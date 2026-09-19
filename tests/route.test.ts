import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceInput } from "@/lib/contracts";

vi.mock("@/lib/bluesky/collect", () => ({ collectTrace: vi.fn() }));
vi.mock("@/lib/analyze", () => ({ analyze: vi.fn() }));

import { POST } from "@/app/api/trace/route";
import { collectTrace } from "@/lib/bluesky/collect";
import { analyze } from "@/lib/analyze";
import { TraceError } from "@/lib/bluesky/client";

const collectMock = vi.mocked(collectTrace);
const analyzeMock = vi.mocked(analyze);

const VALID_URL = "https://bsky.app/profile/alice.example.com/post/3mv6jm4auic2g";

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/trace", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorBody(response: Response) {
  return (await response.json()) as { error: { message: string; code: string; retryAfter?: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/trace", () => {
  it("passes validated input to the collector and returns the analysis", async () => {
    const evidence = { marker: "collected-evidence" };
    const result = { marker: "trace-result" };
    collectMock.mockResolvedValue(evidence as unknown as TraceInput);
    analyzeMock.mockReturnValue(result as never);

    const response = await POST(jsonRequest({ url: VALID_URL }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
    expect(collectMock).toHaveBeenCalledWith(
      { actor: "alice.example.com", rkey: "3mv6jm4auic2g", canonicalUrl: VALID_URL },
      expect.any(AbortSignal),
    );
    expect(analyzeMock).toHaveBeenCalledWith(evidence);
  });

  it("rejects an invalid URL without calling the collector", async () => {
    const response = await POST(jsonRequest({ url: "https://not-bsky.example/profile/a.b/post/x" }));
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(collectMock).not.toHaveBeenCalled();
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies with 400", async () => {
    const response = await POST(jsonRequest("{not-json"));
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_JSON");
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content types with 415", async () => {
    const response = await POST(jsonRequest({ url: VALID_URL }, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("rejects media types that merely contain the json substring", async () => {
    for (const contentType of ["application/json-patch+json", "xapplication/json", "application/jsonx"]) {
      const response = await POST(jsonRequest({ url: VALID_URL }, { "content-type": contentType }));
      expect(response.status).toBe(415);
    }
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("accepts application/json with a charset parameter", async () => {
    collectMock.mockResolvedValue({ marker: "evidence" } as unknown as TraceInput);
    analyzeMock.mockReturnValue({ ok: true } as never);
    const response = await POST(jsonRequest({ url: VALID_URL }, { "content-type": "application/json; charset=utf-8" }));
    expect(response.status).toBe(200);
  });

  it("rejects a streamed body over 4 KB with 413 regardless of Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5_000));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/trace", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "32" },
      body: stream,
      duplex: "half",
    } as unknown as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("maps TraceError to its status, code, message, and retryAfter", async () => {
    collectMock.mockRejectedValue(new TraceError("Bluesky is rate limiting public requests. Please try again later.", 429, "RATE_LIMIT", "30"));
    const response = await POST(jsonRequest({ url: VALID_URL }));
    expect(response.status).toBe(429);
    expect(await errorBody(response)).toEqual({
      error: { message: "Bluesky is rate limiting public requests. Please try again later.", code: "RATE_LIMIT", retryAfter: "30" },
    });
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("returns a generic 502 for unexpected failures without leaking internals", async () => {
    collectMock.mockRejectedValue(new Error("sensitive upstream body <html>…</html>"));
    const response = await POST(jsonRequest({ url: VALID_URL }));
    expect(response.status).toBe(502);
    const body = await errorBody(response);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("sensitive");
  });

  it("returns 499 when the investigation is aborted", async () => {
    collectMock.mockRejectedValue(new DOMException("Investigation cancelled", "AbortError"));
    const response = await POST(jsonRequest({ url: VALID_URL }));
    expect(response.status).toBe(499);
    expect((await errorBody(response)).error.code).toBe("CANCELLED");
  });
});
