import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../lib/analyze";
import { LIMITS } from "../lib/contracts";
import { BlueskyClient } from "../lib/bluesky/client";
import { collectTrace } from "../lib/bluesky/collect";
import { normalizePost, normalizeReposter } from "../lib/bluesky/normalize";

const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const uri = `at://${did}/app.bsky.feed.post/seed`;
const text = "The Riverside greenhouse will close for maintenance on Saturday morning and reopen at noon.";
const date = "2026-09-18T11:00:00.000Z";
const parsed = { actor: did, rkey: "seed", canonicalUrl: `https://bsky.app/profile/${did}/post/seed` };
const actor = { did, handle: "example.test", displayName: "Public example" };
const seed = { uri, cid: "seed-cid", author: actor, indexedAt: date, record: { $type: "app.bsky.feed.post", text, createdAt: date } };
const thread = { thread: { $type: "app.bsky.feed.defs#threadViewPost", post: seed } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function mockApi(override?: (url: URL) => Response | undefined) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const custom = override?.(url);
    if (custom) return custom;
    switch (url.pathname.split("/").at(-1)) {
      case "app.bsky.feed.getPostThread": return json(thread);
      case "app.bsky.feed.getQuotes": return json({ uri, posts: [] });
      case "app.bsky.feed.getRepostedBy": return json({ uri, repostedBy: [] });
      case "app.bsky.feed.searchPosts": return new Response("<h1>Forbidden</h1>", { status: 403, headers: { "content-type": "text/html" } });
      case "app.bsky.feed.getPosts": return json({ posts: [] });
      case "com.atproto.identity.resolveHandle": return json({ did });
      default: throw new Error(`Unexpected endpoint: ${url.pathname}`);
    }
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bounded public API client", () => {
  it("classifies a 403 HTML response without retrying or assuming an empty search", async () => {
    const fetch = mockApi();
    const client = new BlueskyClient();
    try {
      await expect(client.request("app.bsky.feed.searchPosts", { q: "greenhouse" })).rejects.toMatchObject({ code: "HTTP_403" });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { client.dispose(); }
  });

  it("enforces the total request cap", async () => {
    const fetch = mockApi();
    const client = new BlueskyClient();
    try {
      for (let i = 0; i < LIMITS.requests; i++) await client.request("app.bsky.feed.getPosts", { uris: [uri] });
      await expect(client.request("app.bsky.feed.getPosts", { uris: [uri] })).rejects.toMatchObject({ code: "REQUEST_LIMIT" });
      expect(fetch).toHaveBeenCalledTimes(LIMITS.requests);
    } finally { client.dispose(); }
  });

  it("rejects oversized streamed responses without trusting content length", async () => {
    const client = new BlueskyClient(undefined, vi.fn(async () => new Response("x".repeat(LIMITS.responseBytes + 1), { headers: { "content-type": "application/json" } })));
    try { await expect(client.request("app.bsky.feed.getPosts", { uris: [uri] })).rejects.toMatchObject({ code: "BYTE_LIMIT" }); }
    finally { client.dispose(); }
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = mockApi();
    const client = new BlueskyClient(controller.signal);
    try {
      await expect(client.request("app.bsky.feed.getPosts", { uris: [uri] })).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).not.toHaveBeenCalled();
    } finally { client.dispose(); }
  });

  it("does not retry rate limits and keeps retry guidance", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } }));
    const client = new BlueskyClient(undefined, fetch);
    try {
      await expect(client.request("app.bsky.feed.getPosts", { uris: [uri] })).rejects.toMatchObject({ code: "RATE_LIMIT", retryAfter: "60" });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { client.dispose(); }
  });

  it("limits concurrent requests and drains queued work", async () => {
    let active = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const fetch = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active--;
      return json({ posts: [] });
    });
    const client = new BlueskyClient(undefined, fetch);
    try {
      const pending = Array.from({ length: 8 }, () => client.request("app.bsky.feed.getPosts", { uris: [uri] }));
      expect(active).toBe(LIMITS.concurrency);
      while (release.length) {
        release.splice(0).forEach((resolve) => resolve());
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await Promise.all(pending);
      expect(peak).toBe(LIMITS.concurrency);
      expect(fetch).toHaveBeenCalledTimes(8);
    } finally { client.dispose(); }
  });

  it("enforces the global deadline", async () => {
    vi.useFakeTimers();
    const client = new BlueskyClient();
    await vi.advanceTimersByTimeAsync(LIMITS.totalMs + 1);
    try { await expect(client.request("app.bsky.feed.getPosts", { uris: [uri] })).rejects.toMatchObject({ code: "DEADLINE" }); }
    finally { client.dispose(); }
  });
});

