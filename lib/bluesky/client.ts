import { LIMITS } from "../contracts";

export class TraceError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code = "UPSTREAM", public readonly retryAfter?: string) {
    super(message);
    this.name = "TraceError";
  }
}

export type Endpoint = "com.atproto.identity.resolveHandle" | "app.bsky.feed.getPostThread" | "app.bsky.feed.getPosts" | "app.bsky.feed.getQuotes" | "app.bsky.feed.getRepostedBy" | "app.bsky.feed.searchPosts";
type Params = Record<string, string | number | string[] | undefined>;

export class BlueskyClient {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly startedAt = Date.now();
  private active = 0;
  private readonly queue: (() => void)[] = [];
  requestCount = 0;

  constructor(private readonly caller?: AbortSignal, private readonly fetcher: typeof fetch = fetch) {
    this.timer = setTimeout(() => this.controller.abort(), LIMITS.totalMs);
  }

  get exhausted(): boolean {
    return this.requestCount >= LIMITS.requests || this.controller.signal.aborted || Date.now() - this.startedAt >= LIMITS.totalMs;
  }

  dispose(): void { clearTimeout(this.timer); }

  private checkBudget(): void {
    if (this.caller?.aborted) throw new DOMException("Investigation cancelled", "AbortError");
    if (this.controller.signal.aborted || Date.now() - this.startedAt >= LIMITS.totalMs) throw new TraceError("Investigation deadline reached; only collected evidence is available.", 504, "DEADLINE");
    if (this.requestCount >= LIMITS.requests) throw new TraceError("Upstream request limit reached.", 502, "REQUEST_LIMIT");
  }

  async request(endpoint: Endpoint, params: Params): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.attempt(endpoint, params); }
      catch (error) {
        const retryable = error instanceof TraceError && ["NETWORK", "TIMEOUT", "SERVER_ERROR"].includes(error.code);
        if (attempt || !retryable || this.exhausted || this.caller?.aborted) throw error;
      }
    }
    throw new TraceError("Public Bluesky request unavailable.");
  }

  private async attempt(endpoint: Endpoint, params: Params): Promise<unknown> {
    this.checkBudget();
    if (this.active >= LIMITS.concurrency) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      this.checkBudget();
      const url = new URL(`https://public.api.bsky.app/xrpc/${endpoint}`);
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
      }
      const timeout = AbortSignal.timeout(LIMITS.requestMs);
      const signal = AbortSignal.any([this.controller.signal, timeout, ...(this.caller ? [this.caller] : [])]);
      this.requestCount++;
      let response: Response;
      try {
        response = await this.fetcher(url, { headers: { Accept: "application/json" }, redirect: "error", cache: "no-store", signal });
        const raw = await readBounded(response);
        const isJson = /\bapplication\/(?:[a-z.+-]*\+)?json\b/i.test(response.headers.get("content-type") ?? "");
        let data: unknown;
        if (isJson) {
          try { data = JSON.parse(raw); }
          catch { if (response.ok) throw new TraceError("Bluesky returned malformed JSON.", 502, "INVALID_JSON"); }
        }
        if (!response.ok) {
          const knownMissing = isObject(data) && ["NotFound", "BlockedActor", "BlockedByActor", "AccountTakedown"].includes(String(data.error));
          if (response.status === 404 || knownMissing) throw new TraceError("This post is not publicly accessible.", 404, "NOT_PUBLIC");
          if (response.status === 429) throw new TraceError("Bluesky is rate limiting public requests. Please try again later.", 429, "RATE_LIMIT", response.headers.get("retry-after") ?? undefined);
          if (response.status >= 500) throw new TraceError("Bluesky is temporarily unavailable.", 502, "SERVER_ERROR");
          throw new TraceError(`Public Bluesky request unavailable (HTTP ${response.status}).`, 502, `HTTP_${response.status}`);
        }
        if (!isJson) throw new TraceError("Bluesky returned a non-JSON response.", 502, "CONTENT_TYPE");
        return data;
      } catch (error) {
        if (this.caller?.aborted) throw new DOMException("Investigation cancelled", "AbortError");
        if (this.controller.signal.aborted) throw new TraceError("Investigation deadline reached; only collected evidence is available.", 504, "DEADLINE");
        if (error instanceof TraceError) throw error;
        if (timeout.aborted) throw new TraceError("Public Bluesky request timed out.", 504, "TIMEOUT");
        throw new TraceError("Public Bluesky request failed.", 502, "NETWORK");
      }
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBounded(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > LIMITS.responseBytes) {
    await response.body?.cancel();
    throw new TraceError("Bluesky response exceeded the evidence byte limit.", 502, "BYTE_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > LIMITS.responseBytes) {
        await reader.cancel();
        throw new TraceError("Bluesky response exceeded the evidence byte limit.", 502, "BYTE_LIMIT");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
