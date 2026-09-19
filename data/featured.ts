import { traceInputSchema, type EvidencePost, type TraceInput } from "../lib/contracts";

const fetchedAt = "2026-09-19T12:00:00.000Z";
const main = "The Riverside greenhouse will close for maintenance on Saturday morning and reopen at noon.";
const bulletin = "https://example.invalid/illustrative-greenhouse-notice";

function post(id: string, name: string, hour: number, text: string, references: EvidencePost["references"] = [], urls: string[] = [bulletin]): EvidencePost {
  return {
    id: `demo:${id}`,
    cid: `demo-cid:${id}`,
    mode: "illustrative",
    author: { did: `demo:actor:${id}`, handle: `example-${id}`, name },
    text,
    createdAt: `2026-09-18T${String(hour).padStart(2, "0")}:00:00.000Z`,
    indexedAt: `2026-09-18T${String(hour).padStart(2, "0")}:01:00.000Z`,
    retrievedAt: fetchedAt,
    references,
    urls,
    sources: ["featured"],
    url: null,
    versionConflict: false,
    reportedCounts: {},
  };
}

function reference(kind: "reply" | "quote", id: string): EvidencePost["references"][number] {
  return { kind, uri: `demo:${id}`, cid: `demo-cid:${id}` };
}

export const featuredEvidence: TraceInput = traceInputSchema.parse({
  mode: "illustrative",
  seedId: "demo:d",
  fetchedAt,
  posts: [
    post("context", "Example cafe", 7, "The cafe has fresh bread this morning. Have a lovely day.", [], []),
    post("a", "Example garden desk", 8, main.replace("will close", "may close"), [reference("reply", "context")]),
    post("b", "Example community board", 9, main, [reference("quote", "a")]),
    post("c", "Example volunteer", 10, `${main} Bring your plants on Friday.`, [reference("reply", "b")]),
    post("d", "Example neighborhood digest", 11, main),
    post("e", "Example weekend notes", 12, "The Riverside greenhouse will close for maintenance all weekend and reopen on Monday.", [reference("quote", "d")]),
    post("f", "Example noticeboard", 13, main.replace("at noon", "at 3 pm"), [reference("quote", "d")]),
    post("g", "Example garden club", 14, "The greenhouse is getting new benches. Volunteers can help with the Saturday maintenance."),
    post("h", "Example local discussion", 15, main.replace("will close", "will not close"), [reference("reply", "d")]),
  ],
  reposters: ["reader-one", "reader-two", "reader-three"].map((id, index) => ({
    id: `demo:reposter:${id}`,
    mode: "illustrative",
    targetId: "demo:d",
    did: `demo:actor:${id}`,
    handle: `example-${id}`,
    name: `Example reader ${index + 1}`,
    profileUrl: null,
    retrievedAt: fetchedAt,
    source: "featured",
  })),
  missing: [],
  coverage: {
    sources: [{ id: "featured", label: "Illustrative fixture", status: "available", received: 9, pages: 0, detail: "Nine fictional posts and three fictional repost memberships. No live API was contacted.", cursorRemaining: false }],
    requestCount: 0,
    queries: [],
    notes: ["This scenario and its identities are fictional. Every relationship and wording change belongs to the example, not to live Bluesky activity.", "Illustrative items open local evidence details; they have no real Bluesky evidence link."],
    excludedItems: 0,
  },
});
