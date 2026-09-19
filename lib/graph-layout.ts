import { LIMITS, type TraceResult } from "./contracts";

export function layoutEvidence(result: TraceResult) {
  const earliest = new Set(result.earliest?.ids ?? []);
  const priority = (id: string) => id === result.evidence.seedId ? 0 : earliest.has(id) ? 1 : result.matches.find((match) => match.id === id)?.kind === "context" ? 3 : 2;
  const selected = [...result.evidence.posts].sort((a, b) => priority(a.id) - priority(b.id) || a.id.localeCompare(b.id)).slice(0, LIMITS.graphPosts);
  const valid = new Set(result.matches.filter((match) => match.timestampValid).map((match) => match.id));
  const ordered = selected.sort((a, b) => {
    const left = valid.has(a.id) ? Date.parse(a.createdAt!) : Infinity;
    const right = valid.has(b.id) ? Date.parse(b.createdAt!) : Infinity;
    return (left === right ? 0 : left - right) || a.id.localeCompare(b.id);
  });
  const positions = ordered.map((post, index) => ({
    id: post.id,
    position: { x: Math.floor(index / 3) * 340, y: (index % 3) * 190 },
  }));
  return { positions, hiddenPosts: result.evidence.posts.length - selected.length };
}
