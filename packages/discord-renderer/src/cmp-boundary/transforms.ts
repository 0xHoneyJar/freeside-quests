/**
 * cmp-boundary/transforms.ts — the 7 boundary transforms.
 *
 * Per `[[chat-medium-presentation-boundary]]` doctrine §1: every substrate ID
 * is translated BEFORE Discord serialization. EVERY output from this package
 * runs through these transforms.
 *
 * Drift signature (asserted by `__tests__/cmp-boundary.test.ts`):
 *   ❌ NEVER let raw QuestId, NpcId, wallet, trace_id, or backend annotation
 *      escape into user-visible Discord output.
 *
 * Per SDD §5.3 + architect locks A3 (7th transform · filterTelemetryFromOutput)
 * + A4 (substrate NEVER dereferences rubric_pointer · construct does).
 *
 * The 7 transforms:
 *   1. questIdToTitle              — QuestId → user-visible quest title
 *   2. npcIdToDisplayName          — NpcId  → display name via registry
 *   3. walletToHandle              — wallet → @handle via AuthCheck
 *   4. phaseToNarrative            — phase  → curator-voice cadence
 *   5. verdictToNarrative          — verdict → narrative (NEVER status enum)
 *   6. badgeUriToVariant           — badge URI → consumer-appropriate variant
 *   7. filterTelemetryFromOutput   — strip UUIDs / @g<id> / trace_id substrings
 *
 * Cycle-Q · 2026-05-04 · sprint-3 BOT WIRING.
 */

import type {
  PlayerIdentity,
  Quest,
  QuestState,
  QuestVerdict,
} from "@freeside-quests/protocol";

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * Character registry for transform 2 (npcIdToDisplayName).
 *
 * The bot consumer (freeside-characters) constructs this from
 * apps/character-<id>/character.json at boot. Keyed by NpcId
 * (kebab-case slug). Substrate does NOT load characters; it only
 * consumes this map.
 */
export interface CharacterRegistry {
  readonly resolveDisplayName: (npc_id: string) => string | undefined;
}

/**
 * Auth-check result for transform 3 (walletToHandle).
 *
 * Mirrors the AuthCheck shape from the engine package (sprint-4 lands
 * the real Layer; sprint-3 transforms compose against this shape).
 */
export interface AuthCheck {
  readonly is_verified: boolean;
  readonly display_handle?: string;
}

/**
 * Curator voice profile for transform 4 (phaseToNarrative).
 *
 * Track A's apps/character-<id>/persona.yaml defines the per-character
 * cadence phrasing. Substrate ships fallback cadence; persona.yaml
 * overrides per-character.
 */
export interface CuratorVoiceProfile {
  readonly accepted?: string;
  readonly submitted?: string;
  readonly judged_approved?: string;
  readonly judged_rejected?: string;
  readonly judged_needs_human?: string;
  readonly completed?: string;
  readonly failed?: string;
}

/**
 * Consumer-format constraint for transform 6 (badgeUriToVariant).
 *
 * Per Cycle B asset-pipeline (separate cycle): the AssetService produces
 * variants from a stable URI. The renderer expresses what the chat-medium
 * supports, the asset-pipeline picks the optimal format.
 *
 * Discord supports PNG/JPEG/WebP/GIF inline attachments up to 8MB on free
 * tier. WebP is preferred (smaller payload); fall back to PNG for clients
 * lacking WebP support (rare on Discord, but the transform respects the
 * constraint declaratively).
 */
export interface ConsumerConstraint {
  readonly chat_medium: "discord" | "farcaster" | "web";
  readonly prefer: "webp" | "png" | "gif" | "mp4";
}

// ---------------------------------------------------------------------------
// Transform 1: QuestId → user-visible quest title
// ---------------------------------------------------------------------------

/**
 * Replace `quest_id` with the user-visible quest title. The QuestId itself
 * never appears in chat output.
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: raw
 * QuestId (UUID-shaped or branded) NEVER escapes the boundary.
 */
export const questIdToTitle = (quest: Quest): string => quest.title;

// ---------------------------------------------------------------------------
// Transform 2: NpcId → display name
// ---------------------------------------------------------------------------

/**
 * Replace NPC slug (e.g. "mongolian") with display name (e.g. "Munkh") via
 * the character registry. Falls back to the slug when the registry has no
 * entry — but the slug is human-readable kebab-case, NOT a UUID.
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: backend
 * annotations like `@g507` NEVER escape; only the curator-authored
 * displayName is user-visible.
 */
export const npcIdToDisplayName = (
  npc_id: string,
  registry: CharacterRegistry,
): string => registry.resolveDisplayName(npc_id) ?? npc_id;

// ---------------------------------------------------------------------------
// Transform 3: wallet → @handle
// ---------------------------------------------------------------------------

/**
 * Replace `0x...` wallet address with `@handle` resolved via AuthCheck.
 * For anon players, returns a Discord-mention shape `<@discord_id>` so
 * Discord renders the user reference natively.
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: raw wallet
 * address NEVER escapes — neither as text nor as a substring of any
 * user-visible field.
 */
export const walletToHandle = (
  player: PlayerIdentity,
  auth: AuthCheck,
): string => {
  if (auth.display_handle && auth.display_handle.length > 0) {
    return auth.display_handle;
  }
  // Discord mention format — Discord renders this as a clickable
  // user reference; the wallet address never appears as text.
  return `<@${player.discord_id}>`;
};

