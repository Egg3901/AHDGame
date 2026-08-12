# PR2 — Concurrent Bicameral Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bill can sit at a new `active_both` status where both chambers vote **simultaneously**, each into its own tally, passing only if every chamber clears the bar.

**Architecture:** Add a `concurrentVote` stage kind modelled on the shipped `OverrideStage` (which already does `requireAll` concurrency), plus its own `closeConcurrentVoteStage`. Every path that today derives fetch scope, eligibility, actionability, vote-field or deadline-field from `bill.status` must be taught the new status — and for `active_both` the answer depends on **the voter's chamber**, which `bill.currentChamber` cannot express.

**Tech Stack:** TypeScript, MongoDB (native driver), Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-09-bloc-join-conflict-and-cold-war-conflicts-design.md`, Part 2. Read it before starting — it carries the reasoning for every edit here.
- **This PR ships INERT, by design.** Nothing produces an `active_both` bill until PR3: `validateBillProvisions` refuses a hand-rolled `join_conflict` and no builder exists. Every test here **hand-inserts a bill fixture** at `active_both`. Say so in the PR description, or the stage's silence reads as a bug.
- **The two inventories are rules, not lists.** Run the greps in Task 7; the named sites are examples under a rule, never the inventory.
- **Commit style:** commitlint requires a **lowercase-leading** subject, ≤100 chars.
- **Prettier:** `npm run format` on the whole repo; do not scope-limit.
- **Typecheck:** `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`.
- **Never chain `npm run build` with `npm run test:run`.**
- **Pre-existing baseline failures exist** on this branch. Confirm against `origin/development` before investigating a failure in a file you did not touch.
- **CRLF files.**

## The failure mode this PR is designed against

Two shapes, and they are opposites:

- **Fail-closed (B1–B4):** a chamber's votes are never collected, so `requireAll` fails a bill that a legislature would have passed. Looks exactly like a legislature voting no.
- **Silent corruption (B5/B6):** an upper-chamber member's vote and weight land in the **lower** chamber's map and tally, so a bill can *pass* on votes cast by the other house.

Every test below asserts a **downstream effect** — a non-empty `otherChamberVotes`, a status change, a counter value — never that a function was called.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/db/types/legislation.ts` | *Modify* — `BillStatus` gains `"active_both"` |
| `src/lib/congress/billVoteField.ts` | *Create* — the one voter-chamber-aware vote-field resolver |
| `src/lib/turn/billLifecycle/types.ts` | *Modify* — `ConcurrentVoteStage`; `StageBillContext` carries the preset |
| `src/lib/turn/billLifecycle/concurrentStage.ts` | *Create* — `closeConcurrentVoteStage` |
| `src/lib/turn/billLifecycle/engine.ts` | *Modify* — dispatch the third stage kind; resolve the preset once per run |
| `src/lib/turn/npp/context.ts` | *Modify* — B1, the fetch `$or` |
| `src/lib/turn/npp/billVoting.ts` | *Modify* — B2, office-type union + accumulator fork |
| `src/lib/legislature/commands/nationalBillActions.ts` | *Modify* — B3, seven sub-changes |
| `src/lib/congress/applyPlayerWhip.ts` | *Modify* — B5, four forks |
| `src/lib/congress/applyWhipVotes.ts` | *Modify* — B6, three forks (no snapshot) |
| `src/lib/turn/billLifecycle/lifecycleHelpers.ts` | *Modify* — add the missing `countryId` filter |
| `src/lib/turn/billLifecycle/configs/*.ts` | *Modify* — register the stage in all six |

---

### Task 1: The `active_both` status and the vote-field resolver

The vote map is chosen from `bill.status` in several places. A concurrent vote breaks that mapping: two chambers are live at once, so the field must be a function of **who is voting**.

**Files:**
- Modify: `src/lib/db/types/legislation.ts` (`BillStatus`, ~line 21)
- Create: `src/lib/congress/billVoteField.ts`
- Test: `src/lib/congress/__tests__/billVoteField.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BillVoteField = "votes" | "otherChamberVotes" | "vetoOverrideVotes";
  export function resolveBillVoteField(
    bill: Pick<Bill, "status">,
    ctx?: { voterOfficeType?: string; lowerOfficeType?: string }
  ): BillVoteField;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/congress/__tests__/billVoteField.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveBillVoteField } from "../billVoteField";

const bill = (status: string) => ({ status }) as Parameters<typeof resolveBillVoteField>[0];

describe("resolveBillVoteField", () => {
  // Every existing status must behave EXACTLY as it does today and ignore the voter,
  // so no current path can change behaviour when the call sites are swapped over.
  it("ignores the voter for every pre-existing status", () => {
    const ctx = { voterOfficeType: "senate", lowerOfficeType: "house" };
    expect(resolveBillVoteField(bill("active"), ctx)).toBe("votes");
    expect(resolveBillVoteField(bill("active_other"), ctx)).toBe("otherChamberVotes");
    expect(resolveBillVoteField(bill("veto_override"), ctx)).toBe("vetoOverrideVotes");
    expect(resolveBillVoteField(bill("override_shugiin"), ctx)).toBe("votes");
    expect(resolveBillVoteField(bill("cabinet_review"), ctx)).toBe("votes");
  });

  it("routes an active_both vote by the voter's chamber", () => {
    const ctx = (voterOfficeType: string) => ({ voterOfficeType, lowerOfficeType: "house" });
    expect(resolveBillVoteField(bill("active_both"), ctx("house"))).toBe("votes");
    expect(resolveBillVoteField(bill("active_both"), ctx("senate"))).toBe("otherChamberVotes");
  });

  it("falls back to the lower chamber's map when the voter is unknown", () => {
    // Display callers have no voter. Defaulting to `votes` matches what every
    // unconverted reader already assumes, so a missed call site degrades rather
    // than throwing.
    expect(resolveBillVoteField(bill("active_both"))).toBe("votes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/congress/__tests__/billVoteField.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the status**

In `src/lib/db/types/legislation.ts`, add to `BillStatus` after `"active_other"`:

```ts
  /**
   * Both chambers voting AT ONCE, each into its own tally; passes only if every
   * chamber clears the bar. Distinct from `active`/`active_other`, which are
   * sequential. `currentChamber` is a display default on these bills — never the
   * authority for which chamber a voter belongs to.
   */
  | "active_both"
