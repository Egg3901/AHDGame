# PR3 — Join Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bloc organisation can table a 24-turn resolution to enter an existing conflict on a named side; passing it spawns a mirrored bill in every qualifying member's legislature, and each bill that passes enrols its country as a belligerent.

**Architecture:** A ninth `OrganizationResolutionType` (`join_conflict`), granted to the `bloc` category only, tabled through the existing org-legislation route. Its enactment spawns a domestic bill carrying a new `join_conflict` provision, filed at PR2's `active_both` status, skipping the executive. On passage the bill calls the existing idempotent `joinSide`.

**Tech Stack:** TypeScript, Next.js route handlers, MongoDB, Vitest, Zod, React.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-09-bloc-join-conflict-and-cold-war-conflicts-design.md`, Part 1. Read it first.
- **Depends on PR2** for `active_both` and the concurrent stage, and on **PR1** for something to join.
- **Gate:** `gameState.conflictsEnabled`. `coldWarEnabled` is retired — never read it.
- **Never set `gameState.coldWarEndedTurn`.** It makes `resolveOrgCategory` revert NATO/Warsaw Pact to `security`, which does not carry `join_conflict` — silently disabling this entire feature.
- **Commit style:** lowercase-leading subject, ≤100 chars. **Prettier:** whole repo. **Typecheck:** 12 GB heap. **Never chain build + test:run.** **CRLF files.**
- Pre-existing baseline failures exist; confirm against `origin/development` before investigating.

## The two things most likely to go wrong

1. **The spawn gate excluding the United States.** `COUNTRY_BILL_PHASES` has 16 keys and `US` is not one of them — the US engine runs from `billLifecycle.ts:30`. A bare table lookup skips the feature's most important belligerent, and a test asserting "France gets no bill" passes anyway.
2. **`validateBillProvisions` accepting the provision.** Give it a validated bucket and any seated legislator can carry war entry at simple majority, bypassing the foreign-minister gate, the membership check and the bloc vote. It must **refuse**, exactly as it refuses `declare_war`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/db/types/internationalOrganization.ts` | *Modify* — `join_conflict` type + its two fields |
| `src/lib/constants/orgCategory.ts` | *Modify* — grant it to `bloc` only; add to `IMPLEMENTED_RESOLUTION_TYPES`; keep it OUT of `BASELINE_POWERS` |
| `src/lib/db/types/legislation.ts` | *Modify* — `JoinConflictProvision`; add to the union; exclude from `isPolicyProvision` |
| `src/lib/legislature/hasBillLifecycle.ts` | *Create* — the 17-country lifecycle predicate |
| `src/lib/internationalOrganizations/commands/buildJoinConflictBill.ts` | *Create* — the mirrored bill |
| `src/lib/internationalOrganizations/commands/proposeLegislation.ts` | *Modify* — the `join_conflict` branch |
| `src/app/api/country/[code]/international-organizations/[orgId]/legislation/route.ts` | *Modify* — the schema arm |
| `src/lib/turn/internationalOrganizationsPhase.ts` | *Modify* — `applyResolutionEffect` case; pass the voting-member roster |
| `src/lib/internationalOrganizations/withdrawalBills.ts` | *Modify* — skip the President |
| `src/lib/legislationEffects.ts` | *Modify* — enactment calls `joinSide` |
| `src/lib/congress/billProposal.ts` | *Modify* — **refuse** a hand-rolled provision |
| `src/lib/legislature/commands/nationalBillActions.ts` | *Modify* — explicit filibuster refusal (US branch) |
| `src/app/world/international-organizations/components/JoinConflictPanel.tsx` | *Create* — the propose surface |

---

### Task 1: The resolution type and its category grant

**Files:**
- Modify: `src/lib/db/types/internationalOrganization.ts`
- Modify: `src/lib/constants/orgCategory.ts`
- Test: `src/lib/constants/__tests__/orgCategory.joinConflict.test.ts`

