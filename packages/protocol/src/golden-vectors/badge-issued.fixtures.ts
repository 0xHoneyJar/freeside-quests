import type { BadgeIssued } from "../events/BadgeIssued.js";
import { BADGE_ISSUED_INPUTS } from "./_inputs.js";
import type { GoldenVector } from "./types.js";

export const BADGE_ISSUED_VECTORS: ReadonlyArray<GoldenVector<BadgeIssued>> = [
  {
    label: BADGE_ISSUED_INPUTS[0].label,
    input: BADGE_ISSUED_INPUTS[0].input as unknown as BadgeIssued,
    expected_event_id: "ac6c8b0754f51b1bd1e84dd752691c7c2a791d1a38906a02f39f9c971e8e88c1",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/badge-issued/v1.0.0","activity_id":"act_badgeclaim","badge_family_id":"mongolian-petroglyph","identity_id":"id_player001","merkle_proof":["0xabcdef"],"nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/badge-issued/v1.0.0","schema_version":"1.0.0","snapshot_id":"snap_20260515","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: BADGE_ISSUED_INPUTS[1].label,
    input: BADGE_ISSUED_INPUTS[1].input as unknown as BadgeIssued,
    expected_event_id: "c116ab46adb0504823ad8976caa4339d9c41daea02b8bf90245a13055e9b2dda",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/badge-issued/v1.0.0","activity_id":"act_rarebadge","badge_family_id":"puruhani-bond-day-7","identity_id":"id_player002","merkle_proof":["0x111111","0x222222","0x333333"],"nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/badge-issued/v1.0.0","schema_version":"1.0.0","snapshot_id":"snap_20260515","source_event_hash":null,"ts":"2026-05-15T12:34:56Z"}',
  },
  {
    label: BADGE_ISSUED_INPUTS[2].label,
    input: BADGE_ISSUED_INPUTS[2].input as unknown as BadgeIssued,
    expected_event_id: "93b293df3b060e9a118c992d8165498b11de8648aa6317d8337e0baec24e1ff9",
    expected_preimage_jcs:
      '{"$id":"https://schemas.freeside.thj/badge-issued/v1.0.0","activity_id":"act_chained","badge_family_id":"wuxing-wood","identity_id":"id_player003","merkle_proof":["0xdeadbeef"],"nonce":"golden-vector-deterministic-nonce","preimage_schema_id":"https://schemas.freeside.thj/preimage/badge-issued/v1.0.0","schema_version":"1.0.0","snapshot_id":"snap_20260516","source_event_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","ts":"2026-05-15T12:34:56Z"}',
  },
];
