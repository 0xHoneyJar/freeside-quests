# Agent Handbook

## Mental Models

### 1. Unified Activities Architecture
**Core Truth**: Quests and Missions are the SAME thing—both are Activities.

```typescript
// Mental model: Think "Activity" first
interface Activity {
  kind: 'quest' | 'mission';  // Only difference
  slug: string;
  steps: ActivityStep[];
  reward: ActivityReward;
}

// Database: Single source of truth
user_activity_progress {
  activity_id: string;
  period_key: string | null;  // null = quest, "2025-W42" = mission
  status: 'not_started' | 'in_progress' | 'completed';
}
```

**Implications**:
- Use `useActivityProgress()` for BOTH quests and missions
- Same API endpoint: `/api/platform/activities/[slug]`
- Same service functions: `lib/activities/service.ts`
- Same progress table, different period keys

### 2. Batch Fetching for Performance
**Anti-pattern** (N API calls):
```typescript
// ❌ Each component fetches individually
function MissionCard({ mission }) {
  const { progress } = useActivityProgress({ activitySlug: mission.slug });
  // Result: 10 missions = 10 API calls
}
```

**Pattern** (1 API call):
```typescript
// ✅ Parent batch-fetches, creates lookup map, passes down
function MissionSection({ missions }) {
  // 1. Batch fetch all at once
  const { activities } = useActivities({ kind: 'mission', user: address });

  // 2. Create O(1) lookup map
  const progressMap = useMemo(() =>
    new Map(activities.map(a => [a.slug, a.user])),
    [activities]
  );

  // 3. Pass to children
  return missions.map(m => (
    <MissionCard mission={m} progress={progressMap.get(m.slug)} />
  ));
}
```

**Rule**: Always fetch at the highest level that needs the data.

### 3. next-safe-action v8 Pattern
**Critical**: NEVER call actions directly. ALWAYS use `useAction` hook.

```typescript
// ❌ WRONG - Direct call in client component
const result = await myAction({ data });

// ✅ CORRECT - Use hook
const { executeAsync, isExecuting } = useAction(myAction, {
  onSuccess: ({ data }) => toast.success(data.message),
  onError: ({ error }) => toast.error(error.serverError),
});

await executeAsync({ data });
```

**Action Definition**:
```typescript
// Use .inputSchema() NOT .schema() in v8
export const myAction = authenticatedActionClient
  .inputSchema(z.object({ /* ... */ }))
  .action(async ({ parsedInput, ctx }) => {
    // ctx.userAddress from middleware
    return { success: true, message: "..." };
  });
```

**Result Structure**: `{ data?, serverError?, validationErrors? }`

### 4. Code Organization Principles

**DRY Immediately**:
```
lib/activities/
├── formatting.tsx      # Shared text rendering
├── filtering.ts        # Time-based helpers
└── utils.ts           # Domain utilities

hooks/utils/
└── use-activity-rotation.ts  # Reusable time logic
```

**Component Composition**:
```typescript
// Separate concerns
const state = useMissionState({ mission, cycle });
const handlers = useMissionHandlers({ mission, state });
return <MissionRowLayout state={state} handlers={handlers} />;
```

**Never** duplicate helper functions across files.

### 5. Type Safety Everywhere

```typescript
// Define types upfront
import type { Activity, ActivityProgress } from '@/types/activities';

// Use strict types in function signatures
export function processActivity(activity: Activity): ActivityProgress {
  // TypeScript catches errors at compile time
}

// Avoid any, unknown, or loose types
```

## Architecture Overview

### Stack
- **Framework**: Next.js 15 App Router + React 18 Server Components
- **State**: TanStack Query (reads) + next-safe-action (writes)
- **Auth**: Dynamic Labs + Wagmi + NextAuth
- **Database**: Supabase (typed via `types/supabase.ts`)
- **Styling**: Tailwind + Shadcn UI components

### Directory Structure (Essential)
```
src/
├── app/                    # App Router pages + API routes
│   ├── api/platform/       # Consolidated API (activities, resources, raffles)
│   └── [routes]/page.tsx   # Page components
├── actions/                # Server actions (next-safe-action)
│   └── lib/               # Authenticated action clients
components/
├── sections/              # Page-level assemblies
├── features/              # Domain widgets (quests, missions, raffles)
└── ui/                    # Shadcn components
hooks/
├── platform/              # Data hooks (use-activities, use-resources)
├── missions/              # Mission-specific state/handlers
├── user/                  # Auth + profile
└── utils/                 # Reusable utilities
lib/
├── activities/            # Activity domain logic
│   ├── service.ts        # Core CRUD + verification
│   ├── progress.ts       # Progress tracking
│   ├── verifiers.ts      # On-chain verification
│   ├── formatting.tsx    # Shared formatting
│   └── filtering.ts      # Time-based helpers
├── resources/            # Resource ledger service
├── api/                  # API clients (platform.ts, badges.ts)
└── shared/               # Cross-domain utilities
types/
├── supabase.ts           # Auto-generated DB types
└── activities.ts         # Activity domain types
```

## Data Flow Patterns

