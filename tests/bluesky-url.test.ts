import { describe, expect, it } from "vitest";
import { InputError, parseBlueskyUrl } from "@/lib/bluesky-url";
import { blueskyPostUrl } from "@/lib/contracts";

const HANDLE_URL = "https://bsky.app/profile/alice.example.com/post/3mv6jm4auic2g";

function expectInputError(value: unknown) {
  expect(() => parseBlueskyUrl(value)).toThrowError(InputError);
}

describe("parseBlueskyUrl", () => {
  it("accepts a hostname-style handle post URL", () => {
    expect(parseBlueskyUrl(HANDLE_URL)).toEqual({
      actor: "alice.example.com",
      rkey: "3mv6jm4auic2g",
      canonicalUrl: HANDLE_URL,
    });
  });

  it("accepts a did:plc actor", () => {
    const parsed = parseBlueskyUrl("https://bsky.app/profile/did:plc:z72i7hdynmk6r22z27h6tvur/post/3mv6jm4auic2g");
    expect(parsed.actor).toBe("did:plc:z72i7hdynmk6r22z27h6tvur");
    expect(parsed.rkey).toBe("3mv6jm4auic2g");
  });

  it("accepts a did:web actor", () => {
    expect(parseBlueskyUrl("https://bsky.app/profile/did:web:example.com/post/abc").actor).toBe("did:web:example.com");
  });

  it("strips tracking query and fragment and a trailing slash", () => {
    const parsed = parseBlueskyUrl(`${HANDLE_URL}/?utm_source=share&ref=1#comments`);
    expect(parsed.canonicalUrl).toBe(HANDLE_URL);
  });

  it("trims surrounding whitespace", () => {
    expect(parseBlueskyUrl(`  ${HANDLE_URL}  `).canonicalUrl).toBe(HANDLE_URL);
  });

  it("rejects non-string input", () => {
    for (const value of [undefined, null, 42, {}, [], true]) expectInputError(value);
  });

  it("rejects empty and oversized input", () => {
    expectInputError("");
    expectInputError("   ");
    expectInputError(`${HANDLE_URL}${"a".repeat(2_048)}`);
  });

  it("rejects non-https schemes", () => {
    expectInputError(HANDLE_URL.replace("https://", "http://"));
    expectInputError(HANDLE_URL.replace("https://", "ftp://"));
  });

  it("rejects deceptive hosts", () => {
    expectInputError(HANDLE_URL.replace("bsky.app", "bsky.app.evil.example"));
    expectInputError(HANDLE_URL.replace("bsky.app", "notbsky.app"));
    expectInputError(HANDLE_URL.replace("bsky.app", "bsky-app.example"));
    expectInputError(HANDLE_URL.replace("bsky.app", "staging.bsky.app"));
    expectInputError(HANDLE_URL.replace("bsky.app", "bsky.app."));
  });

  it("rejects embedded credentials", () => {
    expectInputError(HANDLE_URL.replace("bsky.app", "user:pass@bsky.app"));
    expectInputError(HANDLE_URL.replace("bsky.app", "user@bsky.app"));
  });

  it("rejects nonstandard ports", () => {
    expectInputError(HANDLE_URL.replace("bsky.app", "bsky.app:8443"));
  });

  it("accepts a benign percent-encoded handle after one decoding pass", () => {
    expect(parseBlueskyUrl("https://bsky.app/profile/%61lice.example.com/post/abc").actor).toBe("alice.example.com");
  });

  it("round-trips an encoded canonical DID link produced by this app", () => {
    const canonical = blueskyPostUrl("at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3mv6jm4auic2g");
    expect(canonical).not.toBeNull();
    const parsed = parseBlueskyUrl(canonical!);
    expect(parsed.actor).toBe("did:plc:z72i7hdynmk6r22z27h6tvur");
    expect(parsed.rkey).toBe("3mv6jm4auic2g");
  });

  it("rejects percent-encoded traversal and separators", () => {
    expectInputError("https://bsky.app/profile/%2e%2e/post/abc");
    expectInputError("https://bsky.app/profile/alice.example.com%2fadmin/post/abc");
    expectInputError("https://bsky.app/profile/alice.example.com/post/a%5cb");
    expectInputError("https://bsky.app/profile/%2e%2e%2f/post/abc");
  });

  it("rejects double-encoded traversal and separators", () => {
    expectInputError("https://bsky.app/profile/%252e%252e/post/abc");
    expectInputError("https://bsky.app/profile/alice.example.com%252fadmin/post/abc");
    expectInputError("https://bsky.app/profile/%252f/post/abc");
  });

  it("rejects malformed percent escapes", () => {
    expectInputError("https://bsky.app/profile/alice.example.com/post/%zz");
    expectInputError("https://bsky.app/profile/%/post/abc");
  });

  it("rejects raw dot segments even though URL parsing would normalize them", () => {
    expectInputError("https://bsky.app/x/../profile/alice.example.com/post/abc");
    expectInputError("https://bsky.app/profile/../profile/alice.example.com/post/abc");
    expectInputError("https://bsky.app/profile/alice.example.com/post/..");
    expectInputError("https://bsky.app/profile/alice.example.com/post/.");
  });

  it("rejects backslash paths", () => {
    expectInputError("https:\\\\bsky.app\\profile\\alice.example.com\\post\\abc");
    expectInputError("https://bsky.app\\profile\\alice.example.com\\post\\abc");
  });

  it("rejects wrong or missing path shape", () => {
    expectInputError("https://bsky.app/");
    expectInputError("https://bsky.app/profile/alice.example.com");
    expectInputError("https://bsky.app/post/abc");
    expectInputError("https://bsky.app/profile//post/abc");
    expectInputError("https://bsky.app/profile/alice.example.com/post/");
    expectInputError("https://bsky.app/profile/alice.example.com/post/abc/extra");
    expectInputError("https://bsky.app/profile/alice.example.com/POST/abc");
  });

  it("rejects invalid actors", () => {
    expectInputError("https://bsky.app/profile/alice/post/abc");
    expectInputError("https://bsky.app/profile/-alice.example.com/post/abc");
    expectInputError("https://bsky.app/profile/alice..example.com/post/abc");
    expectInputError("https://bsky.app/profile/did:plc:tooshort/post/abc");
    expectInputError("https://bsky.app/profile/did:example:abc/post/abc");
  });

  it("rejects invalid record keys", () => {
    expectInputError("https://bsky.app/profile/alice.example.com/post/has space");
    expectInputError("https://bsky.app/profile/alice.example.com/post/has*star");
    expectInputError(`https://bsky.app/profile/alice.example.com/post/${"a".repeat(513)}`);
  });

  it("accepts rkey punctuation that is part of the allowed charset", () => {
    const parsed = parseBlueskyUrl("https://bsky.app/profile/alice.example.com/post/abc-def_ghi.jkl~mno:pqr");
    expect(parsed.rkey).toBe("abc-def_ghi.jkl~mno:pqr");
  });
});
