/**
 * Golden vector shape (T1.11 · §5.7 · per CL-Event-3 cross-runtime determinism).
 *
 * Each vector binds a `label`-tagged input to its expected canonical preimage
 * + event_id hash. Compliant ACVP implementations on any runtime (TS · Rust ·
 * Python · etc.) MUST produce the same `expected_preimage_jcs` and
 * `expected_event_id` for the same `input`.
 *
 * Frozen-input scope (IMP-013 ACCEPTED LIGHT):
 *   - Guarded inputs: deterministic ts (RFC3339Date) · seeded ids · known-canonical
 *     decimal values · explicit step-completion orderings · no UUID generation
 *   - Excluded nondeterminism: NodeJS event-loop ordering · system clock · timezone
 *
 * The expected hash is the SHA-256 of the canonical JCS encoding of the
 * preimage (which is `input` minus `event_id`). See `compute-event-id.ts`
 * for the algorithm.
 */
export interface GoldenVector<TInput> {
  readonly label: string;
  readonly input: TInput;
  readonly expected_event_id: string;
  readonly expected_preimage_jcs: string;
}