```

- [ ] **Step 4: Write the resolver**

Create `src/lib/congress/billVoteField.ts`:

```ts
import type { Bill } from "@/lib/db/types/legislation";

export type BillVoteField = "votes" | "otherChamberVotes" | "vetoOverrideVotes";

/**
 * Which vote map a vote belongs in.
 *
 * Additive by construction: every pre-existing status returns exactly what the inline
 * ternaries it replaces returned, and IGNORES the voter. Only `active_both` consults
 * the voter's chamber — because two chambers are live at once and `bill.currentChamber`
 * is a single value that cannot express "both".
 *
 * The danger this exists to remove: if the mapping stayed status-driven, a senator
 * voting on a concurrent bill would write into `votes` alongside the house, the two
 * tallies would merge, and the bill could pass on votes cast by the other chamber —
 * with nothing erroring.
 */
export function resolveBillVoteField(
  bill: Pick<Bill, "status">,
  ctx?: { voterOfficeType?: string; lowerOfficeType?: string }
): BillVoteField {
  if (bill.status === "active_other") return "otherChamberVotes";
  if (bill.status === "veto_override") return "vetoOverrideVotes";
  if (bill.status === "active_both") {
    // No voter (display callers) → the lower chamber's map, which is what every
    // unconverted reader already assumes.
    if (!ctx?.voterOfficeType || !ctx.lowerOfficeType) return "votes";
    return ctx.voterOfficeType === ctx.lowerOfficeType ? "votes" : "otherChamberVotes";
  }
  return "votes";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/congress/__tests__/billVoteField.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): add the active_both status and a voter-aware vote-field resolver"
```

---

### Task 2: The `concurrentVote` stage and its close

`runBillLifecycle` filters `config.stages` for `chamberVote`, then loops `executiveAction` and `override` separately. A third kind is **silently never closed** — the bill sits at `active_both` forever.

**Files:**
- Modify: `src/lib/turn/billLifecycle/types.ts`
- Create: `src/lib/turn/billLifecycle/concurrentStage.ts`
- Modify: `src/lib/turn/billLifecycle/engine.ts` (dispatch, ~line 179-196; export `enterSigned`/`enterExecutive`/`tallyFields`/`recordTransition` for reuse)
- Test: `src/lib/turn/billLifecycle/concurrentStage.test.ts`

**Interfaces:**
- Consumes: `resolveBillVoteField` (Task 1).
- Produces:
  ```ts
  export interface ConcurrentVoteStage {
    kind: "concurrentVote";
    status: string;
    chambersFor: (bill: StageBillContext) => string[];
    voteFieldFor: (bill: StageBillContext, officeType: string) => "votes" | "otherChamberVotes";
    passRule: PassRule;
    requireAll: true;
    onPassStatus: string;
    votingDurationHours: number;
    execActionCheckOnPass?: boolean;
  }
  ```
  and `StageBillContext` gains `preset?: string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/turn/billLifecycle/concurrentStage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./resolvePhaseVotes", () => ({
  resolvePhaseVotes: vi.fn(async (_db, _bill, opts) => ({
    // house passes, senate fails — the requireAll case that must fail the bill.
    totals:
      opts.officeType === "house"
        ? { for: 10, against: 1, abstain: 0 }
        : { for: 1, against: 10, abstain: 0 },
    snapshot: { totals: { for: 0, against: 0, abstain: 0 }, voters: [] },
  })),
}));

import { closeConcurrentVoteStage } from "./concurrentStage";
import type { ConcurrentVoteStage } from "./types";

const stage: ConcurrentVoteStage = {
  kind: "concurrentVote",
  status: "active_both",
  chambersFor: () => ["house", "senate"],
  voteFieldFor: (_b, officeType) => (officeType === "house" ? "votes" : "otherChamberVotes"),
  passRule: "simpleMajority",
  requireAll: true,
  onPassStatus: "signed",
  votingDurationHours: 24,
};

function makeDb(bills: Record<string, unknown>[]) {
  const updates: Record<string, unknown>[] = [];
  const col = {
    find: vi.fn(() => ({ toArray: async () => bills })),
    findOne: vi.fn(async () => bills[0]),
    updateOne: vi.fn(async (filter: unknown, update: Record<string, unknown>) => {
      updates.push({ filter, update });
      return { modifiedCount: 1, matchedCount: 1 };
    }),
  };
  return { db: { collection: () => col } as never, updates, col };
}

const bill = () => ({
  _id: "b1",
  status: "active_both",
  countryId: "US",
  originChamber: "house",
  currentChamber: "house",
  title: "Entry into the Vietnam War (NATO)",
  provisions: [],
});

beforeEach(() => vi.clearAllMocks());

