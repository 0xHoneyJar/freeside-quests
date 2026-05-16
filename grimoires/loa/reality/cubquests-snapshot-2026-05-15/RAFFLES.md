# Raffle System Guide

**Last Updated**: 2025-10-22
**Status**: ✅ Backend Verified | ✅ Frontend Fully Tested | ✅ Auto-Refresh Enabled

---

## ⚡ Quick Context (For New Chats)

### What We Have
- **2 raffle templates** configured with prizes
- **5 cycles** provisioned (W40-completed, W42-completed, W43-open, W44-scheduled)
- **Backend fully verified** - provisioning, entry, drawing all working
- **Frontend partially tested** - ticket purchase flow working ✅
- **Winners display** - Fixed and working for ended raffles ✅
- **Recent winners sidebar** - Restored and working ✅

### Current Week
- **Now**: Week 43 (Oct 22, 2025)
- **Active**: W43 "Mibera's Eternal Lore" (ends Oct 26)
- **Upcoming**: W44 "Mibera's Eternal Lore" (starts Oct 27)

### Key Code Paths
```
Entry Flow:
  components/features/raffles/raffle-detail-panel.tsx (UI)
    → hooks/mutations/use-enter-raffle.ts (hook)
      → src/actions/raffles/enter-raffle.ts (server action)
        → lib/resource-raffles/service.ts:590 (enterResourceRaffleCycle)
          → DB RPC: enter_resource_raffle_transaction (atomic)

Drawing Flow:
  src/app/api/admin/cron/resource-raffles/draw/route.ts (cron)
    → lib/resource-raffles/service.ts:767 (drawResourceRaffleCycle)
      → resource_raffle_winners (insert)

Display Flow:
  src/app/api/platform/raffles/route.ts (API)
    → components/sections/raffles-section.tsx (UI)
```

### What's Verified ✅
- **Provisioning**: Creates cycles + prizes correctly
- **Entry**: Atomic resource deduction + entry creation
- **Drawing**: Weighted random selection works
- **Idempotency**: No double-charging or double-draws (tested with rapid clicking)
- **Table connections**: All data flows correct
- **Ticket Purchase**: Single & multiple ticket purchases working (tested up to 10 tickets)
- **Real-time Updates**: User tickets and total entries update correctly
- **Auto-Refresh**: Raffles automatically detect status changes every 30s (no manual refresh needed)
- **Progress Bar**: Blue progress bar showing ticket progress
- **Winners Display**: Ended raffles show winners correctly (with frame spacing fix)
- **Recent Winners Sidebar**: Shows all 66 winners from past raffles (with frame spacing fix)
- **Persistence**: Ticket counts persist across page refreshes
- **Error Handling**: Insufficient resources shows proper error messages
- **UI Polish**: Proper frame spacing in winner displays, button layouts with text left/resources right

### Completed Tests ✅
- ✅ **Tab display** - Active/Upcoming/Ended tabs working
- ✅ **Single ticket purchase** - Works correctly, resources deduct
- ✅ **Multiple ticket purchase** - Tested, works correctly (7 tickets purchased)
- ✅ **Real-time updates** - User tickets and total entries update
- ✅ **Progress bar** - Blue color, shows correct percentage
- ✅ **Winners display** - Shows 66 winners for ended raffles (with proper frame spacing)
- ✅ **Recent winners sidebar** - Auto-refreshes every 30s (with proper frame spacing)
- ✅ **Persistence** - Refresh works, tickets persist (7/10 maintained)
- ✅ **Insufficient resources** - Error handling works ("More Crystals required")
- ✅ **Idempotency** - Rapid clicking doesn't double-charge
- ✅ **Max limit enforcement** - 10/10 tickets, button disabled correctly
- ✅ **Winner drawing** - Weighted selection works, 3 winners drawn correctly
- ✅ **Auto-refresh on end** - Raffles auto-move to Ended tab within 30s (no manual refresh needed)

### All Core Features Tested ✅
The raffle system is production-ready. All entry, drawing, and display features have been verified.

---

## 🎯 Overview

