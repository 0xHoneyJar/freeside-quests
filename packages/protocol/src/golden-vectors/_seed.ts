/**
 * Seed script (T1.11 · NOT part of the package surface).
 *
 * Computes `expected_event_id` + `expected_preimage_jcs` for each fixture in
 * `_inputs.ts` and prints the resulting object to stdout. The output is
 * pasted into `_expected.ts` as a locked golden snapshot.
 *
 * Run: `bun run packages/protocol/src/golden-vectors/_seed.ts`
 */

import { canonicalizeJCS } from "../encoding/jcs.js";
import { computeEventIdSync } from "../events/compute-event-id.js";
import {
  ACTIVITY_COMPLETED_INPUTS,
  BADGE_ISSUED_INPUTS,
  PROGRESS_ADVANCED_INPUTS,
  RAFFLE_DRAWN_INPUTS,
  REWARD_FAILED_INPUTS,
  REWARD_GRANTED_INPUTS,
  REWARD_PENDING_INPUTS,
} from "./_inputs.js";

const stripEventId = (event: Record<string, unknown>): Record<string, unknown> => {
  const { event_id: _drop, ...rest } = event;
  return rest;
};

const sortStepCompletions = (preimage: Record<string, unknown>): Record<string, unknown> => {
  const stepsKey = "step_completions" in preimage ? "step_completions" : "new_step_completions";
  if (!(stepsKey in preimage)) return preimage;
  const raw = preimage[stepsKey];
  if (!Array.isArray(raw)) return preimage;
  const sorted = [...raw].sort((a: unknown, b: unknown) => {
    const ao = (a as { order?: number }).order ?? 0;
    const bo = (b as { order?: number }).order ?? 0;
    if (ao !== bo) return ao - bo;
    const aid = String((a as { step_id?: unknown }).step_id ?? "");
    const bid = String((b as { step_id?: unknown }).step_id ?? "");
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });
  return { ...preimage, [stepsKey]: sorted };
};

const computePreimageJcs = (event: Record<string, unknown>): string => {
  const preimage = sortStepCompletions(stripEventId(event));
  return canonicalizeJCS(preimage);
};

interface NamedInputGroup {
  readonly group: string;
  readonly inputs: ReadonlyArray<{ label: string; input: Record<string, unknown> }>;
}

const groups: NamedInputGroup[] = [
  { group: "ACTIVITY_COMPLETED", inputs: ACTIVITY_COMPLETED_INPUTS as never },
  { group: "BADGE_ISSUED", inputs: BADGE_ISSUED_INPUTS as never },
  { group: "RAFFLE_DRAWN", inputs: RAFFLE_DRAWN_INPUTS as never },
  { group: "PROGRESS_ADVANCED", inputs: PROGRESS_ADVANCED_INPUTS as never },
  { group: "REWARD_PENDING", inputs: REWARD_PENDING_INPUTS as never },
  { group: "REWARD_GRANTED", inputs: REWARD_GRANTED_INPUTS as never },
  { group: "REWARD_FAILED", inputs: REWARD_FAILED_INPUTS as never },
];

async function main(): Promise<void> {
  const out: Record<
    string,
    Array<{ label: string; expected_event_id: string; expected_preimage_jcs: string }>
  > = {};
  for (const { group, inputs } of groups) {
    out[group] = [];
    for (const { label, input } of inputs) {
      const id = await computeEventIdSync(input as Parameters<typeof computeEventIdSync>[0]);
      const jcs = computePreimageJcs(input);
      out[group].push({ label, expected_event_id: id, expected_preimage_jcs: jcs });
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
