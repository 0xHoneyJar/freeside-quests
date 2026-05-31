/**
 * HTTP-status mapping proof for the write-path EventError variants
 * (defect #21.8 · the SchemaValidation/422 vs EventStoreUnavailable/503 split).
 *
 * The defect: a retry-exhausted serialization STORM in the postgres event-store
 * returned SchemaValidation — the SAME tag a PERMANENT bad-input failure uses —
 * which `runRead` maps to HTTP 422 (permanent), telling the client to STOP
 * retrying a transient infra fault. The fix added an `EventStoreUnavailable`
 * variant (retryable) mapped to 503. This test pins BOTH mappings so the split
 * cannot silently regress.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { EventStoreUnavailable, SchemaValidation } from "@0xhoneyjar/quests-protocol";

import { runRead } from "./_shared.js";

describe("Defect #21.8 — EventError → HTTP status mapping", () => {
  it("EventStoreUnavailable (transient infra fault) → 503", async () => {
    const failing = Effect.fail(
      EventStoreUnavailable.make({
        event_type: "EventStoreContract.append",
        reason: "postgres append failed: serialization storm exhausted retries",
        retryable: true,
      }),
    );
    const res = await runRead(failing, (v) => v);
    expect(res.status).toBe(503);
  });

  it("SchemaValidation (permanent bad input) → 422 (the tag EventStoreUnavailable is NO LONGER conflated with)", async () => {
    const failing = Effect.fail(
      SchemaValidation.make({
        event_type: "EventStoreContract.append",
        detail: "event_id does not match canonical hash",
      }),
    );
    const res = await runRead(failing, (v) => v);
    expect(res.status).toBe(422);
  });

  it("the two infra-vs-input statuses are DISTINCT (503 ≠ 422)", async () => {
    const transient = await runRead(
      Effect.fail(
        EventStoreUnavailable.make({
          event_type: "x",
          reason: "transient",
          retryable: true,
        }),
      ),
      (v) => v,
    );
    const permanent = await runRead(
      Effect.fail(SchemaValidation.make({ event_type: "x", detail: "bad input" })),
      (v) => v,
    );
    expect(transient.status).not.toBe(permanent.status);
    expect(transient.status).toBe(503);
    expect(permanent.status).toBe(422);
  });
});