describe("closeConcurrentVoteStage", () => {
  it("fails the bill when any chamber fails, even though another passed", async () => {
    const { db, updates } = makeDb([bill()]);
    const result = { transitionedTo: {}, billsProcessed: 0, billsPassed: 0, billsFailed: 0 };
    await closeConcurrentVoteStage(
      db,
      { country: "US", level: "national", stages: [stage], originChambers: ["house"] } as never,
      stage,
      new Date(),
      50,
      result as never
    );
    // Assert the STATUS, not the tally — a merged tally would otherwise look like a pass.
    const setStatus = updates
      .map((u) => (u.update as { $set?: { status?: string } }).$set?.status)
      .filter(Boolean);
    expect(setStatus).toContain("failed");
  });

  it("writes BOTH chambers' tallies", async () => {
    const { db, updates } = makeDb([bill()]);
    const result = { transitionedTo: {}, billsProcessed: 0, billsPassed: 0, billsFailed: 0 };
    await closeConcurrentVoteStage(
      db,
      { country: "US", level: "national", stages: [stage], originChambers: ["house"] } as never,
      stage,
      new Date(),
      50,
      result as never
    );
    const merged = Object.assign(
      {},
      ...updates.map((u) => (u.update as { $set?: Record<string, unknown> }).$set ?? {})
    );
    expect(merged.votesFor).toBe(10);
    expect(merged.otherChamberVotesFor).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/turn/billLifecycle/concurrentStage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the stage type and widen `StageBillContext`**

In `src/lib/turn/billLifecycle/types.ts`:

```ts
/** Minimal bill shape a stage needs to resolve its office type. */
export interface StageBillContext {
  currentChamber: string;
  countryId?: CountryId;
  /**
   * The world's reset preset. Legislature SHAPE is preset-dependent — Germany's
   * 1953 override flips `bicameral` to true over an appointed Bundesrat, and TR/ES
   * flip `upperElectionSystem` — so a stage that resolves its config without this
   * gets the wrong chamber count with no error.
   */
  preset?: string;
}

export interface ConcurrentVoteStage {
  kind: "concurrentVote";
  /** Bill status this stage owns — "active_both". */
  status: string;
  /**
   * Office types voting simultaneously; one entry for a unicameral country.
   *
   * MUST be `getJointSittingOfficeTypes`, NOT `legislature.bicameral`. Germany's
   * 1953 override sets `bicameral: true` over an appointed Bundesrat with no
   * `upperElectionSystem`, so the bicameral reading yields two chambers, the upper
   * tally is structurally empty, and `requireAll` fails every German bill.
   */
  chambersFor: (bill: StageBillContext) => string[];
  /** Vote map per office type: lower → "votes", upper → "otherChamberVotes". */
  voteFieldFor: (bill: StageBillContext, officeType: string) => "votes" | "otherChamberVotes";
  passRule: PassRule;
  /** Every listed chamber must clear the bar — OverrideStage's `.every` semantics. */
  requireAll: true;
  onPassStatus: string;
  votingDurationHours: number;
  execActionCheckOnPass?: boolean;
}

export type BillStage = ChamberVoteStage | ExecutiveActionStage | OverrideStage | ConcurrentVoteStage;
```

- [ ] **Step 4: Export the engine internals the close reuses**

In `src/lib/turn/billLifecycle/engine.ts`, change these from `function` to `export function`, leaving their bodies untouched: `tallyFields`, `recordTransition`, `resolveNotifier`, `enterSigned`, `enterExecutive`.

⚠️ **Do NOT also copy their bodies into the new module.** `enterSigned` already contains `applyLegislationEffect`, `onBillEnacted`, the notifier, `awardLawmakerAchievementForSponsor`, `recordTransition` and the counters. Calling any of those *alongside* `enterSigned` double-enacts the bill.

- [ ] **Step 5: Write the close**

Create `src/lib/turn/billLifecycle/concurrentStage.ts`:

```ts
import type { Db, Filter } from "mongodb";
import type { Bill } from "@/lib/db/types";
import { claimStatusTransition } from "@/lib/db/claimStatusTransition";
import {
  enterExecutive,
  enterSigned,
  recordTransition,
  resolveNotifier,
  tallyFields,
} from "./engine";
import { resolvePhaseVotes } from "./resolvePhaseVotes";
import { billRequiresExecutiveAction } from "@/lib/internationalOrganizations/withdrawalBills";
import { getBillPassRule, meetsBillPassRule, billHasNatPrivProvision } from "@/lib/congress/billPassRule";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type {
  BillLifecycleConfig,
  BillLifecycleResult,
  ConcurrentVoteStage,
  ExecutiveActionStage,
} from "./types";

/**
 * Close a concurrent bicameral vote.
 *
 * Modelled on `closeOverrideStage`, which is already a concurrent bicameral vote with
 * `requireAll` semantics (`stage.chambers.every(...)`). Two things stop it being reused
 * directly: its tally is keyed on hardcoded `house`/`senate` literals, so it is US-only;
 * and it uses one vote map, which forces a display snapshot. Two maps mean the
 * per-chamber counters already exist.
 */
export async function closeConcurrentVoteStage(
  db: Db,
  config: BillLifecycleConfig,
  stage: ConcurrentVoteStage,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult,
  preset?: string
): Promise<void> {
  // The CLOSE filter ANDs the deadline pairs — a bill must not close while a chamber
  // is still voting. (The NPP FETCH filter ORs them: poll while EITHER is open.)
  const expiredFilter: Record<string, unknown> = {
    status: stage.status,
    $and: [
      {
        $or: [
          { votingEndsOnTurn: { $lte: currentTurn } },
          { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { otherChamberVotingEndsOnTurn: { $lte: currentTurn } },
          {
            otherChamberVotingEndsOnTurn: { $exists: false },
            otherChamberVotingEndsAt: { $lte: now },
          },
        ],
      },
    ],
    originChamber: { $in: config.originChambers },
  };

  const expired = await db
    .collection<Bill>("bills")
    .find(expiredFilter as Filter<Bill>)
    .toArray();

  for (const claimedBill of expired) {
    const bill =
      (await db.collection<Bill>("bills").findOne({ _id: claimedBill._id })) ?? claimedBill;
    const ctx = {
      currentChamber: bill.currentChamber ?? "",
      countryId: bill.countryId,
      preset,
    };
    const chambers = stage.chambersFor(ctx);

    // The pass rule is resolved PER BILL, not taken from the stage alone: nat/priv
    // supersedes to two-thirds and is provision-driven. `evaluatePassRule` is not
    // reused because it bundles Senate cloture, which a concurrent bill never faces.
    const { rule } = getBillPassRule(
      getCountryConfig((bill.countryId ?? "US") as CountryId, preset).governmentType,
      billHasNatPrivProvision(bill.provisions),
      // Deliberately false: a join_conflict bill is simple-majority by design, and
      // `billHasDeclareWar` does not match it.
      false
    );

    let fields: Record<string, unknown> = {};
    let allPassed = true;
    for (const officeType of chambers) {
      const voteField = stage.voteFieldFor(ctx, officeType);
      const res = await resolvePhaseVotes(
        db,
        bill,
        { voteField, officeType, countryId: bill.countryId ?? "US" },
        currentTurn
      );
      // tallyFields is parameterised by voteField, so calling it per chamber gives
      // each its own totals AND its own frozen snapshot (#0982).
      fields = { ...fields, ...tallyFields(voteField, res) };
      if (!meetsBillPassRule(res.totals.for, res.totals.against, rule)) allPassed = false;
    }

    if (!allPassed) {
      const claimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status },
        { $set: { status: "failed", ...fields, failedAt: now, updatedAt: now } }
      );
      if (claimed) {
        await resolveNotifier(config)(db, bill, "failed");
        recordTransition(result, "failed");
        result.billsProcessed++;
        result.billsFailed++;
      }
      continue;
    }

    // Passed. Reproduce the DISPATCH only — enterSigned/enterExecutive own everything
    // downstream of it.
    const execStage = config.stages.find(
      (s): s is ExecutiveActionStage => s.kind === "executiveAction"
    );
    const needsExec =
      stage.execActionCheckOnPass && execStage ? billRequiresExecutiveAction(bill) : false;

    if (needsExec && execStage) {
      await enterExecutive(db, bill, execStage, "votes", fields, now, currentTurn, result);
      continue;
    }
    // A concurrent close has TWO passage moments. `enterSigned` spreads `...fields`
    // before `[passedAtField]`, so putting the other chamber's stamp in `fields` lets
    // it set `passedOriginAt` itself — no signature change.
    await enterSigned(
      db,
      config,
      bill,
      stage.status,
      "votes",
      { ...fields, passedOtherChamberAt: now },
      now,
      currentTurn,
      result
    );
  }
}
```

⚠️ Verify `claimStatusTransition`'s import path with `rg -n "export .*claimStatusTransition" src/` — use whatever `engine.ts` imports.

- [ ] **Step 6: Dispatch it from the engine**

In `src/lib/turn/billLifecycle/engine.ts`, resolve the preset once and add the third loop. After the `skipWhenGovPending` block near the top of `runBillLifecycle`:

```ts
  // Legislature shape is preset-dependent (DE 1953 flips `bicameral`; TR/ES flip
  // `upperElectionSystem`), and stages resolve chamber counts. Read once per run.
  const gsForPreset = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  const preset = typeof gsForPreset?.preset === "string" ? gsForPreset.preset : undefined;
```

Then, after the override loop:

```ts
  // ── Close concurrent bicameral votes. ──
  for (const stage of config.stages) {
    if (stage.kind === "concurrentVote") {
      await closeConcurrentVoteStage(db, config, stage, now, currentTurn, result, preset);
    }
  }
```

Add `import { closeConcurrentVoteStage } from "./concurrentStage";` and a `GameState` type import if absent.

⚠️ **Circular import:** `concurrentStage.ts` imports from `engine.ts` and vice-versa. If the bundler or vitest complains, extract `tallyFields`/`recordTransition`/`resolveNotifier`/`enterSigned`/`enterExecutive` into `src/lib/turn/billLifecycle/stageTransitions.ts` and have both import from there. Do not duplicate them.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/lib/turn/billLifecycle/concurrentStage.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Prove the engine actually dispatches it**

Add to `src/lib/turn/billLifecycle/engine.test.ts`:

```ts
it("closes an active_both bill past both deadlines", async () => {
  // A stage kind the engine does not dispatch leaves the bill sitting forever, and
  // no tally assertion catches that — assert the STATUS changed.
  const bill = {
    ...makeBill({}, "active_both"),
    votingEndsOnTurn: 1,
    otherChamberVotingEndsOnTurn: 1,
  };
  db.collectionMocks["bills"]!.find.mockImplementation(findByStatus({ active_both: [bill] }));
  const result = await runBillLifecycle(db as unknown as Db, CONFIG_WITH_CONCURRENT, new Date(), 50);
  expect(result.billsProcessed).toBeGreaterThan(0);
});
```

Define `CONFIG_WITH_CONCURRENT` in that file as `US_NATIONAL_CONFIG` with the concurrent stage appended, matching the shape in Task 8.

- [ ] **Step 9: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): add the concurrent bicameral vote stage and its close"
```

---

### Task 3: B1 — NPP bills are never fetched

`ctx.activeBills` comes from an `$or` over four literal statuses, each paired with its own deadline fields. An `active_both` bill is never returned, so **Task 4's loop never runs on it at all**.

**Files:**
- Modify: `src/lib/turn/npp/context.ts` (~line 213-233)
- Test: `src/lib/turn/npp/__tests__/context.activeBoth.test.ts`

**Interfaces:**
- Consumes: the `active_both` status (Task 1).
- Produces: `ctx.activeBills` includes `active_both` bills while **either** chamber is open.

- [ ] **Step 1: Write the failing test**

Create `src/lib/turn/npp/__tests__/context.activeBoth.test.ts`:

```ts
import { describe, it, expect } from "vitest";

/**
 * The fetch filter is built inline in context.ts. Rather than exercise the whole
 * context builder, assert the FILTER SHAPE the branch must produce — the property
 * that matters is that it matches while EITHER chamber is open.
 */
import { buildActiveBillFilter } from "../context";

describe("active_both bill fetch", () => {
  const filter = () => buildActiveBillFilter({ currentTurn: 100, now: new Date() });

  const matches = (doc: Record<string, unknown>) => {
    const or = (filter() as { $or: Record<string, unknown>[] }).$or;
    const branch = or.find((b) => b.status === "active_both");
    expect(branch, "no active_both branch in the fetch filter").toBeTruthy();
    return branch!;
  };

  it("has an active_both branch that ORs the two deadline pairs", () => {
    const branch = matches({}) as { $or?: unknown[] };
    // Nested $or of two clauses — NOT two spreads (the second $or key would overwrite
    // the first) and NOT a spread of their `.$or` arrays (undefined on the
    // date-only branch, which throws).
    expect(Array.isArray(branch.$or)).toBe(true);
    expect(branch.$or).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/turn/npp/__tests__/context.activeBoth.test.ts`
Expected: FAIL — `buildActiveBillFilter` is not exported.

- [ ] **Step 3: Extract and extend the filter**

In `src/lib/turn/npp/context.ts`, lift the inline bill filter into an exported function beside `billStillOpen`:

```ts
/**
 * The bills an NPP tick may vote on.
 *
 * Exported so the `active_both` branch is directly assertable: it is the gate upstream
 * of the whole NPP voting loop, and a missing branch makes every concurrent bill fail
 * with no error anywhere.
 */
export function buildActiveBillFilter(opts: {
  currentTurn?: number;
  now: Date;
}): Record<string, unknown> {
  const billStillOpen = (turnField: string, dateField: string) =>
    typeof opts.currentTurn === "number"
      ? {
          $or: [
            { [turnField]: { $gt: opts.currentTurn } },
            { [turnField]: { $exists: false }, [dateField]: { $gt: opts.now } },
          ],
        }
      : { [dateField]: { $gt: opts.now } };

  return {
    $or: [
      { status: "active", ...billStillOpen("votingEndsOnTurn", "votingEndsAt") },
      {
        status: "active_other",
        ...billStillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
      },
      {
        status: "veto_override",
        ...billStillOpen("overrideVotingEndsOnTurn", "overrideVotingEndsAt"),
      },
      { status: "override_shugiin", ...billStillOpen("votingEndsOnTurn", "votingEndsAt") },
      {
        // Poll while EITHER chamber is open. NESTED, not spread: `billStillOpen`
        // returns `{ $or: [...] }` on the turn branch and a FLAT object on the date
        // branch, so spreading two of them drops the first (same key) and spreading
        // their `.$or` arrays throws on the flat branch.
        status: "active_both",
        $or: [
          billStillOpen("votingEndsOnTurn", "votingEndsAt"),
          billStillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
        ],
      },
    ],
  };
}
```

Then replace the inline `db.collection<Bill>("bills").find({ $or: [...] })` with
`db.collection<Bill>("bills").find(buildActiveBillFilter({ currentTurn: optionsCurrentTurn, now: billDeadlineNow }) as Filter<Bill>)`.

Leave the `stateBills` filter below it untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/turn/npp/__tests__/context.activeBoth.test.ts`
Expected: PASS

- [ ] **Step 5: Run the existing NPP suite for regressions**

Run: `npx vitest run src/lib/turn/npp`
Expected: PASS — the four pre-existing branches are byte-identical.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(npp): fetch active_both bills while either chamber is open"
```

---

### Task 4: B2 — NPP voting resolves one office type and one accumulator

`relevantOfficials` is picked from a single office type derived from `bill.currentChamber`, and the write builds one `setFields`/`incFields` pair. Both halves must change together: fixing only the office type still lands every vote in `votesFor`, which is the same fail-closed symptom.

**Files:**
- Modify: `src/lib/turn/npp/billVoting.ts` (~171-188 and ~329-347)
- Test: `src/lib/turn/npp/__tests__/billVoting.activeBoth.test.ts`

**Interfaces:**
- Consumes: `buildActiveBillFilter` (Task 3), `resolveBillVoteField` (Task 1).
- Produces: NPP votes on an `active_both` bill land in their own chamber's map and counters.

- [ ] **Step 1: Write the failing test**

Create `src/lib/turn/npp/__tests__/billVoting.activeBoth.test.ts` following the existing `billVoting` test's harness (copy its `NPPContext` fixture builder). The assertions that matter:

```ts
describe("NPP voting on an active_both bill", () => {
  it("puts BOTH chambers' officials in the loop and writes to their own maps", async () => {
    const ctx = makeContext({
      activeBills: [makeBill({ status: "active_both", countryId: "US", currentChamber: "house" })],
      nppOfficials: [
        makeOfficial({ officeType: "house", countryId: "US" }),
        makeOfficial({ officeType: "senate", countryId: "US" }),
      ],
    });

    await processBillVoting(ctx);

    const update = ctx.db.collectionMocks["bills"]!.updateOne.mock.calls[0][1];
    // The discriminating assertion: with the current single-office-type lookup this
    // is empty, which is the structural failure that fails every concurrent bill.
    const otherVotes = Object.keys(update.$set).filter((k) =>
      k.startsWith("otherChamberVotes.")
    );
    expect(otherVotes.length).toBeGreaterThan(0);
    expect(update.$inc).toHaveProperty("otherChamberVotesFor");
    expect(update.$inc).toHaveProperty("votesFor");
  });

  it("still excludes officials from another country", async () => {
    const ctx = makeContext({
      activeBills: [makeBill({ status: "active_both", countryId: "US" })],
      nppOfficials: [makeOfficial({ officeType: "senate", countryId: "BR" })],
    });
    await processBillVoting(ctx);
    expect(ctx.db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/turn/npp/__tests__/billVoting.activeBoth.test.ts`
Expected: FAIL — `otherChamberVotes.*` keys absent.

- [ ] **Step 3: Union the office types**

In `src/lib/turn/npp/billVoting.ts`, inside the `for (const bill of activeBills)` loop, add beside the existing flags:

```ts
    const isConcurrent = bill.status === "active_both";
```

and replace the `relevantOfficials` expression:

```ts
    // For a concurrent bill BOTH chambers are live at once — the same shape
    // `vetoOverrideOfficials` (lines 83-86) already handles, made country-aware.
    // `getOfficeTypeForChamber` is already country-aware, so this is a union, not
    // new country logic.
    const lowerOfficeType = getOfficeTypeForChamber(
      billCountry,
      getCountryConfig(billCountry, ctx.preset).legislature.lowerChamber.key
    );
    const concurrentOfficeTypes = isConcurrent
      ? getJointSittingOfficeTypes(billCountry, ctx.preset)
      : [];

    const relevantOfficials = isUSVetoOverride
      ? vetoOverrideOfficials
      : isJPShugiinOverride
        ? (officialsByOfficeType.get("shugiin") ?? [])
        : isConcurrent
          ? concurrentOfficeTypes.flatMap((t) => officialsByOfficeType.get(t) ?? [])
          : (officialsByOfficeType.get(getOfficeTypeForChamber(billCountry, chamberType)) ?? []);
```

Add imports for `getJointSittingOfficeTypes` and `getCountryConfig`. If `NPPContext` has no `preset`, add it and populate it where the context is built (from `gameState.preset`).

- [ ] **Step 4: Fork the accumulator per chamber**

Replace the single `voteUpdates`/`incFor` group with per-field groups. Where the loop currently accumulates:

```ts
    // Per-vote-field accumulators. A single group would land both chambers' votes in
    // `votes`/`votesFor`, leaving `otherChamberVotesFor` at zero — the identical
    // fail-closed symptom, which is why the office-type fix alone is not enough.
    const byField: Record<string, { updates: Record<string, "for" | "against" | "abstain">; f: number; a: number; ab: number }> = {};
    const bucket = (field: string) =>
      (byField[field] ??= { updates: {}, f: 0, a: 0, ab: 0 });
```

Inside the per-official body, resolve the field from **that official**:

```ts
      const voteFieldForOfficial = isConcurrent
        ? resolveBillVoteField(bill, {
            voterOfficeType: official.officeType,
            lowerOfficeType,
          })
        : voteField;
      const b = bucket(voteFieldForOfficial);
      b.updates[charKey] = decision;
      if (decision === "for") b.f++;
      else if (decision === "against") b.a++;
      else b.ab++;
```

And build the write from every bucket:

```ts
    const setFields: Record<string, unknown> = { updatedAt: now };
    const incFields: Record<string, number> = {};
    const TALLY: Record<string, [string, string, string]> = {
      votes: ["votesFor", "votesAgainst", "votesAbstain"],
      otherChamberVotes: [
        "otherChamberVotesFor",
        "otherChamberVotesAgainst",
        "otherChamberVotesAbstain",
      ],
      vetoOverrideVotes: ["vetoOverrideVotesFor", "vetoOverrideVotesAgainst", ""],
    };
    for (const [field, b] of Object.entries(byField)) {
      for (const [k, v] of Object.entries(b.updates)) setFields[`${field}.${k}`] = v;
      const [forKey, againstKey, abstainKey] = TALLY[field]!;
      if (b.f) incFields[forKey] = b.f;
      if (b.a) incFields[againstKey] = b.a;
      if (abstainKey && b.ab) incFields[abstainKey] = b.ab;
    }
```

⚠️ Keep the existing behaviour for the four pre-existing statuses byte-identical: with one bucket the output is the same shape it is today.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/turn/npp`
Expected: PASS — new tests plus every existing NPP test.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(npp): tally both chambers on a concurrent bill"
```

---

### Task 5: B3 — the player write path refuses the status

`nationalBillActions.ts` 409s anything that is not `cabinet_review`/`active`/`active_other`/`override_shugiin`. **Seven** sub-changes; the last four are easy to miss.

**Files:**
- Modify: `src/lib/legislature/commands/nationalBillActions.ts`
- Test: `src/lib/legislature/commands/__tests__/nationalBillActions.activeBoth.test.ts`

**Interfaces:**
- Consumes: `resolveBillVoteField` (Task 1).
- Produces: both chambers can vote on an `active_both` bill through the player route.

- [ ] **Step 1: Write the failing test**

Create the test with these assertions (reuse the harness from the existing `nationalBillActions` tests):

```ts
describe("voting on an active_both bill", () => {
  it("accepts a lower-chamber member into `votes`", async () => { /* assert $set has "votes.<id>" */ });
  it("accepts an upper-chamber member into `otherChamberVotes`", async () => { /* assert $set has "otherChamberVotes.<id>" */ });
  it("refuses a member of neither chamber with 403", async () => { /* ... */ });
  it("refuses a vote past that voter's own chamber deadline", async () => {
    // Under active_both all three status flags are false today, so BOTH deadline
    // guards no-op and late votes are accepted until the engine happens to close.
  });
  it("logs an upper-chamber vote with chamber: other", async () => { /* recordAudit meta */ });
  it("does not re-fire the policy shift when an upper-chamber voter changes their vote", async () => {
    // previousVote must be read from the voter's own map, not the lower one.
  });
});
```

⚠️ **Do NOT assert that a second vote from the same member is refused.** National bill votes are **re-votable by design** — `buildEmbeddedVoteTallyUpdate` exists so "concurrent re-votes cannot double-apply stale increment/decrement math". Only `cabinet_review` refuses a repeat.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/legislature/commands/__tests__/nationalBillActions.activeBoth.test.ts`
Expected: FAIL — 409 "This bill is not currently open for voting."

- [ ] **Step 3: Apply all seven sub-changes**

1. **The status guard** (~line 95) accepts `active_both`:

```ts
    const isConcurrent = bill.status === "active_both";
    if (!isCabinetReview && !isOrigin && !isOtherChamber && !isConcurrent) {
```

2. **Eligibility takes the voter's chamber** (~line 179). ⚠️ Resolve the voter's chamber **before** the `currentChamber === "joint"` ternary, not after:

```ts
    // `currentChamber` is a display default on a concurrent bill and cannot express
    // "both", so find which chamber this character actually sits in.
    const officeTypes = isConcurrent
      ? getJointSittingOfficeTypes(countryId, preset)
      : [getOfficeTypeForChamber(countryId, bill.currentChamber === "joint" ? lowerKey : bill.currentChamber, preset)];
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: { $in: officeTypes },
      countryId,
    });
```

⚠️ Note this also fixes a **pre-existing** preset drop: line 182 calls `getOfficeTypeForChamber(countryId, chamberType)` without the preset while line 63 of the same function passes one.

3. **The deadline guard** — `active_both` needs its own, against the pair matching the voter's chamber:

```ts
    const voterField = isConcurrent
      ? resolveBillVoteField(bill, {
          voterOfficeType: official.officeType,
          lowerOfficeType: getOfficeTypeForChamber(countryId, lowerKey, preset),
        })
      : undefined;
    if (isConcurrent) {
      const ended =
        voterField === "otherChamberVotes"
          ? isVotingDeadlinePassed(bill.otherChamberVotingEndsAt, now, bill.otherChamberVotingEndsOnTurn, currentTurn)
          : isVotingDeadlinePassed(bill.votingEndsAt, now, bill.votingEndsOnTurn, currentTurn);
      if (ended) return { status: 409, body: { error: "Voting has ended for this bill." } };
    }
```

4. **BOTH `updateOne` filters accept it** — the upper voter goes through the `otherChamberVotes` branch (line 200) and the lower through the `votes` branch (line 229):

```ts
    if (isOtherChamber || voterField === "otherChamberVotes") {
      // filter: { _id: bill._id, status: { $in: ["active_other", "active_both"] } }
    } else {
      // filter: { _id: bill._id, status: { $in: [isJpOverride ? "override_shugiin" : "active", "active_both"] } }
    }
```

5. **`clearWhippedFromVote`** follows the voter's chamber — `otherChamberWhippedFromVote` for an upper voter, the default otherwise.

6. **`previousVote`** (~line 262) reads the voter's own map:

```ts
    const previousVote =
      (voterField ?? (isOtherChamber ? "otherChamberVotes" : "votes")) === "otherChamberVotes"
        ? bill.otherChamberVotes?.[charKey]
        : bill.votes?.[charKey];
```

7. **`recordAudit`** (~line 258) reports the voter's chamber:

```ts
      meta: {
        vote,
        chamber:
          (voterField ?? (isOtherChamber ? "otherChamberVotes" : "votes")) === "otherChamberVotes"
            ? "other"
            : "origin",
        weight,
        countryId,
      },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/legislature/commands`
Expected: PASS — new tests plus every existing one.

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): let both chambers vote on a concurrent bill"
```

---

### Task 6: B5/B6 — the two whip writers

`applyPlayerWhipToBill` forks **four** things on `isOtherChamber`: the vote map, the snapshot field, the existing-votes read, and the `$inc` triple. `applyWhipVotesToBill` forks **three** — it writes no snapshot. Under `active_both` all take the lower branch, so a whipped **upper**-chamber member's vote and weight land in the lower chamber's tally: **the bill can pass on votes cast by the other house.**

⚠️ **Task 7 adds `active_both` to the whip allowlists. Do not land Task 7 without this task.**

**Files:**
- Modify: `src/lib/congress/applyPlayerWhip.ts` (~34-50, ~100-107)
- Modify: `src/lib/congress/applyWhipVotes.ts` (~142-158, ~278)
- Test: `src/lib/congress/__tests__/whipWriters.activeBoth.test.ts`

**Interfaces:**
- Consumes: `resolveBillVoteField` (Task 1).
- Produces: whipped votes land in the whipped member's own chamber.

- [ ] **Step 1: Write the failing test**

```ts
describe("whipping an upper-chamber member on an active_both bill", () => {
  it("writes the vote AND the weight to the upper chamber", async () => {
    const bill = makeBill({ status: "active_both", countryId: "US" });
    await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [senatorId]);
    const [, update] = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
    // Assert the MAP and the COUNTER — the map alone leaves the $inc triple unproven,
    // and it is the counter that lets a bill pass on the other house's votes.
    expect(update.$set).toHaveProperty(`otherChamberVotes.${senatorId.toString()}`);
    expect(update.$inc).toHaveProperty("otherChamberVotesFor");
    expect(update.$inc).not.toHaveProperty("votesFor");
  });

  it("writes the snapshot to otherChamberWhippedFromVote", async () => {
    // applyPlayerWhip ONLY — applyWhipVotes writes no snapshot, so asserting one
    // there tests nothing.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/congress/__tests__/whipWriters.activeBoth.test.ts`
Expected: FAIL — everything lands in `votes`/`votesFor`.

- [ ] **Step 3: Fork `applyPlayerWhip`**

Replace the four `isOtherChamber`-driven expressions with a per-member resolution. The function already receives the eligible character ids; look their office types up once:

```ts
  const isOverride = bill.status === "veto_override";
  const isConcurrent = bill.status === "active_both";

  // For a concurrent bill the four forks below are per-MEMBER, not per-bill: an
  // upper-chamber member whipped into the lower map would add weight to the wrong
  // tally, and the bill could pass on the other chamber's votes.
  const officeTypeByCharacter = isConcurrent
    ? await loadOfficeTypesByCharacter(db, bill.countryId ?? "US", eligibleCharacterIds)
    : new Map<string, string>();

  const fieldFor = (characterId: ObjectId): BillVoteField =>
    isConcurrent
      ? resolveBillVoteField(bill, {
          voterOfficeType: officeTypeByCharacter.get(characterId.toString()),
          lowerOfficeType: lowerOfficeTypeFor(bill.countryId ?? "US"),
        })
      : isOtherChamber
        ? "otherChamberVotes"
        : isOverride
          ? "vetoOverrideVotes"
          : "votes";
```

Then key `voteField`, `snapshotField`, `existingVotes` and the `$inc` triple off `fieldFor(characterId)` per member, accumulating into per-field buckets exactly as Task 4 does.

Add a small helper in the same file:

```ts
/** characterId → officeType, for the members this whip targets. */
async function loadOfficeTypesByCharacter(
  db: Db,
  countryId: string,
  characterIds: ObjectId[]
): Promise<Map<string, string>> {
  const rows = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId, characterId: { $in: characterIds } })
    .project<{ characterId: ObjectId; officeType: string }>({ characterId: 1, officeType: 1 })
    .toArray();
  return new Map(rows.map((r) => [r.characterId.toString(), r.officeType]));
}
```

- [ ] **Step 4: Fork `applyWhipVotes` the same way, minus the snapshot**

`applyWhipVotesToBill` has no `whippedFromVote` write — fork only `voteField`, `existingVotes` and the `$inc` triple.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/congress`
Expected: PASS — new tests plus every existing whip test.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(congress): route whipped votes to the whipped member's own chamber"
```

---

### Task 7: The status and provision sweeps

**Files:**
- Modify: the sites the greps below find
- Modify: `src/lib/turn/billLifecycle/lifecycleHelpers.ts` (~line 79)
- Test: `src/lib/turn/billLifecycle/__tests__/notifyChambers.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new exports.

- [ ] **Step 1: Run the six searches and write the worklist**

```bash
rg -n '"active_other"' src/
rg -n 'status === "active"' src/
rg -n 'ACTIONABLE|BILL_STATUSES|"active_both"|"active_other"|"active"' src/
rg -n 'votingEnds(At|OnTurn)|otherChamberVotingEnds(At|OnTurn)' src/
rg -n 'canVoteOther|canVoteOrigin' src/
rg -n 'PASSED_STATUSES|FAILED_STATUSES|Set<BillStatus' src/
```

**The rule:** any code deriving fetch scope, voting eligibility, actionability, vote-field or deadline-field from `bill.status` must be taught `active_both`, and for `active_both` the answer depends on the voter's chamber.

Known members, each needing `active_both` added:
- `nationalBillQueries.ts` — `canVoteOrigin`, and the hardcoded `canVoteOther: false` beside it; **and** the hardcoded `otherChamberVotingEndsAt: null` nine lines above
- `billWhipPanelData.ts` — `ACTIONABLE_BILL_STATUSES`
- `whipDefiance.ts` — `loadBillTarget`'s status array
- `congressBillFilters.ts`, `billDisplays.ts`, `proposeNationalBill.ts`, `parliamentaryGovernment.ts`, `publicApi/legislation.ts`
- `coalitions/priorities.ts`, `coalitions/priorityApi.ts`, `nationalization/corpNationalizationThreat.ts` — **behavioural**, not display
- `api/admin/country/[code]/bills/route.ts` — an admin **write** that sets `active_other`
- the party, **caucus** and **regional** whip and whippable-bills routes — separate files
- the bill-card / timeline UI set
- `congress/bills/[id]/votes/route.ts` — `resolveVoteOfficeType` must take the **requested** chamber, and must carry the **preset**

⚠️ **Do NOT edit `billStatusFilters.ts`.** It defines "voting" by negation (`!PASSED && !FAILED`), so `active_both` already lands there correctly. It is listed only so nobody edits it needlessly.

- [ ] **Step 2: Add the missing country filter to the vote-open notifier**

`notifyChambersVoteOpen` queries `{ officeType, characterId: { $ne: null }, isNPP: { $ne: true } }` — **no `countryId`**. The US, BR and others share the `house`/`senate` office keys, so it already notifies across countries. PR3's builder fans this out across every qualifying member, so fix it here.

Write the test first:

```ts
it("only notifies officials of the bill's own country", async () => {
  await notifyChambersVoteOpen(db, { ...bill, countryId: "US" }, "senate");
  const [filter] = db.collectionMocks["electedOfficials"]!.find.mock.calls[0];
  expect(filter).toMatchObject({ countryId: "US" });
});
```

Then add `countryId: bill.countryId ?? "US"` to the query.

- [ ] **Step 3: Work the list, running the suite after each file**

Run after each: `npx vitest run <the file's test>`

- [ ] **Step 4: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): teach the bill surfaces about active_both"
```

---

### Task 8: Register the stage in every config

**Files:**
- Modify: `configs/us.ts`, `uk.ts`, `de.ts`, `ie.ts`, `jp.ts`, `oneParty.ts`
- Modify: `src/lib/turn/oneParty/onePartyBillLifecycle.ts` (~64, ~98) and `configs/oneParty.ts` (~79, ~85) — thread the preset
- Test: `src/lib/turn/billLifecycle/__tests__/chambersFor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { getJointSittingOfficeTypes } from "@/lib/legislature/chamberOfficeType";

describe("chambersFor", () => {
  it("returns ONE chamber for Germany under 1953-default", () => {
    // ⚠️ The preset MUST be pinned. DE's base config is `bicameral: false`, so a
    // bicameral-keyed implementation also returns 1 for era-neutral DE — an
    // era-neutral assertion passes on the broken build and proves nothing.
    // 1953-default is the only preset where the two candidate rules disagree.
    expect(getJointSittingOfficeTypes("DE", "1953-default")).toHaveLength(1);
  });

  it("is preset-sensitive for Turkey", () => {
    // TR's base has an upperElectionSystem; its 1953 override sets it undefined.
    // This fails if the stage resolves its config without a preset.
    expect(getJointSittingOfficeTypes("TR", "1953-default").length).not.toBe(
      getJointSittingOfficeTypes("TR", "1979-default").length
    );
  });

  it("returns two chambers for the US", () => {
    expect(getJointSittingOfficeTypes("US", "1953-default")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it — it should PASS already**

Run: `npx vitest run src/lib/turn/billLifecycle/__tests__/chambersFor.test.ts`
Expected: PASS. This test pins the helper this plan depends on; if it fails, stop and re-read the spec's `chambersFor` section before writing the stage.

- [ ] **Step 3: Add the stage to each config**

Append to each config's `stages` array:

```ts
    {
      kind: "concurrentVote",
      status: "active_both",
      // getJointSittingOfficeTypes, NOT `legislature.bicameral` — see the spec.
      chambersFor: (b) => getJointSittingOfficeTypes(b.countryId ?? "US", b.preset),
      voteFieldFor: (b, officeType) =>
        officeType === getLowerChamberOfficeType(b.countryId ?? "US", b.preset)
          ? "votes"
          : "otherChamberVotes",
      passRule: "simpleMajority",
      requireAll: true,
      onPassStatus: "signed",
      votingDurationHours: 24,
      execActionCheckOnPass: true,
    },
```

For `oneParty.ts`, which is one builder covering all 12 one-party countries, add it inside that builder so every one gets it.

- [ ] **Step 4: Thread the preset through the one-party path**

`onePartyBillLifecycle.ts:64` and `:98` read `COUNTRY_CONFIGS[countryId]` directly, and `configs/oneParty.ts:79` derives `upperKey` — and therefore `originChambers` — from that flattened object. `:85`'s `officeTypeFor` drops it too. Replace each with `getCountryConfig(countryId, preset)` and pass the preset in from the caller.

⚠️ `originChambers` matters specifically: `closeConcurrentVoteStage` scopes its expired filter on it, so a preset-blind `upperKey` makes the close's scoping preset-blind for CN/RU/DD/PL/CS/HU/RO/BG/YU/UKR/BLR/BAL.

- [ ] **Step 5: Full gate**

```bash
npm run lint
npm run format:check
NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit
npm run test:run
```

Expected: lint clean, format clean, no new tsc errors, and no NEW test failures beyond the known baseline.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): register the concurrent vote stage in every config"
```

---

## What this PR deliberately does not do

- No `join_conflict` provision, resolution type, or bill builder — PR3.
- No conflict, faction, or map work — PR1/PR4.
- **No filibuster support on `active_both`.** A bloc war-entry bill is not filibusterable by design; the explicit refusal is added in PR3 alongside the provision that makes such bills exist. `evaluatePassRule` and `tallyFields` are untouched here.
