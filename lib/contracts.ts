import { z } from "zod";

export const LIMITS = Object.freeze({
  requests: 12,
  concurrency: 3,
  requestMs: 6_000,
  totalMs: 20_000,
  responseBytes: 2_000_000,
  posts: 150,
  reposters: 100,
  graphPosts: 40,
  pages: 2,
  pageSize: 50,
  depth: 2,
  parentHeight: 8,
});

export const ANALYSIS = Object.freeze({
  version: "wording-v1",
  probable: 0.82,
  related: 0.5,
  minTokens: 6,
});

const modeSchema = z.enum(["live", "illustrative"]);
const referenceSchema = z.object({
  kind: z.enum(["reply", "quote"]),
  uri: z.string().max(2_048),
  cid: z.string().nullable(),
});

export function blueskyPostUrl(uri: string): string | null {
  const match = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]+)$/.exec(uri);
  if (!match || match[2] === "." || match[2] === "..") return null;
  return `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`;
}

export function blueskyProfileUrl(did: string): string | null {
  return /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(did)
    ? `https://bsky.app/profile/${encodeURIComponent(did)}`
    : null;
}

export const postSchema = z.object({
  id: z.string().max(2_048),
  cid: z.string().nullable(),
  mode: modeSchema,
  author: z.object({ did: z.string(), handle: z.string(), name: z.string() }),
  text: z.string().max(10_000),
  createdAt: z.string().nullable(),
  indexedAt: z.string().nullable(),
  retrievedAt: z.iso.datetime(),
  references: z.array(referenceSchema),
  urls: z.array(z.string().max(2_048)),
  sources: z.array(z.string()),
  url: z.string().nullable(),
  versionConflict: z.boolean().default(false),
  reportedCounts: z.object({
    replies: z.number().int().nonnegative().optional(),
    quotes: z.number().int().nonnegative().optional(),
    reposts: z.number().int().nonnegative().optional(),
  }),
}).superRefine((post, context) => {
  const valid = post.mode === "illustrative"
    ? post.id.startsWith("demo:") && post.url === null
    : !!blueskyPostUrl(post.id) && post.url === blueskyPostUrl(post.id);
  if (!valid) context.addIssue({ code: "custom", message: "Post provenance and link do not agree." });
});

export const reposterSchema = z.object({
  id: z.string(),
  mode: modeSchema,
  targetId: z.string(),
  did: z.string(),
  handle: z.string(),
  name: z.string(),
  profileUrl: z.string().nullable(),
  retrievedAt: z.iso.datetime(),
  source: z.string(),
}).superRefine((actor, context) => {
  const valid = actor.mode === "illustrative"
    ? actor.id.startsWith("demo:") && actor.profileUrl === null
    : !!blueskyProfileUrl(actor.did) && actor.profileUrl === blueskyProfileUrl(actor.did) && !!blueskyPostUrl(actor.targetId);
  if (!valid) context.addIssue({ code: "custom", message: "Repost membership provenance does not agree." });
});

export const coverageSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["available", "empty", "unavailable", "capped", "skipped"]),
  received: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  detail: z.string(),
  cursorRemaining: z.boolean().default(false),
});

export const coverageSchema = z.object({
  sources: z.array(coverageSourceSchema),
  requestCount: z.number().int().nonnegative(),
  queries: z.array(z.string()),
  notes: z.array(z.string()),
  excludedItems: z.number().int().nonnegative(),
});

export const traceInputSchema = z.object({
  mode: modeSchema,
  seedId: z.string(),
  fetchedAt: z.iso.datetime(),
  posts: z.array(postSchema).max(LIMITS.posts),
  reposters: z.array(reposterSchema).max(LIMITS.reposters),
  missing: z.array(z.object({ id: z.string(), reason: z.string() })),
  coverage: coverageSchema,
}).superRefine((input, context) => {
  if (!input.posts.some((post) => post.id === input.seedId)) {
    context.addIssue({ code: "custom", message: "Accessible seed evidence is required." });
  }
  if ([...input.posts, ...input.reposters].some((item) => item.mode !== input.mode)) {
    context.addIssue({ code: "custom", message: "Live and illustrative evidence cannot be mixed." });
  }
  if (new Set(input.posts.map((post) => post.id)).size !== input.posts.length) {
    context.addIssue({ code: "custom", message: "Evidence IDs must be unique." });
  }
});

export const claimSchema = z.object({
  excerpt: z.string(),
  sourceId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  method: z.literal("verbatim-v1"),
});

export const matchSchema = z.object({
  id: z.string(),
  kind: z.enum(["seed", "exact", "probable", "related", "context"]),
  score: z.number().min(0).max(1),
  matchedText: z.string(),
  timestampValid: z.boolean(),
});

export const relationSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.enum(["reply", "quote", "repost", "probable", "related"]),
  style: z.enum(["solid", "dashed", "dotted"]),
  directed: z.boolean(),
  evidenceIds: z.array(z.string()),
  score: z.number().min(0).max(1).optional(),
  reason: z.string(),
});

export const diffSegmentSchema = z.object({
  type: z.enum(["equal", "added", "removed"]),
  text: z.string(),
});

export const mutationSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  edgeId: z.string(),
  kind: z.enum(["structural", "comparison"]),
  segments: z.array(diffSegmentSchema),
  summary: z.array(z.string()),
});

export const traceResultSchema = z.object({
  evidence: traceInputSchema,
  algorithm: z.literal(ANALYSIS.version),
  status: z.enum(["bounded", "partial"]),
  claim: claimSchema.nullable(),
  matches: z.array(matchSchema),
  earliest: z.object({
    ids: z.array(z.string()).min(1),
    at: z.string(),
    basis: z.literal("record.createdAt"),
    candidate: z.boolean(),
  }).nullable(),
  relations: z.array(relationSchema),
  mutations: z.array(mutationSchema),
  warnings: z.array(z.string()),
});

export type EvidencePost = z.infer<typeof postSchema>;
export type RepostMembership = z.infer<typeof reposterSchema>;
export type CoverageSource = z.infer<typeof coverageSourceSchema>;
export type TraceInput = z.infer<typeof traceInputSchema>;
export type TraceResult = z.infer<typeof traceResultSchema>;
export type ClaimExcerpt = z.infer<typeof claimSchema>;
export type EvidenceMatch = z.infer<typeof matchSchema>;
export type EvidenceRelation = z.infer<typeof relationSchema>;
export type MutationComparison = z.infer<typeof mutationSchema>;
export type DiffSegment = z.infer<typeof diffSegmentSchema>;
