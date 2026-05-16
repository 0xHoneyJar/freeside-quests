import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  bigintFromDecimal,
  bigintToDecimal,
  canonicalizeJCS,
  DecimalValue,
  dateFromRFC3339,
  dateToRFC3339,
  RFC3339Date,
  sha256JCS,
} from "./index.js";

describe("RFC3339Date (D14 · §5.3)", () => {
  it("accepts canonical UTC timestamps", () => {
    const valid = [
      "2026-05-15T00:00:00Z",
      "2026-05-15T12:34:56Z",
      "2026-05-15T12:34:56.789Z",
      "2026-05-15T12:34:56.123456789Z",
    ];
    for (const v of valid) {
      const decoded = Schema.decodeUnknownSync(RFC3339Date)(v);
      expect(decoded).toBe(v);
    }
  });

  it("rejects non-UTC offsets and non-RFC-shaped strings", () => {
    const invalid = [
      "2026-05-15",
      "2026-05-15T12:34:56",
      "2026-05-15T12:34:56+00:00",
      "2026-05-15T12:34:56-05:00",
      "2026-05-15 12:34:56Z",
      "not-a-date",
      "",
    ];
    for (const v of invalid) {
      const result = Schema.decodeUnknownEither(RFC3339Date)(v);
      expect(Either.isLeft(result)).toBe(true);
    }
  });

  it("roundtrips Date → RFC3339 → Date with ms-precision equality", () => {
    const inputs = [
      new Date("2026-05-15T12:34:56.789Z"),
      new Date("2000-01-01T00:00:00.000Z"),
      new Date(0),
    ];
    for (const d of inputs) {
      const encoded = dateToRFC3339(d);
      const decoded = dateFromRFC3339(encoded);
      expect(decoded.getTime()).toBe(d.getTime());
    }
  });

  it("dateToRFC3339 always emits UTC Z suffix", () => {
    const d = new Date(Date.UTC(2026, 4, 15, 12, 0, 0));
    const encoded = dateToRFC3339(d);
    expect((encoded as unknown as string).endsWith("Z")).toBe(true);
  });
});

describe("DecimalValue (D14 · §5.3)", () => {
  it("accepts canonical decimal-string shapes", () => {
    const valid = [
      { value: "0", decimals: 0 },
      { value: "1000000000000000000", decimals: 18 },
      { value: "-1.23", decimals: 0 },
      { value: "12345.6789", decimals: 4 },
      { value: "1", decimals: 30 },
    ];
    for (const v of valid) {
      const decoded = Schema.decodeUnknownSync(DecimalValue)(v);
      expect(decoded.value).toBe(v.value);
      expect(decoded.decimals).toBe(v.decimals);
    }
  });

  it("rejects invalid value patterns", () => {
    const bad = [
      { value: "abc", decimals: 0 },
      { value: "1e10", decimals: 0 },
      { value: "1,000", decimals: 0 },
      { value: "+1", decimals: 0 },
      { value: "", decimals: 0 },
    ];
    for (const v of bad) {
      const result = Schema.decodeUnknownEither(DecimalValue)(v);
      expect(Either.isLeft(result)).toBe(true);
    }
  });

  it("rejects decimals out of [0, 30] range", () => {
    for (const decimals of [-1, 31, 100, 0.5]) {
      const result = Schema.decodeUnknownEither(DecimalValue)({
        value: "1",
        decimals,
      });
      expect(Either.isLeft(result)).toBe(true);
    }
  });

  it("bigintToDecimal handles the 1 ETH case (18 decimals)", () => {
    const oneEth = bigintToDecimal(1_000_000_000_000_000_000n, 18);
    expect(oneEth).toEqual({ value: "1000000000000000000", decimals: 18 });
  });

  it("bigintToDecimal handles the negative case", () => {
    const negative = bigintToDecimal(-42n, 0);
    expect(negative).toEqual({ value: "-42", decimals: 0 });
  });

  it("bigintToDecimal handles very large (256-bit) values", () => {
    const max256 =
      115_792_089_237_316_195_423_570_985_008_687_907_853_269_984_665_640_564_039_457_584_007_913_129_639_935n;
    const encoded = bigintToDecimal(max256, 18);
    expect(encoded.value).toBe(max256.toString());
    expect(encoded.decimals).toBe(18);
  });

  it("bigintFromDecimal recovers the original bigint for integer values", () => {
    const cases: ReadonlyArray<readonly [bigint, number]> = [
      [0n, 0],
      [42n, 0],
      [-7n, 0],
      [1_000_000_000_000_000_000n, 18],
      [9_876_543_210n, 6],
    ];
    for (const [n, decimals] of cases) {
      const round = bigintFromDecimal(bigintToDecimal(n, decimals));
      expect(round).toBe(n);
    }
  });

  it("bigintFromDecimal throws on fractional values", () => {
    const fractional = Schema.decodeUnknownSync(DecimalValue)({
      value: "1.5",
      decimals: 0,
    });
    expect(() => bigintFromDecimal(fractional)).toThrow();
  });
});

describe("canonicalizeJCS (RFC 8785 · §5.8 · A6)", () => {
  it("returns a deterministic string for identical inputs", () => {
    const a = canonicalizeJCS({ b: 2, a: 1 });
    const b = canonicalizeJCS({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("sorts keys lexicographically (UTF-16 code-unit order)", () => {
    const out = canonicalizeJCS({ z: 1, a: 1, m: 1 });
    expect(out).toBe('{"a":1,"m":1,"z":1}');
  });

  it("produces no insignificant whitespace", () => {
    const out = canonicalizeJCS({ x: [1, 2, 3], y: "hello" });
    expect(out).toBe('{"x":[1,2,3],"y":"hello"}');
  });

  it("recurses into nested objects with stable ordering", () => {
    const out = canonicalizeJCS({
      outer: { z: 1, a: 2 },
      another: { y: 1, b: 2 },
    });
    expect(out).toBe('{"another":{"b":2,"y":1},"outer":{"a":2,"z":1}}');
  });

  it("is byte-identical across 100 invocations of the same input (purity)", () => {
    const input = {
      activity_id: "act_quest1",
      identity_id: "id_player001",
      step_completions: [
        { step_id: "step_1", order: 0 },
        { step_id: "step_2", order: 1 },
      ],
      nonce: null,
      ts: "2026-05-15T12:34:56Z",
    };
    const ref = canonicalizeJCS(input);
    for (let i = 0; i < 100; i++) {
      expect(canonicalizeJCS(input)).toBe(ref);
    }
  });

  it("throws when canonicalization would emit undefined (top-level)", () => {
    expect(() => canonicalizeJCS(undefined)).toThrow();
  });
});

describe("sha256JCS (the hash-ground for computeEventId)", () => {
  it("produces a 64-char lowercase hex digest", async () => {
    const hash = await sha256JCS({ x: 1 });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic across re-invocations", async () => {
    const input = { activity_id: "act_quest1", nonce: "abc" };
    const a = await sha256JCS(input);
    const b = await sha256JCS(input);
    expect(a).toBe(b);
  });

  it("changes for any byte-level input change", async () => {
    const base = { x: 1, y: 2 };
    const tweaked = { x: 1, y: 3 };
    expect(await sha256JCS(base)).not.toBe(await sha256JCS(tweaked));
  });
});
