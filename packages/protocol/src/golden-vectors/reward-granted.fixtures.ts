import type { RewardGrantedEvent } from "../events/RewardGrantedEvent.js";
import { REWARD_GRANTED_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

export const REWARD_GRANTED_VECTORS: ReadonlyArray<GoldenVector<RewardGrantedEvent>> = [
  {
    label: REWARD_GRANTED_INPUTS[0].label,
    input: REWARD_GRANTED_INPUTS[0].input as unknown as RewardGrantedEvent,
    expected_event_id: "5b8d2c2a920aa5a09ca30f34a97d4cf11561abf74c2df7d51cd6c95909a1e1db",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-granted/v1.0.0","nonce":null,"originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-granted/v1.0.0","recipient":"id_player001","reward":{"_tag":"None"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: REWARD_GRANTED_INPUTS[1].label,
    input: REWARD_GRANTED_INPUTS[1].input as unknown as RewardGrantedEvent,
    expected_event_id: "2a997446083c555f0aef6d8be98820bca8203849a667a73ceff4c12b0d98601c",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-granted/v1.0.0","nonce":null,"originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-granted/v1.0.0","recipient":"id_player002","reward":{"_tag":"Cosmetic","cosmetic_id":"cos_petroglyph_pin"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: REWARD_GRANTED_INPUTS[2].label,
    input: REWARD_GRANTED_INPUTS[2].input as unknown as RewardGrantedEvent,
    expected_event_id: "ace5bc09418c5c88b26f43270cb17c820f71127e685e8e84fb8c4453269da5d4",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-granted/v1.0.0","nonce":null,"originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-granted/v1.0.0","recipient":"id_player003","reward":{"_tag":"BadgeMint","mint_intent_id":"mint_abc123def456"},"schema_version":"1.0.0","source_event_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","ts":"2026-05-15T12:34:56Z"}',
  },
];