**Interfaces:**
- Produces: `OrganizationResolutionType` includes `"join_conflict"`; `OrganizationLegislation.joinConflictTheaterId?: string`; `.joinConflictSide?: "A" | "B"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  canTableResolutionType,
  ORGANIZATION_CATEGORY_META,
  IMPLEMENTED_RESOLUTION_TYPES,
} from "@/lib/constants/orgCategory";

describe("join_conflict is a bloc-only power", () => {
  it("is tableable by a bloc", () => {
    expect(canTableResolutionType("bloc", "join_conflict")).toBe(true);
  });

  it("is refused to every other category", () => {
    for (const c of ["security", "political", "economic", "development"] as const) {
      expect(canTableResolutionType(c, "join_conflict"), c).toBe(false);
    }
  });

  it("is NOT a baseline power", () => {
    // canTableResolutionType ORs the category powers with BASELINE_POWERS, so adding
    // it there would silently grant war entry to political forums and dev banks.
    for (const c of ["political", "development"] as const) {
      expect(ORGANIZATION_CATEGORY_META[c].powers).not.toContain("join_conflict");
    }
    expect(canTableResolutionType("political", "join_conflict")).toBe(false);
  });

  it("is implemented", () => {
    expect(IMPLEMENTED_RESOLUTION_TYPES).toContain("join_conflict");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/constants/__tests__/orgCategory.joinConflict.test.ts`
Expected: FAIL — `"join_conflict"` is not a valid type.

- [ ] **Step 3: Add the type and fields**

In `src/lib/db/types/internationalOrganization.ts`:

```ts
export type OrganizationResolutionType =
  | "free_trade_agreement"
  | "sanctions"
  | "directive"
  | "joint_statement"
  | "aid_package"
  | "set_dues"
  | "set_posture"
  | "fund_agency"
  /** Enter an existing conflict on a named side. Bloc organisations only. */
  | "join_conflict";
```

and on `OrganizationLegislation`:

```ts
  /**
   * `join_conflict`: the conflict to enter — a ConflictDoc._id (the theater key).
   *
   * `_id`, NOT `conflictId`. The public sequential number is for display and URLs
   * only; every lookup, unit `theaterId`, declaration and assignment references `_id`.
   */
  joinConflictTheaterId?: string;
  /** `join_conflict`: which side of that conflict the bloc backs. */
  joinConflictSide?: "A" | "B";
```

- [ ] **Step 4: Grant it to `bloc` only**

In `src/lib/constants/orgCategory.ts`, add `"join_conflict"` to `ORGANIZATION_CATEGORY_META.bloc.powers` and to `IMPLEMENTED_RESOLUTION_TYPES`.

⚠️ **Do not touch `BASELINE_POWERS`** — it is `["set_dues"]` and `canTableResolutionType` ORs it with the category list, so an entry there grants the power to every category.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/constants/__tests__/orgCategory.joinConflict.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(intorg): add the join_conflict resolution type as a bloc power"
```

---

### Task 2: The provision, and refusing it on the ordinary bill path

**Files:**
- Modify: `src/lib/db/types/legislation.ts`
- Modify: `src/lib/congress/billProposal.ts` (~line 116-128)
- Modify: `src/lib/congress/billEnrichment.ts` (~698-714) and `src/lib/legislature/queries/nationalBillQueries.ts` (~340-359)
- Test: `src/lib/congress/__tests__/joinConflictProvision.test.ts`

**Interfaces:**
- Produces: `JoinConflictProvision { type: "join_conflict"; theaterId: string; side: "A" | "B"; organizationId: string; resolutionId: string }`.

- [ ] **Step 1: Write the failing test**

```ts
describe("join_conflict provision", () => {
  it("is NOT a policy provision", () => {
    // isPolicyProvision is TRUE BY DEFAULT. Two consumers: billEnactment writes an
    // unhandled provision into a policy record with legislationTypeId undefined, and
    // nationalBillActions feeds it to applyBillVotePolicyShift — which would shift
    // every voting legislator's own policy positions.
    expect(isPolicyProvision({ type: "join_conflict" } as BillProvision)).toBe(false);
  });

  it("is REFUSED when hand-rolled through the ordinary bill route", async () => {
    // Privilege escalation: a validated bucket lets any seated legislator carry war
    // entry at simple majority, bypassing the foreign-minister gate, the membership
    // check and the bloc vote entirely.
    const res = await validateAndBuildProvisions({
      rawProvisions: [{ type: "join_conflict", theaterId: "t1", side: "A" }],
      category: "foreign policy",
      sourceCountry: "US",
    } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/bloc/i);
  });
});
```

⚠️ Match `validateAndBuildProvisions` to the real exported name in `billProposal.ts` — read the file first.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/congress/__tests__/joinConflictProvision.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the provision type**

In `src/lib/db/types/legislation.ts`:

```ts
export interface JoinConflictProvision {
  type: "join_conflict";
  /** ConflictDoc._id — the theater key, not the public conflictId. */
  theaterId: string;
  side: "A" | "B";
  /** The bloc that called for it, for the bill text and the record. */
  organizationId: string;
  /** The resolution that spawned this bill. */
  resolutionId: string;
}
```

Add it to the `BillProvision` union, and add `p.type !== "join_conflict" &&` to the `isPolicyProvision` exclusion chain beside the `declare_war` line.

- [ ] **Step 4: Refuse it on the ordinary path**

In `src/lib/congress/billProposal.ts`, extend the existing `declare_war` refusal at the top of the provision loop:

```ts
    // A declaration of war is introduced by the EXECUTIVE... (existing comment)
    // A join-conflict provision is written ONLY by buildJoinConflictBill, from a
    // passed bloc resolution. Accepting one here would let any backbencher enter a
    // war at the simple majority this design deliberately keeps — bypassing the
    // foreign-minister gate, the org membership check and the bloc vote together.
    const rawType = "type" in (rawP as object) ? (rawP as { type: unknown }).type : undefined;
    if (rawType === "declare_war") {
      return { ok: false, status: 400, error: "A declaration of war is introduced by the head of government or the defence minister." };
    }
    if (rawType === "join_conflict") {
      return {
        ok: false,
        status: 400,
        error: "Entry into a conflict is decided by a bloc resolution, not a bill.",
      };
    }
