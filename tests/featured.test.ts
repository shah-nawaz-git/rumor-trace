import { describe, expect, it, vi } from "vitest";
import { featuredEvidence } from "../data/featured";
import { analyze } from "../lib/analyze";
import { traceResultSchema } from "../lib/contracts";
import { layoutEvidence } from "../lib/graph-layout";

describe("API-independent illustrative investigation", () => {
  it("runs without fetch and never creates live evidence links", () => {
    const fetch = vi.fn(() => { throw new Error("Network disabled"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const result = analyze(featuredEvidence);
      expect(traceResultSchema.safeParse(result).success).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.evidence.posts.every((post) => post.mode === "illustrative" && post.url === null)).toBe(true);
      expect(result.evidence.reposters.every((actor) => actor.profileUrl === null)).toBe(true);
      expect(result.claim).not.toBeNull();
      expect(result.earliest).not.toBeNull();
      expect(result.mutations.length).toBeGreaterThan(0);
      expect(result.evidence.coverage.requestCount).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps graph positions deterministic and distinct", () => {
    const result = analyze(featuredEvidence);
    const layout = layoutEvidence(result);
    expect(layout).toEqual(layoutEvidence(result));
    expect(new Set(layout.positions.map(({ position }) => `${position.x}:${position.y}`)).size).toBe(layout.positions.length);
    expect(layout.hiddenPosts).toBe(0);
  });
});
