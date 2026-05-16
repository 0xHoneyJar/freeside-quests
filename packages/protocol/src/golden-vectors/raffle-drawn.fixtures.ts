import type { RaffleDrawn } from "../events/RaffleDrawn.js";
import { RAFFLE_DRAWN_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

export const RAFFLE_DRAWN_VECTORS: ReadonlyArray<GoldenVector<RaffleDrawn>> = [
  {
    label: RAFFLE_DRAWN_INPUTS[0].label,
    input: RAFFLE_DRAWN_INPUTS[0].input as unknown as RaffleDrawn,
    expected_event_id: "ec1be04a659abc93bd6ec215de2dd19308a4515a3512dc4b80158058badde3ea",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/raffle-drawn/v1.0.0","activity_id":"act_raffle1","cycle_id":"cyc_2026-q2","nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0","prng_seed":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","prng_tier":"TIER-1","schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z","winners":[{"identity_id":"id_winner1","tickets":5}]}',
  },
  {
    label: RAFFLE_DRAWN_INPUTS[1].label,
    input: RAFFLE_DRAWN_INPUTS[1].input as unknown as RaffleDrawn,
    expected_event_id: "5b2e884854fa1302f211ccf764d0c7357c497f7562079d755fb2896c43a73cc8",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/raffle-drawn/v1.0.0","activity_id":"act_raffle2","cycle_id":"cyc_2026-q2-w20","nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0","prng_seed":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","prng_tier":"TIER-2","schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z","winners":[{"identity_id":"id_winneralpha","tickets":10},{"identity_id":"id_winnerbeta","tickets":7},{"identity_id":"id_winnergamma","tickets":3}]}',
  },
  {
    label: RAFFLE_DRAWN_INPUTS[2].label,
    input: RAFFLE_DRAWN_INPUTS[2].input as unknown as RaffleDrawn,
    expected_event_id: "08069c9dbb1738e3754bfd0e32f7a2b55057c1ab50fbc8a2f055b0d007e7138f",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/raffle-drawn/v1.0.0","activity_id":"act_raffle3","cycle_id":"cyc_2026-q3","nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0","prng_seed":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","prng_tier":"TIER-3","schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z","winners":[]}',
  },
];
