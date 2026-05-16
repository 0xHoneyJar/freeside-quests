# CMP-CONVENTION — substrate names vs chat-medium presentation names

> **CMP** = Chat-Medium-Presentation · the documented convention surface-adapter authors
> follow when translating substrate truth into chat-medium presentation.
>
> **Architectural lock A8**: the substrate has NO user-visible strings · surface
> adapters MUST translate substrate identifiers to medium-appropriate copy.
>
> Per **DISPUTED IMP-016** (resolved ACCEPTED with light edits): this convention is
> documented, not enforced at runtime — runtime enforcement would constrain world
> presentation autonomy. The substrate fails closed on bare IDs only by virtue of
> the surface adapter respecting this convention.

---

## The boundary

```
SUBSTRATE TRUTH                          CHAT-MEDIUM PRESENTATION
─────────────────                        ─────────────────────────
ActivityKind: "quest"          ──→       Discord:  "🎯 quest"
EventId: "a3f1..."                       Telegram: "[Q] {{title}}"
Activity.steps[0].step_id: "step_intro"  CLI:      "step 1: introduction"
                                         Web:      "<QuestCard title={{title}}/>"
```

**Substrate side**: stable IDs · sealed schemas · hash-chained events · cross-runtime
deterministic.
**Presentation side**: per-medium copy · per-world tone · per-locale translation · UX
chrome.

The convention sits at the seam: substrate adapters expose stable substrate-truth;
presentation adapters wrap with medium-appropriate display.

Reference doctrine: `[[chat-medium-presentation-boundary]]` (operator vault · cycle R
substrate truth → chat-medium presentation translation layer · 6 proof points closed
in prod 2026-05-04).

---

## The five rules

### Rule 1 · Substrate exports IDs and shapes · NOT user-visible strings

✓ **Correct** (substrate code):

```typescript
// packages/protocol/src/activity/Activity.ts
export const Activity = Schema.Struct({
  id: ActivityId,
  kind: ActivityKind,           // sealed enum · NOT user-visible
  steps: Schema.Array(ActivityStep),
  reward: ActivityReward,        // sealed union · NOT user-visible
  // ... no `title` · no `description` · no `image_url`
});
```

✗ **Wrong** (substrate code with user-visible strings leaking in):

```typescript
// SUBSTRATE MUST NOT carry presentation strings
export const Activity = Schema.Struct({
  id: ActivityId,
  display_title: Schema.String,   // ← presentation concern · belongs in surface adapter
  emoji: Schema.String,           // ← presentation concern
  cta_button_text: Schema.String, // ← presentation concern
});
```

Worlds CAN extend Activity via `WorldDefined` slot with their own presentation
metadata — but the SUBSTRATE shape stays presentation-free.

---

### Rule 2 · Surface adapters translate substrate IDs to medium-appropriate copy

Each surface adapter owns a translation table. Substrate-stable IDs map to
medium-appropriate copy at the boundary.

#### Example: Discord surface adapter

```typescript
// world-{yourworld}-discord/copy/activity-presentation.ts
const ACTIVITY_KIND_DISCORD_COPY = {
  "quest":         { emoji: "🎯", label: "Quest", color: 0x4F46E5 },
  "mission":       { emoji: "⚡", label: "Mission", color: 0xEAB308 },
  "badge-claim":   { emoji: "🏅", label: "Badge", color: 0xD97706 },
  "raffle-entry":  { emoji: "🎟️", label: "Raffle", color: 0xEC4899 },
} as const;

// Surface adapter consumes substrate Activity + maps via the table
function renderActivityCard(activity: Activity, copy: WorldCopy): EmbedBuilder {
  const display = ACTIVITY_KIND_DISCORD_COPY[activity.kind];
  return new EmbedBuilder()
    .setColor(display.color)
    .setTitle(`${display.emoji} ${display.label}: ${copy.titleFor(activity.id)}`)
    .setDescription(copy.descriptionFor(activity.id));
}
```

#### Example: Telegram surface adapter

```typescript
// world-{yourworld}-telegram/copy/activity-presentation.ts
const ACTIVITY_KIND_TELEGRAM_COPY = {
  "quest":         { prefix: "[Q]", inline_keyboard_label: "Accept Quest" },
  "mission":       { prefix: "[M]", inline_keyboard_label: "Join Mission" },
  "badge-claim":   { prefix: "[B]", inline_keyboard_label: "Claim Badge" },
  "raffle-entry":  { prefix: "[R]", inline_keyboard_label: "Enter Raffle" },
} as const;
```

#### Example: CLI surface adapter

```typescript
// world-{yourworld}-cli/copy/activity-presentation.ts
const ACTIVITY_KIND_CLI_COPY = {
  "quest":         { glyph: "🎯", short: "QUEST" },
  "mission":       { glyph: "⚡", short: "MISSION" },
  "badge-claim":   { glyph: "🏅", short: "BADGE" },
  "raffle-entry":  { glyph: "🎟️", short: "RAFFLE" },
} as const;
```

