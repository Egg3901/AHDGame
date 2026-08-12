# Bloc Join Conflict & Cold War Conflicts — Design

**Date:** 2026-08-09
**Status:** Sixteen review rounds; no open questions. Ready for planning.
**Branch:** `feature/intorg-war-declare` (worktree, based on `origin/development` @ `71c78f75d`)

**Citations verified clean against `486d3d13c`** (current `origin/development` as of
2026-08-10). The 7 commits since this branch's base touch corporations/plants, the public
API and wiki content — **not one cited file** — so there is no drift to chase. Merge
`origin/development` before executing, as normal hygiene; re-verification is not a
prerequisite for planning.

## Revision history

Sixteen review rounds, 80+ corrections. The full history is in git
(`git log --oneline -- docs/superpowers/specs/2026-08-09-*`); what a plan-writer needs
from it is only this.

### Decisions made and then REVERSED — do not reinstate

| Withdrawn approach | Why it was wrong | The live rule |
|---|---|---|
| `coldWarEnabled` as Part 3's gate | Flag is retired: its POST 409s, nothing in production reads it, and its default is `true` not `false` | `conflictsEnabled` alone gates both parts |
| A bespoke separate-peace rule for `cold_war` | `peaceOffer.ts:95-97` already refuses any offer to a generated side | Redundant — but load-bearing on `kind` staying `generated`, which a test pins |
| Token force via `buildEnemy` | One consumer, the PvE forecast; live resolution is `resolvePvpBattle(BattleSide[], …)` | `buildFactionSide` producing a synthetic `BattleSide` |
| `tokenStrength` decrement inside `applyOccupation`'s `$set` | It early-returns before that write whenever `control` doesn't move — i.e. every battle at a pinned front | Its own conflict write, beside the report insert |
| Alignment pole resolved from the preset | Poles are live-year era state, re-keyed through `era.inherit` at 1991 | Org from the **preset**, pole from the **live year** |
| A bare `COUNTRY_BILL_PHASES` lookup as the "has a lifecycle" gate | It has 16 keys and **excludes the US**, whose engine runs from `billLifecycle.ts` | `hasBillLifecycle(c)` helper; test pins that the US DOES get a bill |
| `chambersFor` keyed on `legislature.bicameral` | Fails closed on Germany under `1953-default`, where the override flips `bicameral` to `true` over an appointed Bundesrat | `getJointSittingOfficeTypes` — and its test must pin the preset |
| Deferring proxy-war map geometry | Vietnam geometry already exists; the deferral's stated exit was blocked by that module's own design | `FrontMap` consumes static features now |
| `validateBillProvisions` *accepting* the provision | Privilege escalation: any legislator could carry war entry at 51%, bypassing every gate in Part 1 | It **refuses**, exactly as it refuses `declare_war` |
| "The lifecycle engine needs no change" | `execActionCheckOnPass` is read only inside `closeChamberVoteStage` | `closeConcurrentVoteStage` re-implements the post-pass tail |

### The method these rounds produced

**An enumeration is not an inventory.** Five separate times a fix was specified against
*one* site of a multi-site class, and the feature would have shipped silently inert or
silently wrong — the faction placement chain alone accounted for four of them, each one
layer below the last. So where a class has more than one member this document states a
**rule and a search**, not a list; named sites are examples under a rule, never the
inventory.

**The searches need the same adversarial reading the lists got.** Two greps here carried
blind spots a later round found: one anchored on array position, one matched only the
turn half of turn/date pairs, and a third class (`canVoteOther: false`) is a hardcoded
literal that derives from nothing and no status search can reach.

**When the test list and the change list disagree about scope, trust the tests.** That
held every time here. The change list missed the faction placement chain four rounds
running; the test "a declaration against a faction moves `control`" would have failed on
all four. Tests in this document therefore assert *downstream effects* — `control` after
a tick, a non-empty `otherChamberVotes` — not that a named function was called.

**A test that cannot fail on the broken build is worse than no test.** The Germany
chamber-count claim survived three wrong restatements partly because its prescribed test
was written era-neutrally, and a `bicameral`-keyed implementation passes that assertion.
Every discriminating test here therefore pins the input that makes the two candidate
implementations diverge — `"1953-default"` for Germany, divergent deadlines for the NPP
fetch, a battle that does *not* move `control` for the `tokenStrength` decrement.

## Goal

Two features that together give the Cold War its characteristic shape — blocs
dragging their members into other people's wars, and wars fought in third countries
whose outcome decides which bloc those countries end up in.

1. **Join Conflict** — a `bloc` organisation tables a 24-turn resolution to enter an
   existing conflict on a named side. Passage spawns a mirrored bill in every
   player-enabled member's legislature; both chambers vote **at the same time**, the
   President is skipped, and only the countries whose bills pass become belligerents.
2. **Cold War Conflict** — a new conflict type hosted in third-party countries
   (North & South Vietnam, the Koreas, Angola). Blocs back internal factions. When one
   side holds 100% for three consecutive turns the war resolves and the host countries
   join the winning bloc.

Neither feature invents a war-entry mechanism: both funnel into `joinSide`, the
idempotent enrolment `declareWar` and `battleResolution` already share.

## Gating

**Two flags.**

| Flag | Gates | Fresh world | Legacy world |
|---|---|---|---|
| `conflictsEnabled` | Everything here, Parts 1 and 3 alike. | `true` | fail-closed when absent |
| `intOrgAlignmentEnabled` | The alignment shift at Cold War resolution only (Part 3, step 3). | `true` | fail-closed when absent |

