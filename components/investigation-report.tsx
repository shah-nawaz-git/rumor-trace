"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type * as React from "react";
import type { TraceResult } from "@/lib/contracts";
import { EvidencePanel } from "./evidence-panel";
import { MutationTimeline } from "./mutation-timeline";
import { CoveragePanel } from "./coverage-panel";
import { KIND_LABELS, REPOST_GROUP_ID, matchKind, postById, utcLabel } from "./report-utils";

const EvidenceGraph = dynamic(() => import("./evidence-graph"), {
  ssr: false,
  loading: () => (
    <div className="graph-frame flex h-[480px] items-center justify-center" role="status">
      <p className="text-sm text-cream/80">Loading evidence graph…</p>
    </div>
  ),
});

const featuredSteps = [
  { id: "demo:a", title: "Illustrative starting point", confidence: "Scenario-defined", note: "The announcement says “may close”." },
  { id: "demo:b", title: "1 · Quoted announcement", confidence: "Quote · illustrative", note: "“May close” becomes “will close”." },
  { id: "demo:c", title: "2 · Reply adds context", confidence: "Reply · illustrative", note: "The wording is retained; a Friday reminder is added." },
  { id: "demo:d", title: "3 · Similar wording appears", confidence: "Probable wording match", note: "Matching text, without a direct platform reference." },
  { id: "demo:f", title: "4 · Reopening time changes", confidence: "Quote · illustrative", note: "“At noon” becomes “at 3 pm”." },
  { id: "demo:h", title: "5 · Negation is added", confidence: "Reply · illustrative", note: "“Will close” becomes “will not close”." },
];

