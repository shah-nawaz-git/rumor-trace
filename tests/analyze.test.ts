import { describe, expect, it } from "vitest";
import { featuredEvidence } from "../data/featured";
import { analyze, postedTime } from "../lib/analyze";
import { traceInputSchema } from "../lib/contracts";

function fixture() { return structuredClone(featuredEvidence); }

describe("evidence-grounded analysis", () => {
  it("ignores unrelated earlier ancestors for the earliest matching occurrence", () => {
    const result = analyze(fixture());
    expect(result.earliest?.ids).toEqual(["demo:a"]);
    expect(result.earliest?.candidate).toBe(true);
    expect(result.matches.find((match) => match.id === "demo:context")?.kind).toBe("context");
    expect(result.relations.some((edge) => edge.source === "demo:context" && edge.target === "demo:a" && edge.style === "solid")).toBe(true);
  });

  it("keeps repost memberships untimed and out of claim chronology", () => {
    const input = fixture();
    Object.assign(input.reposters[0], { createdAt: "2000-01-01T00:00:00Z", indexedAt: "2000-01-01T00:00:00Z" });
    const result = analyze(input);
    expect(result.earliest?.ids).toEqual(["demo:a"]);
    expect(result.evidence.reposters[0]).not.toHaveProperty("createdAt");
    expect(result.relations.filter((edge) => edge.kind === "repost")).toHaveLength(3);
    expect(result.relations.filter((edge) => edge.kind === "repost").every((edge) => edge.source === input.seedId)).toBe(true);
  });

  it("preserves ties and excludes invalid/future timestamps", () => {
    const input = fixture();
    input.posts.find((post) => post.id === "demo:a")!.createdAt = "invalid";
    const first = input.posts.find((post) => post.id === "demo:b")!;
    input.posts.find((post) => post.id === "demo:c")!.createdAt = first.createdAt;
    input.posts.find((post) => post.id === "demo:h")!.createdAt = "2099-01-01T00:00:00Z";
    expect(analyze(input).earliest?.ids).toEqual(["demo:b", "demo:c"]);
    expect(postedTime(null, input.fetchedAt)).toBeNull();
    expect(postedTime("2026-02-31T00:00:00Z", input.fetchedAt)).toBeNull();
  });

  it("produces all three edge semantics and references evidence for every finding", () => {
    const result = analyze(fixture());
    expect(new Set(result.relations.map((edge) => edge.style))).toEqual(new Set(["solid", "dashed", "dotted"]));
    const ids = new Set([...result.evidence.posts, ...result.evidence.reposters].map((item) => item.id));
    for (const edge of result.relations) expect(edge.evidenceIds.every((id) => ids.has(id))).toBe(true);
    for (const mutation of result.mutations) {
      expect(ids.has(mutation.fromId) && ids.has(mutation.toId)).toBe(true);
      expect(result.relations.some((edge) => edge.id === mutation.edgeId)).toBe(true);
    }
    expect(result.relations.filter((edge) => edge.style === "dotted").every((edge) => !edge.directed)).toBe(true);
  });

  it("describes lexical qualification and negation, not intent", () => {
    const result = analyze(fixture());
    expect(result.mutations.flatMap((mutation) => mutation.summary)).toContain("Qualification wording changed");
    expect(result.mutations.flatMap((mutation) => mutation.summary)).toContain("Negation wording changed");
    expect(result.mutations.some((mutation) => mutation.toId === "demo:context")).toBe(false);
  });

  it("excludes conflicting versions from claim comparisons and retains version-specific missing references", () => {
    const input = fixture();
    input.posts.find((post) => post.id === "demo:a")!.versionConflict = true;
    input.posts.find((post) => post.id === "demo:b")!.references[0].cid = "old-version";
    const result = analyze(input);
    expect(result.earliest?.ids).not.toContain("demo:a");
    expect(result.evidence.missing.some((missing) => missing.id.startsWith("version:demo:a:"))).toBe(true);
    expect(result.mutations.some((mutation) => mutation.fromId === "demo:a")).toBe(false);
  });

  it("supports a seed-only or textless partial result without inventing discoveries", () => {
    const input = fixture();
    input.posts = input.posts.filter((post) => post.id === input.seedId);
    input.reposters = [];
    input.coverage.sources.push({ id: "search", label: "Search", status: "unavailable", received: 0, pages: 0, detail: "HTTP 403", cursorRemaining: false });
    const result = analyze(input);
    expect(result.status).toBe("partial");
    expect(result.earliest?.ids).toEqual([input.seedId]);
    expect(result.mutations).toEqual([]);
    input.posts[0].text = "";
    expect(analyze(input).claim).toBeNull();
    expect(analyze(input).earliest).toBeNull();
  });

  it("rejects mixed provenance and fabricated illustrative links", () => {
    const input = fixture();
    input.posts[0].mode = "live";
    expect(traceInputSchema.safeParse(input).success).toBe(false);
    const second = fixture();
    second.posts[0].url = "https://bsky.app/profile/example/post/fake";
    expect(traceInputSchema.safeParse(second).success).toBe(false);
  });

  it("is deterministic for the same evidence", () => {
    expect(analyze(fixture())).toEqual(analyze(fixture()));
  });
});
