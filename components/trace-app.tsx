"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type * as React from "react";
import { analyze } from "@/lib/analyze";
import { featuredEvidence } from "@/data/featured";
import { traceResultSchema, type TraceResult } from "@/lib/contracts";
import { InputError, parseBlueskyUrl } from "@/lib/bluesky-url";
import { InvestigationReport } from "@/components/investigation-report";

const featuredResult = analyze(featuredEvidence);

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; mode: "live" | "illustrative" }
  | { kind: "ready"; result: TraceResult }
  | { kind: "error"; message: string };

function responseErrorMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const error = (data as { error?: { message?: unknown } }).error;
  return error && typeof error.message === "string" && error.message ? error.message : null;
}

export default function TraceApp(): React.JSX.Element {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      sequenceRef.current += 1;
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function clearPending() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function startDemo() {
    clearPending();
    const sequence = ++sequenceRef.current;
    setFormError(null);
    setState({ kind: "loading", mode: "illustrative" });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (sequenceRef.current !== sequence) return;
      setSelectedId(featuredResult.evidence.seedId);
      setState({ kind: "ready", result: featuredResult });
    }, reduced ? 0 : 600);
  }

  function startLive(value: string) {
    clearPending();
    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "loading", mode: "live" });
    fetch("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: value }),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(responseErrorMessage(data) ?? "The investigation could not be completed.");
        }
        const parsed = traceResultSchema.safeParse(data);
        if (!parsed.success) throw new Error("The investigation returned an unreadable result.");
        if (sequenceRef.current !== sequence) return;
        setSelectedId(parsed.data.evidence.seedId);
        setState({ kind: "ready", result: parsed.data });
      })
      .catch((error: unknown) => {
        if (sequenceRef.current !== sequence || controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "The investigation could not be completed.",
        });
      });
  }

  function submitLive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      parseBlueskyUrl(url);
    } catch (error) {
      setFormError(error instanceof InputError ? error.message : "Enter a valid public Bluesky post URL.");
      return;
    }
    setFormError(null);
    startLive(url.trim());
  }

  function retryLive() {
    try {
      parseBlueskyUrl(url);
    } catch {
      setFormError("Enter a valid public Bluesky post URL before retrying.");
      return;
    }
    setFormError(null);
    startLive(url.trim());
  }

  function resetTrace() {
    clearPending();
    sequenceRef.current += 1;
    setSelectedId("");
    setFormError(null);
    setState({ kind: "idle" });
    requestAnimationFrame(() => document.getElementById("post-url")?.focus());
  }

  const loadingLive = state.kind === "loading" && state.mode === "live";
  const loadingDemo = state.kind === "loading" && state.mode === "illustrative";
  const modeLabel =
    state.kind === "ready"
      ? state.result.evidence.mode === "illustrative"
        ? "Illustrative example"
        : "Live trace"
      : state.kind === "loading"
        ? state.mode === "illustrative"
          ? "Illustrative example"
          : "Live trace"
        : null;

  return (
    <div className="min-h-screen bg-cream text-forest">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-serif-display text-2xl font-bold tracking-tight">
            RUMOR <span className="text-ember-deep">TRACE</span>
          </span>
          <span className="rounded-full border border-line bg-cream-deep px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-forest-soft">
            Bluesky Beta
          </span>
        </div>
        {modeLabel ? (
          <span className="rounded-full bg-forest px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream">
            {modeLabel}
          </span>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-16">
        {state.kind !== "ready" ? (
          <>
            <section aria-labelledby="hero-heading" className="mt-6 max-w-3xl">
              <h1 id="hero-heading" className="font-serif-display text-4xl font-bold leading-tight md:text-5xl">
                Every story leaves a trace.
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-forest-soft">
                Paste a public Bluesky post and RUMOR Trace gathers a bounded set of accessible evidence: confirmed
                replies, quotes, and repost memberships, wording that probably matches, and an honest record of what
                could not be retrieved.
              </p>
            </section>

            <section aria-labelledby="trace-form-heading" className="mt-8">
              <h2 id="trace-form-heading" className="sr-only">
                Trace a public Bluesky post
              </h2>
              <form onSubmit={submitLive} noValidate>
                <label htmlFor="post-url" className="block text-sm font-semibold uppercase tracking-wide">
                  Public Bluesky post URL
                </label>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                  <input
                    id="post-url"
                    name="post-url"
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://bsky.app/profile/…/post/…"
                    autoComplete="off"
                    aria-invalid={formError ? true : undefined}
                    aria-describedby={formError ? "post-url-error" : undefined}
                    className="w-full min-w-0 rounded-2xl border border-line bg-white/70 px-4 py-3 text-base placeholder:text-forest/40"
                  />
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      disabled={loadingLive}
                      className="w-full rounded-2xl border-2 border-ember-deep bg-ember/15 px-5 py-3 font-semibold text-error transition-colors hover:bg-ember/30 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      Trace this post
                    </button>
                    <button
                      type="button"
                      onClick={startDemo}
                      disabled={loadingDemo}
                      className="w-full rounded-2xl bg-forest px-5 py-3 font-semibold text-cream transition-colors hover:bg-forest-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      Try featured investigation
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-forest-soft">
                  Featured investigation always works without Bluesky access. Live lookup may return limited data.
                </p>
              </form>
              {formError ? (
                <p id="post-url-error" role="alert" className="mt-2 text-sm font-semibold text-error">
                  {formError}
                </p>
              ) : null}
            </section>

            {state.kind === "error" ? (
              <div role="alert" className="mt-6 rounded-2xl border border-ember bg-white/60 p-5">
                <p className="font-semibold text-error">The live trace did not complete.</p>
                <p className="mt-1 text-sm text-forest-soft">{state.message}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={retryLive}
                    className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-cream hover:bg-forest-soft"
                  >
                    Retry this URL
                  </button>
                  <button
                    type="button"
                    onClick={startDemo}
                    className="rounded-xl border border-moss px-4 py-2 text-sm font-semibold text-moss-deep hover:bg-moss hover:text-cream"
                  >
                    Explore the featured example instead
                  </button>
                </div>
              </div>
            ) : null}

            {state.kind === "loading" ? (
              <div role="status" className="mt-8 rounded-2xl border border-line bg-white/50 p-6" aria-live="polite">
                <div className="trace-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <p className="mt-2 font-semibold">
                  {loadingLive ? "Gathering accessible evidence" : "Preparing the illustrative example"}
                </p>
                <p className="mt-1 text-sm text-forest-soft">
                  {loadingLive
                    ? "Querying the public Bluesky API within a bounded budget. This may take a few seconds."
                    : "Loading a clearly labelled fictional scenario. No network request is made."}
                </p>
              </div>
            ) : null}

            {state.kind === "idle" ? (
              <section
                aria-labelledby="featured-heading"
                className="mt-10 rounded-3xl border border-line bg-white/60 p-6 md:p-8"
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-moss-deep">Featured investigation</p>
                <h2 id="featured-heading" className="font-serif-display mt-2 text-2xl font-bold">
                  The greenhouse notice that changed in the telling
                </h2>
                <p className="mt-3 max-w-2xl leading-relaxed text-forest-soft">
                  A fully fictional, clearly labelled scenario: a Riverside greenhouse maintenance announcement travels
                  through replies and quotes while its wording quietly shifts. Every account, timestamp, and link is
                  illustrative — nothing here is live Bluesky evidence.
                </p>
                <button
                  type="button"
                  onClick={startDemo}
                  className="mt-5 rounded-2xl bg-forest px-5 py-3 font-semibold text-cream transition-colors hover:bg-forest-soft"
                >
                  Open the featured investigation
                </button>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-serif-display text-3xl font-bold">Investigation report</h1>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={resetTrace}
                  className="rounded-2xl bg-forest px-5 py-2.5 font-semibold text-cream transition-colors hover:bg-forest-soft"
                >
                  Trace another post
                </button>
                {state.result.evidence.mode === "live" ? (
                  <button
                    type="button"
                    onClick={startDemo}
                    className="rounded-2xl border-2 border-moss px-5 py-2.5 font-semibold text-moss-deep transition-colors hover:bg-moss hover:text-cream"
                  >
                    Open featured example
                  </button>
                ) : null}
              </div>
            </div>
            <InvestigationReport
              key={`${state.result.evidence.mode}:${state.result.evidence.seedId}:${state.result.evidence.fetchedAt}`}
              result={state.result}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </>
        )}
      </main>
    </div>
  );
}
