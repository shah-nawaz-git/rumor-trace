# RUMOR Trace

Trace the earliest observable occurrence of a public Bluesky post’s claim within retrieved accessible evidence, and visualize propagation relationships and wording mutations.

**[Open the live demo](https://40042ff49095ff.lhr.life/)**

> This is a temporary preview link and may expire, rotate, or become unavailable. If it is unavailable, use the local setup below. The featured investigation does not depend on live Bluesky API access.

## Quick Demo

1. Choose **Try featured investigation**.
2. Observe the clearly labelled illustrative starting point and **five propagation steps**.
3. Compare “may close” becoming “will close,” a reopening time changing from noon to 3 pm, and added negation.
4. Select evidence to inspect its metadata, confidence labels, record references, and relationship basis.
5. Return with **Trace another post**, paste a public `bsky.app` post URL, and choose **Trace this post** for a live bounded investigation.

**Verified live lookup example:** [Bluesky post by tobyfox.undertale.com](https://bsky.app/profile/tobyfox.undertale.com/post/3lhadac2h2c2y). The application retrieved this post during release verification; future availability and coverage may differ.

## Problem

A single social post rarely shows its surrounding conversation or how similar wording appears elsewhere. Missing evidence and superficial similarity can make a neat propagation story look more certain than the underlying data supports.

## Solution

RUMOR Trace separates observable platform relationships from text-based hypotheses. It presents accessible evidence, literal wording differences, and coverage gaps together rather than treating a graph as an explanation of causation.

Two modes share the same evidence model and deterministic analysis:

- **Featured investigation:** a bundled, entirely fictional greenhouse scenario with clearly illustrative accounts, timestamps, relationships, and local evidence details.
- **Live investigation:** a server-side, unauthenticated lookup of accessible public Bluesky evidence around a submitted post.

## Core Features

- Verbatim, heuristic extraction of central claim wording.
- The **earliest observable occurrence found** among retrieved matching posts.
- Reply, quote, and repost-membership evidence, separated from probable or related wording matches.
- Interactive graph, chronological evidence list, and mutation timeline.
- Added/removed text highlighting and qualification, number, and negation change labels.
- Evidence metadata, canonical Bluesky links for live posts, and explicit coverage/error states.
- Responsive layouts, keyboard-operable evidence selection, and reduced-motion support.

## How the Analysis Works

1. Validate the Bluesky URL and resolve a handle to a DID when needed.
2. Retrieve a bounded thread, quotes, and repost memberships through a server-side `POST /api/trace` route. Attempt public text search when enough substantive text is available; keep other evidence if search fails.
3. Normalize and deduplicate records while retaining identifiers, timestamps, references, and retrieval provenance.
4. Compare sentence wording using Unicode normalization, token overlap, and character trigrams. Scores are deterministic heuristics, not calibrated probabilities.
5. Rank matching occurrences by valid record timestamps. Older unrelated conversation context and reposter account dates are not claim occurrences.
6. Build confirmed platform relationships from returned references or memberships. Use literal token-level differences to show wording changes between qualifying posts.

Collection has request, time, pagination, response-size, and record limits. The coverage panel distinguishes empty results, unavailable sources, skipped requests, and reached limits. There is no runtime language-model service, persistent database, or account system.

## Technology Stack

| Layer | Implementation |
| --- | --- |
| Application | Next.js 16.3.5, App Router, React 19.3.0 |
| Language | TypeScript with strict mode |
| Styling | Tailwind CSS 4.3.3 |
| Graph | `@xyflow/react` 12.11.6 |
| Validation | Zod 4.6.2 |
| Public-data access | Server-side native `fetch` to the Bluesky public AppView |
| Automated tests | Vitest 5.0.0 |
| Browser checks | Playwright |
| Package manager | npm with `package-lock.json` |

## Local Setup

Use **Node.js 24 LTS** and npm. No API key or environment file is required.

From the project directory:

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. On Windows PowerShell, use `npm.cmd` in place of `npm` if script execution is restricted.

## Production Build

```bash
npm run build
npm run start
```

Stop any other server using port 3000 before starting the production server, or select another port with `npm run start -- --port 3001`.

## Tests and Checks

```bash
npm run test -- --run
npm run typecheck
npm run lint
```

The committed automated test suite uses Vitest and mocked upstream requests; it does not require live Bluesky access. Playwright is available for browser checks.

## Project Structure

```text
app/                 Single page, layout, styles, and API route
components/          Graph, evidence inspector, timeline, and coverage UI
lib/                 Contracts, URL validation, and deterministic analysis
lib/bluesky/         Bounded API client, collection, and normalization
data/featured.ts     Fictional featured investigation
tests/               Existing unit and route tests
```

## Evidence Model

Posts retain their URI/CID, author, original text, reported timestamps, references, source endpoint, and retrieval time. Findings link back to this evidence. Illustrative items are explicitly labelled and never receive fabricated live Bluesky links.

| Relationship | Meaning |
| --- | --- |
| **Solid** | A reply, quote, or repost membership supported by returned platform data; in the featured case, a scenario-defined illustrative relationship. |
| **Dashed** | A probable wording-based relationship. Similarity and timing do not establish transmission. |
| **Dotted** | Related wording or a shared link, without an asserted propagation direction. |

Repost memberships identify accounts returned for a target post. The API does not supply their repost-event timestamps or intermediate reposter-to-reposter paths, so those are not invented.

## Limitations

- “Earliest observable occurrence” means earliest among retrieved accessible matching evidence, not a guaranteed absolute origin.
- Bluesky coverage may be incomplete because of indexing, unavailable or restricted posts, pagination, and collection limits.
- Public text search may be unavailable. A successful trace can therefore contain useful but partial evidence.
- Record timestamps may be author supplied; indexing time is not independently established publication time.
- Wording analysis is English-first and does not reliably interpret sarcasm, translations, all paraphrases, or image/video/audio claims.
- Wording comparisons are between posts, not a claim that an individual post was edited.
- The featured greenhouse investigation is entirely fictional and illustrative, not a case study of real people or events.

## Responsible Interpretation

Replies, quotes, repost memberships, and similar wording do not independently establish copying, coordination, intent, or causation. A structural connection does not establish agreement or factual validity. RUMOR Trace reports uncertainty and evidence limits rather than claiming absolute verification, assigning nationality or blame, or acting as a general fact-checking engine.