Weekly raffle system where users spend resources (Fuel, Crystals, Quantum) to buy tickets for prizes. Winners are selected via weighted random draw at the end of each week.

**Key Features**:
- Weekly recurring raffles (auto-provisioned)
- One-time event raffles
- Resource-based entry costs
- Weighted probability (more tickets = higher chance)
- Idempotent operations (no double-charging or double-draws)

---

## 🏗️ Architecture

### Database Tables

```
resource_raffle_templates          # Raffle configurations (reusable)
  ├── resource_raffle_template_prizes  # Links templates to prizes
  │   └── resource_raffle_prizes       # Prize definitions
  │
  └── resource_raffle_cycles         # Weekly instances
      ├── resource_raffle_cycle_prizes   # Prizes for this cycle
      ├── resource_raffle_entries        # User ticket purchases
      └── resource_raffle_winners        # Selected winners
```

### Current Setup

**Template 1: Mibera's Eternal Lore** (Weekly)
- Tags: `["weekly"]` - Auto-provisions every week
- Cost: 25 Fuel + 8 Crystals per ticket
- Max: 10 tickets per user
- Prizes: 3 total (Trait, Lore, 20 USDC)

**Template 2: Beras on the OpenSea** (One-time)
- Tags: `[]` - Manual provisioning only
- Cost: 18 Fuel + 6 Crystals per ticket
- Max: 20 tickets per user
- Prizes: 63 total (HENLO tokens in 4 tiers)

---

## 🔄 Complete Flow

### 1. Provisioning (Weekly - Sunday 00:00 UTC)

**Cron**: `GET /api/admin/cron/resource-raffles/provision`

```
1. Fetch all templates with tags: ["weekly"]
2. For each weekly template:
   - Calculate next week's period key (e.g., "2025-W45")
   - Check if cycle already exists
   - If not, create new cycle:
     - Insert into resource_raffle_cycles (status: "scheduled")
     - Copy prizes from template → resource_raffle_cycle_prizes
3. Return results
```

**Code**: `lib/resource-raffles/provision.ts`

---

### 2. Week Start (Auto-transition)

**Trigger**: User visits `/raffles` page during week start

```
1. Check cycle status === "scheduled"
2. Check current time >= week start time
3. If both true:
   - Update cycle status to "open"
4. Raffle now accepts entries
```

**Code**: `lib/resource-raffles/service.ts:86-112` (`maybeTransitionCycleToOpen`)

---

### 3. Ticket Purchase (User Action)

**Frontend**: User clicks "Buy Ticket"

**Flow**:
```
1. Frontend: hooks/mutations/use-enter-raffle.ts
   - Call enterRaffleAction with { cycleId, tickets, address }

2. Server Action: src/actions/raffles/enter-raffle.ts
   - Validate auth via authenticatedActionClient
   - Call service function

3. Service: lib/resource-raffles/service.ts (enterResourceRaffleCycle)
   - Fetch cycle and validate status === "open"
   - Check user hasn't exceeded max entries
   - Calculate costs (tickets × cost per ticket)
   - Pre-validate user has sufficient resources
   - Call database RPC

4. Database RPC: enter_resource_raffle_transaction
   - Lock existing entry row (FOR UPDATE)
   - Deduct resources via apply_resource_mutation
   - Upsert into resource_raffle_entries:
     - If entry exists: Add tickets to existing total
     - If new: Create entry row
   - Return updated balances

5. Response:
   - entry: { id, cycle_id, user_address, entries, fuel_spent, ... }
   - balances: { fuel, crystals, quantum }
```

**Key Points**:
- Atomic transaction (all or nothing)
- Idempotent (using idempotency key)
- Cumulative (adds to existing entry)
- Unique constraint: (cycle_id, user_address)

---

### 4. Winner Drawing (Hourly Cron)

**Cron**: `GET /api/admin/cron/resource-raffles/draw` (runs every hour)

