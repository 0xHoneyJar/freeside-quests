import type { ActivityCompleted } from "../events/ActivityCompleted.js";
import { ACTIVITY_COMPLETED_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

/**
 * ActivityCompleted golden vectors (T1.11 · 3 per event type).
 *
 * Locked snapshots produced by `_seed.ts` against the reference TS
 * implementation. Cross-runtime ports MUST produce identical hashes for
 * the same `input` objects (CL-Event-3 hash-determinism · §5.6).
 */
export const ACTIVITY_COMPLETED_VECTORS: ReadonlyArray<GoldenVector<ActivityCompleted>> = [
  {
    label: ACTIVITY_COMPLETED_INPUTS[0].label,
    input: ACTIVITY_COMPLETED_INPUTS[0].input as unknown as ActivityCompleted,
    expected_event_id: "71f1d88b0738a17ac826e88f51534e55d63c6a44fe1bde73942597ac938c6b81",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/activity-completed/v1.0.0","activity_id":"act_quest1","identity_id":"id_player001","nonce":"golden-vector-deterministic-nonce","period_key":null,"preimage_schema_id":"https://schemas.freeside.thj/preimage/activity-completed/v1.0.0","reward_state_id":null,"schema_version":"1.0.0","source_event_hash":null,"step_completions":[],"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: ACTIVITY_COMPLETED_INPUTS[1].label,
    input: ACTIVITY_COMPLETED_INPUTS[1].input as unknown as ActivityCompleted,
    expected_event_id: "bfbbac977ef4bbb580951c8c7ea73060a2eb2bf7445a5da55dc122993f6fa392",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/activity-completed/v1.0.0","activity_id":"act_questchain","identity_id":"id_player002","nonce":"golden-vector-deterministic-nonce","period_key":null,"preimage_schema_id":"https://schemas.freeside.thj/preimage/activity-completed/v1.0.0","reward_state_id":null,"schema_version":"1.0.0","source_event_hash":null,"step_completions":[{"completed_at":"2026-05-15T11:00:00Z","event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","order":0,"step_id":"step_first"},{"completed_at":"2026-05-15T12:00:00Z","event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","order":1,"step_id":"step_second"}],"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: ACTIVITY_COMPLETED_INPUTS[2].label,
    input: ACTIVITY_COMPLETED_INPUTS[2].input as unknown as ActivityCompleted,
    expected_event_id: "cfbb2dc43ccfd81d7658b6fc67fce00a866407724b989a109d1ee6e61b129f0a",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/activity-completed/v1.0.0","activity_id":"act_weeklymission","identity_id":"id_player003","nonce":"golden-vector-deterministic-nonce","period_key":"2026-W20","preimage_schema_id":"https://schemas.freeside.thj/preimage/activity-completed/v1.0.0","reward_state_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","schema_version":"1.0.0","source_event_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","step_completions":[],"ts":"2026-05-15T12:34:56Z"}',
  },
];
