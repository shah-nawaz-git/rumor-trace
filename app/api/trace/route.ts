import { collectTrace } from "@/lib/bluesky/collect";
import { analyze } from "@/lib/analyze";
import { InputError, parseBlueskyUrl } from "@/lib/bluesky-url";
import { TraceError } from "@/lib/bluesky/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;

class BodyTooLargeError extends Error {}

function errorResponse(status: number, message: string, code: string, retryAfter?: string): Response {
  return Response.json(
    { error: { message, code, ...(retryAfter ? { retryAfter } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return errorResponse(415, "Request body must be application/json.", "UNSUPPORTED_MEDIA_TYPE");
    }
    const raw = await readBoundedBody(request);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return errorResponse(400, "Request body must be valid JSON.", "INVALID_JSON");
    }
    const url = typeof payload === "object" && payload !== null ? (payload as { url?: unknown }).url : undefined;
    const parsed = parseBlueskyUrl(url);
    const evidence = await collectTrace(parsed, request.signal);
    const result = analyze(evidence);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return errorResponse(499, "Investigation cancelled before completion.", "CANCELLED");
    }
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, "Request body exceeds the 4 KB limit.", "PAYLOAD_TOO_LARGE");
    }
    if (error instanceof InputError) return errorResponse(400, error.message, "INVALID_INPUT");
    if (error instanceof TraceError) return errorResponse(error.status, error.message, error.code, error.retryAfter);
    return errorResponse(502, "The investigation could not be completed.", "INTERNAL");
  }
}
