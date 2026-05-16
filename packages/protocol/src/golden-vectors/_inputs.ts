/**
 * Golden-vector raw inputs (T1.11 · §5.7).
 *
 * 21 deterministic event-payload fixtures (3 per event type × 7 event types).
 * These are the SOURCE of truth — the seed script in `_seed.ts` computes
 * expected event_id + canonical JCS from these inputs and the test asserts
 * the locked expected values match.
 *
 * Constants chosen for determinism: fixed RFC3339 timestamps · seeded
 * identity / activity / cycle / snapshot ids · zero-pad hashes for chain
 * links. Decimal edge cases (1 wei · max 256-bit · negative) cover IMP-013.
 *
 * Underscore-prefixed file so the barrel `index.ts` does not re-export the
 * raw inputs — fixtures.ts files combine them with expected hashes.
 */

const ZERO_HASH = "0".repeat(64);
const SAMPLE_HASH = "a".repeat(64);
const CHAIN_HASH = "b".repeat(64);

const baseEnv = {
  ts: "2026-05-15T12:34:56Z",
  source_event_hash: null as string | null,
  nonce: "golden-vector-deterministic-nonce" as string | null,
  schema_version: "1.0.0" as const,
};

export const ACTIVITY_COMPLETED_INPUTS = [
  {
    label: "minimal · no steps · null period_key",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/activity-completed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
      activity_id: "act_quest1",
      identity_id: "id_player001",
      period_key: null,
      step_completions: [],
      reward_state_id: null,
    },
  },
  {
    label: "two steps · canonical (order, step_id) tie-break",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/activity-completed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
      activity_id: "act_questchain",
      identity_id: "id_player002",
      period_key: null,
      step_completions: [
        {
          step_id: "step_first",
          order: 0,
          completed_at: "2026-05-15T11:00:00Z",
          event_id: SAMPLE_HASH,
        },
        {
          step_id: "step_second",
          order: 1,
          completed_at: "2026-05-15T12:00:00Z",
          event_id: SAMPLE_HASH,
        },
      ],
      reward_state_id: null,
    },
  },
  {
    label: "mission with ISO-week period_key · chained source_event_hash",
    input: {
      ...baseEnv,
      source_event_hash: CHAIN_HASH,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/activity-completed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/activity-completed/v1.0.0",
      activity_id: "act_weeklymission",
      identity_id: "id_player003",
      period_key: "2026-W20",
      step_completions: [],
      reward_state_id: SAMPLE_HASH,
    },
  },
] as const;

export const BADGE_ISSUED_INPUTS = [
  {
    label: "minimal · single-element merkle proof",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/badge-issued/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/badge-issued/v1.0.0",
      activity_id: "act_badgeclaim",
      identity_id: "id_player001",
      snapshot_id: "snap_20260515",
      badge_family_id: "mongolian-petroglyph",
      merkle_proof: ["0xabcdef"],
    },
  },
  {
    label: "multi-step merkle proof · 3 hops",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/badge-issued/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/badge-issued/v1.0.0",
      activity_id: "act_rarebadge",
      identity_id: "id_player002",
      snapshot_id: "snap_20260515",
      badge_family_id: "puruhani-bond-day-7",
      merkle_proof: ["0x111111", "0x222222", "0x333333"],
    },
  },
  {
    label: "chained · source_event_hash set",
    input: {
      ...baseEnv,
      source_event_hash: CHAIN_HASH,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/badge-issued/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/badge-issued/v1.0.0",
      activity_id: "act_chained",
      identity_id: "id_player003",
      snapshot_id: "snap_20260516",
      badge_family_id: "wuxing-wood",
      merkle_proof: ["0xdeadbeef"],
    },
  },
] as const;

export const RAFFLE_DRAWN_INPUTS = [
  {
    label: "TIER-1 simple · single winner",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/raffle-drawn/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0",
      activity_id: "act_raffle1",
      cycle_id: "cyc_2026-q2",
      winners: [{ identity_id: "id_winner1", tickets: 5 }],
      prng_seed: "f".repeat(64),
      prng_tier: "TIER-1",
    },
  },
  {
    label: "TIER-2 commit-reveal · three winners",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/raffle-drawn/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0",
      activity_id: "act_raffle2",
      cycle_id: "cyc_2026-q2-w20",
      winners: [
        { identity_id: "id_winneralpha", tickets: 10 },
        { identity_id: "id_winnerbeta", tickets: 7 },
        { identity_id: "id_winnergamma", tickets: 3 },
      ],
      prng_seed: "c".repeat(128),
      prng_tier: "TIER-2",
    },
  },
  {
    label: "TIER-3 VRF · no winners (empty raffle)",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/raffle-drawn/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/raffle-drawn/v1.0.0",
      activity_id: "act_raffle3",
      cycle_id: "cyc_2026-q3",
      winners: [],
      prng_seed: "e".repeat(64),
      prng_tier: "TIER-3",
    },
  },
] as const;

