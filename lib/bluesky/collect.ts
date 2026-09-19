import { LIMITS, blueskyPostUrl, blueskyProfileUrl, traceInputSchema, type CoverageSource, type EvidencePost, type RepostMembership, type TraceInput } from "../contracts";
import { extractClaim, searchQueries } from "../text-analysis";
import { BlueskyClient, TraceError, isObject, type Endpoint } from "./client";
import { normalizePost, normalizeReposter } from "./normalize";

type ParsedUrl = { actor: string; rkey: string; canonicalUrl: string };

export async function collectTrace(parsed: ParsedUrl, signal?: AbortSignal): Promise<TraceInput> {
  const client = new BlueskyClient(signal);
  const posts = new Map<string, EvidencePost>();
  const reposters = new Map<string, RepostMembership>();
  const missing = new Map<string, string>();
  const restricted = new Set<string>();
  const coverage: TraceInput["coverage"] = { sources: [], requestCount: 0, queries: [], notes: [], excludedItems: 0 };
  const stamp = () => new Date().toISOString();
  function source(id: string, label: string): CoverageSource {
    const value: CoverageSource = { id, label, status: "skipped", received: 0, pages: 0, detail: "Not requested.", cursorRemaining: false };
    coverage.sources.push(value);
    return value;
  }
  const identitySource = source("identity", "Handle resolution");
  const threadSource = source("thread", "Post thread");
  const quoteSource = source("quotes", "Quote posts");
  const repostSource = source("reposts", "Repost memberships");
  const searchSource = source("search", "Public text search");
  const hydrationSource = source("hydration", "Referenced posts");

  function fail(stage: CoverageSource, error: unknown) {
    stage.status = error instanceof TraceError && ["DEADLINE", "REQUEST_LIMIT", "BYTE_LIMIT"].includes(error.code) ? "capped" : "unavailable";
    stage.detail = error instanceof TraceError ? error.message : "This evidence source could not be retrieved.";
    if (error instanceof TraceError && error.retryAfter) stage.detail += ` Retry-After: ${error.retryAfter}.`;
  }

  function acceptPost(raw: unknown, stage: CoverageSource): string | null {
    const post = normalizePost(raw, stage.id, stamp());
    if (!post) { coverage.excludedItems++; return null; }
    if (restricted.has(post.id)) {
      coverage.excludedItems++;
      coverage.notes.push("Unavailable public thread references were not recovered through other sources.");
      return null;
    }
    const existing = posts.get(post.id);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, stage.id])];
      if (existing.cid !== post.cid || existing.text !== post.text || existing.createdAt !== post.createdAt) {
        existing.versionConflict = true;
        coverage.notes.push("Conflicting versions of a returned post were retained as a flagged record, not treated as a wording mutation.");
      }
      return post.id;
    }
    if (posts.size >= LIMITS.posts) {
      stage.status = "capped";
      stage.detail = "The retained-post limit was reached.";
      coverage.excludedItems++;
      return null;
    }
    posts.set(post.id, post);
    return post.id;
  }

  function arrayPayload(raw: unknown, key: string): unknown[] {
    if (!isObject(raw) || !Array.isArray(raw[key])) throw new TraceError("Bluesky returned an unexpected response structure.", 502, "INVALID_SCHEMA");
    return raw[key];
  }

  async function paginate(stage: CoverageSource, endpoint: Endpoint, params: Record<string, string | number | undefined>, key: "posts" | "repostedBy", seenIds: Set<string>, accept: (item: unknown) => string | null) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (let page = 0; page < LIMITS.pages; page++) {
      const raw = await client.request(endpoint, { ...params, limit: LIMITS.pageSize, cursor });
      const items = arrayPayload(raw, key);
      if (!isObject(raw)) throw new TraceError("Unexpected public response.", 502, "INVALID_SCHEMA");
      if (params.uri && raw.uri !== params.uri) throw new TraceError("Bluesky returned a different evidence subject.", 502, "INVALID_SCHEMA");
      stage.pages++;
      for (const item of items) {
        const id = accept(item);
        if (id) seenIds.add(id);
      }
      stage.received = seenIds.size;
      if (raw.cursor !== undefined && typeof raw.cursor !== "string") throw new TraceError("Bluesky returned an invalid page cursor.", 502, "INVALID_SCHEMA");
      cursor = typeof raw.cursor === "string" && raw.cursor ? raw.cursor : undefined;
      if (!cursor) break;
      if (cursors.has(cursor) || page === LIMITS.pages - 1) {
        stage.status = "capped";
        stage.cursorRemaining = true;
        stage.detail = cursors.has(cursor) ? "A repeated cursor stopped pagination." : "Two-page limit reached; additional results may exist.";
        break;
      }
      cursors.add(cursor);
    }
    if (stage.status !== "capped") {
      stage.status = stage.received ? "available" : "empty";
      stage.detail = stage.received ? "Accessible results returned within this request scope." : "No results returned for this request scope.";
    }
  }

  try {
    let did = parsed.actor;
    if (!did.startsWith("did:")) {
      try {
        const identity = await client.request("com.atproto.identity.resolveHandle", { handle: did });
        if (!isObject(identity) || typeof identity.did !== "string" || !blueskyProfileUrl(identity.did)) throw new TraceError("Bluesky could not resolve this handle.", 404, "HANDLE_NOT_FOUND");
        did = identity.did;
        Object.assign(identitySource, { status: "available", received: 1, pages: 1, detail: "Handle resolved to a DID; this is not an identity endorsement." });
      } catch (error) {
        if (error instanceof TraceError && error.code === "HTTP_400") throw new TraceError("This Bluesky handle could not be resolved.", 404, "HANDLE_NOT_FOUND");
        throw error;
      }
    } else identitySource.detail = "A DID was provided; handle lookup was not needed.";
    const seedId = `at://${did}/app.bsky.feed.post/${parsed.rkey}`;
    if (!blueskyPostUrl(seedId)) throw new TraceError("The post identifier is invalid.", 400, "INVALID_IDENTIFIER");
    try {
      const raw = await client.request("app.bsky.feed.getPostThread", { uri: seedId, depth: LIMITS.depth, parentHeight: LIMITS.parentHeight });
      if (!isObject(raw) || !isObject(raw.thread)) throw new TraceError("Bluesky returned an unreadable thread.", 502, "INVALID_SCHEMA");
      const root = raw.thread;
      if (["app.bsky.feed.defs#notFoundPost", "app.bsky.feed.defs#blockedPost"].includes(String(root.$type))) throw new TraceError("This post is not publicly accessible.", 404, "NOT_PUBLIC");
      const queue: unknown[] = [root];
      const seenNodes = new Set<unknown>();
      const threadIds = new Set<string>();
      while (queue.length && seenNodes.size < 1_000) {
        const node = queue.shift();
        if (!isObject(node) || seenNodes.has(node)) continue;
        seenNodes.add(node);
        if (["app.bsky.feed.defs#notFoundPost", "app.bsky.feed.defs#blockedPost"].includes(String(node.$type))) {
          if (typeof node.uri === "string") {
            restricted.add(node.uri);
            posts.delete(node.uri);
            threadIds.delete(node.uri);
            missing.set(node.uri, "Unavailable or blocked in the public thread response");
          }
          continue;
        }
        if (node.$type !== "app.bsky.feed.defs#threadViewPost") { coverage.excludedItems++; continue; }
        const id = acceptPost(node.post, threadSource);
        if (id) threadIds.add(id);
        if (node.parent) queue.push(node.parent);
        if (Array.isArray(node.replies)) queue.push(...node.replies);
      }
      if (queue.length) {
        threadSource.status = "capped";
        threadSource.detail = "Thread traversal safety limit reached.";
      }
      threadSource.received = threadIds.size;
      threadSource.pages = 1;
      if (threadSource.status !== "capped") {
        threadSource.status = threadIds.size ? "available" : "empty";
        threadSource.detail = `Returned thread view, limited to reply depth ${LIMITS.depth} and parent height ${LIMITS.parentHeight}. There is no reply-pagination cursor.`;
      }
      if (!posts.has(seedId)) throw new TraceError("Bluesky returned no readable seed post.", 502, "INVALID_SCHEMA");
    } catch (error) {
      fail(threadSource, error);
      const transport = error instanceof TraceError && ["NETWORK", "TIMEOUT", "SERVER_ERROR"].includes(error.code);
      if (!transport || client.exhausted) throw error;
      const fallbackSource = source("seed", "Seed-only fallback");
      const raw = await client.request("app.bsky.feed.getPosts", { uris: [seedId] });
      for (const item of arrayPayload(raw, "posts")) {
        if (isObject(item) && item.uri === seedId) acceptPost(item, fallbackSource);
      }
      if (!posts.has(seedId)) throw new TraceError("This post is not publicly accessible.", 404, "NOT_PUBLIC");
      Object.assign(fallbackSource, { status: "available", received: 1, pages: 1, detail: "Only the seed was recovered; thread context remains unavailable." });
    }
    const seed = posts.get(seedId)!;
    const queryList = extractClaim(seed.text, seedId);
    const queries = queryList ? searchQueries(queryList.excerpt) : [];
    const quoteIds = new Set<string>();
    const reposterIds = new Set<string>();
    const searchIds = new Set<string>();
    await Promise.all([
      (async () => {
        try { await paginate(quoteSource, "app.bsky.feed.getQuotes", { uri: seedId }, "posts", quoteIds, (item) => acceptPost(item, quoteSource)); }
        catch (error) { fail(quoteSource, error); }
      })(),
      (async () => {
        try {
          await paginate(repostSource, "app.bsky.feed.getRepostedBy", { uri: seedId }, "repostedBy", reposterIds, (item) => {
            const actor = normalizeReposter(item, seedId, stamp());
            if (!actor) { coverage.excludedItems++; return null; }
            if (reposters.size >= LIMITS.reposters && !reposters.has(actor.id)) {
              repostSource.status = "capped";
              repostSource.detail = "Retained reposter limit reached.";
              return null;
            }
            reposters.set(actor.id, actor);
            return actor.id;
          });
        } catch (error) { fail(repostSource, error); }
      })(),
      (async () => {
        if (!queries.length) { searchSource.detail = "Insufficient substantive text for a reliable search query."; return; }
        try {
          for (const [index, q] of queries.entries()) {
            const until = index === 1 && seed.indexedAt && Number.isFinite(Date.parse(seed.indexedAt)) ? seed.indexedAt : undefined;
            coverage.queries.push(`${q}${until ? ` | until=${until}` : ""} | sort=latest`);
            await paginate(searchSource, "app.bsky.feed.searchPosts", { q, sort: "latest", until }, "posts", searchIds, (item) => acceptPost(item, searchSource));
          }
        } catch (error) {
          fail(searchSource, error);
          if (error instanceof TraceError && ["HTTP_401", "HTTP_403"].includes(error.code)) searchSource.detail = "Public text search unavailable. Remaining search queries were not attempted; this is not an empty search result.";
        }
      })(),
    ]);
    if (signal?.aborted) throw new DOMException("Investigation cancelled", "AbortError");
    const references = [...new Set([...posts.values()].flatMap((post) => post.references.map((ref) => ref.uri)))].filter((uri) => !posts.has(uri));
    const candidates = references.filter((uri) => !restricted.has(uri));
    if (candidates.length && !client.exhausted) {
      const requested = new Set(candidates.slice(0, 25));
      try {
        const raw = await client.request("app.bsky.feed.getPosts", { uris: [...requested] });
        const hydrated = new Set<string>();
        for (const item of arrayPayload(raw, "posts")) {
          if (!isObject(item) || typeof item.uri !== "string" || !requested.has(item.uri)) { coverage.excludedItems++; continue; }
          const id = acceptPost(item, hydrationSource);
          if (id) hydrated.add(id);
        }
        hydrationSource.received = hydrated.size;
        hydrationSource.pages = 1;
        if (hydrationSource.status !== "capped") {
          hydrationSource.status = candidates.length > 25 ? "capped" : hydrated.size ? "available" : "empty";
          hydrationSource.detail = candidates.length > 25 ? "Only the first 25 referenced posts were requested." : "One batch of explicit references requested; missing posts were not bypassed.";
        }
      } catch (error) { fail(hydrationSource, error); }
    } else hydrationSource.detail = candidates.length ? "No request budget remained for referenced posts." : "No accessible missing references required hydration.";
    for (const uri of references) if (!posts.has(uri) && !missing.has(uri)) missing.set(uri, "Referenced post not returned within this investigation scope");
    if (signal?.aborted) throw new DOMException("Investigation cancelled", "AbortError");
    coverage.requestCount = client.requestCount;
    coverage.notes.push("Quotes and repost memberships were requested for the submitted seed, not recursively for every discovered post.");
    if (queries.length) coverage.notes.push("Search is newest-first and non-exhaustive. Its time filter uses index sort time, not necessarily the record's createdAt.");
    coverage.notes = [...new Set(coverage.notes)];
    return traceInputSchema.parse({ mode: "live", seedId, fetchedAt: stamp(), posts: [...posts.values()], reposters: [...reposters.values()], missing: [...missing].map(([id, reason]) => ({ id, reason })), coverage });
  } finally { client.dispose(); }
}
