/**
 * Postgres adapter — integration test against an ephemeral mock pool.
 *
 * Per SDD §9.2 AC-2.4 (postgres part): asserts idempotent ON CONFLICT save,
 * Schema.decodeUnknown defense-in-depth on load, PersistenceError on driver
 * failure, StateDecodeError on schema drift, QuestNotFoundError on miss.
 *
 * The "integration" angle: instead of spinning up a Railway DB inside the
 * test runner (which the autonomous flow can't reach), we mock the
 * `QuestStatePostgresPool` interface — the same surface the production
 * adapter uses — and assert the SQL composition, parameter binding, and
 * round-trip semantics. The real DB integration runs at sprint close via
 * Q2.9 operator-bounded migration coordination.
 *
 * Cycle-Q · 2026-05-04 · sprint-2 ENGINE+PERSIST.
 */

import { describe, expect, it } from "vitest";
import { Effect, Either, Schema } from "effect";

import { QuestStatePort } from "../../persistence/port.js";
import {
  QuestStatePortPostgresLayer,
  type QuestStatePostgresPool,
  type QueryResultRow,
} from "../../persistence/adapters/postgres.js";
import {
  type QuestState,
  type PlayerIdentity,
  QuestId,
  NpcId,
  PlayerWallet,
  DiscordId,
} from "@0xhoneyjar/quests-protocol";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUEST_ID = Schema.decodeSync(QuestId)("quest-mongolian-001");
const NPC_ID = Schema.decodeSync(NpcId)("mongolian");
const WALLET = Schema.decodeSync(PlayerWallet)(`0x${"a".repeat(40)}`);
const DISCORD = Schema.decodeSync(DiscordId)("123456789012345678");

const VERIFIED: PlayerIdentity = {
  type: "verified",
  wallet: WALLET,
  discord_id: DISCORD,
};

