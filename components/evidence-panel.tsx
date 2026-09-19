import type * as React from "react";
import type { TraceResult } from "@/lib/contracts";
import { KIND_LABELS, REPOST_GROUP_ID, authorLabel, matchKind, postById, utcLabel } from "./report-utils";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-moss-deep underline underline-offset-2 hover:text-moss">
      {children}
    </a>
  );
}

export function EvidencePanel({
  result,
  selectedId,
  onSelect,
}: {
  result: TraceResult;
  selectedId: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const illustrative = result.evidence.mode === "illustrative";

  if (!selectedId) {
    return (
      <section aria-labelledby="detail-heading" className="rounded-3xl border border-line bg-white/60 p-5">
        <h3 id="detail-heading" className="text-xs font-semibold uppercase tracking-widest text-forest-soft">
          Selected evidence
        </h3>
        <p className="mt-3 text-sm text-forest-soft">Select an evidence item to inspect its details.</p>
      </section>
    );
  }

  if (selectedId === REPOST_GROUP_ID) {
    const seedPost = postById(result, result.evidence.seedId);
    return (
      <section aria-labelledby="detail-heading" className="rounded-3xl border border-line bg-white/60 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="detail-heading" className="text-xs font-semibold uppercase tracking-widest text-forest-soft">
            Returned repost memberships
          </h3>
          {illustrative ? (
            <span className="rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-moss-deep">
              Illustrative
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-forest-soft">
          {result.evidence.reposters.length} account{result.evidence.reposters.length === 1 ? "" : "s"} returned for the
          submitted post. Repost event times are not provided; these profiles are not a cascade.
        </p>
        {!illustrative && seedPost?.url ? (
          <p className="mt-3">
            <ExternalLink href={seedPost.url}>Open the reposted post on Bluesky</ExternalLink>
          </p>
        ) : null}
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {result.evidence.reposters.map((actor) => (
            <li key={actor.id} className="rounded-xl border border-line bg-white/70 px-3 py-2 text-sm wrap-anywhere">
              <span className="font-semibold">{actor.name}</span>{" "}
              <span className="text-forest-soft">@{actor.handle}</span>
              {illustrative ? (
                <span className="ml-2 rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-moss-deep">
                  Illustrative
                </span>
              ) : actor.profileUrl ? (
                <>
                  {" "}
                  <ExternalLink href={actor.profileUrl}>Profile</ExternalLink>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const reposter = result.evidence.reposters.find((actor) => actor.id === selectedId);
  if (reposter) {
    const target = postById(result, reposter.targetId);
    return (
      <section aria-labelledby="detail-heading" className="rounded-3xl border border-line bg-white/60 p-5">
        <h3 id="detail-heading" className="text-xs font-semibold uppercase tracking-widest text-forest-soft">
          Repost membership
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-serif-display text-lg font-bold wrap-anywhere">{reposter.name}</span>
          <span className="text-sm text-forest-soft wrap-anywhere">@{reposter.handle}</span>
          {illustrative ? (
            <span className="rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-moss-deep">
              Illustrative
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-forest-soft">
          Returned as a repost of the submitted post. The repost event time is not provided.
        </p>
        <dl className="mt-4 space-y-1 break-all text-xs text-forest-soft">
          <div className="flex gap-2">
            <dt className="font-semibold">DID:</dt>
            <dd>{reposter.did}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Retrieved:</dt>
            <dd>{utcLabel(reposter.retrievedAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Evidence via:</dt>
            <dd>{reposter.source}</dd>
          </div>
        </dl>
        {!illustrative ? (
          <div className="mt-4 flex flex-wrap gap-4">
            {reposter.profileUrl ? <ExternalLink href={reposter.profileUrl}>Profile on Bluesky</ExternalLink> : null}
            {target?.url ? <ExternalLink href={target.url}>Open the reposted post on Bluesky</ExternalLink> : null}
          </div>
        ) : null}
      </section>
    );
  }

  const post = postById(result, selectedId);
  if (!post) {
    const missing = result.evidence.missing.find((item) => item.id === selectedId);
    return (
      <section aria-labelledby="detail-heading" className="rounded-3xl border border-line bg-white/60 p-5">
        <h3 id="detail-heading" className="text-xs font-semibold uppercase tracking-widest text-forest-soft">
          Selected evidence
        </h3>
        <p className="mt-3 text-sm text-forest-soft wrap-anywhere">
          {missing ? `This reference is unavailable: ${missing.reason}.` : "This item is not part of the report."}
        </p>
      </section>
    );
  }

  const kind = matchKind(result, post.id);
  const match = result.matches.find((item) => item.id === post.id);
  const isSeed = post.id === result.evidence.seedId;
  const isEarliest = result.earliest?.ids.includes(post.id) ?? false;
  const counts = post.reportedCounts;
  const relations = result.relations.filter((edge) => edge.source === post.id || edge.target === post.id);

  return (
    <section aria-labelledby="detail-heading" className="rounded-3xl border border-line bg-white/60 p-5">
      <h3 id="detail-heading" className="text-xs font-semibold uppercase tracking-widest text-forest-soft">
        Selected evidence
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-serif-display text-lg font-bold wrap-anywhere">{post.author.name}</span>
        <span className="text-sm text-forest-soft wrap-anywhere">@{post.author.handle}</span>
        <span className="rounded-full bg-cream-deep px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
          {KIND_LABELS[kind] ?? kind}
        </span>
        {isSeed ? (
          <span className="rounded-full bg-ember px-2 py-0.5 text-[0.65rem] font-bold uppercase text-forest">Seed</span>
        ) : null}
        {isEarliest ? (
          <span className="rounded-full bg-moss px-2 py-0.5 text-[0.65rem] font-bold uppercase text-white">
            Earliest match
          </span>
        ) : null}
        {illustrative ? (
          <span className="rounded-full border border-moss px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-moss-deep">
            Illustrative
          </span>
        ) : null}
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed wrap-anywhere">{post.text}</p>
      {post.url ? (
        <p className="mt-3">
          <ExternalLink href={post.url}>Open this post on Bluesky</ExternalLink>
        </p>
      ) : null}
      {match && !match.timestampValid ? (
        <p className="mt-3 rounded-xl bg-[#fbe4d8] px-3 py-2 text-xs font-semibold text-error">
          This record time is invalid or future-dated; it is excluded from chronology.
        </p>
      ) : null}
      {post.versionConflict ? (
        <p className="mt-3 rounded-xl bg-[#fbe4d8] px-3 py-2 text-xs font-semibold text-error">
          Conflicting versions of this record were returned; it is excluded from wording comparisons.
        </p>
      ) : null}
      <dl className="mt-4 space-y-1 text-xs text-forest-soft">
        <div className="flex gap-2">
          <dt className="font-semibold">Record time (author-supplied):</dt>
          <dd>{utcLabel(post.createdAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Indexed time:</dt>
          <dd>{utcLabel(post.indexedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Retrieved:</dt>
          <dd>{utcLabel(post.retrievedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Evidence via:</dt>
          <dd>{post.sources.join(", ")}</dd>
        </div>
        {counts.replies !== undefined || counts.quotes !== undefined || counts.reposts !== undefined ? (
          <div className="flex gap-2">
            <dt className="font-semibold">Upstream-reported totals:</dt>
            <dd>
              {counts.replies ?? "not provided"} replies · {counts.quotes ?? "not provided"} quotes ·{" "}
              {counts.reposts ?? "not provided"} reposts
            </dd>
          </div>
        ) : null}
      </dl>
      <details className="coverage-details mt-3">
        <summary className="text-xs font-semibold uppercase tracking-wide text-forest-soft">Record identifiers</summary>
        <dl className="mt-2 space-y-1 break-all text-xs text-forest-soft">
          <div className="flex gap-2">
            <dt className="font-semibold">Evidence ID:</dt>
            <dd>{post.id}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold">Record CID:</dt>
            <dd>{post.cid ?? "not provided"}</dd>
          </div>
        </dl>
      </details>
      {relations.length ? (
        <details className="coverage-details mt-4">
          <summary className="text-xs font-semibold uppercase tracking-wide text-forest-soft">
            Relationship evidence ({relations.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {relations.map((relation) => {
              const counterpartId = relation.source === post.id ? relation.target : relation.source;
              const counterpart = postById(result, counterpartId);
              const counterpartReposter = result.evidence.reposters.find((actor) => actor.id === counterpartId);
              return (
                <li key={relation.id} className="rounded-xl border border-line bg-white/70 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold capitalize">
                      {relation.kind} · {relation.style}
                    </span>
                    {typeof relation.score === "number" ? (
                      <span className="text-forest-soft">
                        Wording score {relation.score.toFixed(2)} (heuristic, not a probability)
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 leading-relaxed text-forest-soft wrap-anywhere">{relation.reason}</p>
                  <p className="mt-1">
                    {counterpart || counterpartReposter ? (
                      <button
                        type="button"
                        onClick={() => onSelect(counterpartId)}
                        className="font-semibold text-moss-deep underline underline-offset-2 hover:text-moss"
                      >
                        {authorLabel(result, counterpartId)}
                      </button>
                    ) : (
                      <span className="text-forest-soft">Counterpart unavailable in collected evidence</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {post.references.length ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-forest-soft">Record references</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {post.references.map((reference) => {
              const target = postById(result, reference.uri);
              const versionAvailable = !!target && (!reference.cid || target.cid === reference.cid);
              return (
                <li key={`${reference.kind}:${reference.uri}`} className="wrap-anywhere">
                  <span className="font-semibold capitalize">{reference.kind}</span>{" "}
                  {versionAvailable ? (
                    <button
                      type="button"
                      onClick={() => onSelect(reference.uri)}
                      className="font-semibold text-moss-deep underline underline-offset-2 hover:text-moss"
                    >
                      → {target.author.name}
                    </button>
                  ) : target ? (
                    <span className="text-forest-soft">→ referenced record version unavailable</span>
                  ) : (
                    <span className="text-forest-soft">→ referenced post unavailable in collected evidence</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {post.urls.length ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-forest-soft">Links in post</h4>
          <ul className="mt-2 space-y-1 break-all text-sm">
            {post.urls.map((link) => (
              <li key={link}>
                <span>{link}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