```

- [ ] **Step 5: Give it a label in both chains**

In `billEnrichment.ts` and `nationalBillQueries.ts`, add a `join_conflict` branch **above** each chain's subsidy catch-all (both carry a comment saying new types must sit above it):

```ts
        if (provision.type === "join_conflict") {
          return `Enter the conflict on side ${provision.side} at ${provision.organizationId}'s call`;
        }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/congress src/lib/legislature/queries`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): add the join_conflict provision and refuse it on the bill route"
```

---

### Task 3: The lifecycle predicate

**Files:**
- Create: `src/lib/legislature/hasBillLifecycle.ts`
- Test: `src/lib/legislature/__tests__/hasBillLifecycle.test.ts`

**Interfaces:**
- Produces: `hasBillLifecycle(countryId: CountryId): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
describe("hasBillLifecycle", () => {
  it("includes the United States", () => {
    // ⚠️ The discriminating half. COUNTRY_BILL_PHASES has 16 keys and US is NOT one
    // of them — its engine runs from billLifecycle.ts. A bare table lookup skips the
    // feature's most important belligerent, and the France assertion below passes
    // anyway, so without THIS test the feature ships broken for the US.
    expect(hasBillLifecycle("US")).toBe(true);
  });

  it("includes a COUNTRY_BILL_PHASES country", () => {
    expect(hasBillLifecycle("UK")).toBe(true);
  });

  it("excludes France, which is in NATO's 1953 roster and has no lifecycle", () => {
    expect(hasBillLifecycle("FR")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/legislature/__tests__/hasBillLifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Does this country's national bills get processed by an engine?
 *
 * 17 countries do: the 16 in `COUNTRY_BILL_PHASES`, PLUS the United States, whose
 * lifecycle is invoked directly from `billLifecycle.ts` and is therefore absent from
 * that table. A bare table lookup silently excludes the US — which is why this is a
 * named helper rather than an inline check.
 *
 * Used to gate spawning a mirrored bill: minting one for a country no engine walks
 * leaves a permanent `active_both` zombie on the floor.
 */
export function hasBillLifecycle(countryId: CountryId): boolean {
  return COUNTRY_BILL_PHASES[countryId] != null || countryId === "US";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/legislature/__tests__/hasBillLifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): add the bill-lifecycle predicate covering the us"
```

---

### Task 4: The mirrored bill builder

