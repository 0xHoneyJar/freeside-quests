import type { RewardPendingEvent } from "../events/RewardPendingEvent.js";
import { REWARD_PENDING_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

/**
 * RewardPending golden vectors — includes decimal edge cases (IMP-013):
 *   - 1 wei (smallest non-zero TokenAmount)
 *   - 256-bit max (2^256-1, largest representable token amount)
 */
export const REWARD_PENDING_VECTORS: ReadonlyArray<GoldenVector<RewardPendingEvent>> = [
  {
    label: REWARD_PENDING_INPUTS[0].label,
    input: REWARD_PENDING_INPUTS[0].input as unknown as RewardPendingEvent,
    expected_event_id: "4269efb9be9f49b1b7fd91b49e10e76d54b95d8e739111ba86cb6747b4add7c3",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-pending/v1.0.0","attempts":0,"nonce":"golden-vector-deterministic-nonce","originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-pending/v1.0.0","recipient":"id_player001","reward_intent":{"_tag":"None"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: REWARD_PENDING_INPUTS[1].label,
    input: REWARD_PENDING_INPUTS[1].input as unknown as RewardPendingEvent,
    expected_event_id: "78dcc3ae38f79c24fcb3e3457d6621e1172329e1b9529c49ec2527d9f7b8a42b",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-pending/v1.0.0","attempts":1,"nonce":"golden-vector-deterministic-nonce","originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-pending/v1.0.0","recipient":"id_player002","reward_intent":{"_tag":"TokenAmount","amount":{"decimals":18,"value":"1"},"token_id":"honey-token"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: REWARD_PENDING_INPUTS[2].label,
    input: REWARD_PENDING_INPUTS[2].input as unknown as RewardPendingEvent,
    expected_event_id: "89fc2d3011a1104a69b328c0a6b335e17a9bf3e4724875abd9acec2374f4c89f",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/reward-pending/v1.0.0","attempts":2,"nonce":"golden-vector-deterministic-nonce","originating_event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","preimage_schema_id":"https://schemas.freeside.thj/preimage/reward-pending/v1.0.0","recipient":"id_player003","reward_intent":{"_tag":"TokenAmount","amount":{"decimals":0,"value":"115792089237316195423570985008687907853269984665640564039457584007913129639935"},"token_id":"max-uint256-token"},"schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
];