export const PROGRESS_ADVANCED_INPUTS = [
  {
    label: "first step · version 0 → 1",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
      activity_id: "act_questchain",
      identity_id: "id_player001",
      new_step_completions: [
        {
          step_id: "step_first",
          order: 0,
          completed_at: "2026-05-15T11:00:00Z",
          event_id: SAMPLE_HASH,
        },
      ],
      version_before: 0,
      version_after: 1,
    },
  },
  {
    label: "batch of two steps · version 3 → 5",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
      activity_id: "act_longquest",
      identity_id: "id_player002",
      new_step_completions: [
        {
          step_id: "step_alpha",
          order: 3,
          completed_at: "2026-05-15T11:30:00Z",
          event_id: SAMPLE_HASH,
        },
        {
          step_id: "step_beta",
          order: 4,
          completed_at: "2026-05-15T12:00:00Z",
          event_id: SAMPLE_HASH,
        },
      ],
      version_before: 3,
      version_after: 5,
    },
  },
  {
    label: "chained progress · source_event_hash set",
    input: {
      ...baseEnv,
      source_event_hash: CHAIN_HASH,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
      activity_id: "act_followup",
      identity_id: "id_player003",
      new_step_completions: [],
      version_before: 5,
      version_after: 6,
    },
  },
] as const;

export const REWARD_PENDING_INPUTS = [
  {
    label: "None reward · zero attempts",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-pending/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-pending/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player001",
      reward_intent: { _tag: "None" },
      attempts: 0,
    },
  },
  {
    label: "TokenAmount reward · 1 wei (decimal edge · IMP-013)",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-pending/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-pending/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player002",
      reward_intent: {
        _tag: "TokenAmount",
        token_id: "honey-token",
        amount: { value: "1", decimals: 18 },
      },
      attempts: 1,
    },
  },
  {
    label: "TokenAmount reward · 256-bit max (decimal edge · IMP-013)",
    input: {
      ...baseEnv,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-pending/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-pending/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player003",
      reward_intent: {
        _tag: "TokenAmount",
        token_id: "max-uint256-token",
        amount: {
          value: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          decimals: 0,
        },
      },
      attempts: 2,
    },
  },
] as const;

export const REWARD_GRANTED_INPUTS = [
  {
    label: "None reward · base case",
    input: {
      ...baseEnv,
      nonce: null,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player001",
      reward: { _tag: "None" },
    },
  },
  {
    label: "Cosmetic reward · forward-compat cosmetic_id",
    input: {
      ...baseEnv,
      nonce: null,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player002",
      reward: { _tag: "Cosmetic", cosmetic_id: "cos_petroglyph_pin" },
    },
  },
  {
    label: "BadgeMint reward · forward-compat to freeside-mint",
    input: {
      ...baseEnv,
      nonce: null,
      source_event_hash: CHAIN_HASH,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-granted/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-granted/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player003",
      reward: { _tag: "BadgeMint", mint_intent_id: "mint_abc123def456" },
    },
  },
] as const;

export const REWARD_FAILED_INPUTS = [
  {
    label: "retryable failure · transient RPC error",
    input: {
      ...baseEnv,
      nonce: null,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-failed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-failed/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player001",
      reward_intent: { _tag: "None" },
      failure_reason: "RPC timeout",
      retryable: true,
    },
  },
  {
    label: "terminal failure · sanction list match",
    input: {
      ...baseEnv,
      nonce: null,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-failed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-failed/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player002",
      reward_intent: {
        _tag: "TokenAmount",
        token_id: "honey-token",
        amount: { value: "5", decimals: 18 },
      },
      failure_reason: "recipient on sanctions list",
      retryable: false,
    },
  },
  {
    label: "chained failure · source_event_hash set",
    input: {
      ...baseEnv,
      nonce: null,
      source_event_hash: CHAIN_HASH,
      event_id: ZERO_HASH,
      $id: "https://schemas.freeside.thj/reward-failed/v1.0.0",
      preimage_schema_id: "https://schemas.freeside.thj/preimage/reward-failed/v1.0.0",
      originating_event_id: SAMPLE_HASH,
      recipient: "id_player003",
      reward_intent: { _tag: "Resource", resource_kind: "honey", amount: 100 },
      failure_reason: "world resource ledger unavailable",
      retryable: true,
    },
  },
] as const;
