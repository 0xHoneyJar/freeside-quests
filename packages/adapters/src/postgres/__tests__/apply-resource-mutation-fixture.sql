-- ============================================================================
-- TEST FIXTURE — apply_resource_mutation stored proc + its two tables.
--
-- This MIRRORS the canonical cubquest-db proc that the atomicity bridge calls
-- in production. Grounded against:
--   cubquests-interface/supabase/migrations/
--     20251102231328_fix_apply_resource_mutation_return_deltas.sql
--
-- We reproduce the SAME signature, the SAME idempotency semantics (idempotency
-- key against resource_transactions), the SAME FOR-UPDATE on user_resources,
-- and the SAME insufficient-balance RAISE — so the atomic unit-of-work exercises
-- the real shape, not a toy. The proc is a plpgsql function: it runs in the
-- CALLER's transaction, which is precisely the property the atomicity test
-- depends on (rollback of the engine txn rolls back the ledger mutation).
--
-- Tables are trimmed to the columns the proc touches (the real user_resources
-- has more, but the proc only reads/writes these). The fixture is loaded INTO
-- the per-factory test schema via search_path, exactly like the event-store
-- migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_resources (
  user_address           text PRIMARY KEY,
  common                 integer NOT NULL DEFAULT 0,
  rare                   integer NOT NULL DEFAULT 0,
  legendary              integer NOT NULL DEFAULT 0,
  total_common_earned    integer NOT NULL DEFAULT 0,
  total_common_spent     integer NOT NULL DEFAULT 0,
  total_rare_earned      integer NOT NULL DEFAULT 0,
  total_rare_spent       integer NOT NULL DEFAULT 0,
  total_legendary_earned integer NOT NULL DEFAULT 0,
  total_legendary_spent  integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resource_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_address    text NOT NULL,
  resource_type   text NOT NULL,
  amount          integer NOT NULL,
  balance_after   integer NOT NULL,
  source_type     text,
  source_id       text,
  metadata        jsonb,
  idempotency_key text,
  authorizer      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Defect #21.5: the PROD partial-unique index was MISSING from this fixture, so
-- the proc's check-then-INSERT had a TOCTOU window with NO race-safe backstop in
-- tests (two concurrent calls could both pass the existence check, then both
-- INSERT, double-applying the ledger). The canonical prod index — grounded in
-- cubquests-interface/supabase/migrations/
--   20251102225424_fix_idempotency_key_column_type_to_text.sql
-- (and originally 20251018_add_resource_idempotency.sql) — is:
--
--   (user_address, resource_type, idempotency_key) WHERE idempotency_key IS NOT NULL
--
-- With it present, the LOSER of a check-then-insert race raises 23505 instead of
-- double-applying. The bridge classifies that 23505 as NON-retryable (defect
-- #21.6) — proven by the divergent-key concurrency test.
CREATE UNIQUE INDEX IF NOT EXISTS resource_transactions_user_type_idempotency_idx
  ON resource_transactions (user_address, resource_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- gen_random_uuid lives in pgcrypto on some images; ensure it's available.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION apply_resource_mutation(
  p_user_address text,
  p_source_type text,
  p_common integer DEFAULT 0,
  p_rare integer DEFAULT 0,
  p_legendary integer DEFAULT 0,
  p_source_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_authorizer text DEFAULT NULL
)
RETURNS TABLE(
  common integer,
  rare integer,
  legendary integer,
  common_transaction_id uuid,
  rare_transaction_id uuid,
  legendary_transaction_id uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_user text;
  v_now timestamptz := timezone('utc', now());
  v_existing user_resources%ROWTYPE;
  v_new user_resources%ROWTYPE;
  v_common_delta integer := COALESCE(p_common, 0);
  v_rare_delta integer := COALESCE(p_rare, 0);
  v_legendary_delta integer := COALESCE(p_legendary, 0);
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_common_tx_id uuid := NULL;
  v_rare_tx_id uuid := NULL;
  v_legendary_tx_id uuid := NULL;
  v_existing_tx_id uuid := NULL;
  v_existing_tx_type text := NULL;
  v_idempotency_key_text text := p_idempotency_key;
BEGIN
  v_user := lower(trim(p_user_address));

  IF v_user IS NULL OR v_user = '' THEN
    RAISE EXCEPTION 'p_user_address is required';
  END IF;

  IF v_common_delta = 0 AND v_rare_delta = 0 AND v_legendary_delta = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- Idempotency: a prior tx with this key → no-op, return zero deltas.
  IF v_idempotency_key_text IS NOT NULL THEN
    SELECT rt.id, rt.resource_type
      INTO v_existing_tx_id, v_existing_tx_type
      FROM resource_transactions rt
     WHERE rt.idempotency_key = v_idempotency_key_text
       AND rt.user_address = v_user
     LIMIT 1;

    IF v_existing_tx_id IS NOT NULL THEN
      IF v_existing_tx_type = 'legendary' THEN
        RETURN QUERY SELECT 0, 0, 0, NULL::uuid, NULL::uuid, v_existing_tx_id;
      ELSIF v_existing_tx_type = 'common' THEN
        RETURN QUERY SELECT 0, 0, 0, v_existing_tx_id, NULL::uuid, NULL::uuid;
      ELSE
        RETURN QUERY SELECT 0, 0, 0, NULL::uuid, v_existing_tx_id, NULL::uuid;
      END IF;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_existing FROM user_resources WHERE user_address = v_user FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO user_resources (
      user_address, common, rare, legendary,
      total_common_earned, total_common_spent,
      total_rare_earned, total_rare_spent,
      total_legendary_earned, total_legendary_spent,
      created_at, updated_at
    ) VALUES (
      v_user,
      GREATEST(v_common_delta, 0), GREATEST(v_rare_delta, 0), GREATEST(v_legendary_delta, 0),
      GREATEST(v_common_delta, 0), GREATEST(-v_common_delta, 0),
      GREATEST(v_rare_delta, 0), GREATEST(-v_rare_delta, 0),
      GREATEST(v_legendary_delta, 0), GREATEST(-v_legendary_delta, 0),
      v_now, v_now
    ) RETURNING * INTO v_new;
  ELSE
    v_new := v_existing;
    v_new.common := v_existing.common + v_common_delta;
    v_new.rare := v_existing.rare + v_rare_delta;
    v_new.legendary := v_existing.legendary + v_legendary_delta;

    IF v_new.common < 0 THEN RAISE EXCEPTION 'resource-insufficient-common'; END IF;
    IF v_new.rare < 0 THEN RAISE EXCEPTION 'resource-insufficient-rare'; END IF;
    IF v_new.legendary < 0 THEN RAISE EXCEPTION 'resource-insufficient-legendary'; END IF;

    UPDATE user_resources
       SET common = v_new.common, rare = v_new.rare, legendary = v_new.legendary,
           total_common_earned = v_existing.total_common_earned + GREATEST(v_common_delta, 0),
           total_common_spent = v_existing.total_common_spent + GREATEST(-v_common_delta, 0),
           total_rare_earned = v_existing.total_rare_earned + GREATEST(v_rare_delta, 0),
           total_rare_spent = v_existing.total_rare_spent + GREATEST(-v_rare_delta, 0),
           total_legendary_earned = v_existing.total_legendary_earned + GREATEST(v_legendary_delta, 0),
           total_legendary_spent = v_existing.total_legendary_spent + GREATEST(-v_legendary_delta, 0),
           updated_at = v_now
     WHERE user_address = v_user
    RETURNING * INTO v_new;
  END IF;

  IF v_common_delta <> 0 THEN
    INSERT INTO resource_transactions (
      user_address, resource_type, amount, balance_after, source_type, source_id,
      metadata, idempotency_key, authorizer, created_at
    ) VALUES (
      v_user, 'common', v_common_delta, v_new.common, p_source_type, p_source_id,
      v_metadata, v_idempotency_key_text, p_authorizer, v_now
    ) RETURNING id INTO v_common_tx_id;
  END IF;

  IF v_rare_delta <> 0 THEN
    INSERT INTO resource_transactions (
      user_address, resource_type, amount, balance_after, source_type, source_id,
      metadata, idempotency_key, authorizer, created_at
    ) VALUES (
      v_user, 'rare', v_rare_delta, v_new.rare, p_source_type, p_source_id,
      v_metadata, v_idempotency_key_text, p_authorizer, v_now
    ) RETURNING id INTO v_rare_tx_id;
  END IF;

  IF v_legendary_delta <> 0 THEN
    INSERT INTO resource_transactions (
      user_address, resource_type, amount, balance_after, source_type, source_id,
      metadata, idempotency_key, authorizer, created_at
    ) VALUES (
      v_user, 'legendary', v_legendary_delta, v_new.legendary, p_source_type, p_source_id,
      v_metadata, v_idempotency_key_text, p_authorizer, v_now
    ) RETURNING id INTO v_legendary_tx_id;
  END IF;

  RETURN QUERY SELECT v_common_delta, v_rare_delta, v_legendary_delta,
                      v_common_tx_id, v_rare_tx_id, v_legendary_tx_id;
END;
$$;
