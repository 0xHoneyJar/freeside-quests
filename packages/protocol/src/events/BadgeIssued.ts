import { Schema } from "effect";

import { ActivityId } from "../branded/ActivityId.js";
import { IdentityId } from "../branded/IdentityId.js";
import { SnapshotId } from "../branded/SnapshotId.js";
import { eventEnvelopeFields } from "./EventEnvelope.js";

/**
 * BadgeIssued — emitted on BadgeClaim completion (FR-6).
 *
 * Carries the merkle proof + snapshot id that verified the badge claim.
 * The merkle proof is opaque to the substrate — the world's MerkleProof
 * verifier validates contents before emitting this event.
 */
export const BadgeIssued = Schema.Struct({
  ...eventEnvelopeFields,
  $id: Schema.Literal("https://schemas.freeside.thj/badge-issued/v1.0.0"),
  preimage_schema_id: Schema.Literal("https://schemas.freeside.thj/preimage/badge-issued/v1.0.0"),
  activity_id: ActivityId,
  identity_id: IdentityId,
  snapshot_id: SnapshotId,
  badge_family_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  merkle_proof: Schema.Array(Schema.String.pipe(Schema.pattern(/^0x[a-f0-9]+$/))),
});

export type BadgeIssued = Schema.Schema.Type<typeof BadgeIssued>;
