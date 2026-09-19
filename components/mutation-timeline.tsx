import type * as React from "react";
import type { TraceResult } from "@/lib/contracts";
import { authorLabel, postById, utcLabel } from "./report-utils";

export function MutationTimeline({
  result,
  onSelect,
}: {
  result: TraceResult;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <section aria-labelledby="mutations-heading" className="rounded-3xl border border-line bg-white/60 p-6">
      <h2 id="mutations-heading" className="font-serif-display text-2xl font-bold">
        Mutation timeline
      </h2>
      <p className="mt-1 text-sm text-forest-soft">
        Literal wording differences between posts. These are comparisons, not edits, and they do not show a demonstrated
        causal chain.
      </p>
      {result.mutations.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-cream-deep/60 px-4 py-3 text-sm text-forest-soft">
          No qualifying wording comparisons exist between the collected posts.
        </p>
      ) : (
        <ol className="mt-4 space-y-4">
          {result.mutations.map((mutation) => {
            const toPost = postById(result, mutation.toId);
            const toMatch = result.matches.find((item) => item.id === mutation.toId);
            return (
            <li key={mutation.id} className="rounded-2xl border border-line bg-white/70 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => onSelect(mutation.fromId)}
                  className="font-semibold text-moss-deep underline underline-offset-2 hover:text-moss"
                >
                  {authorLabel(result, mutation.fromId)}
                </button>
                <span aria-hidden="true">→</span>
                <button
                  type="button"
                  onClick={() => onSelect(mutation.toId)}
                  className="font-semibold text-moss-deep underline underline-offset-2 hover:text-moss"
                >
                  {authorLabel(result, mutation.toId)}
                </button>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                    mutation.kind === "structural"
                      ? "bg-forest text-cream"
                      : "border border-ember text-error"
                  }`}
                >
                  {mutation.kind === "structural" ? "Confirmed relationship" : "Wording comparison"}
                </span>
                <span className="text-xs text-forest-soft">
                  {toMatch?.timestampValid && toPost?.createdAt
                    ? `${utcLabel(toPost.createdAt)} · record time`
                    : "No valid record time"}
                </span>
                {result.evidence.mode === "illustrative" ? (
                  <span className="rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-moss-deep">
                    Illustrative
                  </span>
                ) : null}
              </div>
              <p className="diff-view mt-3 whitespace-pre-wrap rounded-xl bg-cream-deep/50 p-3 text-sm leading-relaxed">
                {mutation.segments.map((segment, index) =>
                  segment.type === "added" ? (
                    <ins key={index}>{segment.text}</ins>
                  ) : segment.type === "removed" ? (
                    <del key={index}>{segment.text}</del>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </p>
              {mutation.summary.length ? (
                <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-forest-soft">
                  {mutation.summary.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
