import canonicalize from "canonicalize";

/**
 * canonicalizeJCS — RFC 8785 JSON Canonicalization Scheme (per SDD §5.8).
 *
 * Thin wrapper over the `canonicalize` npm package · the ONE place the
 * protocol calls into a third-party canonicalizer. All preimage hashing
 * routes through this function (architectural lock A6 · "NO bare hash()
 * calls in adapters").
 *
 * RFC 8785 guarantees (preserved by `canonicalize`):
 *   - Object keys are sorted lexicographically by UTF-16 code unit
 *   - No insignificant whitespace
 *   - Numbers use ECMA-262 stringification (no `-0`, no scientific notation
 *     for integers, exact representation for floats)
 *   - Booleans and null are unambiguous tokens
 *
 * Returns a pure-function string · safe to feed into any cross-runtime hash.
 *
 * @throws if input contains `undefined` at the top level (RFC 8785 rejects
 *         `undefined` since JSON has no encoding for it).
 */
export const canonicalizeJCS = (value: unknown): string => {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new Error(
      "canonicalizeJCS: input produced undefined output — likely a top-level undefined value (RFC 8785 rejects undefined)",
    );
  }
  return result;
};

/**
 * Convenience: SHA-256 hash of the canonical JCS of a value.
 *
 * Returns the lowercase hex digest (matches the {@link EventId} pattern).
 * Uses the global `crypto.subtle` API — available on Node ≥19, Bun, and
 * every modern browser.
 */
export const sha256JCS = async (value: unknown): Promise<string> => {
  const canonical = canonicalizeJCS(value);
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