### Activities Pipeline
```
Supabase tables
  ↓
lib/activities/service.ts (server)
  ↓
/api/platform/activities/* (API routes)
  ↓
lib/api/platform.ts (client)
  ↓
hooks/platform/use-activities.ts (React Query)
  ↓
Components
```

### Server Actions Flow
```
Client component
  ↓
useAction(myAction) hook
  ↓
executeAsync({ data })
  ↓
src/actions/[domain]/[action].ts (server)
  ↓
lib/[domain]/service.ts (business logic)
  ↓
Supabase RPC/mutations
```

### Progress Tracking (Unified)
```typescript
// For ANY activity (quest or mission)
const { isCompleted, status } = useActivityProgress({
  activitySlug: 'my-activity',
  kind: 'quest',  // or 'mission'
  user: address,
  periodKey: null,  // or "2025-W42" for missions
});
```

## Common Patterns

### 1. Fetching Activity Data
```typescript
// Batch fetch with user progress
const { activities } = useActivities({
  kind: 'quest',
  user: address,
  include: ['progress'] as const,
});

// activities includes merged user progress in .user field
activities.forEach(a => {
  console.log(a.user?.status);  // 'completed' | 'in_progress' | 'not_started'
});
```

### 2. Creating Server Actions
```typescript
"use server";

import { z } from "zod";
import { authenticatedActionClient } from "@/src/actions/lib";

const inputSchema = z.object({
  activitySlug: z.string(),
  stepId: z.string(),
  address: z.string(),
});

export const completeStepAction = authenticatedActionClient
  .inputSchema(inputSchema)
  .action(async ({ parsedInput, ctx }) => {
    // ctx.userAddress is verified
    // parsedInput is type-safe

    const result = await verifyAndCompleteActivityStep({
      activity,
      userAddress: ctx.userAddress,
      stepId: parsedInput.stepId,
    });

    return { success: true, data: result };
  });
```

### 3. Time-Based Filtering (Missions)
```typescript
import { isCycleLive, isCycleUpcoming } from '@/lib/activities/filtering';
import { useActivityRotation } from '@/hooks/utils/use-activity-rotation';

// Track rotation timer
const { nowMs, secondsUntilRotationEnd } = useActivityRotation(rotation);

// Filter missions by time
const liveMissions = missions.filter(({ cycle }) =>
  isCycleLive(cycle, nowMs)
);
```

### 4. Optimistic Updates
```typescript
const { executeAsync } = useAction(enterRaffleAction, {
  onSuccess: () => {
    // Invalidate queries to refetch
    queryClient.invalidateQueries(['raffles']);
  }
});
```

## Critical Rules

1. **Unified Activities**: Treat quests and missions identically at the data layer
2. **Batch Fetch**: Never fetch in loops, always batch at parent level
3. **useAction Always**: Never call server actions directly
4. **Type Everything**: No `any`, strict TypeScript
5. **DRY Immediately**: Extract duplicates to `lib/` or `hooks/utils/`
6. **Normalize Addresses**: Always lowercase via `normalizeAddress()`
7. **Idempotency Keys**: Required for resource mutations
8. **Period Keys**: `null` for quests, `resolvePeriodKey()` for missions

## Development Workflow

```bash
# Setup
bun install
bun run dev  # Turbopack dev server

# Build & Test
bun run build
bun run lint
bun run format

# Add Shadcn component
bunx --bun shadcn@latest add [component]
```

## Performance Checklist

- [ ] Parent component batch-fetches data
- [ ] Created lookup map for O(1) access
- [ ] Passing data as props to children
- [ ] Using `useMemo` for expensive computations
- [ ] Only fetching when `enabled: true`
- [ ] Proper React Query stale/cache times

## References

- `CLAUDE.md` - Full context guide (start here)
- `lib/activities/README.md` - Activities pipeline deep-dive
- `docs/HOOKS_CONSOLIDATION_PLAN.md` - Hook organization
- `docs/API_CONSOLIDATION_COMPLETE.md` - Platform API structure

## Claude Code Skills Integration

### Skill Workflow

Skills are invoked via Claude Code CLI and provide guided workflows for common operations:

1. **Invoke**: Type trigger (e.g., `/creating-quests`) or describe task
2. **Guide**: Skill walks through required inputs and validations
3. **Execute**: Scripts run with safety checks
4. **Persist**: Context saved to `grimoires/` for audit trail

### Available Skills

See `CLAUDE.md` for complete skill inventory organized by category:
- **Loa Framework**: PRD, SDD, sprint planning, security audits
- **HivemindOS Lab**: Beads, Linear, backend patterns
- **CubQuests Operations**: Quests, badges, raffles, cosmetics

### Skill Invocation Examples

```bash
# Create a new quest
/creating-quests

# Distribute a badge to addresses
/managing-badges

# Start work on a Linear issue
/managing-beads start --issue LAB-123 --domain frontend

# Generate security audit before PR
/audit
```

### When to Use Skills vs. Direct Implementation

| Scenario | Approach |
|----------|----------|
| Adding a new quest | Use `/creating-quests` skill |
| Bug fix in existing code | Direct implementation |
| New badge with distribution | Use `/managing-badges` skill |
| Refactoring existing feature | Direct implementation |
| Partner integration | Use `/integrating-partners` skill |
| Security review before merge | Use `/audit` skill |
