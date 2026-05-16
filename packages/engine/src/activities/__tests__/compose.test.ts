import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ActivityId,
  ChainAddress,
  computeEventIdSync,
  EventId,
  IdentityId,
  type ProgressAdvanced,
  RFC3339Date,
  StepId,
} from "@0xhoneyjar/quests-protocol";

import { buildDefaultActivitiesLayer } from "../compose.js";
import {
  IdentityResolverPortTag,
  ProgressPortTag,
} from "../ports.js";

const decode = Schema.decodeUnknownSync;
const activityA = decode(ActivityId)("act_a");
const identityA = decode(IdentityId)("id_a");
const stepFoo = decode(StepId)("step_foo");
const addrEth = decode(ChainAddress)("0xAaAa000000000000000000000000000000000001");

const ts0 = decode(RFC3339Date)("2026-05-16T00:00:00Z");

const buildAdvance = async (overrides: { nonce: string }): Promise<ProgressAdvanced> => {
  const draft = {
    event_id: "0000000000000000000000000000000000000000000000000000000000000000",
    preimage_schema_id: "https://schemas.freeside.thj/preimage/progress-advanced/v1.0.0",
    ts: ts0,
    source_event_hash: null,
    nonce: overrides.nonce,
    schema_version: "1.0.0" as const,
    $id: "https://schemas.freeside.thj/progress-advanced/v1.0.0" as const,
    activity_id: activityA,
    identity_id: identityA,
    new_step_completions: [
      {
        step_id: stepFoo,
        order: 0,
        completed_at: ts0,
        event_id: decode(EventId)("a".repeat(64)),
      },
    ],
    version_before: 0,
    version_after: 1,
  };
  const computed = await computeEventIdSync(draft as unknown as Record<string, unknown> & {
    $id: string;
    nonce: string | null;
  });
  const parsed = Schema.decodeUnknownSync(
    (await import("@0xhoneyjar/quests-protocol")).ProgressAdvanced,
  )({ ...draft, event_id: computed });
  return parsed;
};

describe("buildDefaultActivitiesLayer", () => {
  it("provides all 4 port Tags and end-to-end advanceProgress works", async () => {
    const { layer } = buildDefaultActivitiesLayer({
      identityBindings: [
        { identity_id: identityA, chain: "ethereum", address: addrEth },
      ],
    });
    const event = await buildAdvance({ nonce: "n1" });
    const program = Effect.gen(function* () {
      const progress = yield* ProgressPortTag;
      const resolver = yield* IdentityResolverPortTag;
      const advanced = yield* progress.advanceProgress(event);
      const resolved = yield* resolver.resolveToChainAddress(identityA, "ethereum");
      return { advanced, resolved };
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result.advanced.version).toBe(1);
    expect(result.advanced.lifecycle_state).toBe("IN_PROGRESS");
    expect(result.resolved).toBe(addrEth);
  });

  it("allows world composition to swap the IdentityResolver Layer", async () => {
    // Build a default layer with NO bindings then merge a world-specific
    // resolver override that supplies the binding. This proves the
    // swap-shape pattern works (last-Layer-wins for the same Tag).
    const { layer: defaults } = buildDefaultActivitiesLayer();
    const worldBindings = buildDefaultActivitiesLayer({
      identityBindings: [
        { identity_id: identityA, chain: "ethereum", address: addrEth },
      ],
    }).layer;
    // worldBindings exposes the same Tags; merging via Layer.merge yields a
    // Layer whose IdentityResolverPortTag value comes from `worldBindings`
    // (the right-hand side wins for overlapping services in Effect's Layer
    // merge semantics).
    const { Layer } = await import("effect");
    const merged = Layer.merge(defaults, worldBindings);
    const program = Effect.gen(function* () {
      const resolver = yield* IdentityResolverPortTag;
      return yield* resolver.resolveToChainAddress(identityA, "ethereum");
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(merged)));
    expect(result).toBe(addrEth);
  });

  it("exposes adapter handles for test inspection (seed + snapshot)", async () => {
    const { layer, handles } = buildDefaultActivitiesLayer();
    handles.progress.seed({
      activity_id: activityA,
      identity_id: identityA,
      current_step: stepFoo,
      steps_completed: [
        { step_id: stepFoo, order: 0, completed_at: ts0, event_id: decode(EventId)("a".repeat(64)) },
      ],
      last_advanced_event_id: decode(EventId)("a".repeat(64)),
      version: 5,
      lifecycle_state: "IN_PROGRESS",
    });
    const program = Effect.gen(function* () {
      const progress = yield* ProgressPortTag;
      return yield* progress.getProgress(activityA, identityA);
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result.version).toBe(5);
    expect(handles.progress.snapshot().size).toBe(1);
  });
});
