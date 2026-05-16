import { Schema } from "effect";

/**
 * RFC3339Date — canonical timestamp encoding (D14 RESOLVED · per SDD §5.3).
 *
 * Wire format: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$`
 *   - JCS-friendly (string, not Date object)
 *   - Cross-runtime stable
 *   - UTC-only (`Z` suffix · never offset-suffixed)
 *   - Optional fractional seconds up to nanosecond precision
 */
export const RFC3339Date = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/),
  Schema.brand("RFC3339Date"),
);

export type RFC3339Date = Schema.Schema.Type<typeof RFC3339Date>;

/**
 * Helper: encode a JS `Date` to its canonical RFC3339 form (always UTC `Z`).
 * Returns the branded type so calls without explicit decode are still typed.
 *
 * Note: `toISOString()` produces `YYYY-MM-DDTHH:MM:SS.sssZ` (3-digit
 * fractional seconds) — always-valid per the pattern above.
 */
export const dateToRFC3339 = (d: Date): RFC3339Date => {
  const iso = d.toISOString();
  return Schema.decodeUnknownSync(RFC3339Date)(iso);
};

/**
 * Helper: decode a canonical RFC3339 string back into a JS `Date`.
 *
 * Pre-condition: caller has validated the input through {@link RFC3339Date}
 * (or another Schema decoder). Passing a raw string here without that
 * boundary check is a type error.
 */
export const dateFromRFC3339 = (s: RFC3339Date): Date => new Date(s as unknown as string);
