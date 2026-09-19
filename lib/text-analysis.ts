import { ANALYSIS, type ClaimExcerpt, type DiffSegment } from "./contracts";

const stopWords = new Set("a an the is are was were be been being to of for in on at by with and or as it its this that these those from your our their us we they you i he she".split(" "));

export function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/@[\p{L}\p{N}._-]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ").trim();
}

export function tokens(text: string): string[] {
  return normalized(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function meaningfulTokens(text: string): string[] {
  return tokens(text).filter((token) => !stopWords.has(token));
}

export function sentences(text: string): { text: string; start: number; end: number }[] {
  const segments = new Intl.Segmenter("en", { granularity: "sentence" }).segment(text);
  return [...segments].map(({ segment, index }) => {
    const leading = segment.length - segment.trimStart().length;
    const trimmed = segment.trim();
    return { text: trimmed, start: index + leading, end: index + leading + trimmed.length };
  }).filter((segment) => segment.text.length > 0);
}

export function extractClaim(text: string, sourceId: string): ClaimExcerpt | null {
  const best = sentences(text).sort((a, b) => meaningfulTokens(b.text).length - meaningfulTokens(a.text).length || a.start - b.start)[0];
  if (!best || meaningfulTokens(best.text).length < ANALYSIS.minTokens) return null;
  return { excerpt: best.text, sourceId, start: best.start, end: best.end, method: "verbatim-v1" };
}

function trigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= value.length - 3; index++) result.add(value.slice(index, index + 3));
  return result;
}

export function similarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const wordsA = new Set(tokens(a));
  const wordsB = new Set(tokens(b));
  const wordIntersection = [...wordsA].filter((word) => wordsB.has(word)).length;
  const jaccard = wordIntersection / new Set([...wordsA, ...wordsB]).size;
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  const gramIntersection = [...gramsA].filter((gram) => gramsB.has(gram)).length;
  const denominator = gramsA.size + gramsB.size;
  const dice = denominator ? 2 * gramIntersection / denominator : 0;
  return Math.min(1, 0.65 * jaccard + 0.35 * dice);
}

export function bestMatch(excerpt: string, text: string): { score: number; text: string; exact: boolean } {
  const candidates = sentences(text).map((sentence) => ({
    score: similarity(excerpt, sentence.text),
    text: sentence.text,
    exact: normalized(excerpt) === normalized(sentence.text),
    start: sentence.start,
  })).sort((a, b) => b.score - a.score || a.start - b.start);
  return candidates[0] ?? { score: 0, text: "", exact: false };
}

export function searchQueries(excerpt: string): string[] {
  if (meaningfulTokens(excerpt).length < ANALYSIS.minTokens) return [];
  const phrase = tokens(excerpt).slice(0, 20).join(" ");
  const keywords = [...new Set(meaningfulTokens(excerpt))].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 7).join(" ");
  return [...new Set([`"${phrase}"`, keywords])];
}

export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = before.match(/\s+|[^\s]+/gu) ?? [];
  const b = after.match(/\s+|[^\s]+/gu) ?? [];
  if (a.length > 400 || b.length > 400) return [{ type: "removed", text: before }, { type: "added", text: after }];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffSegment[] = [];
  function append(type: DiffSegment["type"], text: string) {
    const previous = result.at(-1);
    if (previous?.type === type) previous.text += text;
    else result.push({ type, text });
  }
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      append("equal", a[i++]);
      j++;
    } else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
      append("removed", a[i++]);
    } else append("added", b[j++]);
  }
  return result;
}

export function describeDiff(segments: DiffSegment[]): string[] {
  const changed = segments.filter((segment) => segment.type !== "equal" && segment.text.trim());
  const summaries: string[] = [];
  if (changed.some((segment) => /\d/u.test(segment.text))) summaries.push("Number wording changed");
  if (changed.some((segment) => /\b(?:not|never|no|cannot|can't|won't|don't|doesn't|isn't)\b/iu.test(segment.text))) summaries.push("Negation wording changed");
  if (changed.some((segment) => /\b(?:may|might|could|possibly|reportedly|allegedly|perhaps)\b/iu.test(segment.text))) summaries.push("Qualification wording changed");
  if (!summaries.length && changed.length) summaries.push("Wording changed");
  return summaries;
}
