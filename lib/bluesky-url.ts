const MAX_URL_LENGTH = 2_048;
const HANDLE_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DID_PATTERN = /^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9._:%-]+)$/;
const RKEY_PATTERN = /^[A-Za-z0-9._~:-]{1,512}$/;
const NONSTANDARD_PATH = /%2f|%5c/i;
const ENCODED_ACTOR_CHAR = /%(?!3[aA])/u;

export class InputError extends Error {}

function rawPathname(input: string): string {
  const afterAuthority = input.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "").replace(/^[^/?#]*/, "");
  return afterAuthority.split(/[?#]/, 1)[0];
}

function hasUnsafeCharacter(input: string): boolean {
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || code <= 0x20) return true;
  }
  return false;
}

export function parseBlueskyUrl(value: unknown): { actor: string; rkey: string; canonicalUrl: string } {
  if (typeof value !== "string") throw new InputError("A public Bluesky post URL is required.");
  const input = value.trim();
  if (!input || input.length > MAX_URL_LENGTH) throw new InputError("Enter a Bluesky post URL up to 2,048 characters.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InputError("Enter a valid URL.");
  }
  if (url.protocol !== "https:") throw new InputError("Only https://bsky.app post URLs are supported.");
  if (url.username || url.password) throw new InputError("URLs with embedded credentials are not accepted.");
  if (url.hostname !== "bsky.app" || url.port) throw new InputError("Only public https://bsky.app post URLs are supported.");

  const path = rawPathname(input);
  if (hasUnsafeCharacter(input) || NONSTANDARD_PATH.test(path)) {
    throw new InputError("Encoded separators or nonstandard path characters are not accepted.");
  }
  let segments: string[];
  try {
    segments = path.split("/").slice(1).map(decodeURIComponent);
  } catch {
    throw new InputError("The post URL contains invalid encoding.");
  }
  if (segments.at(-1) === "") segments.pop();
  if (segments.length !== 4 || segments[0] !== "profile" || segments[2] !== "post" || segments.some((segment) => segment === "." || segment === "..")) {
    throw new InputError("Use a post URL shaped like https://bsky.app/profile/<handle-or-DID>/post/<post-id>.");
  }
  const [, actor, , rkey] = segments;
  if (ENCODED_ACTOR_CHAR.test(actor)) throw new InputError("Encoded characters are not accepted in the profile name.");
  if (!HANDLE_PATTERN.test(actor) && !DID_PATTERN.test(actor)) {
    throw new InputError("The profile must be a Bluesky handle or a did:plc/did:web identifier.");
  }
  if (!RKEY_PATTERN.test(rkey) || rkey === "." || rkey === "..") throw new InputError("The post identifier is invalid.");
  return { actor, rkey, canonicalUrl: `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(rkey)}` };
}
