import { z } from "zod";
import { ANALYSIS, traceInputSchema, traceResultSchema, type EvidenceMatch, type EvidenceRelation, type MutationComparison, type TraceInput, type TraceResult } from "./contracts";
import { bestMatch, describeDiff, extractClaim, meaningfulTokens, similarity, wordDiff } from "./text-analysis";

export function postedTime(value: string | null, fetchedAt: string): number | null {
  if (!value || !z.iso.datetime({ offset: true }).safeParse(value).success) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.parse(fetchedAt) ? time : null;
}

export function analyze(input: TraceInput): TraceResult {
  const evidence = traceInputSchema.parse(input);
  evidence.posts.sort((a, b) => a.id.localeCompare(b.id));
  const posts = new Map(evidence.posts.map((post) => [post.id, post]));
  const seed = posts.get(evidence.seedId)!;
  const claim = seed.versionConflict ? null : extractClaim(seed.text, seed.id);
  const warnings = [
    "This is a bounded view of accessible evidence, not a complete Bluesky history.",
    "Record timestamps are author-supplied. Indexing time is not publication time.",
    "Text similarity does not establish copying, agreement, or transmission.",
    "English-first wording comparison does not interpret media, sarcasm, translations, or all paraphrases.",
  ];
  const matches: EvidenceMatch[] = evidence.posts.map((post) => {
    const best = claim ? bestMatch(claim.excerpt, post.text) : { score: 0, text: "", exact: false };
    const substantial = meaningfulTokens(best.text).length >= ANALYSIS.minTokens;
    const sharedLink = post.urls.some((url) => seed.urls.includes(url));
    const kind = post.versionConflict ? "context" : post.id === seed.id ? "seed"
      : claim && substantial && best.exact ? "exact"
      : claim && substantial && best.score >= ANALYSIS.probable ? "probable"
      : claim && (best.score >= ANALYSIS.related || sharedLink) ? "related" : "context";
    return { id: post.id, kind, score: best.score, matchedText: best.text, timestampValid: postedTime(post.createdAt, evidence.fetchedAt) !== null };
  });
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const eligible = (id: string) => !!claim && ["seed", "exact", "probable"].includes(matchById.get(id)?.kind ?? "");
  const dated = evidence.posts.filter((post) => eligible(post.id) && matchById.get(post.id)?.timestampValid)
    .sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!) || a.id.localeCompare(b.id));
  const earliestTime = dated.length ? Date.parse(dated[0].createdAt!) : null;
  const earliestPosts = dated.filter((post) => Date.parse(post.createdAt!) === earliestTime);
  const earliest = earliestPosts.length ? {
    ids: earliestPosts.map((post) => post.id),
    at: new Date(earliestTime!).toISOString(),
    basis: "record.createdAt" as const,
    candidate: earliestPosts.some((post) => matchById.get(post.id)?.kind === "probable"),
  } : null;
  if (!claim) warnings.push("No substantive text claim was extracted; relationship evidence can still be inspected.");
  if (matches.some((match) => !match.timestampValid)) warnings.push("Undated, invalid, or future-dated records are excluded from earliest-occurrence ranking.");
  if (evidence.posts.some((post) => post.versionConflict)) warnings.push("Conflicting record versions are excluded from claim comparisons.");
  const relations: EvidenceRelation[] = [];
  for (const post of evidence.posts) {
    for (const reference of post.references) {
      const source = posts.get(reference.uri);
      const mismatch = !!(source && reference.cid && source.cid !== reference.cid);
      const sourceId = mismatch ? `version:${reference.uri}:${reference.cid}` : reference.uri;
      if ((!source || mismatch) && !evidence.missing.some((missing) => missing.id === sourceId)) {
        evidence.missing.push({ id: sourceId, reason: mismatch ? "Referenced record version unavailable" : "Referenced post unavailable in collected evidence" });
      }
      const id = `${reference.kind}:${sourceId}:${post.id}`;
      if (relations.some((edge) => edge.id === id)) continue;
      relations.push({ id, source: sourceId, target: post.id, kind: reference.kind, style: "solid", directed: true, evidenceIds: [post.id], reason: `Explicit ${reference.kind} reference in the returned post record; not evidence of agreement or copying.` });
      if (source && !mismatch) {
        const a = postedTime(source.createdAt, evidence.fetchedAt);
        const b = postedTime(post.createdAt, evidence.fetchedAt);
        if (a !== null && b !== null && a > b) warnings.push("A structural relationship conflicts with reported timestamps; its direction is preserved.");
      }
    }
  }
  for (const actor of evidence.reposters) {
    relations.push({ id: `membership:${actor.id}`, source: actor.targetId, target: actor.id, kind: "repost", style: "solid", directed: true, evidenceIds: [actor.id], reason: "Returned repost membership. Event time and any intermediate transmission path are unavailable." });
  }
  const connected = (a: string, b: string) => relations.some((edge) => (edge.source === a && edge.target === b) || (edge.source === b && edge.target === a));
  for (const target of dated) {
    if (relations.some((edge) => edge.target === target.id && edge.style === "solid" && eligible(edge.source))) continue;
    const candidates = dated.filter((source) => Date.parse(source.createdAt!) < Date.parse(target.createdAt!) && !connected(source.id, target.id))
      .map((source) => ({ source, score: similarity(matchById.get(source.id)!.matchedText, matchById.get(target.id)!.matchedText) }))
      .filter((candidate) => candidate.score >= ANALYSIS.probable)
      .sort((a, b) => b.score - a.score || Date.parse(b.source.createdAt!) - Date.parse(a.source.createdAt!) || a.source.id.localeCompare(b.source.id));
    const candidate = candidates[0];
    if (candidate) relations.push({ id: `probable:${candidate.source.id}:${target.id}`, source: candidate.source.id, target: target.id, kind: "probable", style: "dashed", directed: true, evidenceIds: [candidate.source.id, target.id], score: candidate.score, reason: "Similar wording and an earlier reported timestamp; transmission is not established." });
  }
  for (const match of matches) {
    if (match.id === seed.id || match.kind === "context" || connected(seed.id, match.id)) continue;
    if (match.kind !== "related" && relations.some((edge) => edge.source === match.id || edge.target === match.id)) continue;
    const probable = match.kind === "exact" || match.kind === "probable";
    relations.push({ id: `comparison:${seed.id}:${match.id}`, source: seed.id, target: match.id, kind: probable ? "probable" : "related", style: probable ? "dashed" : "dotted", directed: false, evidenceIds: [seed.id, match.id], score: match.score, reason: probable ? "Similar wording without a supported temporal direction; transmission is not established." : "Related wording or a shared link; no propagation direction asserted." });
  }
  const mutations: MutationComparison[] = [];
  for (const edge of relations) {
    if (!edge.directed || edge.kind === "repost" || edge.kind === "related" || !eligible(edge.source) || !eligible(edge.target)) continue;
    const before = matchById.get(edge.source)!.matchedText;
    const after = matchById.get(edge.target)!.matchedText;
    const segments = wordDiff(before, after);
    const summary = describeDiff(segments);
    if (!summary.length) continue;
    mutations.push({ id: `mutation:${edge.id}`, fromId: edge.source, toId: edge.target, edgeId: edge.id, kind: edge.style === "solid" ? "structural" : "comparison", segments, summary });
  }
  mutations.sort((a, b) => (postedTime(posts.get(a.toId)?.createdAt ?? null, evidence.fetchedAt) ?? Infinity) - (postedTime(posts.get(b.toId)?.createdAt ?? null, evidence.fetchedAt) ?? Infinity) || a.id.localeCompare(b.id));
  const partial = evidence.coverage.sources.some((source) => source.status === "unavailable" || source.status === "capped") || evidence.missing.length > 0 || evidence.coverage.excludedItems > 0;
  return traceResultSchema.parse({ evidence, algorithm: ANALYSIS.version, status: partial ? "partial" : "bounded", claim, matches, earliest, relations, mutations, warnings: [...new Set(warnings)] });
}