**Files:**
- Create: `src/lib/internationalOrganizations/commands/buildJoinConflictBill.ts`
- Test: `src/lib/internationalOrganizations/commands/__tests__/buildJoinConflictBill.test.ts`

**Interfaces:**
- Consumes: `JoinConflictProvision` (Task 2).
- Produces: `buildJoinConflictBill(params): Promise<ObjectId>`.

- [ ] **Step 1: Write the failing test**

```ts
describe("buildJoinConflictBill", () => {
  it("stamps BOTH deadline pairs and initialises both vote maps", async () => {
    const id = await buildJoinConflictBill({ db, countryId: "US", /* … */ });
    const doc = inserted();
    expect(doc.status).toBe("active_both");
    // The builder inserts directly, so ConcurrentVoteStage's entry logic never runs
    // for these bills — it owns the whole opening state.
    expect(doc.votingEndsOnTurn).toBeDefined();
    expect(doc.otherChamberVotingEndsOnTurn).toBeDefined();
    expect(doc.votingEndsAt).toBeInstanceOf(Date);
    expect(doc.otherChamberVotingEndsAt).toBeInstanceOf(Date);
    expect(doc.otherChamberVotes).toEqual({});
    expect(doc.otherChamberVotesFor).toBe(0);
    // originChamber, or closeConcurrentVoteStage's `$in: config.originChambers`
    // scoping never claims the bill.
    expect(doc.originChamber).toBeTruthy();
    expect(doc.currentChamber).toBeTruthy();
    expect(doc.proposalActionCost).toBe(0);
  });

  it("notifies both chambers", async () => {
    // A Join Conflict bill lands UNBIDDEN on a 24-turn clock; buildMembershipBill gets
    // away without a notification because that bill is raised by the country itself.
    await buildJoinConflictBill({ db, countryId: "US", /* … */ });
    expect(notifyChambersVoteOpen).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/internationalOrganizations/commands/__tests__/buildJoinConflictBill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

Model it on `buildMembershipBill.ts`, with these differences:

```ts
export async function buildJoinConflictBill(params: {
  db: Db;
  countryId: CountryId;
  preset?: string;
  sponsor: { characterId: ObjectId; characterName: string; party?: string };
  conflictName: string;
  organizationId: string;
  provision: JoinConflictProvision;
}): Promise<ObjectId> {
  const { db, countryId, preset } = params;
  // ⚠️ getCountryConfig, NOT COUNTRY_CONFIGS[...] — buildMembershipBill reads the
  // static table directly, and legislature shape is preset-dependent.
  const config = getCountryConfig(countryId, preset);
  const lowerKey = config.legislature.lowerChamber.key;
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);
  const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endsOnTurn = currentTurn + 24;
  const billId = new ObjectId();

  await db.collection<Bill>("bills").insertOne({
    _id: billId,
    countryId,
    stateId: getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`,
    title: `Entry into the ${params.conflictName} (${params.organizationId})`,
    summary: `Enter the ${params.conflictName} on side ${params.provision.side} at ${params.organizationId}'s call.`,
    fullText: "",
    category: "foreign policy",
    provisions: [params.provision],
    // `active_both` has no single current chamber, but nationalBillActions derives a
    // voter's chamber from it and the card/timeline/whip surfaces read it. The lower
    // chamber is the same opening value every other bill takes, so unconverted
    // readers degrade rather than seeing undefined. Never the authority.
    originChamber: lowerKey,
    currentChamber: lowerKey,
    status: "active_both",
    sponsorId: params.sponsor.characterId,
    sponsorName: params.sponsor.characterName,
    sponsorParty: params.sponsor.party,
    votes: {},
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    otherChamberVotes: {},
    otherChamberVotesFor: 0,
    otherChamberVotesAgainst: 0,
    otherChamberVotesAbstain: 0,
    // BOTH pairs: the NPP fetch ORs them and the close ANDs them, so a missing pair
    // either stops polling one chamber or refuses its votes against an undefined
    // deadline.
    votingStartedAt: now,
    votingEndsAt: endsAt,
    votingEndsOnTurn: endsOnTurn,
    otherChamberVotingEndsAt: endsAt,
    otherChamberVotingEndsOnTurn: endsOnTurn,
    // The diplomatic action spent tabling the bloc resolution is the cost; the member
    // countries did not file this.
    proposalActionCost: 0,
    proposedAt: now,
    proposedTurn: currentTurn,
    createdAt: now,
    updatedAt: now,
  } as Bill);

  // The engine notifies on activation; a builder-inserted bill never passes through
  // it, and this one lands unbidden in a chamber that did not ask for it.
  for (const officeType of getJointSittingOfficeTypes(countryId, preset)) {
    await notifyChambersVoteOpen(db, { ...bill, currentChamber: officeType }, officeType);
  }

  return billId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/internationalOrganizations/commands/__tests__/buildJoinConflictBill.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A