const stateFixture = (overrides: Partial<QuestState> = {}): QuestState => ({
  quest_id: QUEST_ID,
  player: VERIFIED,
  npc_id: NPC_ID,
  phase: "browsing",
  trace_id: "trace-pg-test",
  contract_version: "1.0.0",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Mock pool — captures queries, replays canned rows.
// ---------------------------------------------------------------------------

interface QueryRecord {
  text: string;
  values: ReadonlyArray<unknown>;
}

const makeMockPool = (
  responses: ReadonlyArray<{ rows: ReadonlyArray<QueryResultRow>; rowCount?: number | null }>,
) => {
  const queries: QueryRecord[] = [];
  let cursor = 0;
  const pool: QuestStatePostgresPool = {
    query: async (text, values) => {
      queries.push({ text, values: values ?? [] });
      const response = responses[cursor++];
      if (response === undefined) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [...response.rows] as never[],
        rowCount: response.rowCount ?? response.rows.length,
      };
    },
  };
  return { pool, queries };
};

const makeFailingPool = (error: Error): {
  pool: QuestStatePostgresPool;
  queries: QueryRecord[];
} => {
  const queries: QueryRecord[] = [];
  const pool: QuestStatePostgresPool = {
    query: async (text, values) => {
      queries.push({ text, values: values ?? [] });
      throw error;
    },
  };
  return { pool, queries };
};

// ---------------------------------------------------------------------------
// save — ON CONFLICT idempotency
// ---------------------------------------------------------------------------

describe("QuestStatePortPostgresLayer · save", () => {
  it("emits INSERT ... ON CONFLICT DO UPDATE with all 5 bound params", async () => {
    const { pool, queries } = makeMockPool([{ rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFixture({ phase: "accepted" }));
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );

    expect(queries.length).toBe(1);
    const q = queries[0];
    if (q === undefined) throw new Error("missing query");
    expect(q.text).toMatch(/INSERT INTO quest_state/);
    expect(q.text).toMatch(/ON CONFLICT \(quest_id, player_key\)/);
    expect(q.text).toMatch(/DO UPDATE SET/);
    expect(q.values.length).toBe(5);
    expect(q.values[0]).toBe(QUEST_ID);
    expect(q.values[1]).toBe(`${QUEST_ID}|wallet:${WALLET}`);
    expect(typeof q.values[2]).toBe("string"); // JSONB serialized
    expect(JSON.parse(q.values[2] as string).phase).toBe("accepted");
    expect(q.values[3]).toBe("mibera");
    expect(q.values[4]).toBe("accepted");
  });

  it("two saves with same key issue two ON CONFLICT statements (idempotent semantics)", async () => {
    const { pool, queries } = makeMockPool([{ rows: [] }, { rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFixture({ phase: "browsing" }));
      yield* port.save(stateFixture({ phase: "accepted" }));
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );

    expect(queries.length).toBe(2);
    expect(JSON.parse(queries[0]?.values[2] as string).phase).toBe("browsing");
    expect(JSON.parse(queries[1]?.values[2] as string).phase).toBe("accepted");
    // Both queries carry the ON CONFLICT clause.
    expect(queries.every((q) => /ON CONFLICT/.test(q.text))).toBe(true);
  });

  it("driver failure → PersistenceError{operation: save}", async () => {
    const { pool } = makeFailingPool(new Error("connection refused"));
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFixture());
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PersistenceError");
      if (result.left._tag === "PersistenceError") {
        expect(result.left.operation).toBe("save");
      }
    }
  });

  it("respects custom table_name override", async () => {
    const { pool, queries } = makeMockPool([{ rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.save(stateFixture());
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({
            pool,
            world_slug: "mibera",
            table_name: "quest_state_staging",
          }),
        ),
      ),
    );

    expect(queries[0]?.text).toMatch(/INSERT INTO quest_state_staging/);
  });
});

// ---------------------------------------------------------------------------
// load — round-trip through Schema.decodeUnknown
// ---------------------------------------------------------------------------

describe("QuestStatePortPostgresLayer · load", () => {
  it("returns decoded QuestState on row hit", async () => {
    const persisted = stateFixture({ phase: "accepted", accepted_at: "2026-05-04T18:00:00.000Z" });
    const { pool, queries } = makeMockPool([
      {
        rows: [
          {
            quest_id: QUEST_ID,
            player_key: `${QUEST_ID}|wallet:${WALLET}`,
            state_json: persisted,
            world_slug: "mibera",
            phase: "accepted",
            updated_at: "2026-05-04T18:00:00.000Z",
          },
        ],
      },
    ]);

    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.load(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );
    expect(result.phase).toBe("accepted");
    expect(result.accepted_at).toBe("2026-05-04T18:00:00.000Z");
    expect(queries[0]?.text).toMatch(/SELECT.*FROM quest_state.*WHERE quest_id = \$1 AND player_key = \$2/s);
    expect(queries[0]?.values).toEqual([QUEST_ID, `${QUEST_ID}|wallet:${WALLET}`]);
  });

  it("empty rows → QuestNotFoundError", async () => {
    const { pool } = makeMockPool([{ rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.load(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("QuestNotFoundError");
    }
  });

  it("malformed state_json → StateDecodeError (defense-in-depth)", async () => {
    const { pool } = makeMockPool([
      {
        rows: [
          {
            quest_id: QUEST_ID,
            player_key: `${QUEST_ID}|wallet:${WALLET}`,
            // Missing required fields · should fail Schema.decodeUnknown.
            state_json: { quest_id: QUEST_ID, phase: "browsing" },
            world_slug: "mibera",
            phase: "browsing",
            updated_at: "2026-05-04T18:00:00.000Z",
          },
        ],
      },
    ]);

    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.load(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("StateDecodeError");
      if (result.left._tag === "StateDecodeError") {
        expect(result.left.quest_id).toBe(QUEST_ID);
      }
    }
  });

  it("driver failure → PersistenceError{operation: load}", async () => {
    const { pool } = makeFailingPool(new Error("connection lost"));
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.load(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PersistenceError");
      if (result.left._tag === "PersistenceError") {
        expect(result.left.operation).toBe("load");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// list — keyspace isolation
// ---------------------------------------------------------------------------

describe("QuestStatePortPostgresLayer · list", () => {
  it("queries with player-key suffix LIKE pattern (verified)", async () => {
    const { pool, queries } = makeMockPool([{ rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.list(VERIFIED);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );

    expect(queries[0]?.values[0]).toBe(`%|wallet:${WALLET}`);
  });

  it("queries with discord-key suffix LIKE pattern (anon)", async () => {
    const { pool, queries } = makeMockPool([{ rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.list({ type: "anon", discord_id: DISCORD });
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );

    expect(queries[0]?.values[0]).toBe(`%|discord:${DISCORD}`);
  });

  it("decodes each row through Schema; bad rows are silently dropped (defensive)", async () => {
    const goodState = stateFixture({ phase: "accepted" });
    const { pool } = makeMockPool([
      {
        rows: [
          {
            quest_id: QUEST_ID,
            player_key: `${QUEST_ID}|wallet:${WALLET}`,
            state_json: goodState,
            world_slug: "mibera",
            phase: "accepted",
            updated_at: "2026-05-04T18:00:00.000Z",
          },
          {
            quest_id: "garbage",
            player_key: "garbage",
            state_json: { broken: true },
            world_slug: "mibera",
            phase: "???",
            updated_at: "2026-05-04T18:00:00.000Z",
          },
        ],
      },
    ]);

    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.list(VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0]?.phase).toBe("accepted");
  });

  it("driver failure → PersistenceError{operation: list}", async () => {
    const { pool } = makeFailingPool(new Error("query timeout"));
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      return yield* port.list(VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PersistenceError");
      if (result.left._tag === "PersistenceError") {
        expect(result.left.operation).toBe("list");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("QuestStatePortPostgresLayer · delete", () => {
  it("emits DELETE FROM quest_state WHERE ... with bound (quest_id, player_key)", async () => {
    const { pool, queries } = makeMockPool([{ rows: [] }]);
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.delete(QUEST_ID, VERIFIED);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
      ),
    );

    expect(queries[0]?.text).toMatch(/DELETE FROM quest_state/);
    expect(queries[0]?.values).toEqual([QUEST_ID, `${QUEST_ID}|wallet:${WALLET}`]);
  });

  it("driver failure → PersistenceError{operation: delete}", async () => {
    const { pool } = makeFailingPool(new Error("constraint violation"));
    const program = Effect.gen(function* () {
      const port = yield* QuestStatePort;
      yield* port.delete(QUEST_ID, VERIFIED);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          QuestStatePortPostgresLayer({ pool, world_slug: "mibera" }),
        ),
        Effect.either,
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PersistenceError");
      if (result.left._tag === "PersistenceError") {
        expect(result.left.operation).toBe("delete");
      }
    }
  });
});
