import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { CycleId } from "../branded/CycleId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * RaffleDrawn — emitted when a raffle cycle resolves and winners are picked
 * (FR-7). Lists winners + the PRNG seed used.
 *
 * Per CL-Raffle-3 (deferred to SDD), the PRNG hardening tier (TIER-1 simple ·
 * TIER-2 commit-reveal · TIER-3 VRF) is captured in `prng_tier`. Adapters
 * MUST refuse to emit higher-tier raffles than their configured ceiling.
 */
export const RaffleDrawn = Schema.Struct({
  ...eventEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/raffle-drawn/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0"),
  activity_id: ActivityId,
  cycle_id: CycleId,
  winners: Schema.Array(
    Schema.Struct({
      identity_id: IdentityId,
      tickets: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    }),
  ),
  prng_seed: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64,128}$/)),
  prng_tier: Schema.Literal("TIER-1", "TIER-2", "TIER-3"),
});

export type RaffleDrawn = Schema.Schema.Type<typeof RaffleDrawn>;