git commit -m "feat(intorg): add the mirrored join-conflict bill builder"
```

---

### Task 5: Tabling the resolution

**Files:**
- Modify: `src/lib/internationalOrganizations/commands/proposeLegislation.ts`
- Modify: `src/app/api/country/[code]/international-organizations/[orgId]/legislation/route.ts`
- Test: `src/lib/internationalOrganizations/commands/__tests__/proposeLegislation.joinConflict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("tabling a join_conflict resolution", () => {
  it("is accepted at NATO under a 1953 preset", async () => { /* expect ok, status pending */ });
  it("is refused at a security-category org", async () => {
    // loadOrganizationDefWithPowers resolves the world's EFFECTIVE category, so a
    // security alliance in a post-Cold-War preset is refused by canTableResolutionType
    // with no new code.
  });
  it("is refused when the conflict is resolved or missing", async () => { /* ... */ });
  it("stores the theater _id and the side", async () => { /* ... */ });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/internationalOrganizations/commands/__tests__/proposeLegislation.joinConflict.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the branch**

In `proposeLegislation.ts`, add a `join_conflict` arm to `ProposeResolutionInput`:

```ts
  | { type: "join_conflict"; theaterId: string; side: "A" | "B"; title?: string; description?: string }
```

and a branch beside the others (after the `canTableResolutionType` gate, which already refuses a non-bloc org):

```ts
  if (input.type === "join_conflict") {
    const conflict = await getConflict(db, input.theaterId);
    if (!conflict || conflict.status === "resolved") {
      return { ok: false as const, status: 400, error: "That conflict is not live." };
    }
    if (input.side !== "A" && input.side !== "B") {
      return { ok: false as const, status: 400, error: "Pick side A or side B." };
    }
    const sideLabel = input.side === "A" ? conflict.sideA.label : conflict.sideB.label;
    const title = input.title?.trim() || `${orgId} Entry into ${conflict.name} (${sideLabel})`;

    await legislation.insertOne({
      _id: legislationId,
      organizationId: orgId,
      type: "join_conflict",
      title,
      description: input.description,
      parties: [],
      joinConflictTheaterId: conflict._id,
      joinConflictSide: input.side,
      proposingCountryId: countryId,
      proposedByCharacterId: actor.characterId,
      proposedByCharacterName: actor.characterName,
      status: "pending",
      votes: [],
      proposedAt: now,
      proposedOnTurn: currentTurn,
      closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
    });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} moved that ${orgId} enter ${conflict.name} alongside ${sideLabel}.`,
      { organizationId: orgId, legislationId: legislationId.toString() }
    );

    return { ok: true as const, legislationId: legislationId.toString() };
  }
```

- [ ] **Step 4: Add the route schema arm**

In the legislation route, add:

```ts
const joinConflictSchema = z.object({
  type: z.literal("join_conflict"),
  theaterId: z.string().min(1).max(120),
  side: z.enum(["A", "B"]),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});
