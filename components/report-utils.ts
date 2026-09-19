import { z } from "zod";
import type { EvidencePost, TraceResult } from "@/lib/contracts";

export const REPOST_GROUP_ID = "repost-membership-group";

export const KIND_LABELS: Record<string, string> = {
  seed: "Submitted post",
  exact: "Exact wording",
  probable: "Probable wording match",
  related: "Related text",
  context: "Conversation context",
};

export function utcLabel(value: string | null): string {
  if (!value) return "Not recorded";
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) return "Invalid timestamp";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Invalid timestamp";
  return `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function postById(result: TraceResult, id: string): EvidencePost | undefined {
  return result.evidence.posts.find((post) => post.id === id);
}

export function matchKind(result: TraceResult, id: string): string {
  return result.matches.find((match) => match.id === id)?.kind ?? "context";
}

export function authorLabel(result: TraceResult, id: string): string {
  const post = postById(result, id);
  if (post) return post.author.name;
  const reposter = result.evidence.reposters.find((actor) => actor.id === id);
  return reposter?.name ?? id;
}
