import { describe, expect, it } from "vitest";
import { bestMatch, describeDiff, extractClaim, normalized, searchQueries, similarity, wordDiff } from "../lib/text-analysis";

const sentence = "The Riverside greenhouse will close for maintenance on Saturday morning and reopen at noon.";

describe("verbatim extraction and wording comparison", () => {
  it("preserves exact source offsets and selects substantive wording", () => {
    const text = ` Hi!  ${sentence}  `;
    const claim = extractClaim(text, "example");
    expect(claim?.excerpt).toBe(sentence);
    expect(text.slice(claim!.start, claim!.end)).toBe(sentence);
  });

  it("does not invent claims for media, short text, or unsegmented scripts", () => {
    for (const text of ["", "yes", "https://example.com", "植物園明日休園です"]) expect(extractClaim(text, "example")).toBeNull();
  });

  it("retains negations and numbers and normalizes URL noise and Unicode", () => {
    expect(normalized("ＮＯ 25 @example.test https://example.com")).toBe("no 25");
    expect(similarity("", "")).toBe(0);
    expect(similarity(sentence, sentence)).toBe(1);
    expect(similarity(sentence, sentence.replace("will close", "will not close"))).toBeLessThan(1);
    expect(similarity(sentence, "The train departs from the harbor after sunset.")).toBeLessThan(0.5);
  });

  it("matches a sentence inside a longer post without paraphrasing", () => {
    const match = bestMatch(sentence, `An unrelated introduction. ${sentence} Thank you!`);
    expect(match).toMatchObject({ exact: true, score: 1, text: sentence });
  });

  it("produces at most two sanitized search queries only for substantive text", () => {
    expect(searchQueries("yes")).toEqual([]);
    const queries = searchQueries(sentence);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatch(/^"[\p{L}\p{N} ]+"$/u);
    expect(queries[1]).not.toMatch(/[+():]/u);
  });
});

describe("literal word differences", () => {
  it("reconstructs both original strings losslessly", () => {
    const after = sentence.replace("will close", "may not close").replace("at noon", "at 3 pm");
    const diff = wordDiff(sentence, after);
    expect(diff.filter((part) => part.type !== "added").map((part) => part.text).join("")).toBe(sentence);
    expect(diff.filter((part) => part.type !== "removed").map((part) => part.text).join("")).toBe(after);
    expect(describeDiff(diff)).toEqual(expect.arrayContaining(["Number wording changed", "Negation wording changed", "Qualification wording changed"]));
  });

  it("does not manufacture changes", () => {
    expect(describeDiff(wordDiff(sentence, sentence))).toEqual([]);
    expect(wordDiff("", "Hello")).toEqual([{ type: "added", text: "Hello" }]);
  });
});