function renderStepNote(note: string): React.ReactNode {
  return note.split(/(“[^”]*”)/g).map((part, index) =>
    part.startsWith("“") ? (
      <strong key={index} className="font-semibold text-moss-deep">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

export function InvestigationReport({
  result,
  selectedId,
  onSelect,
}: {
  result: TraceResult;
  selectedId: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const [showGraph, setShowGraph] = useState(false);
  const illustrative = result.evidence.mode === "illustrative";
  const timestamped = new Set(result.matches.filter((match) => match.timestampValid).map((match) => match.id));
  const orderedPosts = [...result.evidence.posts].sort((a, b) => {
    const aTime = timestamped.has(a.id) && a.createdAt ? Date.parse(a.createdAt) : Infinity;
    const bTime = timestamped.has(b.id) && b.createdAt ? Date.parse(b.createdAt) : Infinity;
    return aTime - bTime;
  });
  const earliest = result.earliest;
  const degraded = result.evidence.coverage.sources.filter(
    (source) => source.status === "unavailable" || source.status === "capped",
  );

  return (
    <article aria-label="Investigation report" className="mt-4 space-y-8">
      <div
        className={`rounded-2xl border px-5 py-4 ${
          illustrative ? "border-moss bg-[#dcefe6]" : "border-ember bg-[#fbe4d8]"
        }`}
      >
        <p className="font-semibold">
          {illustrative
            ? "Illustrative example — not live Bluesky evidence."
            : `Live bounded trace of public Bluesky evidence — status: ${result.status}.`}
        </p>
        <p className="mt-1 text-sm text-forest-soft">
          {illustrative
            ? "Every item below is fictional and labelled. Illustrative items open local details only."
            : "This is a bounded view of accessible evidence, not a complete Bluesky history."}
        </p>
        {degraded.length ? (
          <ul className="mt-2 space-y-0.5 text-xs font-semibold">
            {degraded.map((source) => (
              <li key={source.id}>
                {source.label} ({source.status}): {source.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <section aria-labelledby="claim-heading" className="rounded-3xl border border-line bg-white/60 p-6">
          <h2 id="claim-heading" className="text-xs font-semibold uppercase tracking-widest text-moss-deep">
            Central claim
          </h2>
          {result.claim ? (
            <>
              <blockquote className="font-serif-display mt-3 text-lg leading-relaxed">
                “{result.claim.excerpt}”
              </blockquote>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-forest-soft">
                Extracted wording · heuristic
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-forest-soft">
              No substantive text claim could be extracted. Relationship evidence below remains available.
            </p>
          )}
        </section>

        <section aria-labelledby="earliest-heading" className="rounded-3xl border border-line bg-white/60 p-6">
          <h2 id="earliest-heading" className="text-xs font-semibold uppercase tracking-widest text-moss-deep">
            Earliest observable occurrence found
          </h2>
          <p className="mt-1 text-xs text-forest-soft">Among retrieved matching posts</p>
          {earliest ? (
            <>
              <p className="font-serif-display mt-3 text-lg font-semibold">{utcLabel(earliest.at)}</p>
              <p className="mt-1 text-xs text-forest-soft">Basis: record.createdAt — author-supplied time</p>
              {earliest.candidate ? (
                <span className="mt-2 inline-block rounded-full border border-ember px-2.5 py-0.5 text-xs font-semibold text-error">
                  Text-based candidate
                </span>
              ) : null}
              <ul className="mt-3 space-y-1">
                {earliest.ids.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      className="text-sm font-semibold text-moss-deep underline underline-offset-2 hover:text-moss"
                    >
                      {postById(result, id)?.author.name ?? id}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-forest-soft">
              No dated matching post was found within the retrieved evidence.
            </p>
          )}
        </section>

        <section aria-labelledby="metrics-heading" className="rounded-3xl border border-line bg-white/60 p-6">
          <h2 id="metrics-heading" className="text-xs font-semibold uppercase tracking-widest text-moss-deep">
            Retrieved evidence
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-forest-soft">Posts collected</dt>
              <dd className="font-serif-display text-2xl font-bold">{result.evidence.posts.length}</dd>
            </div>
            <div>
              <dt className="text-forest-soft">Repost memberships</dt>
              <dd className="font-serif-display text-2xl font-bold">{result.evidence.reposters.length}</dd>
            </div>
            <div>
              <dt className="text-forest-soft">Relationships</dt>
              <dd className="font-serif-display text-2xl font-bold">{result.relations.length}</dd>
            </div>
            <div>
              <dt className="text-forest-soft">Unavailable references</dt>
              <dd className="font-serif-display text-2xl font-bold">{result.evidence.missing.length}</dd>
            </div>
          </dl>
        </section>
      </div>

      {illustrative ? (
        <section aria-labelledby="steps-heading" className="rounded-3xl border border-line bg-white/60 p-6">
          <h2 id="steps-heading" className="font-serif-display text-2xl font-bold">
            An illustrative starting point. Five propagation steps.
          </h2>
          <p className="mt-1 text-sm text-forest-soft">
            Fictional evidence, shown chronologically. The graph shows branches; this is not a single demonstrated
            transmission chain.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featuredSteps.map((step) => (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  aria-pressed={selectedId === step.id}
                  className={`flex h-full w-full flex-col gap-2 rounded-2xl border p-4 text-left transition-colors ${
                    selectedId === step.id ? "border-ember bg-[#fbe4d8]" : "border-line bg-white/70 hover:border-moss"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{step.title}</span>
                    <span className="rounded-full bg-cream-deep px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
                      {step.confidence}
                    </span>
                    <span className="rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-moss-deep">
                      Illustrative
                    </span>
                  </span>
                  <span className="text-xs text-forest-soft">{renderStepNote(step.note)}</span>
                  <span className="line-clamp-3 text-sm leading-snug wrap-anywhere">
                    {postById(result, step.id)?.text ?? "Post not in evidence."}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="evidence-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="evidence-heading" className="font-serif-display text-2xl font-bold">
            Evidence and relationships
          </h2>
          <button
            type="button"
            onClick={() => setShowGraph((value) => !value)}
            aria-expanded={showGraph}
            className="rounded-xl border border-moss px-4 py-2 text-sm font-semibold text-moss-deep hover:bg-moss hover:text-cream md:hidden"
          >
            {showGraph ? "Hide evidence graph" : "Show evidence graph"}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-6 md:grid md:grid-cols-5">
          <div className="order-1 min-w-0 space-y-5 md:order-2 md:col-span-2">
            <EvidencePanel result={result} selectedId={selectedId} onSelect={onSelect} />
            <div className="rounded-3xl border border-line bg-white/60 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-forest-soft">
                Chronological evidence list
              </h3>
              <ol className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto pr-1">
                {orderedPosts.map((post) => {
                  const kind = matchKind(result, post.id);
                  return (
                    <li key={post.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(post.id)}
                        aria-pressed={selectedId === post.id}
                        className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                          selectedId === post.id
                            ? "border-ember bg-[#fbe4d8]"
                            : "border-line bg-white/70 hover:border-moss"
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold wrap-anywhere">{post.author.name}</span>
                          <span className="text-xs text-forest-soft wrap-anywhere">@{post.author.handle}</span>
                          <span className="rounded-full bg-cream-deep px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
                            {KIND_LABELS[kind] ?? kind}
                          </span>
                          {illustrative ? (
                            <span className="rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-moss-deep">
                              Illustrative
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs text-forest-soft">
                          {post.createdAt && timestamped.has(post.id)
                            ? `${utcLabel(post.createdAt)} · record time`
                            : "No valid record time"}
                        </span>
                        <span className="mt-1 block text-sm leading-snug wrap-anywhere">
                          {post.text.length > 140 ? `${post.text.slice(0, 140)}…` : post.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {result.evidence.missing.length ? (
                <ul className="mt-3 space-y-1 border-t border-line pt-3">
                  {result.evidence.missing.map((missing) => (
                    <li key={missing.id} className="rounded-xl bg-cream-deep/60 px-3 py-2 text-xs text-forest-soft wrap-anywhere">
                      Unavailable reference — {missing.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.evidence.reposters.length ? (
                <button
                  type="button"
                  onClick={() => onSelect(REPOST_GROUP_ID)}
                  className="mt-3 w-full rounded-xl border border-moss px-4 py-2 text-sm font-semibold text-moss-deep hover:bg-moss hover:text-cream"
                >
                  Inspect {result.evidence.reposters.length} repost membership
                  {result.evidence.reposters.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="order-2 min-w-0 md:order-1 md:col-span-3">
            <div className={showGraph ? "block" : "hidden md:block"}>
              <EvidenceGraph result={result} selectedId={selectedId} onSelect={onSelect} />
            </div>
          </div>
        </div>
      </section>

      <MutationTimeline result={result} onSelect={onSelect} />

      <details className="coverage-details rounded-3xl border border-line bg-white/60 p-6">
        <summary className="font-serif-display text-xl font-bold">Detailed coverage and limits</summary>
        <div className="mt-4">
          <CoveragePanel result={result} />
        </div>
      </details>

      {result.warnings.length ? (
        <section aria-labelledby="limits-heading" className="rounded-3xl border border-line bg-white/60 p-6">
          <h2 id="limits-heading" className="text-xs font-semibold uppercase tracking-widest text-moss-deep">
            Interpretation limits
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-forest-soft">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