```

to `resolutionSchema`'s union, and an `else if (body.data.type === "join_conflict")` arm building `validatedInput`. Everything else — foreign-minister auth, rate limit, membership check, diplomatic-action cost — is inherited unchanged.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/internationalOrganizations src/app/api/country`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(intorg): let a bloc table a join-conflict resolution"
```

---

### Task 6: Enactment — spawning the mirrored bills

**Files:**
- Modify: `src/lib/turn/internationalOrganizationsPhase.ts` (`applyResolutionEffect` ~605; the call site ~482; `votingMembers` is already computed at ~436)
- Test: `src/lib/turn/__tests__/internationalOrganizationsPhase.joinConflict.test.ts`

⚠️ Both functions are **private** inside `internationalOrganizationsPhase.ts` — neither is exported and neither has a file of its own.

- [ ] **Step 1: Write the failing test**

```ts
describe("join_conflict enactment", () => {
  it("spawns one bill per player-enabled member with a lifecycle", async () => { /* ... */ });
  it("spawns NO bill for a non-player-enabled member", async () => { /* client states */ });
  it("spawns NO bill for France (player-enabled but no lifecycle)", async () => { /* ... */ });
  it("spawns a bill for the United States", async () => {
    // The discriminating case — the France assertion above passes on a bare
    // COUNTRY_BILL_PHASES lookup, which skips the US.
  });
  it("skips a member already on the chosen side", async () => { /* ... */ });
  it("skips and logs a member on the OPPOSING side", async () => { /* never switches sides */ });
  it("is a no-op when the conflict resolved during the window", async () => { /* ... */ });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — no `join_conflict` case.

- [ ] **Step 3: Pass the voting roster into the effect**

`applyResolutionEffect` receives `effectMembers` — *modelled* countries, right for sanctions and aid but not this. `resolveExpiredOrganizationLegislation` already computes `const members = await votingMembers(db, item.organizationId)` 46 lines above the call.

Add it as a **new argument alongside** `effectMembers`, not in place of it — `effectMembers` is load-bearing for sanctions/aid (a client state is still bound by its bloc's sanctions).

- [ ] **Step 4: Write the case**

```ts
    case "join_conflict": {
      const theaterId = item.joinConflictTheaterId;
      const side = item.joinConflictSide;
      if (!theaterId || !side) return;

      // A resolution sits for 24 turns; the war it was about can end inside that
      // window. Mirrors declareWar, which re-runs findWarBetween at enactment.
      const conflict = await getConflict(db, theaterId);
      if (!conflict || conflict.status === "resolved") {
        await recordOrgHistoryEvent(db, item.proposingCountryId, currentTurn,
          `${item.organizationId}'s entry resolution lapsed: that conflict is over.`,
          { organizationId: item.organizationId });
        return;
      }

      const opposing = side === "A" ? "B" : "A";
      for (const countryId of votingMemberIds) {
        if (!hasBillLifecycle(countryId)) {
          await recordOrgHistoryEvent(db, countryId, currentTurn,
            `${countryId} could not act on ${item.organizationId}'s entry resolution: no legislature.`,
            { organizationId: item.organizationId });
          continue;
        }
        const chosen = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
        const other = opposing === "A" ? conflict.sideA.countries : conflict.sideB.countries;
        if ((chosen as string[]).includes(countryId)) continue;
        if ((other as string[]).includes(countryId)) {
          // A bloc resolution never switches a country's side mid-war.
          await recordOrgHistoryEvent(db, countryId, currentTurn,
            `${countryId} is already fighting on the other side of ${conflict.name}.`,
            { organizationId: item.organizationId });
          continue;
        }

        const hog = await getHeadOfGovernmentCharacterId(db, countryId);
        if (!hog) continue;
        await buildJoinConflictBill({ db, countryId, preset, /* sponsor from hog */
          conflictName: conflict.name,
          organizationId: item.organizationId,
          provision: {
            type: "join_conflict",
            theaterId,
            side,
            organizationId: item.organizationId,
            resolutionId: item._id.toString(),
          },
        });
      }
      return;
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/turn`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(intorg): spawn mirrored bills when a bloc votes to enter a conflict"
```

---

### Task 7: Passage — skip the President and enrol

**Files:**
- Modify: `src/lib/internationalOrganizations/withdrawalBills.ts` (~line 40)
- Modify: `src/lib/legislationEffects.ts`
- Modify: `src/lib/legislature/commands/nationalBillActions.ts` (the US filibuster branch, ~487)
- Test: `src/lib/__tests__/legislationEffects.joinConflict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("join_conflict enactment effect", () => {
  it("enrols the country on the resolution's side", async () => {
    await applyLegislationEffect(db, billWithJoinConflict);
    expect(joinSide).toHaveBeenCalledWith(expect.anything(), conflict, "US", "A");
  });
  it("is a no-op when the conflict resolved while the bill sat", async () => { /* ... */ });
  it("is a no-op when the country landed on the opposing side", async () => { /* ... */ });
  it("skips the president", () => {
    expect(billRequiresExecutiveAction({ countryId: "US", provisions: [joinConflictProvision] })).toBe(false);
  });
  it("keeps the simple-majority bar", () => {
    // Enforced by OMISSION — join_conflict is deliberately not added to
    // billHasDeclareWar. A decision enforced by absence needs a test that names it.
    expect(billHasDeclareWar([joinConflictProvision])).toBe(false);
  });
  it("refuses a filibuster with a reason that names it", async () => { /* US only */ });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Skip the President**

In `withdrawalBills.ts`, beside the `declare_war` case:

```ts
  const hasJoinConflict = bill.provisions?.some((p) => p.type === "join_conflict");
  // The return expression must consume it — the declaration alone is inert.
  return !bill.internationalAction && !hasIntOrgProvision && !hasDeclareWar && !hasJoinConflict;
```

- [ ] **Step 4: Enrol on passage**

In `legislationEffects.ts`, in its own branch beside the `declare_war` case:

```ts
        } else if (p.type === "join_conflict") {
          // Up to 48 turns of world state separate the proposal from this effect
          // (24 at the org, 24 at the chamber), so re-check both.
          const conflict = await getConflict(db, p.theaterId);
          if (!conflict || conflict.status === "resolved") return;
          const opposing = p.side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
          if ((opposing as string[]).includes(countryId)) return;
          await joinSide(db, conflict, countryId, p.side);
        }
