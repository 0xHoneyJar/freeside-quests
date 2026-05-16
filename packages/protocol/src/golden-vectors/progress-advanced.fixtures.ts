import type { ProgressAdvanced } from "../events/ProgressAdvanced.js";
import { PROGRESS_ADVANCED_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

export const PROGRESS_ADVANCED_VECTORS: ReadonlyArray<GoldenVector<ProgressAdvanced>> = [
  {
    label: PROGRESS_ADVANCED_INPUTS[0].label,
    input: PROGRESS_ADVANCED_INPUTS[0].input as unknown as ProgressAdvanced,
    expected_event_id: "7b141ee575a1e6731033fda82f47d715d5eb487ea216e0f2af9ec1ee8cbd0bdc",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/progress-advanced/v1.0.0","activity_id":"act_questchain","identity_id":"id_player001","new_step_completions":[{"completed_at":"2026-05-15T11:00:00Z","event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","order":0,"step_id":"step_first"}],"nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0","schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z","version_after":1,"version_before":0}',
  },
  {
    label: PROGRESS_ADVANCED_INPUTS[1].label,
    input: PROGRESS_ADVANCED_INPUTS[1].input as unknown as ProgressAdvanced,
    expected_event_id: "a3a7bf74be28aa583ccddd90fdc1723a33e5cc396b2626ddb4d773b285d34e1c",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/progress-advanced/v1.0.0","activity_id":"act_longquest","identity_id":"id_player002","new_step_completions":[{"completed_at":"2026-05-15T11:30:00Z","event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","order":3,"step_id":"step_alpha"},{"completed_at":"2026-05-15T12:00:00Z","event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","order":4,"step_id":"step_beta"}],"nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0","schema_version":"1.0.0","source_event_hash":null,"ts":"2026-05-15T12:34:56Z","version_after":5,"version_before":3}',
  },
  {
    label: PROGRESS_ADVANCED_INPUTS[2].label,
    input: PROGRESS_ADVANCED_INPUTS[2].input as unknown as ProgressAdvanced,
    expected_event_id: "c46688573a3fe9e187f05358ff1240f285cc14959d5244c377ab46fc1199e501",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/progress-advanced/v1.0.0","activity_id":"act_followup","identity_id":"id_player003","new_step_completions":[],"nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0","schema_version":"1.0.0","source_event_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","ts":"2026-05-15T12:34:56Z","version_after":6,"version_before":5}',
  },
];
