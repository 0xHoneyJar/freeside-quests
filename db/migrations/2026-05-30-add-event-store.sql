-- ============================================================================
-- Seam-B event-store schema (T-A1 · cubquests-activities-extraction · Lane A)
--
-- Backs the postgres EventStoreContract + CompletionEventPort adapters at
-- packages/adapters/src/postgres/event-store.ts.
--
-- Design notes (tie to CL-EventStore-1..7):
--
--   CL-EventStore-1 (APPEND-ONLY): the adapter issues ONLY INSERT + SELECT.
--     There is no UPDATE/DELETE path. The table has no `updated_at`; rows are
--     immutable once written. (Enforced by the adapter, not a DB trigger —
--     keeping the DDL portable; a future hardening pass MAY add a
--     `REVOKE UPDATE, DELETE` grant or a row-immutability trigger.)
--
--   CL-EventStore-2 (monotonic-sequence per partition): `monotonic_sequence`
--     is assigned per (scope, partition_value) as MAX(existing)+1 inside the
--     same SERIALIZABLE / FOR-UPDATE transaction that performs the CAS check.
--     The UNIQUE (scope, partition_value, monotonic_sequence) constraint is the
--     DB-level backstop: two writers that somehow computed the same next
--     sequence cannot both commit.
--
--   CL-EventStore-3 (CAS via expected_tip_hash): the adapter SELECTs the
--     current tip row FOR UPDATE (or runs the whole append at SERIALIZABLE)
--     so two racing writers serialize; the loser sees the advanced tip and
--     fails CAS. The DB constraints make a lost-update structurally impossible.
--
--   CL-EventStore-4 (duplicate-reject by event_id): `event_id` is the PRIMARY
--     KEY. A duplicate INSERT raises unique_violation (SQLSTATE 23505) which
--     the adapter maps to DuplicateEvent.
--
--   CL-EventStore-5 (scope-grouping): `scope` + `partition_value` are stored
--     separately and the (scope, value) tuple defines the partition. The
--     adapter rejects scope mismatches before touching the DB.
--
--   CL-EventStore-6 (replay-determinism): read() does
--     `ORDER BY monotonic_sequence ASC`, a total order within a partition.
--
--   CL-EventStore-7 (nonce-collision): `event_id` already differs for events
--     that differ only by nonce (the caller's canonical hash folds nonce in),
--     so two distinct-nonce events get two distinct PKs and both insert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_store (
  -- CL-EventStore-4: caller's canonical event hash (computeEventId, §5.6).
  -- PRIMARY KEY ⇒ duplicate append raises 23505 ⇒ DuplicateEvent.
  event_id           TEXT        NOT NULL,

  -- Partition identity (CL-EventStore-5). `scope` is the PartitionScope
  -- ("activity" | "composite" | ...); `partition_value` is the scope-specific
  -- value (e.g. activity_id, or "world::activity" for composite).
  scope              TEXT        NOT NULL,
  partition_value    TEXT        NOT NULL,

  -- Convenience composite mirror of (scope, partition_value) — exactly the
  -- string the in-memory adapter uses as its Map key (`${scope}::${value}`).
  -- Stored so a human can eyeball partitions; NOT load-bearing for the
  -- adapter (the adapter keys off the two columns above).
  partition_key      TEXT        NOT NULL,

  -- CL-EventStore-2: 1-based monotonic sequence, dense + gapless per
  -- partition. Assigned MAX+1 under the CAS lock.
  monotonic_sequence BIGINT      NOT NULL,

  -- The full event envelope (ActivityCompleted / ProgressAdvanced / ...).
  -- Stored verbatim so read()/query() round-trip the type-specific fields
  -- (activity_id, identity_id, ...) — the bare EventEnvelope schema would
  -- strip them, so the adapter does NOT re-decode through it.
  event_envelope     JSONB       NOT NULL,

  -- Wall-clock insert time for operability (NOT used for ordering — ordering
  -- is monotonic_sequence only, per CL-EventStore-6).
  inserted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_store_pkey PRIMARY KEY (event_id),

  -- CL-EventStore-2 backstop: no two rows in one partition share a sequence.
  CONSTRAINT event_store_partition_seq_uniq
    UNIQUE (scope, partition_value, monotonic_sequence)
);

-- read()/getTip() hot path: range + tip lookups per partition, sequence-ordered.
CREATE INDEX IF NOT EXISTS idx_event_store_partition_seq
  ON event_store (scope, partition_value, monotonic_sequence);

-- ============================================================================
-- reward_grants — backs makePostgresRewardPort (RewardPort · FR-8 + D18).
--
--   CL-Reward-2 (D18 idempotency): the (originating_event_id, recipient) tuple
--     is the PRIMARY KEY. A second grant for the same tuple raises 23505; the
--     adapter catches it, re-reads the existing row, and surfaces
--     AlreadyGranted carrying the existing granted_event_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reward_grants (
  originating_event_id TEXT        NOT NULL,
  recipient            TEXT        NOT NULL,
  granted_event_id     TEXT        NOT NULL,
  reward               JSONB       NOT NULL,   -- the ActivityReward intent
  ts                   TEXT        NOT NULL,   -- RFC3339Date string
  inserted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reward_grants_pkey PRIMARY KEY (originating_event_id, recipient)
);

CREATE INDEX IF NOT EXISTS idx_reward_grants_recipient
  ON reward_grants (recipient);

-- ============================================================================
-- progress_records — backs makePostgresProgressPort (ProgressPort · CL-Progress-1).
--
--   CL-Progress-1 (optimistic concurrency): advanceProgress checks
--     version_before == stored version inside a FOR-UPDATE transaction; the
--     loser of a race sees the bumped version and fails ConcurrentUpdate.
-- ============================================================================

CREATE TABLE IF NOT EXISTS progress_records (
  activity_id           TEXT        NOT NULL,
  identity_id           TEXT        NOT NULL,
  record_json           JSONB       NOT NULL,   -- full ProgressRecord
  version               BIGINT      NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT progress_records_pkey PRIMARY KEY (activity_id, identity_id)
);

-- ============================================================================
-- identity_bindings — backs makePostgresIdentityResolver (IdentityResolverPort).
--
--   CL-Identity-3: one IdentityId may map to many chains (PK includes chain).
--   CL-Identity-4: reverse resolution is consistent — UNIQUE (chain, address)
--     guarantees an address binds to at most one identity per chain.
-- ============================================================================

CREATE TABLE IF NOT EXISTS identity_bindings (
  identity_id TEXT NOT NULL,
  chain       TEXT NOT NULL,
  address     TEXT NOT NULL,

  CONSTRAINT identity_bindings_pkey PRIMARY KEY (identity_id, chain),
  CONSTRAINT identity_bindings_addr_uniq UNIQUE (chain, address)
);

CREATE INDEX IF NOT EXISTS idx_identity_bindings_reverse
  ON identity_bindings (chain, address);