Same substrate Activity · three different surfaces · no substrate change needed.

---

### Rule 3 · Substrate IDs leak through MCP tool outputs · presentation adapters wrap

MCP tools return substrate-truth. They are READ-ONLY (A7) and serve agents — agents
reason about IDs and shapes, not user-visible copy. Presentation adapters wrap the
agent response with chat-medium display before the human sees it.

✓ **Correct** (MCP tool output · substrate-truth):

```json
{
  "items": [
    {
      "id": "act_summer-2026-001",
      "kind": "quest",
      "lifecycle_state": "ACTIVE",
      "reward": { "_tag": "BadgeMint", "mint_intent_id": "mint_summer-badge" }
    }
  ],
  "next_cursor": "eyJ...",
  "total_count": 1
}
```

✓ **Correct** (presentation adapter wraps for the user):

```
🎯 Summer Solstice Quest         ACTIVE
Reward: Summer Badge
[Accept] [Details]
```

✗ **Wrong** (substrate-id-leak into user-visible output):

```
You completed activity act_summer-2026-001 successfully!
                       ^^^^^^^^^^^^^^^^^^^^ user sees raw substrate ID — presentation failure
```

---

### Rule 4 · Two-tier name table per world

Every world that ships a chat-medium surface MUST publish a two-tier name table:

```
SUBSTRATE NAME    →    PRESENTATION NAME
─────────────          ─────────────────────
kind: "quest"          Discord: "🎯 Quest"
                       Telegram: "[Q] Quest"
                       Web: <QuestCard/>
                       CLI: "QUEST"
```

For each substrate identifier the world surfaces (ActivityKind · ActivityReward variant
tag · CompletionEvent type · RewardState · ProgressLifecycleState · LifecycleError tag
· any sealed-error variant), the world supplies the presentation mapping.

The table lives in the world's repo — not in the substrate. The substrate's only job
is to keep IDs stable so the table doesn't break on schema bumps.

---

### Rule 5 · World-defined kinds extend the table · don't pollute the substrate

When a world ships a `WorldDefined` ActivityKind (e.g., `mibera:tithe-rotation` ·
`purupuru:eldercouncil-vote`), the world ALSO ships the presentation mapping for THAT
kind in THEIR table:

```typescript
// world-mibera-discord/copy/activity-presentation.ts
const MIBERA_KINDS_DISCORD_COPY = {
  ...ACTIVITY_KIND_DISCORD_COPY,  // built-in 4
  "mibera:tithe-rotation": {
    emoji: "🪙",
    label: "Tithe",
    color: 0x8B4513,
  },
} as const;
```

The substrate's `WorldDefinedKindId` only enforces ID shape + reserved-prefix rejection
+ payload size bounds (16 KiB · 8 levels). The substrate is BLIND to what the world's
presentation looks like — by design (A8).

---

## Concrete examples · 5 substrate-id-leak patterns to AVOID

These are the patterns the convention exists to prevent. Surface adapter authors who
catch themselves writing any of these are violating CMP.

### Pattern 1 · Raw EventId in user-visible copy

```typescript
// ❌ WRONG
await discord.reply(`Completion recorded · event ${event_id}`);

// ✓ CORRECT
await discord.reply(`✅ Completion recorded`);
// (operator-visible audit log captures event_id separately)
```

### Pattern 2 · Substrate `_tag` discriminator leaking through

```typescript
// ❌ WRONG · sealed-union discriminant leaks
await discord.reply(`Reward: ${reward._tag} (${reward.amount})`);
// → "Reward: TokenAmount (100)" — user sees substrate jargon

// ✓ CORRECT · presentation-mapped
await discord.reply(`Reward: ${WORLD_COPY.reward.title(reward)}`);
// → "Reward: 100 $HONEY" — world copy resolves tag to friendly form
```

### Pattern 3 · `ActivityKind` enum value in chat copy

```typescript
// ❌ WRONG
await discord.reply(`Type: ${activity.kind}`);
// → "Type: badge-claim" — substrate enum leak

// ✓ CORRECT
const display = ACTIVITY_KIND_DISCORD_COPY[activity.kind];
await discord.reply(`${display.emoji} ${display.label}`);
// → "🏅 Badge"
```

### Pattern 4 · Sealed `LifecycleError._tag` in user-facing failure messages

```typescript
// ❌ WRONG
await discord.reply(`Failed: ${err._tag} — ${JSON.stringify(err)}`);
// → "Failed: InvalidTransition — {from: 'COMPLETED', to: 'EXPIRED'}"
//   substrate error variant leaks · operator-debug-only info reaches user

// ✓ CORRECT
await discord.reply(WORLD_COPY.errorMessage(err));
// world copy maps error variants to user-friendly explanations
//   InvalidTransition → "This quest is already complete · cannot reopen"
//   TerminalState     → "This activity has ended · no further changes"
```

