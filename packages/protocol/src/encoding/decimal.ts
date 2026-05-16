import { Schema } from "effect";

/**
 * DecimalValue — canonical BigInt encoding (D14 RESOLVED · per SDD §5.3).
 *
 * Why a struct, not a string: BigInt has no native JSON form. The PRD pattern
 * preserves arbitrary precision (`value` as a decimal string) AND the fixed-
 * point exponent (`decimals`) so consumers can reconstruct the exact value.
 *
 * Wire shape:
 *   - `value`: signed decimal string `^-?[0-9]+(\.[0-9]+)?$`
 *   - `decimals`: integer in [0, 30] (covers ETH 18-decimal · most ERC20s)
 *
 * Examples:
 *   - 1 ETH       → { value: "1000000000000000000", decimals: 18 }
 *   - 0.5 USDC    → { value: "500000",              decimals: 6  }
 *   - -1.23       → { value: "-1.23",               decimals: 0  }
 */
export const DecimalValue = Schema.Struct({
  value: Schema.String.pipe(Schema.pattern(/^-?[0-9]+(\.[0-9]+)?$/)),
  decimals: Schema.Number.pipe(Schema.int(), Schema.between(0, 30)),
});

export type DecimalValue = Schema.Schema.Type<typeof DecimalValue>;

/**
 * Helper: encode a `bigint` with a fixed-point `decimals` exponent into the
 * canonical {@link DecimalValue} struct.
 *
 * The bigint is NOT divided by 10^decimals — it is recorded as-is. Callers
 * holding raw on-chain integers (e.g. 1000000000000000000n for 1 ETH) should
 * pass them directly; the `decimals` field tells consumers where the
 * fractional point sits.
 */
export const bigintToDecimal = (n: bigint, decimals: number): DecimalValue =>
  Schema.decodeUnknownSync(DecimalValue)({ value: n.toString(), decimals });

/**
 * Helper: best-effort `bigint` extraction from a {@link DecimalValue}.
 *
 * Pre-condition: `value` has NO fractional component (only valid for
 * integer-shaped DecimalValues — the common on-chain case). If `value`
 * contains a `.`, this throws via `BigInt` constructor — the caller MUST
 * inspect `decimals` and reconstruct precision in their target numeric type
 * (e.g. fixed-point decimal class) when fractional values are present.
 */
export const bigintFromDecimal = (d: DecimalValue): bigint => {
  if (d.value.includes(".")) {
    throw new Error(
      `bigintFromDecimal: value '${d.value}' has a fractional component; use a fixed-point library`,
    );
  }
  return BigInt(d.value);
};