// ---------------------------------------------------------------------------
// Transform 4: phase → curator-voice narrative
// ---------------------------------------------------------------------------

/**
 * Replace substrate phase enum with curator-voice cadence prose. e.g.
 * `phase=judged + verdict=APPROVED` → "the steppe nods" (Mongolian voice).
 * Falls back to substrate-neutral cadence when the persona doesn't supply
 * its own — but NEVER returns the enum string.
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: phase
 * enum (`judged` · `submitted` · `accepted` etc.) NEVER appears in user
 * text. Only narrative cadence escapes.
 */
export const phaseToNarrative = (
  state: QuestState,
  voice: CuratorVoiceProfile,
): string => {
  switch (state.phase) {
    case "browsing":
      return "the path is open"; // substrate fallback (not voice-authored)
    case "accepted":
      return voice.accepted ?? "your mark joins the fire";
    case "submitted":
      return voice.submitted ?? "the witness reads";
    case "judged": {
      const status = state.verdict?.status;
      if (status === "APPROVED") return voice.judged_approved ?? "the steppe nods";
      if (status === "REJECTED")
        return voice.judged_rejected ?? "the wind turns away";
      return voice.judged_needs_human ?? "the elder will speak";
    }
    case "completed":
      return voice.completed ?? "the mark is set";
    case "failed":
      return voice.failed ?? "the path closes for now";
  }
};

// ---------------------------------------------------------------------------
// Transform 5: verdict → narrative (NEVER status enum, NEVER confidence)
// ---------------------------------------------------------------------------

/**
 * Surface the curator-authored narrative ONLY. Status enum stays internal
 * (substrate-only), confidence stays internal (substrate-only).
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature: NEVER
 * "PASS"/"FAIL"/"APPROVED" — only narrative prose. Numeric confidence
 * NEVER appears in user output.
 */
export const verdictToNarrative = (verdict: QuestVerdict): string =>
  verdict.narrative;

// ---------------------------------------------------------------------------
// Transform 6: badge URI → consumer-appropriate variant
// ---------------------------------------------------------------------------

/**
 * Express the consumer's format constraint. The actual variant fetch is
 * Cycle B asset-pipeline territory; this transform builds a stable URI
 * that encodes the desired variant via query string (the asset service
 * resolves; substrate doesn't).
 *
 * For Cycle B v1: pass-through (URI unchanged) — sprint-3 substrate ships
 * the boundary, Cycle B's AssetService will swap in transparently.
 *
 * Per [[metadata-as-integration-contract]]: the URI is the contract;
 * consumer constraint is operator-mutable.
 */
export const badgeUriToVariant = (
  uri: string,
  _consumer: ConsumerConstraint,
): string => uri; // Cycle B pipeline binds at port-adapter swap

// ---------------------------------------------------------------------------
// Transform 7: telemetry filter (NEW · A3 architect lock)
// ---------------------------------------------------------------------------

/**
 * Strip every telemetry-shaped substring from any user-visible string.
 * Defense-in-depth for transforms 1-6 — if any upstream code accidentally
 * concatenates a `trace_id` or backend `@g<id>` into user text, this
 * transform redacts it before serialization.
 *
 * Drift signatures filtered:
 *   - UUID v4 / v5 / generic 8-4-4-4-12 hex pattern (case-insensitive)
 *   - Wallet hex strings (0x followed by 40 hex chars · case-insensitive)
 *   - Backend annotations of shape `@g<digits>` (Mongolian #507 etc · the
 *     curator-authored *name* is fine; the *anchor annotation* is not)
 *   - Discord IDs in raw form (17-20 digits standalone) — bare numerics
 *     leak across boundaries even when not fenced. Mention syntax
 *     `<@discord_id>` is preserved since Discord renders it as a name.
 *   - submission_id / quest_id branded prefixes (kebab-case slugs are
 *     allowed; UUID-shape is not)
 *
 * Per [[chat-medium-presentation-boundary]] §2 drift signature.
 * Per architect lock A3 (the 7th transform · NEW this cycle).
 */
const UUID_PATTERN =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const WALLET_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g;
const BACKEND_ANCHOR_PATTERN = /(?<!\w)@g\d+\b/g;
// Bare 17-20 digit runs that aren't already inside a Discord mention.
// Strategy: blank out matching runs UNLESS they are part of <@digits> or
// <@!digits> (allowed Discord render syntax · transform 3 emits these).
const BARE_DISCORD_ID_PATTERN = /(?<![<@!])\b\d{17,20}\b(?![>])/g;

const REDACTED = "[redacted]";

export const filterTelemetryFromOutput = (text: string): string => {
  if (!text) return text;
  return text
    .replace(UUID_PATTERN, REDACTED)
    .replace(WALLET_PATTERN, REDACTED)
    .replace(BACKEND_ANCHOR_PATTERN, REDACTED)
    .replace(BARE_DISCORD_ID_PATTERN, REDACTED);
};

// ---------------------------------------------------------------------------
// Aggregate export — the 7 transforms as one surface
// ---------------------------------------------------------------------------

/**
 * The CMP-boundary transform surface. Every render-* function in
 * cmp-boundary/ imports from this aggregate (or directly from the named
 * exports above) and applies the transforms before emitting any descriptor.
 */
export const transforms = {
  questIdToTitle,
  npcIdToDisplayName,
  walletToHandle,
  phaseToNarrative,
  verdictToNarrative,
  badgeUriToVariant,
  filterTelemetryFromOutput,
} as const;