⚠️⚠️ **`coldWarEnabled` IS RETIRED — Revision 08-10b was wrong to add it, in three
separate ways.** That revision read the doc comment at `gameState.ts:229-231` ("Master
switch for the Cold War conflict subsystem…") and took it at face value **without
grepping for readers** — the precise failure Part 2 built predicate-plus-grep to
prevent, committed in the same document that institutionalised the rule.

What the source actually says:

- **Nothing gates on it.** `rg -n 'coldWarEnabled' src/` returns 18 lines: the type
  declaration, the toggle route (its `GET` projection and the 409), the sim harness
  (`forceFullAutonomy.ts`), `featureFlagDefaults.ts:80`, and two test files. **No
  production code path reads it as a gate.**

  *(An earlier revision added `sim/experimentsReport.ts:172-173` to this list as a fifth
  reference, presented as this document's own inventory rule catching the document. **That
  file does not mention the flag** — the bullet was added on a reviewer's citation
  without re-running the grep, even though the correct output was already in this
  session's history. Removed. The decision to drop the flag is unaffected; the worked
  example was fabricated.)*
- **Its admin toggle refuses writes.** `POST api/admin/conflicts/cold-war/toggle`
  returns **409**: *"The legacy coldWarEnabled flag is retired. Use `conflictsEnabled`
  for the live conflict system."* So it cannot be "the same admin surface the Part 3
  creation control extends" — that surface is closed.
- **The default was backwards.** `src/lib/seeds/reference/featureFlagDefaults.ts:74-92` sets `conflictsEnabled`,
  `coldWarEnabled` and `intOrgAlignmentEnabled` all **`true`** for fresh worlds
  (2026-07-20 product decision: fresh worlds get the full feature set). The "Default:
  false" column described legacy-world posture, not the default.

**Decision: drop it.** Part 3 gates on `conflictsEnabled`, exactly as the retirement
message instructs. Un-retiring the flag would mean a new POST, new admin UI and new gate
code to re-create a switch the repo deliberately removed — unrequested work pulling
against the codebase's own direction.

Both remaining flags are **fail-closed at runtime** (absent = off) and **default-on for
fresh worlds**. The distinction matters: a legacy world that predates a flag has it
absent, and absent must mean off.

Part 1 and Part 3 therefore share one gate. A bloc can vote to enter an ordinary
interstate war on the same flag that permits a proxy war.

---

# Part 1 — Join Conflict

## The resolution type

A ninth member of `OrganizationResolutionType`, granted to the **`bloc` category
only**:

```ts
export type OrganizationResolutionType =
  | "free_trade_agreement" | "sanctions" | "directive" | "joint_statement"
  | "aid_package" | "set_dues" | "set_posture" | "fund_agency"
  | "join_conflict";
```

`ORGANIZATION_CATEGORY_META.bloc.powers` gains it; `security` does **not**.
`resolveOrgCategory` already reserves `bloc` for NATO and the Warsaw Pact in the
1953/1979 presets, on the stated grounds that those two were "the instruments through
which two superpowers ran their halves of the world" and therefore carry patronage and
coercion an ordinary defence pact is denied. Dragging members into a shooting war is
the same kind of power. A player-founded alliance cannot be created as `bloc`
(`CREATABLE_ORGANIZATION_CATEGORIES` excludes it), so this cannot be self-granted.

It is also added to `IMPLEMENTED_RESOLUTION_TYPES` — a type must be in both its
category's powers and that set to be tabled.

⚠️ **Part 3 does NOT set the Cold-War-ended state, and must not.** `resolveOrgCategory`
returns the plain archetype the instant its `coldWarEnded` argument is true — NATO and the
Warsaw Pact revert to `security`, which does not carry `join_conflict` — so setting it
would **silently disable bloc war entry**, with no error anywhere.

**Name the storage key, not just the parameter:** `coldWarEnded` is
`resolveOrgCategory`'s *argument*; the settable field is
**`gameState.coldWarEndedTurn`**, which `service.ts` derives the boolean from. A document
this careful about `_id`-versus-`conflictId` should not blur that distinction — the thing
to leave alone is the field. The flag's own comment calls it "the seam for an
ending nobody has built yet", and Part 3 *is* an ending for Cold War conflicts, so the
temptation to wire the two together is real and specific. Resolving a proxy war ends that
war; it does not end the Cold War. Nothing in this design touches the flag.

⚠️ **And it must stay OUT of `BASELINE_POWERS`.** `canTableResolutionType`
(`src/lib/constants/orgCategory.ts:128-136`) passes a type if it is in the category's powers **or** in
`BASELINE_POWERS`, which every category has regardless of archetype. Adding it there
would silently grant war entry to political forums and development banks, defeating the
bloc-only restriction entirely. Earlier revisions named only the category list and
`IMPLEMENTED_RESOLUTION_TYPES`.

Two new optional fields on `OrganizationLegislation`:

```ts
/** `join_conflict`: the conflict to enter — a ConflictDoc._id (the theater key). */
joinConflictTheaterId?: string;
/** `join_conflict`: which side of that conflict the bloc backs. */
joinConflictSide?: "A" | "B";
```

**`_id`, not `conflictId`.** The public sequential number is for display and URLs
only; every lookup, unit `theaterId`, declaration and assignment references `_id`.
Storing the number here would mean resolving it again at enactment, on a document that
is addressed by two different keys and where confusing them is the documented hazard.

## Tabling it

No new route. `POST /api/country/[code]/international-organizations/[orgId]/legislation`
gains a `joinConflictSchema` in its discriminated union, and
`proposeOrganizationLegislation` gains a `join_conflict` branch. That means it inherits,
unchanged: foreign-minister auth (`requireForeignMinister`), the rate limit, the
membership check, the diplomatic-action cost, and the 24-turn window
(`ORG_PROPOSAL_VOTING_TURNS` — 24 turns = 24 game-hours, which is the "24 hour
proposal" this design was asked for).

Validated at proposal time:

- The org's **effective** category grants the power. `loadOrganizationDefWithPowers`
  already resolves the world's effective category, so a security alliance in a
  post-Cold-War preset is refused by the existing `canTableResolutionType` gate with
  no new code.
- The conflict exists and its `status !== "resolved"`.
- The side is `"A"` or `"B"`.
- The proposing country is a member of the org.

**The proposer names the side.** The bloc moves as one body: every member's mirrored
bill is a yes/no on joining *that* side. Letting each member choose its own side would
allow a bloc to end up fighting itself, which is not a thing an alliance does.

**UI:** `JoinConflictPanel.tsx` under
`src/app/world/international-organizations/components/`, alongside the seven existing
per-type panels (`PosturePanel`, `SanctionsPanel`, `AidPanel`, `DirectivePanel`,
`JointStatementPanel`, `AgencyFundingPanel`, `DuesPanel`) and rendered from
`FlagshipTab` on the `alliance` flagship. It lists active conflicts with each side's
label and current control, and picks a side.

## How it passes

Simple majority of the org's **player-enabled** members — the default non-FTA branch of
`resolutionPasses` (`yes > no && yes > 0`, non-member votes ignored). **No change to
`resolutionRules.ts` at all.**

`votingMembers` already narrows the ballot to player-enabled members, for the reason
the existing code gives: a client state cannot withhold a vote it was never entitled to
cast. The UN permanent-member veto does not apply — no bloc has permanent members.

## What enactment does

A new `case "join_conflict"` in `applyResolutionEffect`, reached from
`resolveExpiredOrganizationLegislation` on the turn the window closes.

⚠️ **Both are private functions inside `src/lib/turn/internationalOrganizationsPhase.ts`.**
Neither is exported and neither has a file of its own, so searching by symbol name finds
nothing and searching for a file of that name finds nothing either. Every line number
this document cites for them (436, 477, 482, 605) is in that file. Flagged because it is
less guessable than `withdrawalBills.ts:40`, which this document already flags for the
same reason.

Re-load the conflict first. **If it is missing or `resolved`, the resolution enacts as
a no-op and says so in the org history.** A resolution sits for 24 turns; the war it
was about can end inside that window. This mirrors `declareWar`, which re-runs
`findWarBetween` at enactment rather than trusting a check made at proposal.

Then, for each member of the org:

| Member state | Action |
|---|---|
| Not player-enabled | **Skip entirely.** No bill, no enrolment. |
| Player-enabled but `!hasBillLifecycle(c)` | **Skip, and log.** No engine would ever close the bill. ⚠️ Not a bare `COUNTRY_BILL_PHASES` lookup — that excludes the US. See Part 2, "Country coverage". |
| Already on the chosen side | Skip — `joinSide` is idempotent, but there is nothing to vote on. |
| Already on the **opposing** side | Skip, and log it. A bloc resolution never switches a country's side mid-war. |
| Otherwise | Spawn the mirrored domestic bill. |

**The roster this table needs is not the one `applyResolutionEffect` receives.** That
function is handed
`effectMembers = getMembers(...).filter(m => m in COUNTRY_CONFIGS)` — *modelled*
countries, which is the right set for sanctions and aid but not for this. Reusing it
would spawn bills for client states with no legislature — the exact outcome the "do not
join" decision rejected.

**The work is an added parameter, not a lookup.** `resolveExpiredOrganizationLegislation`
(in `src/lib/turn/internationalOrganizationsPhase.ts`)
already computes `const members = await votingMembers(db, item.organizationId)` at
line 436, forty-six lines above the `applyResolutionEffect` call at 482. That array is
passed in as a **new argument alongside** `effectMembers` — not in place of it.
`effectMembers` is load-bearing for sanctions and aid (its comment at line 477: a client
state is still bound by its bloc's sanctions), so swapping it would break them. No
`AccessTable` threading is needed either way. (Revision 3 over-scoped this; Revision 4's
"pass that array through" read as a swap.)

**Non-player-enabled members do not join.** They have no legislature to mirror a bill
into, and the alternative — auto-enrolling them — fills the belligerent roster with
countries nobody plays and no units to field. This diverges from how sanctions bind
client states, deliberately: a sanction is a rule the bloc applies to itself, war is a
roster of forces.

## The mirrored bill

`buildJoinConflictBill`, modelled directly on `buildMembershipBill` (the existing
"org action spawns a domestic bill" helper), differing only in provision, status and
window:

```ts
export interface JoinConflictProvision {
  type: "join_conflict";
  /** ConflictDoc._id. */
  theaterId: string;
  side: "A" | "B";
  /** The bloc that called for it, for the bill text and the record. */
  organizationId: string;
  /** The resolution that spawned this bill. */
  resolutionId: string;
}
```

⚠️ `buildMembershipBill` reads `COUNTRY_CONFIGS[countryId]` directly for its lower-chamber
key (line 26). `buildJoinConflictBill` is modelled on it and **must not inherit that
hazard** — it resolves through `getCountryConfig(countryId, preset)`, for the same
Germany reason set out in Part 2.

- **Sponsor:** the country's head of government via `getHeadOfGovernmentCharacterId`,
  which branches on the runtime government type. Reading
  `governmentFormations.pmCharacterId` directly is the bug that once locked the US
  President out of declaring war entirely.
- **Cost:** `proposalActionCost: 0`. The diplomatic action spent tabling the bloc
  resolution is the cost; the member countries did not file this.
- **Status:** `active_both` (Part 2), window 24 turns.
- **Title:** "Entry into the ⟨conflict name⟩ (⟨bloc⟩)".

### Simple majority, not two-thirds

`getBillPassRule` is **not** touched. Only `declare_war` and nationalize/privatize
escape the default simple majority, and neither applies here.

This is a considered divergence from the declare-war bar. A country entering a war at
its alliance's call is honouring a treaty it already ratified — the hard vote was
joining the bloc. Holding bloc entry to the same two-thirds as a unilateral declaration
would make alliance membership militarily inert, which is the opposite of the point.

### It skips the President

One clause added to `billRequiresExecutiveAction` — which lives in
`src/lib/internationalOrganizations/withdrawalBills.ts:40`, the least guessable location
in Part 1 — beside the `declare_war` case that already does exactly this:

```ts
const hasJoinConflict = bill.provisions?.some((p) => p.type === "join_conflict");
// …and the return expression at :41 must consume it — the declaration alone is inert:
return !bill.internationalAction && !hasIntOrgProvision && !hasDeclareWar && !hasJoinConflict;
```

The same function already returns `false` for every non-presidential government, so
parliamentary and one-party countries route no bill through an executive regardless.

⚠️ **The predicate needs no change; the engine does.** Earlier revisions said "the
lifecycle engine needs no change — the `execActionCheckOnPass` flag already consults this
predicate." That flag is read only inside `closeChamberVoteStage`, which never runs for
an `active_both` bill. `closeConcurrentVoteStage` must consult the predicate itself, as
part of the post-pass tail enumerated in Part 2 (B4).

### On passage

`applyLegislationEffect` gains a `join_conflict` branch:

1. Re-load the conflict; missing or `resolved` → no-op.
2. Re-check the country is not already on the opposing side.
3. `joinSide(db, conflict, countryId, side)`.

Both re-checks are load-bearing for the same reason the resolution's are: the bill sat
for 24 turns after a resolution that itself sat for 24, so up to 48 turns of world
state separate the proposal from the effect.

**On failure the bill simply dies.** Nothing joins. That is the whole mechanism — no
penalty, no bloc-cohesion effect, no retry cooldown.

---

# Part 2 — The concurrent bicameral vote

This is the only part of the design that edits shared bill machinery, and it is a
larger change than a first pass suggested. **Revised 2026-08-09 after design review**;
the original framing ("one pure helper plus six ternary swaps") understated the
surface by roughly half and missed both blocking paths. What follows is the corrected
inventory.

## The precedent this is modelled on

**`veto_override` is already a concurrent bicameral vote, and it ships today.**
`engine.ts:250-267` holds `vetoOverrideVotes` — a single map — tallies it per chamber
via `tallyOverrideByChamber`, and passes only when
`stage.chambers.every(ch => forByChamber[ch] >= threshold)`. That `.every` **is** the
`requireAll` semantics proposed below. On the NPP side, `turn/npp/billVoting.ts:83-86`
builds `vetoOverrideOfficials` by unioning the house and senate rosters, which is
exactly the "both chambers are live at once" problem, already solved.

`ConcurrentVoteStage` is therefore modelled on `OverrideStage`, not presented as a new
shape.

### Why it is not simply reused

Two concrete reasons, both worth recording so nobody re-opens this:

1. **The override tally is keyed on hardcoded `house`/`senate` literals** (`engine.ts:257-264`, in the caller; `tallyOverrideByChamber` itself is imported)
   builds `seatsByChamber`/`forByChamber` from those two literals). The override stage
   is US-only by construction; a bloc resolution reaches every member country, so the
   tally must resolve office types per country through `getOfficeTypeForChamber`.
2. **The override uses one vote map and therefore needs a display snapshot.** The
   denormalised counters (`votesFor`, `otherChamberVotesFor`, …) merge under a single
   map, which is why `buildOverrideDisplay` exists to freeze a per-chamber readout.
   Keeping the **two existing maps** avoids that entirely: `src/app/api/congress/bills/billDisplays.ts:143-145`
   already projects both chambers' counters unconditionally, so the per-chamber readout
   comes for free and no new snapshot type is needed.

**Decision: two vote maps** (`votes` = lower, `otherChamberVotes` = upper), selected by
the voter's chamber. Recorded with reasons because the single-map alternative is the
shipped precedent and looks like the obvious choice.

## The inventory is a predicate, not a list

**Revision 3 note.** Two successive reviews found sites the enumerated list had missed,
including the one gating the path this document called "the blocking one". A third list
would probably be wrong too. So the inventory is stated as a **rule plus the search
that finds every instance**, and only the sites that are structurally blocking — the
ones where a missed edit produces silence rather than a compile error — are named.

### The rule

> Any code that derives **fetch scope, voting eligibility, actionability, vote-field
> selection, or deadline-field selection** from `bill.status` must be taught
> `active_both`. For every such site, the answer for `active_both` depends on the
> **voter's chamber**, which `bill.currentChamber` cannot express.

### The search

```bash
rg -n '"active_other"' src/            # the paired-status sites
rg -n 'status === "active"' src/       # single-status gates
rg -n 'ACTIONABLE|BILL_STATUSES|"active_both"|"active_other"|"active"' src/  # allowlists
rg -n 'votingEnds(At|OnTurn)|otherChamberVotingEnds(At|OnTurn)' src/         # deadline pairs
rg -n 'canVoteOther|canVoteOrigin' src/               # the NEGATIVE-LITERAL blind spot
```

⚠️ **Two of these were repaired on the eighth review, and the repairs are the point.**
The originals read `\[\s*"active"` and `votingEndsOnTurn|otherChamberVotingEndsOnTurn`:

- The first **anchored on array position** — it matched only arrays whose *first* element
  is `"active"`, so `declare-war/route.ts:101`'s
  `$in: ["proposed", "active", "passed_origin", "active_other"]` was invisible.
- The second matched only the **turn half** of every turn/date pair. Every deadline here
  is a pair (`billStillOpen` takes both), so any site touching only `votingEndsAt` was
  invisible — including `nationalBillQueries.ts:483`'s hardcoded
  `otherChamberVotingEndsAt: null`, nine lines above the `canVoteOther: false` the fifth
  grep was added to catch, in the same object literal.

A grep offered *in place of* a list inherits the burden the list had: it has to be read
adversarially, or it is just a shorter list with hidden gaps.

⚠️ **A sixth blind spot, and it is the same class as the fifth.** Grep #5 exists for
hardcoded literals that derive from nothing. **Status sets defined by NEGATION are
equally unreachable**, and there is at least one:
`src/lib/legislature/billStatusFilters.ts` decides whether a bill shows under the
legislature page's "voting" filter as `!PASSED && !FAILED` — it contains no status
literal for any of the five searches to match.

Here it **fails safe**: `active_both` is neither passed nor failed, so it lands in
"voting" with no edit at all. **Do not edit it.** It is recorded because "the negation
happens to include our new status" is exactly the incidental immunity this document
refuses to depend on elsewhere — and because the next status added may not be so lucky.
A companion search for the class:

```bash
rg -n 'PASSED_STATUSES|FAILED_STATUSES|Set<BillStatus' src/
```

⚠️ **The fifth search exists because the predicate was right and the other four could not
express it.** `nationalBillQueries.ts:492` is `canVoteOther: false` — a **hardcoded
literal**, deriving from no status at all, on the country-legislature list where every
non-US mirrored bill lands. The same literal appears at `mapStateBillToBillDisplay.ts:110`
and `cabinet-bills/route.ts:313`. A grep for status expressions finds none of them,
because there is no expression to find. This document's Testing section asserts
`canVoteOther` is true for an upper-chamber member on an `active_both` bill — through
this query that is **unreachable**, and no amount of status-grep discipline would have
caught it.

Everything those turn up outside the named sites below is a **mechanical sweep** — where
"mechanical" means *the edit is the same everywhere* (add `active_both` to a status
set), **not** that the consequences are cosmetic. ⚠️ **Do not read this bucket as
"display".** Calling it that is what mis-triaged the whip writers into it (B5/B6), and
several members are behavioural:

- **Behavioural allowlists:** `coalitions/priorities.ts`, `coalitions/priorityApi.ts`,
  `nationalization/corpNationalizationThreat.ts`.
- **An admin WRITE path:** `api/admin/country/[code]/bills/route.ts` sets
  `active_other` directly.
- **Whip surfaces beyond the party-level routes:** the **caucus-level**
  (`parties/[id]/caucuses/[slug]/whip`, `.../whippable-bills`) and **regional**
  (`region/[id]/party/[partyId]/whip`) routes are separate files from the party-level
  ones. All of them reach the B5/B6 writers.
- **Genuinely display:** `billDisplays.ts`, `congressBillFilters.ts`,
  `nationalBillQueries.ts`, `billWhipPanelData.ts`, `whipDefiance.ts`,
  `proposeNationalBill.ts`, `parliamentaryGovernment.ts`, `publicApi/legislation.ts`, the
  bill-card / timeline UI set.

A missed allowlist is an invisible vote button; a missed writer is a corrupted tally.

⚠️ **`src/app/api/congress/bills/[id]/votes/route.ts` IS in the sweep**, contrary to
three earlier revisions that excluded it. The exclusion reason — "keyed on `?chamber=`,
not on status" — is true of the **vote map** it picks (line 75) and **false of
`resolveVoteOfficeType`** (line 36), which derives the *other* chamber's office type from
`bill.currentChamber`. Under `active_both`, `currentChamber` is pinned to the lower
chamber, so a `?chamber=other` request scopes the roster to the wrong house. It still
exports only `GET`, so this is a display defect rather than a write one — but "excluded"
was wrong, and it must take the **requested** chamber.

### The four structurally-blocking sites

These four are called out because a missed edit here fails **silently**, and three of
them sit upstream of work the previous revision described.

**B1 — NPP bills are never fetched.** `turn/npp/context.ts:213-233` builds
`ctx.activeBills` from an `$or` over four literal statuses, each paired with its own
deadline fields:

```ts
$or: [
  { status: "active",         ...billStillOpen("votingEndsOnTurn", "votingEndsAt") },
  { status: "active_other",   ...billStillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt") },
  { status: "veto_override",  ... },
  { status: "override_shugiin", ... },
]
```

An `active_both` bill is never returned, so **B2's loop never runs on it at all**. This
was missed by the previous revision, which specified a loop restructure downstream of a
query that never delivers the bill. `active_both` needs a branch here matching while
**either** chamber is still open.

⚠️ **`billStillOpen` returns two different shapes** (`context.ts:130-138`): `{ $or: [...] }`
when `currentTurn` is a number, and a flat `{ [dateField]: { $gt } }` otherwise.

Both naive fixes are wrong. **Spreading two results into one object literal** silently
drops the first — same `$or` key, invisible until the deadlines diverge. **Spreading
their `.$or` arrays** (`$or: [ ...openLower.$or, ...openUpper.$or ]`) throws a
`TypeError` on the flat branch, where `.$or` is `undefined` — worse, because it is a
crash rather than a quiet gap. Nest them instead:

```ts
{ status: "active_both", $or: [openLower, openUpper] }
```

which is correct for both return shapes and reads as "fetch while **either** chamber is
open".

**B2 — NPP voting resolves one office type, and accumulates into one counter set.**
`turn/npp/billVoting.ts:171-175` picks `relevantOfficials` from a single office type
derived from `bill.currentChamber`. For `active_both` it must union both chambers,
following the `vetoOverrideOfficials` pattern at lines 83-86, then select each official's
vote field from their own `officeType`.

**Smaller than earlier revisions implied:** `getOfficeTypeForChamber` at line 175 is
**already** country-aware, and the per-official country filter already exists (it is why
lines 161-166 exist at all). So the change is *unioning two office types and forking the
accumulator* — not adding country-awareness, which is already there.

**That is only half of it.** The write at lines 329-347 builds a single `setFields`
from one `voteField` and a single `incFields` triple chosen by `isOtherChamber`, and
`existingVotes` at 183-188 is likewise single-valued. The **accumulator group must fork
per chamber too**. Miss it and both chambers' NPP votes land in `votesFor` with
`otherChamberVotesFor` at zero — the identical fail-closed symptom, which means the
regression test prescribed below ("count non-zero votes in `otherChamberVotes`") would
still fail *after* the office-type fix. The two changes only work together.

Without B1 **and** both halves of B2 the upper tally is structurally empty and
`requireAll` fails every concurrent bill — the feature fails closed, looking exactly
like a legislature that voted no.

**B3 — the player write path refuses the status.** `src/lib/legislature/commands/nationalBillActions.ts:95-118`
409s anything that is not `cabinet_review` / `active` / `active_other` /
`override_shugiin`. Seven sub-changes, and the last four are easy to miss:

- Accept `active_both` in that guard.
- **Eligibility must accept either chamber** — lines 179-184 resolve the voter's
  `officeType` from `bill.currentChamber` and 403 everyone else. Note line 179 also
  maps `currentChamber === "joint"` to the lower key; the `active_both` branch must
  take the **voter's** chamber *before* that ternary, not after it, or a joint-origin
  bill silently forces every voter into the lower chamber.
- **The deadline checks would silently no-op.** Lines 88-93 derive
  `isCabinetReview`/`isOrigin`/`isOtherChamber` from the status; under `active_both` all
  three are false, so *both* guards at 102-118 are skipped and **late votes are accepted
  until the engine happens to close the bill**. This is a correctness hole, not a
  refusal — easy to miss precisely because nothing errors. `active_both` needs its own
  deadline check, against the pair matching the voter's chamber.
- **BOTH `updateOne` filters must accept it**, not one. Line 200 pins
  `status: "active_other"` and line 229 pins `"active"`/`"override_shugiin"`; the upper
  voter goes through the first and the lower through the second, so teaching only one
  leaves half the chamber getting "This bill changed before your vote could be
  recorded." (Revision 3 said "one must accept" — wrong.)
- Each branch calls `clearWhippedFromVote` with a **different field** —
  `otherChamberWhippedFromVote` vs the default (lines 220-226) — which must likewise
  follow the voter's chamber.
- **(6)** line 262 reads
  `previousVote = isOtherChamber ? bill.otherChamberVotes?.[charKey] : bill.votes?.[charKey]`,
  which gates `applyBillVotePolicyShift`. Under `active_both` `isOtherChamber` is false,
  so an upper-chamber voter's prior vote is looked up in the **lower** map — always
  absent — and the policy shift re-fires every time they change their vote. Missed at
  first because it is a read, not a write.
- **(7)** line 258's `recordAudit` writes
  `meta: { chamber: isOtherChamber ? "other" : "origin" }`, so under `active_both` every
  upper-chamber vote is logged as an origin vote. Same fork class; missed twice, for the
  same reason as (6).

**B4 — the engine has no dispatch for a third stage kind.** `engine.ts:144-196` filters
`config.stages` for `chamberVote`, then loops `executiveAction` and `override`
separately. A `concurrentVote` stage would be **silently never closed** — the bill
would sit at `active_both` forever. It needs:

- its own `closeConcurrentVoteStage`, with an expired-filter querying **both** deadline
  pairs — **ANDed, not ORed**. B1's *fetch* filter uses OR ("poll while either chamber
  is open"); the *close* filter must use AND, or the bill closes while a chamber is still
  voting. The two are not interchangeable and each is stated explicitly because the same
  two field pairs appear in both. (For a unicameral country `chambersFor` returns one
  office type while the builder still stamps both pairs, so the AND must ignore a
  deadline no chamber will ever tally — key it on `chambersFor`, not on which fields are
  present.)
- a `passedAtField` decision. `enterSigned` and `enterExecutive` both derive one
  `passedAtField` from a single `voteField`; a concurrent close has two chambers and
  therefore two passage moments. The stage sets `passedOriginAt` and
  `passedOtherChamberAt` together at close.
- **the post-pass DISPATCH, re-implemented — and nothing below it.**
  `execActionCheckOnPass` is read only inside `closeChamberVoteStage`, under
  `nextStage?.kind === "executiveAction"` (`engine.ts:533-537`), so a concurrent close
  must reproduce the dispatch at roughly `engine.ts:485-587`: the joint short-circuit,
  `nextStage` resolution, the `execActionCheckOnPass` branch, and then a call to
  `enterSigned` or `enterExecutive`.

  ⚠️⚠️ **STOP THERE.** An earlier revision listed "`enterSigned`/`enterExecutive`,
  `applyLegislationEffect`, `onBillEnacted`, the achievement award, the notifier and
  `recordTransition`" as if they were siblings. **They are not: the last five live
  *inside* `enterSigned`** (`engine.ts:775-786`). Followed literally, the close would
  call `applyLegislationEffect` *and* `enterSigned` — **double-enacting every bill**.
  `joinSide` is idempotent so Part 1 would survive it, but `onBillEnacted`,
  `awardLawmakerAchievementForSponsor` and the `result` counters are not. This is a
  caller/callee conflation that would have shipped as a real bug.

  **Implementation note:** `enterSigned` spreads `...fields` *before* `[passedAtField]`,
  so the two-passage-moments requirement is met by putting `passedOtherChamberAt` into
  `fields` and letting the function stamp `passedOriginAt` itself — no signature change.

  ⚠️ **This still contradicts Part 1's "the lifecycle engine needs no change"** — that
  sentence is true of `billRequiresExecutiveAction` as a predicate and false of the
  engine.

"No new counting code" was true only of `resolvePhaseVotes` itself; the close function
around it is new.

**B5/B6 — the two whip WRITERS, `applyPlayerWhip.ts` and `applyWhipVotes.ts`.**

⚠️ **These were triaged into the "mechanical sweep" and they belong here.** The sweep
bucket is described as "display strings, filters, whip routes, timeline steppers" — but
the *routes* are not the problem; the two library functions they call are, and those have
**B2's exact failure shape**, not a display one.

`applyPlayerWhipToBill` forks **four** things on `isOtherChamber` (`bill.status ===
"active_other"`):

| Fork | Lower branch taken under `active_both` |
|---|---|
| `voteField` | writes into `votes` |
| `snapshotField` | writes `whippedFromVote`, not `otherChamberWhippedFromVote` |
| `existingVotes` | reads the lower map, so prior votes are invisible |
| the `$inc` triple | adds weight to `votesFor`/`votesAgainst`/`votesAbstain` |

So a whipped **upper-chamber** member has their vote written into the lower chamber's
map, their weight added to the lower chamber's tally, and their snapshot written to a
field `nationalBillActions.ts:220-226` never clears for them. `requireAll` then fails an
upper chamber that recorded no votes while the lower tally carries phantom ones —
**silent tally corruption**, worse than the fail-closed cases, because the bill can
*pass* on votes cast by members of the other chamber.

`applyWhipVotes.ts` has **the same fork class minus the snapshot** — three forks, not
four: `voteField` (`:151`), `existingVotes` (`:157`) and the `$inc` triple (`:278`). It
writes **no whip snapshot at all**; `whippedFromVote` appears only in
`applyPlayerWhip.ts`. An earlier draft called the two "identical" and cited a "header
comment" saying so — the quoted string is at `applyWhipVotes.ts:332` and describes a
third, state/regional function in that file. Both claims are dropped: calling them
identical would send an implementer looking for a snapshot fork that does not exist.

Both fork on the voter's chamber under `active_both`, and both need the fix.

⚠️ **This design is what makes it reachable.** The whip routes
(`parties/[id]/whip/route.ts`) reach these functions, and this document *mandates*
adding `active_both` to the whip allowlists ("Whip panel and whip-defiance both treat
`active_both` as actionable"). Opening that door without forking these two writers ships
the corruption. **Do not add `active_both` to the whip allowlists in a change that does
not also fork these.**

The first grep (`rg -n '"active_other"'`) surfaces both files. The search worked; the
triage after it did not — which is the failure one step past the one predicate-plus-grep
was adopted to prevent.

### Country coverage

`COUNTRY_BILL_PHASES` (`src/lib/turn/countryPhases.ts`) covers 16 countries plus the US
special case: `UK DE JP IE CN RU DD PL CS HU RO BG YU UKR BLR BAL`. NATO's 1953 roster
is `US UK FR IT TR GR CA NL BE LU NO DK PT IS` — so **FR, IT, TR and GR are members with
no bill lifecycle at all**.

They are not player-enabled today, so the player-enabled skip happens to save it. That
is luck, not a rule. **The gate on spawning a mirrored bill is therefore
`player-enabled AND has a bill lifecycle`**, because an admin enabling France would
otherwise mint an `active_both` bill that no engine will ever close — a permanent zombie
on the floor. Members skipped for want of a lifecycle are logged, so the gap is visible
rather than silent.

⚠️⚠️ **"Has a lifecycle" is NOT "is in `COUNTRY_BILL_PHASES`" — that formulation
excluded the United States.** `COUNTRY_BILL_PHASES` holds exactly 16 keys and **`US` is
not one of them**: the US lifecycle runs separately, from `src/lib/billLifecycle.ts:30`
via `US_NATIONAL_CONFIG`. Written as a direct table lookup, the gate would have skipped
the US and logged it as a member with no lifecycle — in a document that simultaneously
asserts "NATO 1953 yields US and UK: two bills", registers the stage in `us.ts`, and adds
a US-only filibuster refusal. **The feature's most important belligerent would have
received no bill.**

So the check is a **named helper**, not an inline lookup:

```ts
// 17 countries have a national bill lifecycle: the 16 in COUNTRY_BILL_PHASES,
// plus the US, whose engine is invoked directly from billLifecycle.ts.
export function hasBillLifecycle(countryId: CountryId): boolean {
  return COUNTRY_BILL_PHASES[countryId] != null || countryId === "US";
}
```

⚠️ **And the prescribed test did not discriminate.** "A member with no
`COUNTRY_BILL_PHASES` entry gets no mirrored bill — asserted with France" **passes on the
broken implementation**, because France is excluded either way. This is exactly the
failure mode this document added to its own method section two revisions ago, committed
inside its own test list. The test list now pins **both** directions: France gets no
bill, **and the US does**.

Correspondingly, **"every other country config is untouched" was wrong**: the stage
must be registered in every national config that can receive one of these bills —
`us.ts`, `uk.ts`, `de.ts`, `ie.ts`, `jp.ts` and `oneParty.ts` (both branches).

### The mirrored bill must stamp its own window

`buildJoinConflictBill` inserts directly at `active_both`, exactly as
`src/lib/internationalOrganizations/commands/buildMembershipBill.ts:32-58` inserts at `active` — it does not enter through the
engine, so **`ConcurrentVoteStage`'s entry logic never runs for these bills**. The
builder is therefore responsible for the whole opening state:

- **Both deadline pairs** — `votingEndsAt`/`votingEndsOnTurn` **and**
  `otherChamberVotingEndsAt`/`otherChamberVotingEndsOnTurn`. Miss either and every
  upper-chamber vote is refused against an undefined deadline, and B1's fetch `$or`
  never matches that branch.
- **`otherChamberVotes` plus its three counters**, initialised alongside `votes`.
- **`originChamber`, or the engine never sees the bill.** `closeOverrideStage`'s expired
  filter pins `originChamber: { $in: config.originChambers }` (`engine.ts:215`), and
  `closeConcurrentVoteStage` needs the same scoping so one country's engine never claims
  another's bills. `buildMembershipBill` sets `originChamber` (line 39) and this builder
  must too — Revision 3's responsibility list covered `currentChamber` and missed this.
- **A defined `currentChamber`.** `active_both` has no single current chamber, but
  `src/lib/legislature/commands/nationalBillActions.ts:179` derives the voter's chamber from it, `buildMembershipBill`
  sets it, and the bill card, timeline and whip surfaces all read it. It is set to the
  **lower chamber**, matching every other bill's opening value, so unconverted readers
  degrade to "this is a lower-chamber bill" rather than to `undefined`. Every converted
  reader must take the voter's chamber instead — `currentChamber` is a display default
  here, never the authority.
- **A vote-open notification.** The engine calls `notifyChambersVoteOpen` on activation
  (`engine.ts:173`); a builder-inserted bill never passes through it.
  `buildMembershipBill` gets away without one because that bill is raised by the country
  itself. A Join Conflict bill lands **unbidden** in every qualifying member's chamber
  on a 24-turn clock, so the builder notifies both chambers explicitly. Without it the
  most likely outcome is a quorum nobody knew to attend.

  ⚠️ **`notifyChambersVoteOpen` has no country filter, and this prescription would
  amplify that.** Its query is
  `{ officeType: chamberType, characterId: { $ne: null }, isNPP: { $ne: true } }`
  (`lifecycleHelpers.ts:79-81`) — no `countryId`. Since the US, BR and others all share
  the `house`/`senate` office-type keys (the very collision `billVoting.ts:161-166`
  exists to work around), it **already** notifies across countries. Pre-existing, but
  calling it from this builder for every qualifying member across both chambers turns a
  latent leak into a visible one on this feature's flagship path — Brazilian legislators
  pinged about a NATO bill. **PR2 adds the `countryId` filter**, in the file it already
  touches. Small, contained, and knowingly shipping the fan-out without it would be
  choosing to amplify a bug this design surfaced.

  *(Earlier revisions said "up to fifteen legislatures" — roughly double. After this
  design's own player-enabled **and** has-a-lifecycle gate, NATO 1953 yields US and UK:
  two bills. The largest real fan-out is the Warsaw Pact's seven. The notification is
  still warranted; the number was not.)*

## The second inventory: provision type

**The status rule above does not reach this class, and it is the more dangerous of the
two** — every site here has a **catch-all fallback**, so a missed edit produces wrong
output rather than an error.

### The rule

> Every site that switches on `BillProvision["type"]` must handle `join_conflict`
> explicitly. Several of these chains end in a default that is silently wrong for an
> unknown provision.

### The search

```bash
rg -n '"declare_war"' src/     # 11 lines across 9 non-test files
```

`declare_war` is the right probe because it is the most recently added provision of the
same shape (foreign policy, executed on enactment, skips the executive). Revisions 1–3
of this document named **two** of them.

Two sites the earlier discussion skipped, both load-bearing here:

- **`billPassRule.ts:20`** — `billHasDeclareWar`. This design's "simple majority, not
  two-thirds" decision is enforced **by omission**: `join_conflict` is deliberately not
  added here. A decision enforced by absence needs an explicit test, or a later
  contributor "fixing the inconsistency" silently doubles the bar.
- **`validateDeclareWar.ts:62`** — scans pending `declare_war` bills as a **re-filing
  cooldown** ("re-filing it immediately would make the vote meaningless"), *not* the
  one-war-per-pair rule, which is `findWarBetween`. Either way it correctly does **not**
  match a `join_conflict` bill. Stated so nobody widens the query.

Note that `declare-war/route.ts:101`'s duplicate check also filters
`"provisions.type": "declare_war"`, so a `join_conflict` bill never matches it whatever
its status — that part of the mechanical sweep is a genuine no-op here. Harmless to
update for consistency; not feature-critical, and worth knowing so nobody hunts for a
symptom that cannot occur.

### The three that fail silently

- **`isPolicyProvision`** (`legislation.ts:314-333`) is **true by default**, and it has
  **two** consumers with different symptoms:
  - `billEnactment` writes the unhandled provision into a *policy record* with
    `legislationTypeId: undefined`. The `declare_war` line in that very chain carries a
    comment naming this exact trap ("the same trap the union_law branch documents").
  - `nationalBillActions.ts:268` filters a bill's provisions through it into
    `applyBillVotePolicyShift` — so without the exclusion, **every legislator who votes
    on a Join Conflict bill has their own policy positions shifted**, in whatever
    direction an undefined policy provision implies. Player-visible, unlike the first,
    and it fires on the vote rather than on enactment.

  One line fixes both: `join_conflict` joins the exclusion list. Both are named because a
  test written against only the enactment symptom leaves the voting one unproven.
- **`billEnrichment.ts` (~698-714)** and **`nationalBillQueries.ts` (~340-359)** both
  end their provision-label chains in a **subsidy catch-all**, each with an explicit
  comment that new types must sit above it. Without a branch, a legislator voting on
  "Entry into the Vietnam War (NATO)" reads a provision line formatted as a subsidy.
- **`billEnrichment.ts:952`** — a *second*, separate site in the same file: it calls
  `getBillPassRule(…, billHasDeclareWar(bill.provisions))` to compute the **displayed
  pass rule** for every enriched bill. This is what tells a player which bar an
  `active_both` bill faces, so it must agree with what `closeConcurrentVoteStage`
  actually applies — a display saying "two-thirds" over a simple-majority close is the
  kind of divergence this document refuses elsewhere. ⚠️ It also resolves
  `getCountryConfig(...)` **without a preset**; see the preset inventory.

Plus the ordinary, loud ones: the `BillProvision` union itself (`legislation.ts:296-311`)
and the `legislationEffects.ts` dispatch — whose tariff catch-all at line 218 is the one
earlier revisions did cover.

### `validateBillProvisions` must REFUSE it, not validate it

**This one is a privilege-escalation gate, and earlier revisions filed it under the
"ordinary, loud" list — which prescribes exactly the wrong thing.**

`billProposal.ts:116-128` refuses a hand-rolled `declare_war` provision outright, with
the reason spelled out in the source:

> "This path has no such gate — it only checks that the proposer holds a legislative
> seat — so accepting one here would let any backbencher take the country to war by
> hand-rolling a provision. Refused outright rather than validated."

Every word applies to `join_conflict`, and it is **worse**: a declaration of war at
least needs two-thirds, while this design deliberately keeps war entry at a simple
majority because the bloc vote is supposed to be the hard gate. Give it a validated
bucket in `validateBillProvisions` and any seated legislator can propose entry into any
conflict and carry it on 51% — bypassing the foreign-minister gate, the org membership
check, and the bloc vote entirely. The whole of Part 1 becomes optional.

So `join_conflict` joins `declare_war` in the **refusal** branch at the top of that
loop, with the same shape of message. The only writer of a `join_conflict` provision is
`buildJoinConflictBill`, called from the resolution's enactment.

### The helper

```ts
// src/lib/congress/billVoteField.ts
export function resolveBillVoteField(
  bill: Pick<Bill, "status">,
  voterOfficeType?: string
): "votes" | "otherChamberVotes" | "vetoOverrideVotes";
```

Every existing status returns what it returns today and ignores `voterOfficeType`, so
no current path can change behaviour. Only `active_both` consults it. It resolves the
vote-field class of sites; it does **not** resolve the allowlists, the fetch scope, or
the engine dispatch, which is what the first draft got wrong.

## The stage

A third `BillStage` kind in `src/lib/turn/billLifecycle/types.ts`, shaped after
`OverrideStage`:

```ts
export interface ConcurrentVoteStage {
  kind: "concurrentVote";
  status: string;                                  // "active_both"
  /** Office types voting simultaneously — one entry for a unicameral country. */
  chambersFor: (bill: StageBillContext) => string[];
  /** Vote map per office type. Lower → "votes", upper → "otherChamberVotes". */
  voteFieldFor: (bill: StageBillContext, officeType: string) => "votes" | "otherChamberVotes";
  passRule: PassRule;
  /** Every listed chamber must clear the bar — the `stage.chambers.every` of OverrideStage. */
  requireAll: true;
  onPassStatus: string;
  votingDurationHours: number;
  execActionCheckOnPass?: boolean;
}
```

At close the engine calls the existing `resolvePhaseVotes` once per chamber — a named
vote field scoped to an office type, which is what it already does. All chambers pass →
`onPassStatus`; any chamber fails → the bill fails. Both chambers' snapshots are frozen
at close, so a later election cannot drop the members who actually voted (#0982) — and
they are separate fields (`voteSnapshot`, `otherChamberVoteSnapshot`), so calling the
evaluator twice does not collide.

⚠️ **Correction: "the nat/priv and filibuster supersedes keep working" was false.**
Nat/priv holds — it is provision-driven. **Filibuster does not**, in three linked places:

- `nationalBillActions.ts:494-496` — invoking requires `status === "active"` or
  `"active_other"` **and** `currentChamber === "senate"`. Under `active_both`, with
  `currentChamber` pinned to the lower chamber by this design's own builder rule, neither
  holds.
- `nationalBillActions.ts:555-559` — `deadlineField`/`deadlineTurnField` fork on
  `isSenateOther`, so a Senate filibuster would extend the *lower* chamber's deadline.
- `engine.ts:93-99` — `evaluatePassRule` gates cloture on `bill.currentChamber ===
  "senate"` and takes the whole bill, so it is structurally chamber-blind; a
  per-chamber concurrent close cannot route through it unchanged.

  ⚠️ **`tallyFields` is fine, and an earlier draft said otherwise.** It is
  *parameterised* by `voteField` (`engine.ts:104-121`) and returns that chamber's three
  counters plus its own frozen snapshot — so calling it once per chamber and merging the
  results is exactly right, and it needs no change. Found while writing the PR2 plan
  against it.

**Decision: a Join Conflict bill is NOT filibusterable, and the code says so.** War entry
at a bloc's call is a treaty obligation on a 24-turn clock, and this design already keeps
it at simple majority because the bloc vote is the hard gate; letting one senator run out
that clock would hand a single player a veto over the alliance. The invoke path gains an
**explicit refusal naming the reason**, rather than falling through to the existing
"only on a bill actively being voted on in the Senate" message — which would be an
accidental refusal that reads like a bug.

**Scope: the filibuster path is US-only.** `nationalBillActions.ts:487` refuses the
action outright for any `countryId !== "US"`, *before* the status and chamber checks. So
the three broken places above affect US bills alone, and the explicit refusal is added
inside that US branch. **Sixteen of the seventeen** countries that can receive one of
these bills were never affected — the 16 in `COUNTRY_BILL_PHASES` plus the US, which is
the one that is.

**How `passRule` is honoured — the interface field is not decorative.**
`ConcurrentVoteStage` carries `passRule: PassRule`, and the close applies it through the
pure `meetsBillPassRule` (`billPassRule.ts`) per chamber, **not** through
`evaluatePassRule`. That is the whole distinction:

- `evaluatePassRule` (`engine.ts:93-99`) bundles the pass rule *with* the Senate cloture
  check and is structurally chamber-blind — it is the function the filibuster decision
  declines to make chamber-aware.
- `meetsBillPassRule` is the rule alone, already used by every other pass path, and
  applies cleanly to a per-chamber tally.

⚠️ **`closeConcurrentVoteStage` must call `getBillPassRule` ITSELF.** Within the engine,
`getBillPassRule` is reached only from inside `evaluatePassRule` (`engine.ts:86`), and
`meetsBillPassRule` takes a rule and derives nothing.

*(Precisely: it has three consumers — `engine.ts:86`, **`billEnrichment.ts:952`**, and
`NationalizationProvisionEditor.tsx:187`. An earlier draft said "only from inside
`evaluatePassRule`", which is true engine-side and false globally. See the display
consequence below.)* Prescribing `meetsBillPassRule` alone while leaving
`evaluatePassRule` untouched would mean **nat/priv never supersedes at `active_both`** —
the close would apply the stage's declared `simpleMajority` to a bill the rules say needs
two-thirds. So the close resolves the rule per bill (`getBillPassRule(governmentType,
hasNatPriv, hasDeclareWar)`) and then applies it per chamber via `meetsBillPassRule`.

Moot for `join_conflict` itself — it carries neither provision — but PR2 ships this stage
as reusable and its own tests hand-insert arbitrary bills at `active_both`, so the gap
would be live the first time anything else adopts it.

With that, nat/priv supersedes, cloture does not apply, and the field means what it says.
`evaluatePassRule` and `tallyFields` are untouched.

### `chambersFor` is `getJointSittingOfficeTypes`, full stop

**Correction.** Revisions 1–3 said to key on `legislature.bicameral` *and* to reuse
`getJointSittingOfficeTypes`. Those are not the same rule, and the difference fails
closed on a real country.

`getJointSittingOfficeTypes` gates on `config.legislature.upperChamber &&
config.upperElectionSystem` (`src/lib/legislature/chamberOfficeType.ts:77-85`).

⚠️ **Germany's numbers, settled on the third attempt.** Two independent fields matter and
earlier revisions each read one of them:

| Preset | `bicameral` | `upperElectionSystem` | `bicameral` rule | `getJointSittingOfficeTypes` |
|---|---|---|---|---|
| base / 1979 / 1991 | `false` (`countries.ts:1115`) | `undefined` (`:1139`) | 1 chamber | 1 chamber |
| **`1953-default`** | **`true`** (`:6043`) | `undefined` (inherited — the override replaces the whole `legislature` object but sets no `upperElectionSystem`) | **2 chambers → upper tally structurally empty → `requireAll` fails every German bill** | 1 chamber ✓ |

So the two rules **diverge for Germany under `1953-default` only**, and that is the exact
fail-closed symptom B1 and B2 exist to prevent — in the preset this whole design is
about, in a country that is player-enabled and has a `COUNTRY_BILL_PHASES` entry.

⚠️ **Germany is NOT in NATO's 1953 roster** (`US UK FR IT TR GR CA NL BE LU NO DK PT IS`
— the FRG acceded in 1955, and the 1979 roster is where it appears). An earlier draft of
this paragraph said it "sits in NATO", contradicting this document's own roster listing.
The finding stands and is arguably sharper for it: DE reaches a Join Conflict bill by
**in-play accession** during a 1953 game, which is the case least likely to be exercised
in a fixture and most likely to surprise.

**The prescription is unchanged: `getJointSittingOfficeTypes` is authoritative.** Its own
doc comment states the intent — appointed and advisory chambers (UK Lords, CN CPPCC) are
excluded — which is the property that matters: *does this chamber have members who can
cast a vote*, not *does the constitution have two houses*. And note it returns 1 for
Germany under **every** preset, so the prescribed rule is preset-insensitive here even
though the country is not.

**What each revision got wrong, since this claim has now been restated three times:**

- Revision 4 said the 1953 override sets `bicameral: true` and made preset-dependence
  live. **Right**, and it should not have been withdrawn.
- Revision 5 found `upperElectionSystem: undefined` in the **base** config — a true fact
  — and concluded from it alone that DE is era-invariant and the divergence spans every
  era. **Wrong**: it never read `bicameral`, which is `false` in the base.
- This revision reads both. Germany **is** the live preset-dependent case; the divergence
  is 1953-only.

The genuinely preset-dependent countries for chamber count are therefore **DE**, **TR**
and **ES**. ~~FR~~ is **not** — its base config already defines `upperElectionSystem`
(`countries.ts:3938`) alongside `bicameral: true`, and the 1953 override merely changes
the Sénat's term length, so FR yields two chambers under every preset.

### The stage cannot currently see the preset

`getJointSittingOfficeTypes(countryId, preset?)` takes a preset, and `StageBillContext`
is `{ currentChamber: string; countryId?: CountryId }` (`billLifecycle/types.ts:19-22`).
There is no preset on it.

Either `StageBillContext` widens to carry it, or the engine resolves it once per run and
passes it into the stage callback — the engine already loads game state for its
`skipWhenGovPending` check, so resolving it there is cheap.
`nationalBillActions.ts:52-63` already threads a preset correctly and is the model to
copy — ⚠️ **but the same function drops it 119 lines later.** `:182` calls
`getOfficeTypeForChamber(countryId, chamberType)` with **no preset**, while `:63` passes
one. That call is the voter-eligibility lookup **inside the block B3 mandates
rewriting**, so an implementer copying the surrounding line inherits the defect on the
player write path. `getOfficeTypeForChamber`'s own doc comment names *"TR 1953 unicameral
vs 1979 bicameral"* as the reason the parameter exists — and TR is one of the two
countries this document's own preset-sensitivity test targets.

*(Raised during the ninth review and reported only in prose, never folded into this
document; it survived five further rounds as a result. Recorded here so the fix travels
with the spec rather than with a conversation.)*

⚠️ **Teaching only the stage callback leaves 12 of the 17 eligible countries
preset-blind**, and an earlier draft named just one adjacent consumer (`engine.ts:87`).
The one-party path builds its **entire config** from flattened lookups:

- `onePartyBillLifecycle.ts:64` and `:98` read `COUNTRY_CONFIGS[countryId]` directly.
- `oneParty.ts:79` derives `upperKey` — **and therefore `originChambers`** — from that
  flattened object, and `:85`'s `officeTypeFor` drops the preset too.
- `npp/billVoting.ts:175` likewise, and that line is already on B2's edit path.
- **`congress/bills/[id]/votes/route.ts:31-41`** — `resolveVoteOfficeType` calls both
  `getCountryConfig(countryId)` and `getOfficeTypeForChamber(...)` with no preset. This
  document already moves that route into the sweep for taking the *requested* chamber;
  **the same edit must carry the preset**, or the fix reproduces the exact defect the
  TR/ES preset-sensitivity test targets.
- **`billEnrichment.ts:952`** — resolves the config without a preset while computing the
  displayed pass rule (see the provision inventory).

`originChambers` matters here specifically: `closeConcurrentVoteStage` scopes its
expired-filter on `originChamber: { $in: config.originChambers }`, so a preset-blind
`upperKey` makes the close's scoping preset-blind for CN/RU/DD/PL/CS/HU/RO/BG/YU/UKR/
BLR/BAL.

**Inert today** — CN is unicameral under both presets, RU bicameral under both — but that
is exactly the "the helper happens not to care for the countries we ship today" property
this document refuses to depend on two paragraphs above, for TR and ES. **`originChambers`
is in scope for PR2**, since PR2 is where the close is written.

**Priority: required, on a narrower basis than "it breaks today."** The earlier
justification — "no country that can currently receive one of these bills changes chamber
count with the preset" — is **false**: Germany does, in `bicameral`. The conclusion
survives for a different and weaker reason: the rule this design prescribes
(`getJointSittingOfficeTypes`) returns 1 for Germany under every preset, so *this*
implementation does not break if the preset is dropped.

It is still required, because that immunity is incidental. TR and ES flip
`upperElectionSystem` between presets, so either gaining a `COUNTRY_BILL_PHASES` entry
turns a missing preset into a silently wrong chamber count rather than an error — and
"the helper happens not to care for the countries we ship today" is not a property worth
depending on.

## Scope

Only the `join_conflict` bill is filed into `active_both`. Every other bill keeps its
existing phase graph, and every other country config is untouched. The stage is
reusable later (mobilisation, emergency powers) but nothing else adopts it here.

`Bill["status"]` gains `"active_both"`, and every status-switch that enumerates
statuses for display gains a case for it.

**Planning note.** Class C is where this stops being additive. The re-inventory should
be done by grepping for the **status allowlists** (`=== "active"`, `"active_other"`
membership tests, status arrays and `Set`s), not only for vote-field ternaries — that
is what the original draft missed, and both blocking paths were in the class it did not
search for.

---

# Part 3 — Cold War Conflicts

## The type

```ts
export type ConflictType =
  "interstate" | "intervention" | "civil_war" | "independence" | "cold_war";
```

A proxy war fought on third-party soil. The two sides are internal factions; the blocs
back them through `ConflictSide.backer` ("west" | "east"), which already exists and
already drives `blocOfSides` → `ConflictDoc.bloc` → the map pin's colour.

## Model changes

Three additive optional fields on `ConflictDoc`, **plus one type widening that the
original draft wrongly claimed was unnecessary**. No data migration — the three new
fields are absent on every existing conflict, and the widening is source-compatible
(every existing `hostCountry` value stays valid).

```ts
/**
 * Every third-party country in the theatre — the roster that changes bloc when the
 * war resolves. `hostCountry` remains the single map anchor.
 */
hostEntities?: WorldEntityId[];
/** `cold_war`: which side currently holds 100% of the host territory. */
poleSide?: "A" | "B";
/** `cold_war`: the turn that side reached the pole. Cleared if it comes off. */
poleSinceTurn?: number;
```

### `hostCountry` must widen to `WorldEntityId`

**Correction.** The original draft said `hostCountry` was unchanged and then gave
`hostCountry: "SVN"` as the worked example. That does not compile: `hostCountry` is
typed `CountryId`, a closed 29-member union
(`US UK DE JP IE BR CN NG HU PL RO YU BG BLR UKR CS BAL RU FR IT ES SE TR GR AT FI DD SCO WAL`).
`VN`, `NVN`, `SVN`, `KR` and `KP` are none of them.

Keeping `CountryId` and requiring the anchor to be a playable country does not rescue
the design either — there is no playable country anywhere near Vietnam, so the flagship
example would have no legal anchor. So `hostCountry` widens to `WorldEntityId`,
following the same precedent as `OrgMemberId`.

**What that touches, and one latent bug it exposes:**

- **`region` derivation — this is the sharp edge.** `buildConflict` does
  `homeRegionOf(input.hostCountry) ?? "noa"`. `COUNTRY_HOME_REGION`
  (`src/lib/military/regionTopology.ts`) has `VN: "sea"`, `KR: "eas"` and `KP: "eas"` — but **no `NVN`
  or `SVN` rows**. A Vietnam proxy war would therefore fall through to `"noa"` and be
  **filed in North America**, silently, with a map pin in the wrong hemisphere.

  **Two change items, not one aspiration.** Revision 3 left the second as a "should"
  outside the change list, which is how it would have been skipped:
  1. Add a `COUNTRY_HOME_REGION` row for every intended proxy-war host (`NVN`/`SVN` →
     `"sea"`). A hard prerequisite.
  2. **`buildConflict` throws when `type === "cold_war"` and `homeRegionOf` misses**,
     instead of falling back to `"noa"`. It stays pure — a throw is not I/O — and the
     admin create route is where that surfaces as a validation error. Without it, rule 1
     is a convention nothing enforces, and the failure is silent by construction.
- `initialControl(hostCountry: CountryId, …)` widens its parameter. Its body does
  `sideA.countries.includes(hostCountry)` against a `CountryId[]`, which **will not
  compile** with a `string` parameter — the roster comparison needs an explicit widening
  (`(sideA.countries as string[]).includes(...)`), matching how `opposedBelligerents`
  and `sideOf` already cast in the same file.
- `occupationOf` / `OccupationView.host: CountryId` (`occupation.ts:146-169`) widen too,
  and it has the **same compile break as `initialControl`** — lines 161-162 both
  do `.includes(c.hostCountry)` against `CountryId[]`. Revision 3 listed this as "widen
  too" without noting the break.
- `BuildConflictInput.hostCountry` (`createConflict.ts:56`) — the input type, distinct
  from the document field, and missed by Revision 3's inventory.
- `regionCodesOfCountry(db, countryId: CountryId)` widens. It queries `states` by
  `countryId` and filters to drawable codes, so an entity with no rows returns `[]`.
- `COUNTRY_ANCHOR` / `anchorOf` already take a plain string and return `undefined` for
  an unknown key, which `FrontMap` handles.
- `COUNTRY_CONFIGS[hostCountry]?.name` lookups for display must go through a
  null-tolerant label helper — `entityLabel.ts` already exists for exactly this in the
  org UI.

**`WorldEntityId` is `string`**, so the widening is source-compatible — and it removes
all compile-time checking on the field. Validation therefore moves to the **admin
creation boundary**, which is the only writer: host entities are checked against the
world entity manifest there, once, rather than trusted everywhere downstream.

For Vietnam: `hostCountry: "SVN"`, `hostEntities: ["NVN", "SVN"]`, with `NVN`/`SVN`
added to `COUNTRY_HOME_REGION` as `"sea"`.

## Merged host geometry

`hostRegionCodes` is already a plain `string[]` handed to `useRegionGeometry`, and that
hook already loads and merges shards across more than one file. So a multi-host conflict
is `regionCodesOfCountry` over every host entity, flattened and deduped. The occupation
bar stays a single 0–100 track over the combined territory, which is the right reading:
a proxy war is one front, not two.

⚠️ **Two producers and two consumers, not one of each.** Revision 3 named
`[conflictId]/page.tsx` and `FrontMap.tsx` and stopped — the same list-instead-of-rule
lapse Part 2 exists to prevent, for the third time in this document.

> **Rule:** every site that produces or consumes `hostRegionCodes` handles multi-host
> conflicts and the static-feature source.

```bash
rg -n 'hostRegionCodes|useRegionGeometry' src/
```

- **Producers:** `[conflictId]/page.tsx:287` and **`combat/page.tsx:143`** — miss the
  second and the combat hub draws only the anchor for a multi-host war.
- **Consumers:** `FrontMap.tsx:48` and **`FrontLineMap.tsx:104`** — miss the second and
  the front-line map is blank for Vietnam while the territory map renders.

### Static host features — the deferral is withdrawn

**Correction, and the most consequential one in this revision.** The previous draft
deferred proxy-war geometry, claiming `NVN`/`SVN` had no data and that seeding `states`
rows later would fix it with no code change. Both halves were wrong.

**The geometry already exists.** `src/lib/maps/vietnamGeometry.ts` serves
`/vietnam-regions.json` with feature ids `NVN` and `SVN`, split at the 17th parallel by
`scripts/maps/build-vietnam-geo.mjs`, plus `VIETNAM_BASE_FEATURE_ID = "704"` (unified
Vietnam) which the two halves replace.

**And the deferral's exit was blocked.** That module's header states it sits outside
`REGION_SHARDS` deliberately, because shard entries are drawn by unioning regions whose
owner is read from `states`, and *"NVN and SVN are sphere-macro, so ownership could
never resolve for them without promoting both to full countries."* Seeding `states` rows
therefore requires exactly the entity promotion this spec lists as out of scope. The
claim that the code "is correct the moment that data exists" was not established.

**So the front map reads static features directly.** `FrontMap` gains an optional
static-feature source alongside `hostRegionCodes`:

```ts
staticFeatures?: { url: string; featureIds: readonly string[]; replacesBaseId?: string };
```

resolved per host from a small `PROXY_HOST_GEOMETRY` table keyed on entity id (Vietnam
today; Korea and Angola when their builders land). The globe already consumes these
constants the same way, so this is a second consumer of a shipped pattern, not new
machinery. `useRegionGeometry` keeps serving `hostRegionCodes` for playable hosts.

⚠️⚠️ **Merging the FEATURES is not enough — both consumers filter by a ROSTER too, and
an earlier draft stopped one layer short.** Passing merged features while the roster
stays empty renders **nothing**:

- `RegionalGeoMap` builds `new Set(regionCodes)` and drops every feature whose
  `properties.regionCode` is not in it (its own comment: "renders ONLY the regions in
  `regionCodes`"). `FrontMap` passes `regionCodes={hostRegionCodes}` — and for an
  `NVN`/`SVN` host `regionCodesOfCountry` returns `[]`, as this document says itself.
- `FrontLineMap` does the same filter inline, against a `Set` built from its own
  `codeKey`.

**So the static feature ids must be appended to the roster as well as to the features**,
in both components. The features themselves are fine: `build-vietnam-geo.mjs` stamps
`properties.regionCode`, so `regionData` and `occupiedCodes` key correctly once the
features survive the filter.

⚠️ **And the promised degradation would NOT have fired.** `hasGeometry` keys on
`features` being non-empty — which it now is — so the "no mapped territory, meter only"
fallback is skipped and the player gets an **empty map box** instead. Worse than the
deferral it replaced. The fallback must key on the *post-filter* feature count, not on
the merged input.

**Two box tables, not one.** `MAP_BOX` (`FrontMap`) **and `FRONT_BOX`
(`FrontLineMap`)** each need an entry per proxy-war host — copied from that country's
real map config where one exists, **not invented**, which is how `MAP_BOX` went wrong
before. An earlier draft named only the first.

A host with neither shard codes nor a static entry still degrades to the meter alone.

## The three-turn hold

Today `applyOccupation` (`src/lib/turn/battleResolution.ts`) calls `resolveConflict`
the instant `control` reaches 0 or 100. For a `cold_war` conflict it instead:

- stamps `poleSide` + `poleSinceTurn` when control first reaches a pole,
- clears both if control moves off the pole,
- and does **not** resolve.

Resolution is then decided by a new turn step, `resolveColdWarHolds(db, currentTurn)`,
which sweeps active `cold_war` conflicts and resolves any whose
`currentTurn - poleSinceTurn >= COLD_WAR_HOLD_TURNS` (3).

**Where it is wired, and its gate.** It is called from `ministerialOrderProcessing.ts`
(step 4b-ii), beside `resolveBattleDeclarations` — which runs once, globally, at line
340. ⚠️ **It must read `conflictsEnabled` at the step itself.** Every existing conflict
turn-step is gated *upstream*: `resolveBattleDeclarations` carries a comment saying it
relies on the flag having been checked at declare time, which is sound because a
declaration cannot exist without passing that gate. `resolveColdWarHolds` is reached from
`poleSinceTurn` alone, with no declaration upstream of it, making it **the first conflict
turn-step with no upstream gate**. Turning the flag off must stop it, so it checks
directly.

⚠️ **There is no `isConflictsEnabled` helper to reuse.** `intOrgAlignmentEnabled` has one
(`isIntOrgAlignmentEnabled`, fail-closed, accepting a preloaded projection), but
`conflictsEnabled` is read inline everywhere — the fail-closed reference read is
`battleAuthz.ts`. Follow that read rather than inventing a third pattern; extracting a
matching helper is optional and, if done, belongs in PR1 where the flag is first touched.

**`hostEntities` falls back to `[hostCountry]` everywhere it is read.** The admin
control can omit it (a single-host proxy war is the common case), and the field is
optional on every pre-existing document. A missing array must mean "just the anchor",
never "no countries change bloc" — the latter would make the whole outcome a silent
no-op.

### The factions: generated sides with a token force

**The gap this closes.** The previous revision never said what `ConflictSide.kind` the
factions carry, and four behaviours fork on it. Worse, whichever it was, the conflict
was **inert**: `battle/declare/route.ts:71` resolves the *target* with
`belligerentSideOf`, which is roster-only by deliberate design (its comment: "you can
only attack somebody already in this war, or a belligerent could drag in a bystander").
With `countries: []` every declaration 400s, `applyOccupation` never runs, and
`control` — which the entire hold → resolve → admit → align chain hangs off — can never
move. Every test would have passed.

**Model.** Both factions are `kind: "generated"` with `countries: []`, plus two new
fields on `ConflictSide`:

```ts
/** Faction sides: the world entity this faction represents — the declarable target. */
factionEntity?: WorldEntityId;
/** Faction sides: weight of the token force it brings. Small by design. */
tokenStrength?: number;
```

`countries: []` is preserved, so the `generated` contract in `ConflictSide` and
`createConflict`'s `baseStrength`/`severity` derivation are both untouched. A bloc
member joining via `joinSide` pushes onto `countries`; `kind` **stays** `generated`,
because the faction is still what the side fundamentally is.

**Declaring against a faction — TWO resolvers, not one.**

⚠️⚠️ **This is the fourth distinct reason this conflict would have shipped inert, and
the previous three fixes all sit downstream of it.** Widening `belligerentSideOf` gets
the declaration *accepted* at `declare/route.ts:71`. It does not get the battle
*placed*, because placement happens somewhere else:

- `mergeOffensives` (`coalition.ts:71-72`) resolves **both** ends through **`sideOf`**,
  not `belligerentSideOf`.
- `sideOf(conflict, "NVN", blocs)` finds it in neither roster (`countries: []`), falls
  back to `blocOf`, and a non-playable macro entity is in no bloc — since #4001 that
  returns `nonAligned` rather than the old US row, so it matches no backer and the
  function returns **`null`**.
- So `resolvable` is false and the offensive is built with `side: null,
  enemySide: null`.
- At `battleResolution.ts:247-251` a null `enemySide` takes the else arm, which reads
  `unitsByCountry` — and the token force is synthetic by design, so `defenders` is `[]`.
- Line 258 takes the walkover branch, and line 263's `if (off.side)` is **also null**,
  so `joinSide` never runs and **`applyOccupation` never runs**.

`control` does not move. `buildFactionSide`, the shared defenders helper and the
`tokenStrength` decrement are all downstream of a branch that is never taken.

**Both resolvers need the `factionEntity` clause** — or, better, one faction-aware
resolver both call, so they cannot drift the way `sideOf` and `belligerentSideOf`
already have.

⚠️ **And a third gate sits upstream of both, in two routes.** Naming
`.../cabinet/[positionId]/battle/declare/route.ts:52` alone leaves the forecast broken:

> **Rule:** every route that resolves a *target* for a conflict action must accept a
> world entity, not only a `CountryId`.

```bash
rg -n 'COUNTRY_CONFIGS\[targetCountry\]' src/app/api
```

`.../cabinet/[positionId]/battle/forecast/route.ts:52` carries the **byte-identical** guard — its own comment says
"the same gate the declare route applies" — and it runs *before* `belligerentSideOf` at
`:70` and `defendersAtFront` at `:119`. So a forecast against `NVN` 400s at line 52, and
this document's mandated test ("the forecast and the resolution agree about a faction
front") is **unpassable**. Caught only on the eighth review: the downstream half of this
very file was already named, and the guard eighteen lines above it was not.

⚠️ **`sideOf` is the permissive one, and that has fog consequences.** The two functions
differ deliberately: `belligerentSideOf` is roster-only *because* visibility must not
inherit `sideOf`'s bloc fallback (the doc note on `conflictVisibility.ts` says so
outright). Adding faction matching to `sideOf` widens the function that already places
unrostered bloc members. The clause must therefore be **exact-match on `factionEntity`
only** — never a bloc-derived guess — so it grants placement to the faction itself and
to nobody else.

**The walkover gate has a third producer.** The "one shared helper" rule stated below
covers `defendersAtFront`'s two callers, but `defenders` at `battleResolution.ts:247-251`
is a **ternary**: `defendersAtFront` is only the `off.enemySide` arm. The else arm builds
the same value from `unitsByCountry` and feeds the same `length === 0` gate. A helper
installed only at the two `defendersAtFront` sites still returns `[]` for a faction
through that arm.

**On `belligerentSideOf` itself:** ⚠️ it has 6 non-test call sites, not one — "one
clause" was asserted without the inventory discipline Part 2 insists on everywhere else,
so each is checked rather than assumed.

⚠️ **ONE of those sites feeds `conflictTier`** — `[conflictId]/page.tsx:99`, whose
`ownSide` is consumed by the single production `conflictTier` call at `:184`. That is
**command-sight authorisation**, the fog rule this codebase treats as its sharpest edge,
and the clause is safe there only because no player country's id can equal a
`factionEntity`.

*(An earlier draft said two sites, naming `combat/page.tsx:68` as the second. That call
builds `sideByConflict` for `groundFor` — which direction a battle report's ground delta
reads for the viewer — not visibility. The 6-site inventory is right; the fog exposure is
one site. Corrected so nobody hunts for a second fog consumer that does not exist.)* That is currently an accident, not an
invariant: the admin create route's validation list (manifest membership +
`COUNTRY_HOME_REGION`) does not check it. **It gains a collision check** — a
`factionEntity` may not be a `CountryId` — and a test pins it. Without that, seating a
faction on a real country's id would hand its order of battle to anyone.

**Battle reports must name the faction.** `battleResolution` writes `defenders` (the
`CountryId[]`) into the report document, so a battle fought against a token force would
be recorded with an **empty defender roster and a real result**, and the conflict record
page renders exactly that. The report carries the `factionEntity` for a synthetic
defender. `COUNTRY_CONFIGS[targetCountry]` at
`.../cabinet/[positionId]/battle/declare/route.ts:52` widens to accept a world entity. A player declares on *North
Vietnam*, which is what they would expect — no second "declare against a side"
addressing mode. The bystander rule the original comment protects is intact: a faction
entity is named on the conflict, so it is not a bystander.

**The token force is synthetic, not `militaryUnits`.** `MilitaryUnit.countryId` is
typed `CountryId` and is grouped by country in `aggregateForce`, the national-metrics
channel and the cabinet UI. Giving a faction real unit rows would mean widening that
field and auditing every consumer for a faction's army leaking into some nation's power.

⚠️⚠️ **CORRECTION — Revision 4 pointed this at the wrong machinery entirely, and as
written it would have left the conflict inert after all.** That revision said the
contingent comes "from `baseStrength`/`enemyMix` via the existing `buildEnemy`", needing
only a strength parameter. Every part of that is wrong:

- **`buildEnemy` is not on the live path.** It has exactly one consumer —
  `battle.ts:489`, inside `forecast()`, the PvE preview. Turn resolution runs
  `resolvePvpBattle(attackers: BattleSide[], defenders: BattleSide[], …)`
  (`battle.ts:845`). The comment at `battle.ts:707` says so outright: *"Both sides are
  real units; the 'enemy' aggregate comes from the defender's live units, not
  buildEnemy."*
- **The types do not meet.** `buildEnemy` returns `EnemyUnit[]`; `defendersAtFront`
  returns `CountryId[]` (`coalition.ts:117-132`) and the walkover gate is
  `defenders.length === 0`. No `EnemyUnit[]` can make that non-empty.
- **`buildEnemy` never reads `baseStrength` anyway** — `count = 3 + floor(r()*2)`,
  `cv = (45 + r()*75) * grade`, `front.enemyMix` and nothing else.

So the token force is built where resolution actually happens:

**1. A synthetic `BattleSide` factory** — `buildFactionSide(conflict, side, front)` in
`battleSides.ts`, beside `buildCoalitionSide`. It returns one `BattleSide` whose
`country` is the side's `factionEntity`, with in-memory `CombatUnit`s minted from
`enemyMix` and scaled by `tokenStrength`, and with empty `assignments`, `generalsById`
and `positions`, neutral `natMods` and `countryScale: 1`. Nothing is inserted anywhere.

**2. The walkover gate changes — in BOTH places that compute it.** Today
`defenders.length === 0` means "nobody home, advance unopposed". It becomes: no
defenders **and** no faction token force on the defending side.

⚠️ **This is a two-site class, and naming only one breaks a stated invariant.**
`defendersAtFront` has exactly two non-test callers:

```bash
rg -n 'defendersAtFront|length === 0' src/
```

- `battleResolution.ts:248` — live resolution.
- `battle/forecast/route.ts:119` — the war-room forecast, which computes
  `unopposed = defenderCountries.length === 0` from the same roster.

Fixing only resolution means the war room reports **`unopposed: true`, 0 enemy
contingents** while the tick fights the token force and takes losses. The forecast
route's own comment states the invariant it would break: *"a forecast can never disagree
with the outcome it predicts."* So both call **one shared helper** — "the defending
sides at this front, including any faction token force" — rather than each growing its
own branch.

**3. `persistSide` is skipped for it.** `persistSide` (`battleResolution.ts:46`) bulk-
writes `militaryUnits` filtered on `countryId: side.country` and credits general XP; a
synthetic side has neither, so it must be bypassed explicitly rather than left to write
nothing by luck.

**4. The faction's losses persist in their OWN conflict write.**

⚠️ **Correction: this cannot ride on `applyOccupation`'s `$set`, as the previous
revision said.** Two reasons, either fatal:

- `applyOccupation` **early-returns at line 133** when `control` does not move, *before*
  the `$set`. Every low-margin battle — and **every** battle once the front is pinned at
  a pole, which is exactly the state the three-turn hold is about — would skip the write
  entirely. A stalemated proxy front would grind the token force every turn and record
  nothing: the immortal wall this mechanism exists to prevent, restored by the
  bookkeeping.
- `applyOccupation` takes no casualty data. Threading it in means a signature change the
  previous revision never listed.

So `tokenStrength` decrements in its own `updateOne` on the conflict, beside the battle
report insert, sourced from the synthetic side's `SideOutcome` losses and floored at
zero. At zero the side is a walkover again.

**Related pre-existing rot, found here and NOT fixed by this design:** `Front.enemyBase`
(`combat.ts:577`) is written by `conflictToFront` from `ConflictDoc.baseStrength` and
**read by no production code** — the same shape as the inert supply fields the occupation
work found. `tokenStrength` deliberately does not reuse it; reviving a dead field by
overloading it would hide the rot rather than record it. Retiring `enemyBase` is its own
cleanup, and it has exactly one assertion to update (`createConflict.test.ts:80`) — a
test that pins a value nothing consumes, which is the tell.

*(The alternative — real unit rows owned by the host entity — was rejected on that
blast radius, not on modelling grounds. If factions later need player-visible
order-of-battle, that is the upgrade path.)*

**Consequences, all of which are what you asked for:**

- **The faction defends automatically.** A side with `tokenStrength` is never "nobody
  home", so the walkover branch (`battleResolution.ts:258-273`) no longer advances a
  bloc unopposed against an unbacked faction — it has to fight through the token force
  first.
- **It joins its patrons' battles automatically**, on both attack and defence: the
  contingent is appended to whichever side it belongs to, so a bloc offensive on that
  side fights alongside it.
- **It cannot attack on its own**, by construction rather than by a check. Filing a
  declaration requires `canActAtTheater` — a defence seat holder, a posted general or
  an admin — and a non-playable entity has none of them. Worth stating so nobody adds
  a redundant guard.

### Part 1 is the only door into a proxy war

**The bypass this closes.** `sideOf` resolves an unrostered country by matching its bloc
against the sides' backers (`occupation.ts:37-42`), and a `cold_war` conflict sets
**both** backers by construction — so every member of either bloc matches a side
automatically. Meanwhile the general-assignments route
(`api/country/[code]/general/assignments`) validates only `isValidUnitLocation`, with no
belligerency check.

Chained: a defence-seat holder in any bloc member posts a general to the front, units
arrive, they declare, and `joinSide` enrols them in the walkover branch
(`battleResolution.ts:264`) — **no bloc resolution, no domestic bill, no vote of any
kind.** Part 1 would be a door standing beside an open wall.

**Rule: at a `cold_war` conflict, posting a general and declaring an offensive both
require the country to already be on a roster.** Roster membership is reached only by
`joinSide`, and for a proxy war `joinSide` is reached only from a passed Join Conflict
bill — so the bloc vote plus the domestic bill become the sole entry.

**Scoped to `cold_war` deliberately.** Interstate wars keep today's behaviour, where
`sideOf`'s fallback is exactly how an ally joins an ongoing war without its own
declaration — a shipped rationale written into `sideOf`'s own comment. Narrowing it
everywhere would remove that, and it is not this design's business.

**Stated as a predicate, not a list.** Revision 4 named two doors — and there are at
least three. Part 2 institutionalised predicate-plus-grep precisely because enumeration
kept coming up short; Part 3 reverted to a list and made the same mistake.

> **Rule:** every route that lets a country place forces or command at a theater must,
> for a `cold_war` conflict, require that country to already be on a roster.

```bash
rg -n 'isValidUnitLocation|theaterId' src/app/api
```

**Two doors behind the identical `isValidUnitLocation`-only check:**

- `country/[code]/general/assignments/route.ts:76` — posting a general.
- `executive/cabinet/[positionId]/formations/route.ts:112` — writes
  `conflictAssignments` behind the same gate. **Missed by Revision 4**, and its own error
  string reads "a general cannot be posted to it", so it is unmistakably the same door.

**Plus the declare route**, which already loads the conflict, so the type test is free
there. **Three real gates, not four.**

⚠️ **`.../military/[unitId]/assign` is NOT a door**, and an earlier revision was wrong to
list it as one. It never accepts a theater: it derives
`theaterId = theaterOfUnit(assignedGeneralId, conflictAssignments)` (line 89), inheriting
whatever the general's posting already is — `commandChain.ts:16` states the rule
outright, *"Nobody moves units to a front directly."* Gating it would guard a path that
cannot be driven. The grep surfaces it correctly; the earlier prose over-read the result.
**Confirm during PR4 rather than gating on it.**

The gate is one shared helper called from each, not four copies of the condition — the
same reasoning `findWarBetween` records for the one-war-per-pair rule.

### Separate peace: already refused, no new rule needed

**Correction to Revision 3.** That revision added a bespoke rule blocking a peace that
would empty a side of a `cold_war` conflict. With generated factions it is
**redundant** — `validatePeaceOffer` already refuses *any* offer when either side is
generated (`peaceOffer.ts:95-97`), with the reason "There is no government on the other
side to negotiate with", and `kind` stays `generated` for the life of the conflict. The
rule is dropped rather than duplicated.

The outcome Revision 3 wanted still holds, and now falls out of shipped behaviour: no
peace deal can resolve a proxy war, so **`resolveColdWarHolds` is the only path that
resolves one** (`applyOccupation` no longer resolves at a pole for this type either).
That settles where the bloc admission lives — see below.

⚠️ **This is load-bearing on `kind` never changing.** If a later change promotes a side
to `coalition` once patrons join, the generated check stops firing and the
`sideWouldEmpty` hole re-opens exactly as Revision 3 described. A test pins that a
`cold_war` side keeps `kind: "generated"` after `joinSide`.

### Why it must be a turn step

`applyOccupation` only runs when a battle **moves the front**, and it early-returns
when `control` does not change. Once a side is pinned at 100 the front cannot move
further, so nothing would ever re-enter that code and the timer would never fire.

This is the same class of defect as the generals bug on the conflicts branch — a
feature whose entry condition can never be met again, sitting there with every test
green. The step runs in the same phase as `resolveBattleDeclarations`, keyed on
`poleSinceTurn` alone, independent of whether anyone fought that turn.

## Resolution

**Where the bloc admission lives: in `resolveColdWarHolds`, not in `resolveConflict`.**
`resolveConflict` is shared with every other conflict type and with the separate-peace
path, so putting admission inside it would fire on any future route into it. With the
separate peace blocked above, `resolveColdWarHolds` is the sole path by which a
`cold_war` conflict ends, so it is both the correct owner and a complete one. It calls
`resolveConflict` for the war itself, then applies the bloc outcome.

`resolveConflict` runs unchanged for the war itself: outcome recorded, every
belligerent walked out via `standDownCountry`, truces recorded for every cross-side
pair.

One string does need changing: `resolveConflict.ts:33` writes
``note: `${victor} took full control of ${conflict.hostCountry}.` ``, which reads wrong
when two hosts flip. It becomes a list of `hostEntities` labels.

Then, for the winning side's `backer`:

### 1 — Resolve the bloc's organisation from the PRESET, not the year

**Correction.** The original draft cited `resolveOrgCategory`'s warning — *"NOT DERIVED
FROM THE YEAR… `resolveAlignmentEra` flips to post-cold-war at 1991"* — approvingly,
and then derived the bloc org from `resolveAlignmentEra(year)`, which is precisely the
hazard that comment names.

The consequence is concrete. `ALIGNMENT_ERAS`' post-1991 era has poles
`WASHINGTON`/`MOSCOW`/`BEIJING` but **only WASHINGTON-side channels** (NATO, EU); its
own comment says *"Moscow and Beijing have no surviving bloc org."* So an east-backed
proxy war resolving in a 1953 game that had reached 1991 would find no organisation and
**admit nobody, silently** — the Cold War ended on the calendar rather than in the game.

The fix follows the code this design already cites. `loadBlocMembership` keys on
**`PRESET_YEAR[preset]`, not the live year**, for exactly this reason, and
`BLOC_BY_POLE` already maps poles onto `west`/`east`:

```ts
const BLOC_BY_POLE = { WEST: "west", EAST: "east", WASHINGTON: "west", MOSCOW: "east" };
```

So a shared helper — `blocOrgFor(preset, bloc: "west" | "east")` — resolves the
preset's year to an era, walks that era's `channels`, keeps only those with
`alignmentAccession: true` **and whose `organizationId` is in
`INTERNATIONAL_ORGANIZATIONS`**, and inverts `BLOC_BY_POLE` to find the channel whose
pole sits on the winning bloc.

⚠️ **Both filters, not just the first.** `loadBlocMembership` applies the manifest check
too (`src/lib/world/blocMembership.ts:51`). Without it `blocOrgFor` can return an organisation id that
does not exist, and `admitMember` will happily write membership rows against it — a
whole bloc's worth of hosts joining nothing, with no error.

**Layering note:** `src/lib/world/blocMembership.ts` is the globe's bloc-painting module. Housing a
war-resolution helper there keeps the pole↔bloc mapping and its consumers together, at
the cost of a module that now serves two subsystems. Stated rather than assumed; if it
grows further, the mapping moves to its own module and both import it. `alignmentAccession` is also what disambiguates post-1991
WASHINGTON's two channels (NATO carries it, the EU does not) — the same reason
`loadBlocMembership` filters on it: an org that carries influence without a membership
gate does not make a country "West".

`BLOC_BY_POLE` is currently **module-private** in `src/lib/world/blocMembership.ts:25`, so `blocOrgFor`
either lives in that file or the constant is exported. Living there is preferable: it
keeps the pole↔bloc mapping and its only two consumers in one place.

`ConflictSide.backer` is `"west" | "east"`; `AlignmentPoleId` is
`"WEST" | "EAST" | "WASHINGTON" | "MOSCOW" | "BEIJING"`. The mapping between them is
`BLOC_BY_POLE`, not a case change, and the helper owns it so no caller re-derives it.

**If the helper finds no org** — a preset whose era has no accession channel on that
pole — the conflict still resolves and the admission is skipped, **logged explicitly**
rather than passing silently. That is the failure mode above, made visible.

### 2 — Admit every host entity

`admitMember(db, organizationId, countryId, currentTurn, opts?)` clears withdrawal tombstones
so a re-admitted member is not re-suppressed by the founding self-heal, which is the
behaviour wanted here.

**Correction:** its `countryId` parameter is typed `CountryId`, so the draft's claim
that it is "already entity-keyed" was wrong — the *document* is entity-keyed
(`OrgMemberId = WorldEntityId`) but the function signature is narrower, and passing
`"NVN"` is a type error today. The parameter widens to `OrgMemberId`.

**It is not a one-line widening**, as the previous revision implied: the body also calls
`clearOrganizationWithdrawal` (defined at `src/lib/internationalOrganizations/withdrawalTombstone.ts:40`; called from `joinApplication.ts:60`), whose own `countryId` parameter
is `CountryId` and must widen with it.

**Three live consumers of that membership row, none of them obvious.**

1. **Tribute.** `tributeMembers` is the exact complement of `votingMembers`, so an
   admitted macro host immediately begins paying its new bloc's tribute — the Warsaw
   Pact's is 0.0075/yr of GDP. Arguably correct (a client pays its patron), but it is a
   real economic consequence of a battlefield outcome.
2. **The globe.** `loadBlocMembership` reads these rows, and `world/page.tsx` →
   `worldBlocs.ts` → `WorldMapSVG` paints from it. So the map's bloc mode gains `NVN`/
   `SVN` as coloured entities — **verify they are drawable there** before assuming the
   pin lands; unlike the front map, the globe has no meter to degrade to.
3. ⚠️ **`sideOf`, in every future conflict.** `loadMilitaryBlocs` builds its `BlocLookup`
   from the same rows, so once `NVN` joins the Warsaw Pact it is **no longer
   `nonAligned`** — and `sideOf`'s bloc fallback will place it by bloc in any later
   conflict whose sides carry backers.

Point 3 partially erodes the invariant the fog argument rests on. The `factionEntity`
clause is exact-match precisely so a faction is placed by identity and never by a bloc
guess; after admission the *bloc* route starts working for that entity too. It is not a
fog leak — placement is not visibility, and `belligerentSideOf` stays roster-only — but
it means a resolved proxy war changes how its hosts behave in the next one. Stated so it
is a known consequence rather than a surprise.

### 3 — Shift alignment toward the winner's pole

**Correction:** `normalizeShares` (`src/lib/alignment/normalize.ts:82`) is a **pure**
`(raw, poles) => AlignmentShares` function — it writes nothing, so calling it "the sole
write path on `countryAlignments`" was wrong. It is the sole *normaliser*, and the
invariant claim holds; the persistence is elsewhere.

**Correction, round 3:** the previous revision then pointed at `commitInfluencePlay` as
the write path. That is also wrong — it is not a generic delta applier
(`commitInfluencePlay.ts:38-106`). It requires a `sponsorCountryId` and an
`amountLocal`, **debits the org's fund** and returns `insufficient-funds` when it cannot,
prices the play against the target's GDP and refuses an unpriceable target, refuses a
`target-locked` nation outright, resolves its channel from `resolveAlignmentEra(year)`
— the year again — and only **queues** an `alignmentPlays` row for the turn phase to
apply. Routing a war outcome through it would move nothing in several ordinary cases,
silently: the exact failure class this document insists on making loud elsewhere.

**So: a new bounded command, `applyConflictOutcomeAlignment`.** A battlefield result is
not a purchase, and billing it to the bloc's fund would refuse precisely when a bloc has
been fighting a long war and spent itself down. The command:

- takes `(entityIds, pole, turn, preset)` — no sponsor, no money, no pricing;
- applies a **fixed delta** toward the winning pole, capped by the existing
  `PER_NATION_TURN_CAP` so a war outcome cannot outrun what a turn of influence can do;
- persists through `normalizeShares`, preserving the shares-plus-`nonAligned`-equals-100
  invariant;
- resolves its pole from the **LIVE YEAR**, not from the preset — see below;
- **ignores the `target-locked` gate.** That gate exists to stop money moving a nation
  that is already committed; a nation that has just been conquered is a different case,
  and refusing here would mean the most decisive outcome in the game moved nothing.
  Called out because it is a deliberate divergence from `commitInfluencePlay`.

It writes `countryAlignments` directly rather than queuing an `alignmentPlays` row,
because a play is a *bid* resolved against other bids at the turn phase, and a war
outcome is not competing with anyone.

#### Org from the preset, pole from the live year

**Correction to Revision 3**, which extended preset-keying from `blocOrgFor` to the
alignment pole "for consistency". The two are not the same kind of thing, and the
consistency was wrong.

An organisation's identity does not expire, so `blocOrgFor` keying on the preset is
right. **Alignment poles are era state keyed to the live year**, and the code is
unambiguous about it: `alignmentPhase.ts:144` computes
`polesForYear(resolveGameYear(gs))`; `crossing.ts` re-keys every document through
`era.inherit` (`{WEST: "WASHINGTON", EAST: "MOSCOW"}`) when a game crosses 1991; and
`normalizeShares` keeps only poles present in the set it is given.

So in a 1953 game that has reached 1991, a preset-derived `EAST` either gets silently
dropped by `normalizeShares` or — if the preset's pole set is passed alongside it —
clobbers the document's `WASHINGTON`/`MOSCOW`/`BEIJING` shares. Both are the silent
no-op this command exists to avoid.

**The rule splits:**

| Resolve | From | Why |
|---|---|---|
| Which org the hosts join | the **preset** | An alliance's identity does not expire; this is the `resolveOrgCategory` principle. |
| Which pole the shares move toward | the **live year** | Poles are era state; documents are re-keyed at era crossings. |

`BLOC_BY_POLE` already carries both vocabularies (`WEST`/`EAST` and
`WASHINGTON`/`MOSCOW`), so the same constant serves both lookups — inverted within
`polesForYear(liveYear)` for the pole, and within the preset's era for the org.

**Step 3 is gated on `intOrgAlignmentEnabled`**, which is a different flag from
`conflictsEnabled` and fail-closed. With alignment off, admission still happens and the
alignment write is skipped — the outcome is never half-applied and never throws on a
collection the world is not using.

**If the winning side has no `backer`** — a purely internal faction wins — the conflict
resolves and nobody joins anything. That is the honest answer, and it is the same shape
as `sideOf` returning `null` rather than guessing a bloc.

### What this does not touch

`_coldwar/proxyWar.ts` is a static proxy-war model (hardcoded Afghanistan, Nicaragua,
Angola, Ogaden with their own CP-commitment control formula) that predates the live
conflict collection. Part 3 lands on the same subject matter, so its fate needs stating:
**leave it, and do not extend it.**

Grepping `SIDE_CONFIG`, `ProxyState` and `CONFLICTS[` shows its model has **no
production consumer** — only the module itself and its own test. The nine `_coldwar`
files that import from it (`sideTheme`, `IntelBoard`, `intel`, `HomeFrontBoard`,
`homefront`, `DetenteBoard`, `detente`, `CrisisBoard`, `crisis`) take
`type Side = "west" | "east"` and nothing else. It is a dead model behind a live type
alias, in the same category as the `CONFLICTS: Conflict[] = []` array the live hub
already replaced. Deleting it is a separate cleanup; conflating it with this work would
put a UI teardown inside a mechanics change.

## Creation: admin only

Nothing in the game creates a `cold_war` conflict; `declareWar` only builds
`interstate` wars between two playable countries. A new control under
**Admin ▸ World ▸ Conflicts** creates one: pick host entities, name the two factions,
set each side's backer, then `createConflict({ type: "cold_war", … })`.

**This is more work than "a new control" implies, and it is on the critical path.**
`src/app/api/admin/conflicts/` contains only `general/toggle` and `cold-war/toggle`,
and `ConflictsManager.tsx` renders just that toggle — there is no existing list or form
to extend. So it is a new admin `POST` route **plus** its validation **plus** new UI,
and nothing else in this design can be exercised until it exists. It should be built
first, not last.

The route is also the **sole validation boundary for `hostCountry`/`hostEntities`**,
since widening to `WorldEntityId` removes compile-time checking (see above): host ids
are checked against the world entity manifest here, and against `COUNTRY_HOME_REGION`
so a host with no region row is refused rather than silently filed in North America.

Gated on `conflictsEnabled` like every other conflict surface, and admin-only like
every other world-authoring control. Era seeding of proxy wars is explicitly out of
scope — it would hardcode which proxy wars exist in each era, and the admin control is
what unblocks testing everything above.

`initialControl` returns 50 when the host is on neither side, which is exactly right
for a proxy war and needs no special case. The `hostEntities` array is passed through
`BuildConflictInput` and `buildConflict` stays pure.

**Two birth values carry no signal for this type, and that is accepted, not overlooked.**
`createConflict.ts:~88` derives `enemyCoalition` from `sideB` alone
(`sideB.kind === "generated" ? 0 : sideB.countries.length`). With **both** `cold_war`
sides generated, `baseStrength` is always 320 → `severity: "MEDIUM"`, `intensity: 50`,
and neither is recomputed as patrons join. And `blocOfSides` returns **`"contested"`** for
every `cold_war` conflict, since both backers are set and differ — so where this document
says `backer` "drives the map pin's colour", for a proxy war that colour is always the
contested one. Both are display-only today. Making severity track the patrons who have
actually joined is a reasonable follow-up and explicitly not in scope.

---

## Delivery sequence

Four PRs. The ordering is not cosmetic — each one is unusable without its predecessor,
and PR2 is the only piece that touches machinery shared with the rest of the game.

**PR1 — Admin conflict creation.** The route, its validation (world-entity manifest,
`COUNTRY_HOME_REGION` presence, `factionEntity`-vs-`CountryId` collision), and the UI.
`src/app/api/admin/conflicts/` has only two toggles today and `ConflictsManager.tsx`
renders just one, so there is nothing to extend. **Nothing else in this design can be
exercised until a `cold_war` conflict can be created**, which is why it leads despite
being the least interesting.

**PR2 — The concurrent bicameral vote.** The stage kind, `closeConcurrentVoteStage`, the
NPP fetch and tally, the player write path, six country configs, and the mechanical
sweep the two inventories find. **Ships on its own, ahead of Parts 1 and 3**, because it
is the only change to shared bill machinery and it is independently testable with an
ordinary bill filed into `active_both` — no conflict, no bloc, no faction required.
Reviewing it alongside a war-entry feature would bury a change that touches every
country's legislature inside a change about NATO.

⚠️ **PR2 ships an inert stage, and that is expected, not a bug.** Until PR3 lands nothing
can *produce* an `active_both` bill — `validateBillProvisions` refuses a hand-rolled
`join_conflict` and no builder exists — so the six registered configs sit unused. PR2's
tests therefore hand-insert bill fixtures at `active_both`. Say so in the PR description,
or the stage's silence reads as the exact class of defect this design spent nine rounds
hunting.

**Adjacent, and one line away from PR2's engine change:** `engine.ts:87` calls
`getCountryConfig(bill.countryId)` with no preset. It resolves `governmentType`, not
chamber count, so it is outside this design — but if PR2's fix is "the engine resolves
the preset once per run", the second consumer is three lines from the first.

**PR3 — Join Conflict (Part 1).** The resolution type, the propose surface, the mirrored
bill, the enactment table, `joinSide`. Depends on PR2 for the stage and PR1 only for
something to join.

**PR4 — Cold War Conflicts (Part 3).** The type, the faction model and its placement
chain, the three-turn hold, resolution, admission and alignment.

⚠️ **Within PR4, prove the placement chain FIRST.** Build
`belligerentSideOf` + `sideOf` + the two target guards + the walkover ternary, and assert
`control` moves end-to-end, **before** building `buildFactionSide`, the shared defenders
helper, or the `tokenStrength` decrement. Four separate review rounds specified work
downstream of that chain while it was still broken; every one of those pieces is inert
until `control` moves, and none of them fails loudly when it doesn't.

## Testing

**Pure**

- `resolveBillVoteField`: every existing status returns its current field regardless of
  `voterOfficeType`; `active_both` returns `votes` for the lower office type and
  `otherChamberVotes` for the upper.
- `canTableResolutionType("bloc", "join_conflict")` is true; `security`, `political`,
  `economic` and `development` are all false.
- The concurrent stage's `chambersFor` returns two chambers for the US, one for the UK
  (`bicameral: false` despite a Lords config), one for a genuinely unicameral country.
- `blocOrgFor("1953-default", "east")` returns `WARSAW_PACT` **even when the live game
  year is 1991 or later** — the direct regression test for the year-derivation defect,
  and the reason the helper keys on the preset.
- `blocOrgFor` picks NATO, not the EU, for a WASHINGTON-pole preset — the
  `alignmentAccession` filter.
- `homeRegionOf("NVN")` and `homeRegionOf("SVN")` return `"sea"`, not the `"noa"`
  fallback. Asserted as a table-completeness test over every intended proxy-war host,
  because the fallback is silent.
- Cold War hold: control reaching a pole stamps `poleSide`/`poleSinceTurn`; coming off
  clears both; a re-arrival re-stamps rather than resuming the old count.
- `initialControl` for a two-host proxy war where the host is on neither side is 50.
- `hostEntities` absent resolves to `[hostCountry]`, not to an empty list.

**Engine**

- A concurrent bill with both chambers passing enacts; with the upper chamber failing,
  the bill fails — proved by asserting the **status**, not just the tally, so a merged
  tally cannot pass the test.
- A concurrent bill carrying `join_conflict` never enters `enrolled`.
- Entering `active_both` stamps **both** deadline pairs (`votingEndsOnTurn` and
  `otherChamberVotingEndsOnTurn`); the upper-chamber vote path reads the second one, so
  a missing stamp refuses every upper vote.

**Chamber-awareness (the two blocking paths — these are the regression tests that
matter most)**

- **NPP fetch:** an `active_both` bill within its window appears in `ctx.activeBills`.
  This is the upstream gate — without it the loop test below passes vacuously against a
  bill the tick never saw.
- **NPP:** an `active_both` bill puts **both** chambers' NPP officials in the voting
  loop, and each writes to their own chamber's map. Asserted by counting non-zero votes
  in `otherChamberVotes` after a tick — with the current single-office-type lookup this
  is zero, which is the structural failure that makes every concurrent bill fail.
- **`chambersFor("DE", "1953-default")` returns ONE chamber.** ⚠️ **The preset must be
  pinned in the assertion.** DE's base config is `bicameral: false`, so a
  `bicameral`-keyed implementation *also* returns 1 for era-neutral DE — an era-neutral
  assertion passes on the broken build and proves nothing. `1953-default` is the only
  preset where the two rules disagree, and therefore the only one that discriminates.
  *(Two earlier revisions prescribed this test era-neutrally, which is how the underlying
  claim stayed wrong for three rounds.)*
- **`chambersFor` is preset-sensitive for TR and ES** — both have an `upperElectionSystem`
  in the base config and both `1953-default` overrides set it `undefined`, so the same
  country yields two chambers or one depending on the preset passed. This is the test
  that fails if the stage resolves its config without a preset. (FR is **not** such a
  case — two chambers under every preset.)
- The NPP fetch matches an `active_both` bill while **either** chamber is open, pinned
  with two *divergent* deadlines — a single spread of two `billStillOpen` results
  silently drops one, and equal deadlines would hide it.
- A vote cast after that voter's own chamber deadline is refused; a vote from each
  chamber's member is accepted by its own `updateOne` filter.
- `nationalBillQueries` reports the upper chamber's deadline for an `active_both` bill —
  its `otherChamberVotingEndsAt` is a hardcoded `null` today.
- An upper-chamber vote is audit-logged with `chamber: "other"`, not `"origin"`.
- **Engine dispatch:** an `active_both` bill past both deadlines is *closed* by a tick.
  A stage kind the engine does not dispatch leaves the bill sitting forever, and no
  tally assertion catches that — assert the status changed.
- **Builder:** `buildJoinConflictBill` stamps both deadline pairs and initialises
  `otherChamberVotes` plus its three counters. Asserted on the inserted document,
  because the stage's entry logic never runs for a directly-inserted bill.
- **NPP:** officials from a different country are still excluded (the existing
  per-bill country scoping must survive the loop restructure).
- **Player write:** a lower-chamber member and an upper-chamber member can each vote on
  an `active_both` bill, landing in different maps; a member of neither chamber is
  refused 403.
  ⚠️ **An earlier draft added "and a second vote from the same member is refused". That
  is wrong and a correct implementation FAILS it.** National bill votes are re-votable by
  design — `buildEmbeddedVoteTallyUpdate` exists precisely so "concurrent re-votes cannot
  double-apply stale increment/decrement math", and `nationalBillActions.ts:262` reads
  `previousVote` to handle a changed vote. Only the `cabinet_review` branch (`:141-146`)
  refuses a repeat. The assertion also contradicted this document's own later test, which
  requires an upper-chamber voter to *change* their vote. Removed.
- **UI gates:** `canVoteOrigin`/`canVoteOther` are both true for a member of the
  respective chamber on an `active_both` bill.
- Whip panel and whip-defiance both treat `active_both` as actionable.
- ⚠️ **A whipped UPPER-chamber member's vote lands in `otherChamberVotes`, and their
  weight in `otherChamberVotesFor`.** The regression test for B5/B6: without the fork,
  the vote and its weight land in the lower chamber's map and tally, so the bill can
  *pass* on votes cast by the other house. Assert the map **and** the counter — the map
  alone leaves the `$inc` triple unproven.
- Their whip snapshot is written to `otherChamberWhippedFromVote`, so the clear path in
  `nationalBillActions` can find it. **Scoped to `applyPlayerWhip` only** —
  `applyWhipVotes` writes no snapshot, so asserting one there tests nothing.
- The votes route with `?chamber=other` scopes its roster to the upper chamber on an
  `active_both` bill, not to `currentChamber`.
- An upper-chamber voter changing their vote does **not** re-fire
  `applyBillVotePolicyShift` — the prior vote is read from their own chamber's map.
- **A Senator invoking a filibuster on a Join Conflict bill gets the explicit refusal**,
  naming the reason, not the generic "not actively being voted on in the Senate".
- `canVoteOther` is true for an upper-chamber member on an `active_both` bill **through
  the country-legislature query**, whose hardcoded `false` no status grep would find.
- The concurrent close fires only when **every** chamber in `chambersFor` is past its
  deadline, and a unicameral country closes on its single chamber despite the builder
  stamping both pairs.

**Resolution / effects**

- A passed `join_conflict` resolution spawns exactly one bill per player-enabled member
  that is not already on a side, and zero for non-enabled members.
- A member already on the opposing side gets no bill.
- The resolution enacting against a `resolved` conflict is a no-op.
- A passed mirrored bill calls `joinSide` with the resolution's side; a failed one does
  not.
- `resolveColdWarHolds` resolves a conflict held at a pole for 3 turns, does not resolve
  at 2, and does not resolve one whose hold was broken and restarted.
- Resolution admits every `hostEntities` member to the preset's winning-bloc org, and
  skips the alignment write when `intOrgAlignmentEnabled` is off.
- A winning side with no `backer` resolves the conflict and admits nobody.
- **After admission, `sideOf` places the host entity by bloc in a LATER conflict** —
  it is no longer `nonAligned`. The stated consequence of step 2 had no assertion; every
  other consequence in that section does. Pin it so the behaviour is a recorded decision
  rather than a discovery.
- The displayed pass rule for an `active_both` bill matches what the close applies —
  `billEnrichment.ts:952` and `closeConcurrentVoteStage` cannot disagree.
- A preset with no accession channel on the winning pole logs the skip rather than
  passing silently.
- **A `cold_war` side keeps `kind: "generated"` after `joinSide` adds a patron.** The
  separate-peace refusal depends entirely on this; if `kind` ever flips, a proxy war can
  be ended at 50% control by one patron suing for peace.
- Any peace offer into a `cold_war` conflict is refused with the existing generated-side
  reason, before and after patrons join.
- **A declaration against a faction resolves AND moves `control`.** Both halves, because
  they fail independently: `belligerentSideOf` matching `factionEntity` gets the
  declaration accepted, and `sideOf` matching it gets the offensive *placed*. Asserting
  only acceptance passes while the battle silently fizzles as a walkover — which is
  exactly how the defect survived three revisions. Assert `control` after the tick.
- `sideOf` returns a side for a `factionEntity` and still returns `null` for an unrelated
  non-aligned entity — the clause is exact-match, not a widened bloc guess, because
  `sideOf` is the permissive resolver two fog sites depend on.
- An offensive against a faction is **not** built with `side: null` — pinned directly on
  `mergeOffensives`, since a null side skips `joinSide` and `applyOccupation` together.
- **A faction with `tokenStrength` is not a walkover.** `defendersAtFront` yields a
  synthetic contingent, so `battleResolution` fights instead of advancing the attacker
  unopposed; a faction with no token strength still walks over, as today.
- A faction never appears as a declarer — no path can file one.
- **A bloc member NOT on a roster cannot post a general to, or declare at, a `cold_war`
  conflict**, even though `sideOf` places it by bloc backer. The regression test for
  Part 1 being bypassable — asserted at **every** entry point the grep finds
  (assignments, formations, unit-assign, declare), since any one left open defeats the
  other three.
- **A faction with `tokenStrength` produces a `BattleSide` that `resolvePvpBattle`
  accepts**, and the defending side is no longer empty at the walkover gate. The direct
  regression test for the token force not reaching the live path — a `buildEnemy`-shaped
  fix passes nothing here.
- The faction's `tokenStrength` decrements by its casualties and floors at zero; at zero
  the side becomes a walkover again. **Asserted on a battle that does NOT move `control`**
  — the case `applyOccupation` early-returns on, and the one a pinned front produces
  every turn.
- **The forecast and the resolution agree about a faction front.** Same conflict, same
  units: the war room must not report `unopposed` while the tick fights the token force.
  The regression test for the invariant the forecast route documents.
- The battle report for a fought proxy battle names the faction as defender, not an
  empty roster.
- A `factionEntity` colliding with a real `CountryId` is refused at creation — the
  invariant the `belligerentSideOf` clause relies on at the two `conflictTier` sites.
- `persistSide` is not called for a synthetic side — asserted by the absence of a
  `militaryUnits` write for the faction entity, not by the bulk op happening to be empty.
- The same country CAN post and declare at an `interstate` conflict its bloc backs, as
  today — proving the narrowing did not catch the ally-joins-an-ongoing-war path.
- **The United States DOES receive a mirrored bill.** ⚠️ The discriminating half: the US
  has no `COUNTRY_BILL_PHASES` entry, so a bare table lookup skips it, and the France
  assertion below passes anyway. Without this test the feature ships broken for the
  country it is built around.
- A member with no bill lifecycle gets no mirrored bill even when player-enabled —
  asserted with France, which is in NATO's 1953 roster and has no lifecycle. Keep both
  directions; either alone is satisfied by a wrong implementation.
- `applyConflictOutcomeAlignment` moves shares for a locked target (where
  `commitInfluencePlay` would refuse), respects `PER_NATION_TURN_CAP`, and leaves
  shares plus `nonAligned` summing to 100.
- **In a 1953-preset game whose live year is 1991+, an east win admits to
  `WARSAW_PACT` (preset) but moves the `MOSCOW` share (live year).** The single test
  that pins both halves of the split rule; getting either from the wrong source is a
  silent no-op.
- `blocOrgFor` returns nothing (and logs) for a channel whose `organizationId` is not in
  `INTERNATIONAL_ORGANIZATIONS`, rather than an id `admitMember` would write rows against.
- `join_conflict` is absent from `BASELINE_POWERS`, so a `political` or `development`
  org cannot table it — the escalation `canTableResolutionType`'s `or` would otherwise
  allow.
- `billHasDeclareWar` does **not** match a `join_conflict` bill, so the simple-majority
  decision holds. A decision enforced by omission needs a test that names it.

**Provisions**

- A `join_conflict` provision is **not** matched by `isPolicyProvision` — the guard is
  true-by-default, so without a branch the bill is written into a policy record.
- **A seated legislator proposing a hand-rolled `join_conflict` provision through the
  ordinary bill route is REFUSED**, exactly as `declare_war` is. The
  privilege-escalation test: without it, Part 1's whole gate chain is optional.
- The bill's provision renders its own label in both `billEnrichment` and
  `nationalBillQueries`, not the subsidy fallback each chain ends in.

**Map**

- **`FrontMap` for a Vietnam host renders `NVN` and `SVN` PATHS** — asserted on the
  rendered regions, not on `features` being non-empty. ⚠️ The non-empty assertion passes
  on the broken build: both consumers filter features against a roster that is `[]` for
  a proxy-war host, so the merged features are dropped and an empty box renders. Assert
  the same for `FrontLineMap`, which filters independently.
- A host with neither shard codes nor a static entry falls back to the **meter**, not to
  an empty box — the fallback keys on the post-filter count.

**Route**

- Tabling `join_conflict` at a `security` org is refused; at NATO under a 1953 preset it
  is accepted.
- Tabling against an unknown or resolved conflict is refused.
- A non-foreign-minister is refused (inherited, but asserted for the new type).

## Out of scope

- **Promoting `NVN`/`SVN` to full countries** (giving them `states` rows so the
  region-shard path resolves). The static-feature route above makes this unnecessary
  for the map, and promotion would touch seeding, economy and metrics.
- **Static geometry for hosts that do not have it yet** — Korea and Angola need their
  own `scripts/maps/build-*-geo.mjs` output before `PROXY_HOST_GEOMETRY` can carry them.
  Vietnam works today; the others fall back to the meter until their builders land.
- **Entity unification** (NVN + SVN → VN). Merging entities means merging states,
  regions, org rows and map shards; it is its own feature.
- **Era-seeded proxy wars.** Admin creation only, this pass.
- Bloc cohesion or reputation effects when a member's bill fails — a refusal costs
  nothing today.
- Any other bill type adopting `active_both`.
- **Deleting `_coldwar/proxyWar.ts`.** Its CP model is dead (no production consumer)
  but nine sibling files import its `Side` type alias, so removing it is a UI cleanup
  with its own diff. Leave it; do not extend it.
- **Generalising `OverrideStage` and `ConcurrentVoteStage` into one kind.** They share
  `requireAll` semantics, but the override's tally is US-only (`tallyOverrideByChamber`
  hardcodes `house`/`senate`) and seat-threshold-based rather than office-type-scoped.
  Merging them means rewriting the override path, which is shipped and working.
- Extracting the per-type chains in `proposeLegislation.ts` (381 lines) and the
  legislation route (251 lines). Both are at the size where a ninth branch is the moment
  to split them, but refactoring them in the same pass that adds a mechanic would make
  the diff unreviewable. Noted for its own change.
