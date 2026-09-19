import { z } from "zod";
import { blueskyPostUrl, blueskyProfileUrl, type EvidencePost, type RepostMembership } from "../contracts";
import { isObject } from "./client";

const actorSchema = z.object({ did: z.string(), handle: z.string(), displayName: z.string().optional() });
const postViewSchema = z.object({
  uri: z.string(),
  cid: z.string(),
  author: actorSchema,
  record: z.object({
    $type: z.literal("app.bsky.feed.post").optional(),
    text: z.string().max(10_000),
    createdAt: z.string().optional(),
    reply: z.unknown().optional(),
    embed: z.unknown().optional(),
    facets: z.array(z.unknown()).optional(),
  }),
  indexedAt: z.string().optional(),
  replyCount: z.number().int().nonnegative().optional(),
  quoteCount: z.number().int().nonnegative().optional(),
  repostCount: z.number().int().nonnegative().optional(),
});

function reference(value: unknown, kind: "reply" | "quote"): EvidencePost["references"][number] | null {
  if (!isObject(value) || typeof value.uri !== "string" || !blueskyPostUrl(value.uri)) return null;
  return { kind, uri: value.uri, cid: typeof value.cid === "string" ? value.cid : null };
}

export function normalizePost(value: unknown, source: string, retrievedAt: string): EvidencePost | null {
  const parsed = postViewSchema.safeParse(value);
  if (!parsed.success) return null;
  const post = parsed.data;
  const url = blueskyPostUrl(post.uri);
  if (!url || !blueskyProfileUrl(post.author.did) || !post.uri.startsWith(`at://${post.author.did}/`)) return null;
  const references: EvidencePost["references"] = [];
  if (isObject(post.record.reply)) {
    const parent = reference(post.record.reply.parent, "reply");
    if (parent) references.push(parent);
  }
  const embed = post.record.embed;
  if (isObject(embed)) {
    const quoted = embed.$type === "app.bsky.embed.record" ? embed.record
      : embed.$type === "app.bsky.embed.recordWithMedia" && isObject(embed.record) ? embed.record.record : undefined;
    const quote = reference(quoted, "quote");
    if (quote) references.push(quote);
  }
  const urls: string[] = [];
  for (const facet of post.record.facets ?? []) {
    if (!isObject(facet) || !Array.isArray(facet.features)) continue;
    for (const feature of facet.features) {
      if (isObject(feature) && feature.$type === "app.bsky.richtext.facet#link" && typeof feature.uri === "string" && feature.uri.length <= 2_048) urls.push(feature.uri);
    }
  }
  const external = isObject(embed) && embed.$type === "app.bsky.embed.external" ? embed.external
    : isObject(embed) && embed.$type === "app.bsky.embed.recordWithMedia" && isObject(embed.media) ? embed.media.external : null;
  if (isObject(external) && typeof external.uri === "string" && external.uri.length <= 2_048) urls.push(external.uri);
  return {
    id: post.uri,
    cid: post.cid,
    mode: "live",
    author: { did: post.author.did, handle: post.author.handle, name: post.author.displayName || post.author.handle },
    text: post.record.text,
    createdAt: post.record.createdAt ?? null,
    indexedAt: post.indexedAt ?? null,
    retrievedAt,
    references,
    urls: [...new Set(urls)],
    sources: [source],
    url,
    versionConflict: false,
    reportedCounts: { replies: post.replyCount, quotes: post.quoteCount, reposts: post.repostCount },
  };
}

export function normalizeReposter(value: unknown, targetId: string, retrievedAt: string): RepostMembership | null {
  const parsed = actorSchema.safeParse(value);
  if (!parsed.success) return null;
  const actor = parsed.data;
  const profileUrl = blueskyProfileUrl(actor.did);
  if (!profileUrl) return null;
  return {
    id: `membership:${targetId}:${actor.did}`,
    mode: "live",
    targetId,
    did: actor.did,
    handle: actor.handle,
    name: actor.displayName || actor.handle,
    profileUrl,
    retrievedAt,
    source: "reposts",
  };
}