describe("public evidence normalization", () => {
  it("reads both quote embeds and only the direct reply parent", () => {
    const reference = { uri, cid: "seed-cid" };
    const quote = { ...seed, uri: uri.replace("/seed", "/quote"), cid: "quote-cid", record: { ...seed.record, reply: { parent: reference, root: { uri: uri.replace("/seed", "/root"), cid: "root-cid" } }, embed: { $type: "app.bsky.embed.recordWithMedia", record: { $type: "app.bsky.embed.record", record: reference }, media: { $type: "app.bsky.embed.images", images: [] } } } };
    expect(normalizePost(quote, "quotes", date)?.references).toEqual([{ kind: "reply", ...reference }, { kind: "quote", ...reference }]);
    const simpleQuote = { ...quote, record: { ...quote.record, embed: { $type: "app.bsky.embed.record", record: reference } } };
    expect(normalizePost(simpleQuote, "quotes", date)?.references.at(-1)).toEqual({ kind: "quote", ...reference });
  });

  it("discards account creation/index dates from repost memberships", () => {
    const value = normalizeReposter({ ...actor, createdAt: "2000-01-01T00:00:00Z", indexedAt: date }, uri, date);
    expect(value).not.toHaveProperty("createdAt");
    expect(value).not.toHaveProperty("indexedAt");
    expect(value?.targetId).toBe(uri);
  });

  it("rejects malformed records and mismatched author identities", () => {
    expect(normalizePost({}, "search", date)).toBeNull();
    expect(normalizePost({ ...seed, author: { ...actor, did: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb" } }, "search", date)).toBeNull();
  });
});

describe("partial evidence collection", () => {
  it("retains live seed evidence when search is denied and skips remaining queries", async () => {
    const fetch = mockApi();
    const evidence = await collectTrace(parsed);
    const result = analyze(evidence);
    expect(result.evidence.mode).toBe("live");
    expect(result.evidence.posts).toHaveLength(1);
    expect(result.status).toBe("partial");
    expect(result.earliest?.ids).toEqual([uri]);
    expect(evidence.coverage.sources.find((source) => source.id === "search")).toMatchObject({ status: "unavailable", received: 0 });
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("searchPosts"))).toHaveLength(1);
    expect(evidence.coverage.requestCount).toBe(fetch.mock.calls.length);
    expect(fetch.mock.calls.every(([input]) => new URL(String(input)).hostname === "public.api.bsky.app")).toBe(true);
  });

  it("continues short pages when a cursor is present", async () => {
    mockApi((url) => url.pathname.endsWith("getRepostedBy") ? json({ uri, repostedBy: [{ ...actor, did: url.searchParams.has("cursor") ? "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb" : did }], ...(url.searchParams.has("cursor") ? {} : { cursor: "next" }) }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.reposters).toHaveLength(2);
    expect(result.coverage.sources.find((source) => source.id === "reposts")).toMatchObject({ received: 2, pages: 2, status: "available" });
  });

  it("stops repeated cursors and keeps valid siblings when items are malformed", async () => {
    const quote = { ...seed, uri: uri.replace("/seed", "/quote"), cid: "quote-cid", record: { ...seed.record, embed: { $type: "app.bsky.embed.record", record: { uri, cid: "seed-cid" } } } };
    mockApi((url) => url.pathname.endsWith("getQuotes") ? json({ uri, posts: [quote, { bad: true }], cursor: "repeat" }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.posts).toHaveLength(2);
    expect(result.coverage.sources.find((source) => source.id === "quotes")).toMatchObject({ received: 1, pages: 2, status: "capped", cursorRemaining: true });
    expect(result.coverage.excludedItems).toBe(2);
  });

  it("falls back to seed hydration only after transport/server failure", async () => {
    mockApi((url) => url.pathname.endsWith("getPostThread") ? json({}, 503) : url.pathname.endsWith("getPosts") ? json({ posts: [seed] }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.posts[0].id).toBe(uri);
    expect(result.coverage.sources.find((source) => source.id === "thread")?.status).toBe("unavailable");
    expect(result.coverage.sources.find((source) => source.id === "seed")?.status).toBe("available");
  });

  it("does not bypass missing or blocked seed responses", async () => {
    const fetch = mockApi((url) => url.pathname.endsWith("getPostThread") ? json({ thread: { $type: "app.bsky.feed.defs#blockedPost", uri } }) : undefined);
    await expect(collectTrace(parsed)).rejects.toMatchObject({ code: "NOT_PUBLIC" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not query search for textless posts", async () => {
    const fetch = mockApi((url) => url.pathname.endsWith("getPostThread") ? json({ thread: { $type: "app.bsky.feed.defs#threadViewPost", post: { ...seed, record: { ...seed.record, text: "" } } } }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.coverage.sources.find((source) => source.id === "search")?.status).toBe("skipped");
    expect(fetch.mock.calls.some(([input]) => String(input).includes("searchPosts"))).toBe(false);
    expect(analyze(result).claim).toBeNull();
  });

  it("caps retained posts while preserving the seed", async () => {
    const replies = Array.from({ length: LIMITS.posts + 10 }, (_, index) => ({ $type: "app.bsky.feed.defs#threadViewPost", post: { ...seed, uri: uri.replace("/seed", `/child${index}`), cid: `child-${index}` } }));
    mockApi((url) => url.pathname.endsWith("getPostThread") ? json({ thread: { ...thread.thread, replies } }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.posts).toHaveLength(LIMITS.posts);
    expect(result.posts.some((post) => post.id === uri)).toBe(true);
    expect(result.coverage.sources.find((source) => source.id === "thread")?.status).toBe("capped");
  });

  it("does not recover a blocked thread node from another category", async () => {
    const blockedUri = uri.replace("/seed", "/blocked");
    const fetch = mockApi((url) => url.pathname.endsWith("getPostThread") ? json({ thread: { ...thread.thread, replies: [{ $type: "app.bsky.feed.defs#blockedPost", uri: blockedUri }] } })
      : url.pathname.endsWith("getQuotes") ? json({ uri, posts: [{ ...seed, uri: blockedUri }] }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.posts.some((post) => post.id === blockedUri)).toBe(false);
    expect(result.missing.some((item) => item.id === blockedUri)).toBe(true);
    expect(fetch.mock.calls.some(([input]) => String(input).includes("getPosts"))).toBe(false);
  });

  it("distinguishes empty search results from unavailable search", async () => {
    const fetch = mockApi((url) => url.pathname.endsWith("searchPosts") ? json({ posts: [] }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.coverage.sources.find((source) => source.id === "search")).toMatchObject({ status: "empty", received: 0, pages: 2 });
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("searchPosts"))).toHaveLength(2);
  });

  it("rejects mismatched subjects without losing other evidence", async () => {
    mockApi((url) => url.pathname.endsWith("getQuotes") ? json({ uri: "different", posts: [] }) : undefined);
    const result = await collectTrace(parsed);
    expect(result.posts).toHaveLength(1);
    expect(result.coverage.sources.find((source) => source.id === "quotes")?.status).toBe("unavailable");
  });
});
