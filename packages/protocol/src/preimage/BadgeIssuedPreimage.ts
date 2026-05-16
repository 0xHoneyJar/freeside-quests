import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { SnapshotId } from "../branded/SnapshotId.js";
import { preimageEnvelopeFields } from "./PreimageEnvelope.js";

/**
 * BadgeIssuedPreimage — canonical preimage shape for BadgeIssued
 * (§5.6 · T1.8 · per FR-6).
 *
 * Identical to {@link BadgeIssued} MINUS the `event_id` field.
 */
export const BadgeIssuedPreimage = Schema.Struct({
  ...preimageEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/badge-issued/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/badge-issued/v1.0.0"),
  activity_id: ActivityId,
  identity_id: IdentityId,
  snapshot_id: SnapshotId,
  badge_family_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  merkle_proof: Schema.Array(Schema.String.pipe(Schema.pattern(/^0x[a-f0-9]+$/))),
});

export type BadgeIssuedPreimage = Schema.Schema.Type<typeof BadgeIssuedPreimage>;