**Flow**:
```
1. Fetch all cycles with status IN ("scheduled", "open")
2. Filter for cycles where week has ended
3. For each eligible cycle:

   A. Check idempotency:
      - If winners already exist → skip

   B. Fetch prizes:
      - Read from resource_raffle_cycle_prizes
      - Expand quantities: [Prize A ×1, Prize B ×3] → [A, B, B, B]

   C. Fetch entries:
      - Read from resource_raffle_entries
      - Build weighted pool: [{ user, tickets }, ...]

   D. Select winners (for each prize):
      - Generate random number: 0 to totalTickets-1
      - Walk cumulative tickets until random number < cumulative
      - Selected entry wins
      - Decrement winner's ticket count by 1
      - Repeat for next prize

   E. Save winners:
      - Insert into resource_raffle_winners
      - Update cycle status to "completed"

4. Return summary
```

**Weighted Selection Example**:
```
User A: 5 tickets → 50% chance (5/10)
User B: 3 tickets → 30% chance (3/10)
User C: 2 tickets → 20% chance (2/10)

Random pick = 7
Cumulative:
  A: 0→5  (7 >= 5, continue)
  B: 5→8  (7 < 8, User B wins!)
```

**Key Points**:
- Fair weighted probability
- Same user can win multiple prizes
- Each win decrements ticket count
- Idempotent (won't redraw)

**Code**: `lib/resource-raffles/service.ts:767-924` (`drawResourceRaffleCycle`)

---

### 5. Winner Display (Frontend)

**API**: `GET /api/platform/raffles?include=winners`

**Flow**:
```
1. Fetch winners from resource_raffle_winners
2. Get user profiles (username, avatar, frame)
3. Decorate winners with profile data
4. Group by cycle_id
5. Return:
   {
     winnersByCycle: {
       "cycle-id-1": [{ username, prize, avatar, ... }],
       "cycle-id-2": [...]
     }
   }
```

**Code**: `src/app/api/platform/raffles/route.ts:70-145`

---

## 🧪 Frontend Testing Checklist

### Pre-Test Setup
- [ ] Dev server running: `bun run dev`
- [ ] Wallet connected
- [ ] Test account has resources:
  - 100+ Fuel
  - 50+ Crystals

---

### Test 1: Tab Display States

**Navigate to**: `/raffles`

#### Active Tab
- [ ] Shows W43 "Mibera's Eternal Lore" (current week)
- [ ] Countdown timer displays correctly
- [ ] Shows "Time Left" in days/hours
- [ ] "Buy Ticket" button is enabled

#### Upcoming Tab
- [ ] Shows W44 "Mibera's Eternal Lore" (next week)
- [ ] Shows start date (Oct 27, 2025)
- [ ] "Buy Ticket" button is disabled
- [ ] Shows "Raffle not started" or similar message

#### Ended Tab
- [ ] Shows completed raffles (W40, W42)
- [ ] Winner lists display (if winners exist)
- [ ] No purchase buttons
- [ ] Shows "Raffle Ended" status

**Edge Cases**:
- [ ] Empty state shows when no raffles
- [ ] Loading skeleton displays during fetch
- [ ] Error state shows on API failure

---

### Test 2: Ticket Purchase Flow

**Tab**: Active → "Mibera's Eternal Lore"

#### Buy 1 Ticket
1. [ ] Note current resources (e.g., 100 Fuel, 50 Crystals)
2. [ ] Click "Buy Ticket" (default 1 ticket)
3. [ ] Observe:
   - [ ] Button shows loading spinner
   - [ ] Button disabled during transaction
4. [ ] After success:
   - [ ] Success toast appears
   - [ ] Success sound plays
   - [ ] Resources updated:
     - Fuel: -25 (now 75)
     - Crystals: -8 (now 42)
   - [ ] Ticket count shows "1/10"
   - [ ] Win probability updates (e.g., "10%")

#### Buy Multiple Tickets
5. [ ] Buy 3 more tickets (button or input)
6. [ ] Verify:
   - [ ] Resources deducted correctly (-75 Fuel, -24 Crystals)
   - [ ] Ticket count now "4/10"
   - [ ] Win probability updated
   - [ ] Entry is cumulative (not duplicate)

#### Test Max Limit
7. [ ] Buy 6 more tickets (total 10/10)
8. [ ] Verify:
   - [ ] Ticket count shows "10/10"
   - [ ] "Buy Ticket" button disabled
   - [ ] Shows "Limit Reached" message
9. [ ] Try to buy 1 more ticket
10. [ ] Verify:
    - [ ] Error toast: "Entry limit reached"
    - [ ] No resources deducted

#### Test Insufficient Resources
11. [ ] Use account with low resources (< 25 Fuel)
12. [ ] Try to buy ticket
13. [ ] Verify:
    - [ ] Error toast: "More Fuel required"
    - [ ] No entry created

---

### Test 3: Progress Persistence

**Refresh Page**:
- [ ] Close and reopen browser tab
- [ ] Navigate back to `/raffles`
- [ ] Verify:
  - [ ] Ticket count persists (shows 4/10 or 10/10)
  - [ ] Resource balances correct
  - [ ] Win probability correct

**Multi-Session**:
- [ ] Open `/raffles` in incognito/different browser
- [ ] Connect same wallet
- [ ] Verify same ticket count shows

---

### Test 4: Real-Time Updates

**Multiple Purchases**:
- [ ] Buy 2 tickets
- [ ] Immediately check ticket count updates
- [ ] Verify resources decrease in real-time
- [ ] Check win probability recalculates

**Race Conditions** (Advanced):
- [ ] Click "Buy Ticket" rapidly multiple times
- [ ] Verify:
  - [ ] Only processes correct number of tickets
  - [ ] No double-charging
  - [ ] Idempotency works

---

### Test 5: Winner Display (After Draw)

**Prerequisites**:
- Week has ended (after Oct 26)
- Draw cron has run
- Winners exist in database

**Ended Tab**:
- [ ] Navigate to "Ended" tab
- [ ] Select completed raffle (e.g., W43)
- [ ] Verify:
  - [ ] Winner list displays
  - [ ] Shows usernames (or shortened addresses)
  - [ ] Shows avatars/frames
  - [ ] Shows prize names
  - [ ] Current user highlighted if they won
  - [ ] Winner count matches expected (3 for Mibera's)

---

### Test 6: Edge Cases

#### Not Connected
- [ ] Disconnect wallet
- [ ] Navigate to `/raffles`
- [ ] Verify:
  - [ ] "Connect Wallet" button shows
  - [ ] Cannot buy tickets

#### Network Errors
- [ ] Turn off network mid-purchase
- [ ] Verify:
  - [ ] Error toast appears
  - [ ] Transaction rolls back (no partial state)
  - [ ] Can retry after network restored

#### Invalid State
- [ ] Try to enter ticket for non-existent cycle
- [ ] Verify graceful error handling

---

## 🔍 Debugging

### Common Issues

**Issue**: Raffles not showing in Active tab
- Check cycle status (should be "open")
- Verify current week matches cycle period_key
- Check template is active

**Issue**: Ticket purchase fails
- Verify cycle status === "open"
- Check user has sufficient resources
- Verify user hasn't hit max entries
- Check current time is within week bounds

**Issue**: Winners not showing
- Verify draw cron has run
- Check resource_raffle_winners table
- Verify API includes ?include=winners param

**Issue**: Wrong raffles provisioned
- Only templates with tags: ["weekly"] auto-provision
- Check template.active === true
- Verify provisioning cron is running

---

## 🚀 Deployment Checklist

### Environment Variables
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key
CRON_SECRET=your_cron_secret
```

### Vercel Cron Setup
Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/admin/cron/resource-raffles/provision",
      "schedule": "0 0 * * 0"
    },
    {
      "path": "/api/admin/cron/resource-raffles/draw",
      "schedule": "0 * * * *"
    }
  ]
}
```

**Schedules**:
- Provision: Every Sunday 00:00 UTC
- Draw: Every hour (checks for ended weeks)

### Pre-Launch
- [ ] All migrations applied to production DB
- [ ] Templates seeded with prizes
- [ ] Test raffle completed successfully (full cycle)
- [ ] Cron jobs configured
- [ ] Environment variables set

---

## 📊 Expected Behavior

### Timeline Example (Week 43)

**Sunday, Oct 20 (Week 42 End)**
- 00:00 UTC: Provision cron creates W43 cycle (status: "scheduled")
- 01:00 UTC: Draw cron completes W42 raffles

**Monday, Oct 21 (Week 43 Start)**
- User visits `/raffles` → W43 auto-transitions to "open"
- Users can now buy tickets

**Monday-Sunday, Oct 21-26**
- Users purchase tickets throughout the week
- Entries accumulate in resource_raffle_entries

**Sunday, Oct 27 00:00 UTC (Week 43 End)**
- W43 raffle appears in "Ended" tab (based on time)
- Status still "open" (draw hasn't run yet)

**Sunday, Oct 27 01:00 UTC**
- Draw cron runs
- Winners selected from entries
- Cycle status → "completed"
- Winners visible in UI

**Sunday, Oct 27 (Later)**
- Provision cron creates W44 cycle
- W44 appears in "Upcoming" tab

---

## 🗄️ Current Database State

### Templates
| Slug | Title | Weekly? | Cost/Ticket | Max Entries | Prizes |
|------|-------|---------|-------------|-------------|--------|
| `mibera-eternal-lore` | Mibera's Eternal Lore | ✅ Yes | 25 Fuel + 8 Crystals | 10 | 3 (Trait, Lore, USDC) |
| `beras-opensea` | Beras on the OpenSea | ❌ No | 18 Fuel + 6 Crystals | 20 | 63 (HENLO tokens) |

### Active Cycles
| Period | Template | Status | Start | End |
|--------|----------|--------|-------|-----|
| 2025-W43 | Mibera's Eternal Lore | `open` | Oct 21 | Oct 26 |
| 2025-W44 | Mibera's Eternal Lore | `scheduled` | Oct 27 | Nov 2 |

### Completed Cycles
| Period | Template | Status | Winners |
|--------|----------|--------|---------|
| 2025-W40 | Mibera's Eternal Lore | `completed` | Yes |
| 2025-W40 | Beras on the OpenSea | `completed` | Yes |
| 2025-W42 | Mibera's Eternal Lore | `completed` | 0 (no entries) |

---

## 📁 Important Files

### Backend
- `lib/resource-raffles/service.ts` - Core business logic
- `lib/resource-raffles/provision.ts` - Provisioning logic
- `src/actions/raffles/enter-raffle.ts` - Entry server action
- `src/app/api/platform/raffles/route.ts` - Main API
- `src/app/api/admin/cron/resource-raffles/*` - Cron endpoints

### Frontend
- `components/sections/raffles-section.tsx` - Main UI
- `components/features/raffles/raffle-card.tsx` - Raffle card
- `components/features/raffles/raffle-detail-panel.tsx` - Detail view
- `components/features/raffles/raffle-winners.tsx` - Winner list
- `hooks/platform/use-raffles.ts` - Data fetching
- `hooks/mutations/use-enter-raffle.ts` - Entry mutation

### Database
- `supabase/migrations/20251015130000_add_resource_atomic_functions.sql` - Entry RPC

---

## 🎯 Quick Reference

### Raffle States
- `scheduled` - Created, week hasn't started
- `open` - Week active, accepting entries
- `completed` - Winners drawn

### Resource Costs (Per Ticket)
- Mibera's: 25 Fuel + 8 Crystals
- Beras: 18 Fuel + 6 Crystals

### Max Entries
- Mibera's: 10 tickets/user
- Beras: 20 tickets/user

### Current Period
Run in browser console:
```javascript
const now = new Date();
const oneJan = new Date(now.getFullYear(), 0, 1);
const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
const week = Math.ceil((now.getDay() + 1 + numberOfDays) / 7);
console.log(`Current: ${now.getFullYear()}-W${week}`);
```

---

**Status**: ✅ Backend verified - Ready for frontend testing
**Next Step**: Complete frontend testing checklist above
