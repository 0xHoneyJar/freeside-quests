import type { RewardFailedEvent } from "../events/RewardFailedEvent.js";
import { REWARD_FAILED_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

export const REWARD_FAILED_VECTORS: ReadonlyArray<GoldenVector<RewardFailedEvent>> = [
  {
    label: REWARD_FAILED_INPUTS[0].label,
    input: REWARD_FAILED_INPUTS[0].input as unknown as RewardFailedEvent,
    expected_event_id: "9bc59c7c5c06e1fa36116baa248a3683045548f8423fdab6e84587763c42e2cc",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-failed/v1.0.0","failure_reason":"RPC timeout","nonce":null,"originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-failed/v1.0.0","recipient":"id_player001","retryable":true,"reward_intent":{"_tag":"None"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: REWARD_FAILED_INPUTS[1].label,
    input: REWARD_FAILED_INPUTS[1].input as unknown as RewardFailedEvent,
    expected_event_id: "75b16e41688614df844fd7f711514e0e991be2cc89dfb2063c6b22d7e14ea88c",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-failed/v1.0.0","failure_reason":"recipient on sanctions list","nonce":null,"originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-failed/v1.0.0","recipient":"id_player002","retryable":false,"reward_intent":{"_tag":"TokenAmount","amount":{"decimals":18,"value":"5"},"token_id":"honey-token"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: REWARD_FAILED_INPUTS[2].label,
    input: REWARD_FAILED_INPUTS[2].input as unknown as RewardFailedEvent,
    expected_event_id: "233faf5d3ccd3102dfd2f2efba2b69e93785cf4cfae5831877073e227f2b910a",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-failed/v1.0.0","failure_reason":"world resource ledger unavailable","nonce":null,"originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-failed/v1.0.0","recipient":"id_player003","retryable":true,"reward_intent":{"_tag":"Resource","amount":100,"resource_kind":"honey"},"schema_version":"1.0.0","source_event_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","ts":"2026-05-15T12:34:56Z"}',
  },
];
