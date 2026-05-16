/**
 * T2.13 acceptance — audit log writes records with structured fields ·
 * production interface stub compiles.
 */
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { IdentityId, WorldId } from "@0xhoneyjar/quests-protocol";

import {
  appendOnlyJsonlSinkSpec,
  makeInMemoryAuditLogSink,
  type AuditLogRecord,
} from "../auth/audit-log.js";

const caller = Schema.decodeUnknownSync(IdentityId)("id_caller");
const world = Schema.decodeUnknownSync(WorldId)("world_foo");

const sampleRecord = (overrides: Partial<AuditLogRecord> = {}): AuditLogRecord => ({
  ts: "2026-05-16T00:00:00Z",
  caller,
  world,
  tool: "getProgress",
  args_hash: "a".repeat(64),
  outcome: "ok",
  latency_ms: 5,
  ...overrides,
});

describe("makeInMemoryAuditLogSink", () => {
  it("appends records and exposes them in order", () => {
    const { sink, records } = makeInMemoryAuditLogSink();
    sink.append(sampleRecord({ outcome: "ok" }));
    sink.append(sampleRecord({ outcome: "permission_denied" }));
    const all = records();
    expect(all.length).toBe(2);
    expect(all[0]!.outcome).toBe("ok");
    expect(all[1]!.outcome).toBe("permission_denied");
  });

  it("captures full structured fields per record", () => {
    const { sink, records } = makeInMemoryAuditLogSink();
    sink.append(sampleRecord({ latency_ms: 42, args_hash: "b".repeat(64) }));
    const [record] = records();
    expect(record!.ts).toBeTruthy();
    expect(record!.caller).toBe(caller);
    expect(record!.world).toBe(world);
    expect(record!.tool).toBe("getProgress");
    expect(record!.args_hash).toBe("b".repeat(64));
    expect(record!.outcome).toBe("ok");
    expect(record!.latency_ms).toBe(42);
  });

  it("enforces capacity (rolling window)", () => {
    const { sink, records } = makeInMemoryAuditLogSink({ capacity: 3 });
    for (let i = 0; i < 5; i++) {
      sink.append(sampleRecord({ tool: `tool-${i}` }));
    }
    const all = records();
    expect(all.length).toBe(3);
    expect(all[0]!.tool).toBe("tool-2");
    expect(all[2]!.tool).toBe("tool-4");
  });

  it("clear empties the buffer", () => {
    const { sink, records, clear } = makeInMemoryAuditLogSink();
    sink.append(sampleRecord());
    clear();
    expect(records().length).toBe(0);
  });
});

describe("appendOnlyJsonlSinkSpec (production interface stub)", () => {
  it("has the documented description", () => {
    expect(appendOnlyJsonlSinkSpec.description).toContain("append-only");
  });

  it("stub append throws — confirms worlds MUST supply a concrete sink", async () => {
    await expect(appendOnlyJsonlSinkSpec.append(sampleRecord())).rejects.toThrow(/contract stub/);
  });
});