### Pattern 5 · ScopeAudit / IdentityId / WorldScope leaking through

```typescript
// ❌ WRONG
await discord.reply(`Audit log entry · caller ${token.sub} · scope ${token.scope}`);
// → "caller id_abc123 · scope WorldScopeAudit{...}"
//   substrate IDs leak into operator-visible audit message

// ✓ CORRECT
await discord.reply(`✅ Audit entry recorded`);
// or for operator-only views, present human-resolved identity:
await discord.reply(`Audit entry · caller @${displayNameFor(token.sub)}`);
```

### Bonus pattern 6 · Telling the user about CASFailed retry

```typescript
// ❌ WRONG · substrate-error-shape exposed in retry prompt
await discord.reply(`Got CASFailed(expected: 5, actual: 6) · please retry`);

// ✓ CORRECT · substrate retries silently · only user-visible failure if max retries hit
await discord.reply(`Hmm, something raced. Try again?`);
```

---

## Naming guidance for surface adapter authors

### Substrate name → presentation name conventions

| Substrate concept | Substrate name | Typical surface name |
|---|---|---|
| Sealed union tag | `_tag` discriminator (CamelCase) | Per-world friendly label |
| Activity kind | `quest` / `mission` / `badge-claim` / `raffle-entry` (kebab) | Per-world title |
| Reward variant | `BadgeMint` / `TokenAmount` / `Cosmetic` (CamelCase) | Per-world reward title |
| Error variant | `ConcurrentUpdate` / `AlreadyGranted` (CamelCase) | Per-world user-friendly explanation |
| Lifecycle state | `DEFINED` / `ACTIVE` / `PARTICIPATING` / `COMPLETED` / `EXPIRED` (SCREAMING) | Per-world status label |
| Progress state | `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` (SCREAMING) | Per-world progress label |

### Substrate verb → presentation verb conventions

| Substrate verb (port operation) | Typical surface verb |
|---|---|
| `advanceProgress` | "Mark step complete" · "Continue quest" · "Submit progress" |
| `emit` (CompletionEventPort) | "Finish quest" · "Complete activity" |
| `grant` (RewardPort) | "Issue reward" · "Mint badge" · "Send tokens" |
| `resolveToChainAddress` | (operator-internal · not user-visible) |

---

## Reference implementations

| Surface | World | Reference |
|---|---|---|
| **Discord** | `cubquests-interface` (canonical operator surface) | Source of design wisdom · the long-running production reference |
| **Discord (multi-character)** | `freeside-characters` (`ruggy` · `satoshi`) | Per-character voice translation layer · CMP doctrine instance |
| **Web cards** | `compass` (medium-blink) | Cycle-3 reference for substrate-truth → presentation-blink translation · cited as canonical for CMP-boundary in the operator vault |
| **CLI** | `loa-finn` | Second-medium proof point · ANSI-render translation |
| **Frame / Blink** | operator's Farcaster Frame POAP-badge-mint-as-quest (2025) + Solana Hackathon Blink (2026-05-11) | Empirical proof: same substrate · two surface mediums · no substrate change |

---

## CMP discipline checklist

For every surface adapter your world ships:

| ✓ | Check |
|---|---|
| ☐ | World repo contains `copy/activity-presentation.ts` (or equivalent) — the two-tier name table |
| ☐ | No file in surface adapter code matches `/\$\{.*\._tag\}|\$\{.*\.kind\}|\$\{.*event_id\}|\$\{.*_id\}/` in user-visible string templates |
| ☐ | Every `ActivityKind` value used by your world has a presentation entry (built-in 4 + any WorldDefined kinds) |
| ☐ | Every sealed-error variant your surface might display has a user-friendly message mapping |
| ☐ | Operator-only views (audit logs · debug panels) are clearly partitioned from user-facing views (substrate IDs allowed in former · not latter) |
| ☐ | Locale support (i18n) lives in the surface · NOT in substrate (substrate is locale-free by design) |

---

## Reference

- Doctrine: `[[chat-medium-presentation-boundary]]` (operator vault · cycle R · 6 proof points)
- Doctrine: `[[mibera-as-npc]]` (two-tier: construct judges · substrate verifies)
- SDD §1.2 — the substrate boundary (load-bearing per A5 · A7 · A8)
- SDD §6 — security design (no PII in audit logs · CMP-related discipline at logging layer)
- PRD §FR-10 — chat-medium-presentation-boundary discipline (the requirement this doc closes)
- Sister doc: `INTEGRATION-PATH.md` § "Common pitfalls" (avoid substrate-id-leak patterns)
- Reference repos: `cubquests-interface` · `freeside-characters` · `compass` · `loa-finn`
