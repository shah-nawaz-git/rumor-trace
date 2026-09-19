import type * as React from "react";
import { LIMITS, type CoverageSource, type TraceResult } from "@/lib/contracts";
import { postById, utcLabel } from "./report-utils";

const STATUS_STYLES: Record<CoverageSource["status"], string> = {
  available: "bg-moss text-cream",
  empty: "bg-cream-deep text-forest",
  unavailable: "bg-ember text-forest",
  capped: "bg-forest text-cream",
  skipped: "border border-line text-forest-soft",
};

const STATUS_LABELS: Record<CoverageSource["status"], string> = {
  available: "Available",
  empty: "No results returned",
  unavailable: "Unavailable",
  capped: "Limit reached",
  skipped: "Not requested",
};

export function CoveragePanel({ result }: { result: TraceResult }): React.JSX.Element {
  const { coverage, mode } = result.evidence;
  const live = mode === "live";
  const seed = postById(result, result.evidence.seedId);
  const upstream = seed?.reportedCounts;

  return (
    <div className="space-y-5 text-sm">
      <p className="text-forest-soft">
        {live
          ? `This investigation is bounded; it is not complete coverage of Bluesky. Evidence retrieved ${utcLabel(result.evidence.fetchedAt)}.`
          : `Bundled illustrative data; no Bluesky request was made. Scenario reference time: ${utcLabel(result.evidence.fetchedAt)}.`}
      </p>

      <ul className="space-y-2">
        {coverage.sources.map((source) => (
          <li key={source.id} className="rounded-2xl border border-line bg-white/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{source.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${STATUS_STYLES[source.status]}`}
              >
                {STATUS_LABELS[source.status]}
              </span>
              <span className="text-xs text-forest-soft">
                {source.received} received · {source.pages} page{source.pages === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-forest-soft">
              {source.detail}
              {source.cursorRemaining ? " Additional pages may exist beyond the retrieved cursor." : ""}
            </p>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white/70 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-forest-soft">Counts</h3>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <dt>Upstream requests made</dt>
              <dd className="font-semibold">{coverage.requestCount}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Posts retrieved</dt>
              <dd className="font-semibold">{result.evidence.posts.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Repost memberships retrieved</dt>
              <dd className="font-semibold">{result.evidence.reposters.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Excluded or malformed items</dt>
              <dd className="font-semibold">{coverage.excludedItems}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Unavailable references</dt>
              <dd className="font-semibold">{result.evidence.missing.length}</dd>
            </div>
          </dl>
          {upstream && (upstream.replies !== undefined || upstream.quotes !== undefined || upstream.reposts !== undefined) ? (
            <p className="mt-3 border-t border-line pt-2 text-xs text-forest-soft">
              Upstream-reported totals for the submitted post (separate from retrieved counts):{" "}
              {upstream.replies ?? "not provided"} replies · {upstream.quotes ?? "not provided"} quotes ·{" "}
              {upstream.reposts ?? "not provided"} reposts.
            </p>
          ) : null}
        </div>

        {live ? (
          <div className="rounded-2xl border border-line bg-white/70 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-forest-soft">Collection limits</h3>
            <ul className="mt-2 space-y-1 text-xs text-forest-soft">
              <li>At most {LIMITS.requests} upstream requests · {LIMITS.concurrency} concurrent</li>
              <li>{LIMITS.requestMs / 1000}s per request · {LIMITS.totalMs / 1000}s overall deadline</li>
              <li>
                Up to {LIMITS.pages} pages of {LIMITS.pageSize} per search query or quotes/reposts list · replies to
                depth {LIMITS.depth} · ancestors to height {LIMITS.parentHeight}
              </li>
              <li>
                Retains up to {LIMITS.posts} posts, {LIMITS.reposters} repost memberships, {LIMITS.graphPosts} graph
                post nodes (the repost aggregate is additional)
              </li>
              <li>Upstream responses capped at {Math.round(LIMITS.responseBytes / 1_000_000)} MB each</li>
            </ul>
          </div>
        ) : null}
      </div>

      {coverage.queries.length ? (
        <div className="rounded-2xl border border-line bg-white/70 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-forest-soft">Search queries used</h3>
          <ul className="mt-2 space-y-1 break-all font-mono text-xs text-forest-soft">
            {coverage.queries.map((query) => (
              <li key={query}>{query}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {coverage.notes.length ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-forest-soft">
          {coverage.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
