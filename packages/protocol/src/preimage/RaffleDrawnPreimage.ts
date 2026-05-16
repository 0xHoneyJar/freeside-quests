import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { CycleId } from "../branded/CycleId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * RaffleDrawnPreimage — canonical preimage shape for RaffleDrawn
 * (§5.6 · T1.8 · per FR-7).
 *
 * Identical to {@link RaffleDrawn} MINUS the `event_id` field. The `winners`
 * array is NOT canonically sorted by the substrate — the raffle algorithm
 * itself produces a deterministic ordering, and JCS preserves array order
 * verbatim. If a world's raffle needs an extra canonical sort, it MUST do
 * so before constructing the event.
 */
export const RaffleDrawnPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
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

export type RaffleDrawnPreimage = Schema.Schema.Type<typeof RaffleDrawnPreimage>;
