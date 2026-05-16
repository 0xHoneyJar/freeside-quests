/**
 * Encoding helpers for the freeside-activities protocol (T1.12).
 *
 * Three modules · all bound by the canonicalization contract (§5.3 + §5.8):
 *   - jcs.ts     → RFC 8785 canonicalization (the hash ground per A6)
 *   - date.ts    → RFC3339Date branded type + Date <-> string helpers (D14)
 *   - decimal.ts → DecimalValue struct + bigint <-> decimal helpers (D14)
 */

export { dateFromRFC3339, dateToRFC3339, RFC3339Date } from "./date.js";
export {
  bigintFromDecimal,
  bigintToDecimal,
  DecimalValue,
} from "./decimal.js";
export { canonicalizeJCS, sha256JCS } from "./jcs.js";