```

- [ ] **Step 5: Refuse the filibuster explicitly**

In `nationalBillActions.ts`, inside the **US-only** filibuster branch (it already 400s any other country before the status checks), before the existing status/chamber test:

```ts
    if (bill.provisions?.some((p) => p.type === "join_conflict")) {
      return {
        status: 409,
        body: { error: "A bloc war-entry bill cannot be filibustered." },
      };
    }
```

Without this the caller falls through to "only on a bill actively being voted on in the Senate" — an accidental refusal that reads like a bug.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib src/lib/legislature`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
npm run format
git add -A
git commit -m "feat(legislature): enact join-conflict bills without a signature"
```

---

### Task 8: The propose surface

**Files:**
- Create: `src/app/world/international-organizations/components/JoinConflictPanel.tsx`
- Modify: `src/app/world/international-organizations/components/FlagshipTab.tsx`
- Test: `src/app/world/international-organizations/components/__tests__/JoinConflictPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
describe("JoinConflictPanel", () => {
  it("lists active conflicts with each side's label", () => { /* ... */ });
  it("posts the theater id and the chosen side", () => { /* ... */ });
  it("surfaces the server's refusal reason", () => { /* ... */ });
  it("renders nothing for a non-bloc org", () => { /* category gate */ });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Write the panel**

Model it on `PosturePanel.tsx` — the closest existing per-type panel on the `alliance` flagship. It takes the org's effective category, the member country, and the list of active conflicts; it renders a conflict picker showing each side's label and current control, a side selector, and a submit that POSTs to the existing legislation route.

- [ ] **Step 4: Render it from `FlagshipTab`**

Add it to the `alliance` flagship's panel list, gated on `canTableResolutionType(category, "join_conflict")` so it appears for a bloc and not for a security alliance.

- [ ] **Step 5: Full gate**

```bash
npm run lint
npm run format:check
NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit
npm run test:run
```

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(intorg): add the join-conflict propose panel"
```

---

## Manual verification

Against an isolated database, with `conflictsEnabled` on and a conflict created by PR1's admin form:

1. As the US foreign minister, open NATO's Alliance flagship → table a Join Conflict resolution on side A.
2. Vote it through with the other player-enabled members; wait 24 turns (or advance the clock).
3. Expect a bill titled "Entry into the … (NATO)" in **both** the US House and Senate simultaneously — that is the PR2 stage doing its job.
4. Pass both chambers. The bill should enact **without reaching the President**.
5. `/world/conflicts/<n>` should now list the US as a belligerent on side A.

## What this PR deliberately does not do

- No faction placement, token force, three-turn hold or resolution — PR4.
- No bloc-cohesion or reputation effect when a member's bill fails; a refusal costs nothing.
- No other bill type adopts `active_both`.
