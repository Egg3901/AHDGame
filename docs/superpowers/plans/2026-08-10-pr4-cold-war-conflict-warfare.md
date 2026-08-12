# PR4 — Cold War Conflict Warfare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cold War Conflict can actually be fought — blocs declare at it, faction token forces defend it, territory moves, and holding a pole for three turns resolves the war and takes the host countries into the winning bloc.

**Architecture:** Teach both side resolvers about faction entities so an offensive is *placed*; give a generated faction a synthetic `BattleSide` so it is not a walkover; add a turn step that resolves a three-turn pole hold; on resolution admit the host entities to the winner's bloc organisation and shift their alignment.

**Tech Stack:** TypeScript, MongoDB, Vitest, React (map components).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-09-bloc-join-conflict-and-cold-war-conflicts-design.md`, Part 3. Read it first.
- **Depends on PR1** (the type, the fields, the creation surface). PR3 is independent of this but is how a real bloc joins.
- **Gate:** `gameState.conflictsEnabled`. `coldWarEnabled` is retired. `intOrgAlignmentEnabled` gates the alignment shift **only**.
- **Never set `gameState.coldWarEndedTurn`.** It reverts NATO/Warsaw Pact to `security` and silently disables PR3's whole feature. Resolving a proxy war ends *that war*, not the Cold War.
- **Commit style:** lowercase-leading subject, ≤100 chars. **Prettier:** whole repo. **Typecheck:** 12 GB heap. **Never chain build + test:run.** **CRLF files.**

## ⚠️ TASK ORDER IS NOT NEGOTIABLE

Task 1 proves `control` moves end to end. **Do not start Tasks 3–8 until it does.**

Four separate review rounds specified work downstream of the placement chain while it was still broken, each one layer below the last. Every piece below Task 1 — the token force, the hold, the resolution, the map — is **inert** until `control` moves, and **none of them fails loudly when it doesn't**. A green suite proves nothing here if the chain is broken.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/military/conflictVisibility.ts` | *Modify* — `belligerentSideOf` matches a `factionEntity` |
| `src/lib/military/occupation.ts` | *Modify* — `sideOf` matches a `factionEntity` (exact-match only) |
| `.../battle/declare/route.ts`, `.../battle/forecast/route.ts` | *Modify* — accept a world-entity target |
| `src/lib/military/factionSide.ts` | *Create* — the synthetic `BattleSide` factory |
| `src/lib/military/defendingSides.ts` | *Create* — the ONE shared "defenders including any token force" helper |
| `src/lib/turn/battleResolution.ts` | *Modify* — walkover gate; `tokenStrength` attrition; skip `persistSide` |
| `src/lib/military/rosterGate.ts` | *Create* — "already a belligerent" gate for `cold_war` theatre entry |
| `src/lib/turn/coldWarHolds.ts` | *Create* — the three-turn hold + resolution |
| `src/lib/world/blocMembership.ts` | *Modify* — `blocOrgFor(preset, bloc)`; export or co-locate `BLOC_BY_POLE` |
| `src/lib/alignment/commands/applyConflictOutcomeAlignment.ts` | *Create* — the bounded alignment write |
| `src/app/world/conflicts/combat/components/FrontMap.tsx`, `FrontLineMap.tsx` | *Modify* — static host features |
| `src/lib/maps/proxyHostGeometry.ts` | *Create* — entity → static feature source |

---

### Task 1: The placement chain — prove `control` moves

Widening `belligerentSideOf` gets a declaration **accepted**. It does not get the battle **placed**: `mergeOffensives` resolves *both* ends through `sideOf`, which finds a faction in no roster, falls back to `blocOf`, gets `nonAligned`, and returns `null`. The offensive is then built `side: null`, the walkover branch runs, and `if (off.side)` skips `joinSide` **and** `applyOccupation` together.

**Files:**
- Modify: `src/lib/military/conflictVisibility.ts` (`belligerentSideOf`)
- Modify: `src/lib/military/occupation.ts` (`sideOf`)
- Modify: `.../cabinet/[positionId]/battle/declare/route.ts:52` and `.../battle/forecast/route.ts:52`
- Test: `src/lib/military/__tests__/factionPlacement.test.ts`

**Interfaces:**
- Produces: both resolvers match `side.factionEntity` by **exact string equality**.

- [ ] **Step 1: Write the failing test**

```ts
import { sideOf } from "../occupation";
import { belligerentSideOf } from "../conflictVisibility";
import { mergeOffensives } from "../coalition";

const vietnam = {
  sideA: { label: "RVN", countries: [], kind: "generated", backer: "west", factionEntity: "SVN" },
  sideB: { label: "DRV", countries: [], kind: "generated", backer: "east", factionEntity: "NVN" },
} as const;

describe("faction placement", () => {
  it("resolves a faction entity through BOTH resolvers", () => {
    expect(belligerentSideOf(vietnam, "NVN")).toBe("B");
    expect(sideOf(vietnam, "NVN", {})).toBe("B");
  });

  it("still returns null for an unrelated non-aligned entity", () => {
    // sideOf is the PERMISSIVE resolver and two fog consumers depend on it. The
    // clause must be exact-match on factionEntity, never a widened bloc guess.
    expect(sideOf(vietnam, "LAO", {})).toBeNull();
  });

  it("builds an offensive with a real side, not null", () => {
    // The decisive assertion. A null side skips joinSide AND applyOccupation together,
    // so control never moves and every downstream feature is inert.
    const offs = mergeOffensives(
      { ...vietnam, _id: "cw1" } as never,
      [{ _id: "d1", declarerCountry: "US", targetCountry: "NVN", theaterId: "cw1", declaredTurn: 9 }] as never,
      10,
      {}
    );
    expect(offs).toHaveLength(1);
    expect(offs[0]!.side).not.toBeNull();
    expect(offs[0]!.enemySide).toBe("B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/military/__tests__/factionPlacement.test.ts`
Expected: FAIL — both resolvers return null for `"NVN"`.

- [ ] **Step 3: Add the clause to both resolvers**

In `conflictVisibility.ts`:

```ts
export function belligerentSideOf(c: Pick<ConflictDoc, "sideA" | "sideB">, id: string): Side | null {
  if ((c.sideA.countries as string[]).includes(id)) return "A";
  if ((c.sideB.countries as string[]).includes(id)) return "B";
  // A faction IS a belligerent — it is the side, named by its entity id. Exact match
  // only: this function is the roster-only one precisely so visibility never inherits
  // sideOf's bloc fallback.
  if (c.sideA.factionEntity === id) return "A";
  if (c.sideB.factionEntity === id) return "B";
  return null;
}
```

In `occupation.ts`, add the same two lines to `sideOf` **before** the `blocOf` fallback:

```ts
  if (c.sideA.factionEntity === countryId) return "A";
  if (c.sideB.factionEntity === countryId) return "B";
  const bloc = blocOf(blocs, countryId);
  // …unchanged…
```

⚠️ `sideOf` is the permissive resolver — it already places unrostered bloc members by backer. The clause must be **exact-match on `factionEntity`** so it grants placement to the faction itself and to nobody else.

- [ ] **Step 4: Widen the target guard in BOTH routes**

Both `declare/route.ts:52` and `forecast/route.ts:52` carry the byte-identical `if (!COUNTRY_CONFIGS[targetCountry])` guard, and forecast's runs **before** its `belligerentSideOf` and `defendersAtFront` calls. Fixing only the declare route leaves the forecast broken.

```bash
rg -n 'COUNTRY_CONFIGS\[targetCountry\]' src/app/api
```

Replace in each with a check that accepts a country **or** a faction entity named on this conflict:

```ts
    const isKnownTarget =
      !!COUNTRY_CONFIGS[targetCountry as CountryId] ||
      conflict.sideA.factionEntity === targetCountry ||
      conflict.sideB.factionEntity === targetCountry;
    if (!isKnownTarget) {
      return NextResponse.json({ error: "Invalid target country" }, { status: 400 });
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/military src/app/api/country`
Expected: PASS

- [ ] **Step 6: Prove `control` moves end to end**

This is the gate on the rest of the plan. Add an integration test to `src/lib/turn/__tests__/battleResolution.coldWar.test.ts`:

```ts
it("moves control when a bloc member declares at a faction front", async () => {
  // Seed: a cold_war conflict, a US unit at the front, a pending declaration on NVN.
  await resolveBattleDeclarations(db, currentTurn);
  const after = await getConflict(db, "cw1");
  // Assert CONTROL, not that a function was called. Asserting acceptance alone passes
  // while the battle silently fizzles as a walkover — which is exactly how this
  // defect survived three revisions.
  expect(after!.control).not.toBe(50);
});
```

Run it. **If it does not pass, stop and fix the chain before proceeding.**

- [ ] **Step 7: Commit**

```bash
npm run format
git add -A
git commit -m "fix(conflicts): place offensives against a faction so control can move"
```

---

### Task 2: Part 1 is the only door into a proxy war

`sideOf`'s bloc fallback places any bloc member, and a `cold_war` conflict sets both backers by construction. Posting a general has no belligerency gate. So a defence-seat holder could post, declare, and be enrolled by `joinSide` — **no bloc vote, no bill**.

**Files:**
- Create: `src/lib/military/rosterGate.ts`
- Modify: the routes the grep finds
- Test: `src/lib/military/__tests__/rosterGate.test.ts`

- [ ] **Step 1: Find every door**

```bash
rg -n 'isValidUnitLocation|theaterId' src/app/api
```

**Three real gates:** `country/[code]/general/assignments/route.ts:76`, `executive/cabinet/[positionId]/formations/route.ts:112`, and the declare route (which already loads the conflict).

⚠️ **`.../military/[unitId]/assign` is NOT a door.** It never accepts a theater — it derives `theaterId = theaterOfUnit(assignedGeneralId, …)`, inheriting the general's posting. `commandChain.ts:16`: *"Nobody moves units to a front directly."* Gating it would guard a path that cannot be driven.

- [ ] **Step 2: Write the failing test**

```ts
describe("cold_war theatre entry", () => {
  it("refuses a bloc member not on a roster", async () => {
    // sideOf places US by backer, but Part 1 is supposed to be the only way in.
    expect(await canEnterTheatre(db, "US", coldWarConflict)).toBe(false);
  });
  it("allows a country already on a roster", async () => {
    expect(await canEnterTheatre(db, "US", { ...coldWarConflict, sideA: { ...sideA, countries: ["US"] } })).toBe(true);
  });
  it("does NOT narrow an interstate conflict", async () => {
    // sideOf's backer fallback is how an ally joins an ongoing war — shipped
    // behaviour with its own rationale. The narrowing must not catch it.
    expect(await canEnterTheatre(db, "US", interstateConflict)).toBe(true);
  });
});
```

- [ ] **Step 3: Write the shared gate**

```ts
/**
 * May this country place forces or command at this conflict?
 *
 * For a `cold_war` conflict: only if it is ALREADY on a roster, which is reachable only
 * through `joinSide` — and for a proxy war `joinSide` is reached only from a passed
 * Join Conflict bill. So the bloc vote plus the domestic bill become the sole entry.
 *
 * Every other conflict type is unchanged: `sideOf`'s backer fallback is how an ally
 * joins an ongoing war, and narrowing that is not this design's business.
 */
export function canEnterTheatre(country: CountryId, conflict: ConflictDoc): boolean {
  if (conflict.type !== "cold_war") return true;
  return (
    (conflict.sideA.countries as string[]).includes(country) ||
    (conflict.sideB.countries as string[]).includes(country)
  );
}
```

- [ ] **Step 4: Call it from all three doors**

One shared helper called from each — not three copies of the condition.

- [ ] **Step 5: Run, then commit**

```bash
npx vitest run src/lib/military src/app/api/country
npm run format
git add -A
git commit -m "feat(conflicts): require roster membership to enter a proxy war"
```

---

### Task 3: The faction token force

`buildEnemy` is **not** on the live path — one consumer, `forecast()`. Live resolution is `resolvePvpBattle(BattleSide[], BattleSide[])`, and `defendersAtFront` returns `CountryId[]`.

**Files:**
- Create: `src/lib/military/factionSide.ts`
- Create: `src/lib/military/defendingSides.ts`
- Modify: `src/lib/turn/battleResolution.ts` (walkover gate ~258; `persistSide` ~46)
- Modify: `.../battle/forecast/route.ts` (the `unopposed` computation)
- Test: `src/lib/military/__tests__/factionSide.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("faction token force", () => {
  it("produces a BattleSide resolvePvpBattle accepts", () => {
    const side = buildFactionSide(coldWarConflict, "B", front);
    expect(side.country).toBe("NVN");
    expect(side.units.length).toBeGreaterThan(0);
    expect(side.assignments).toEqual([]);
    expect(side.generalsById).toEqual({});
  });

  it("makes the defending side non-empty at the walkover gate", async () => {
    await resolveBattleDeclarations(db, turn);
    const report = lastReport();
    expect(report.noContact).toBe(false);
  });

  it("scales with tokenStrength", () => {
    const weak = buildFactionSide({ ...c, sideB: { ...c.sideB, tokenStrength: 10 } }, "B", front);
    const strong = buildFactionSide({ ...c, sideB: { ...c.sideB, tokenStrength: 100 } }, "B", front);
    expect(strong.units.length).toBeGreaterThanOrEqual(weak.units.length);
  });

  it("does not write militaryUnits for the faction", async () => {
    // persistSide bulk-writes filtered on countryId: side.country. A synthetic side
    // has no rows — assert the ABSENCE of a write, not an empty bulk op.
    await resolveBattleDeclarations(db, turn);
    const writes = db.collectionMocks["militaryUnits"]!.bulkWrite.mock.calls;
    expect(writes.flatMap((c) => c[0]).some((op) => JSON.stringify(op).includes("NVN"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL, then build the factory**

`buildFactionSide(conflict, side, front)` returns one `BattleSide` whose `country` is the side's `factionEntity`, with in-memory `CombatUnit`s minted from `enemyMix` and scaled by `tokenStrength`, and empty `assignments`/`generalsById`/`positions`, neutral `natMods`, `countryScale: 1`. Nothing is inserted.

- [ ] **Step 3: One shared defending-sides helper, used by BOTH callers**

```bash
rg -n 'defendersAtFront|length === 0' src/
```

`defendersAtFront` has **two** non-test callers: `battleResolution.ts:248` and `battle/forecast/route.ts:119`. The forecast computes `unopposed = defenderCountries.length === 0` from the same roster, and its own comment states the invariant: *"a forecast can never disagree with the outcome it predicts."*

⚠️ The gate at `battleResolution.ts:247-251` is a **ternary** — `defendersAtFront` is only the `off.enemySide` arm; the else arm builds the same value from `unitsByCountry` and feeds the same `length === 0` test. **Both arms** must go through the helper.

- [ ] **Step 4: Skip `persistSide` for a synthetic side, and attrite on the conflict**

⚠️ **The `tokenStrength` decrement must NOT ride on `applyOccupation`'s `$set`.** That function early-returns at line 133 when `control` does not move — which is every battle once the front is pinned at a pole, exactly the state the three-turn hold is about. A stalemated front would grind the token force every turn and record nothing: the immortal wall the mechanism removes. It also takes no casualty data.

Write it in its own `updateOne` on the conflict, beside the battle-report insert, sourced from the synthetic side's `SideOutcome` losses and floored at zero.

- [ ] **Step 5: Run, then commit**

```bash
npx vitest run src/lib/military src/lib/turn src/app/api/country
npm run format
git add -A
git commit -m "feat(conflicts): give a faction a synthetic token force in the live battle path"
```

---

### Task 4: The three-turn hold

**Files:**
- Modify: `src/lib/turn/battleResolution.ts` (`applyOccupation` — stamp instead of resolve)
- Create: `src/lib/turn/coldWarHolds.ts`
- Modify: `src/lib/turn/ministerialOrderProcessing.ts` (~step 4b-ii, beside `resolveBattleDeclarations`)
- Test: `src/lib/turn/__tests__/coldWarHolds.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("resolveColdWarHolds", () => {
  it("resolves a conflict held at a pole for 3 turns", async () => { /* poleSinceTurn = t-3 */ });
  it("does NOT resolve at 2 turns", async () => { /* ... */ });
  it("does NOT resolve a hold that was broken and restarted", async () => { /* re-stamped */ });
  it("reads conflictsEnabled at the step itself", async () => {
    // The FIRST conflict turn-step with no upstream gate: it is reached from
    // poleSinceTurn alone, with no declaration upstream of it.
    await resolveColdWarHolds(dbWithFlagOff, turn);
    expect(resolveConflict).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Stamp instead of resolving**

In `applyOccupation`, for a `cold_war` conflict reaching a pole: set `poleSide`/`poleSinceTurn`; clear both if control comes off; **do not** call `resolveConflict`.

- [ ] **Step 3: Write the turn step**

⚠️ **It must be a turn step, not a battle-time check.** `applyOccupation` only runs when a battle *moves the front* and early-returns when `control` does not change. Once a side is pinned at 100 the front cannot move further, so nothing would ever re-enter that code and the timer would never fire — a feature whose entry condition can never be met, with every test green.

It sweeps active `cold_war` conflicts by `poleSinceTurn` alone, independent of whether anyone fought.

- [ ] **Step 4: Wire it in and commit**

```bash
npx vitest run src/lib/turn
npm run format
git add -A
git commit -m "feat(conflicts): resolve a proxy war held at a pole for three turns"
```

---

### Task 5: Resolution — admit the hosts

**Files:**
- Modify: `src/lib/world/blocMembership.ts` (`blocOrgFor`; export or co-locate `BLOC_BY_POLE`, currently module-private at :25)
- Modify: `src/lib/internationalOrganizations/joinApplication.ts` (widen `admitMember`) and `withdrawalTombstone.ts` (widen `clearOrganizationWithdrawal`)
- Modify: `src/lib/military/resolveConflict.ts` (the outcome note)
- Test: `src/lib/world/__tests__/blocOrgFor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("blocOrgFor", () => {
  it("returns WARSAW_PACT for a 1953 preset EVEN AT live year 1991+", () => {
    // The direct regression test for the year-derivation defect: the post-1991 era has
    // only WASHINGTON channels ("Moscow and Beijing have no surviving bloc org"), so a
    // year-derived lookup admits nobody, silently.
    expect(blocOrgFor("1953-default", "east")).toBe("WARSAW_PACT");
  });

  it("picks NATO, not the EU, for the west", () => {
    // alignmentAccession disambiguates: the EU carries influence without a membership
    // gate, so it does not make a country West.
    expect(blocOrgFor("1953-default", "west")).toBe("NATO");
  });

  it("returns null when no accession channel exists on that pole", () => {
    // Logged, not silent — this is the failure mode above made visible.
    expect(blocOrgFor("2019-default", "east")).toBeNull();
  });
});
```

- [ ] **Step 2: Write `blocOrgFor`**

Resolve the **preset's** year to an era, walk that era's `channels`, keep only those with `alignmentAccession: true` **and** whose `organizationId` is in `INTERNATIONAL_ORGANIZATIONS` (both filters — `loadBlocMembership` applies both at :51, and without the manifest check `admitMember` writes rows against an org that does not exist), and invert `BLOC_BY_POLE`.

**Layering note:** `blocMembership.ts` is the globe's bloc-painting module. Housing this there keeps the pole↔bloc mapping with its consumers; if it grows further, move the mapping to its own module.

- [ ] **Step 3: Admit the hosts, and widen the two signatures**

`admitMember`'s `countryId` is `CountryId` — widen to `OrgMemberId`. ⚠️ It is not a one-line change: its body calls `clearOrganizationWithdrawal`, whose own parameter is also `CountryId`.

Use `hostEntitiesOf` (PR1) — never `hostEntities` directly.

⚠️ **Three live consumers of the membership row**, none obvious: tribute starts charging; the globe's bloc mode gains `NVN`/`SVN` as coloured entities (**verify they are drawable**); and `loadMilitaryBlocs` now places them by bloc in *later* conflicts. Add a test pinning the third — it is stated in the spec and was the one consequence without an assertion.

- [ ] **Step 4: Fix the outcome note**

`resolveConflict.ts:33` writes ``took full control of ${conflict.hostCountry}`` — wrong when two hosts flip. Make it a list of `hostEntitiesOf` labels.

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): admit proxy-war hosts to the winning bloc"
```

---

### Task 6: The alignment shift

**Files:**
- Create: `src/lib/alignment/commands/applyConflictOutcomeAlignment.ts`
- Test: `src/lib/alignment/commands/__tests__/applyConflictOutcomeAlignment.test.ts`

⚠️ **Do not route this through `commitInfluencePlay`.** It is not a generic delta applier: it debits the org fund and returns `insufficient-funds`, requires a `sponsorCountryId` and an `amountLocal`, prices against the target's GDP, refuses a `target-locked` nation, resolves its channel from `resolveAlignmentEra(year)`, and only **queues** an `alignmentPlays` row. A war outcome routed through it moves nothing, silently, in several ordinary cases — including when a bloc has spent itself down fighting.

- [ ] **Step 1: Write the failing test**

```ts
describe("applyConflictOutcomeAlignment", () => {
  it("moves shares for a LOCKED target", () => {
    // Deliberate divergence from commitInfluencePlay: that gate stops money moving an
    // already-committed nation. A nation that was just conquered is a different case,
    // and refusing would make the most decisive outcome in the game move nothing.
  });
  it("respects PER_NATION_TURN_CAP", () => { /* ... */ });
  it("leaves shares + nonAligned summing to 100", () => { /* normalizeShares invariant */ });
  it("resolves the pole from the LIVE YEAR, not the preset", () => {
    // Poles are era state, re-keyed through era.inherit at 1991. A preset-derived
    // EAST is either dropped by normalizeShares or clobbers WASHINGTON/MOSCOW/BEIJING.
  });
  it("is skipped when intOrgAlignmentEnabled is off, while admission still happens", () => { /* ... */ });
});
```

- [ ] **Step 2: Write it**

`applyConflictOutcomeAlignment(db, { entityIds, bloc, turn, year, preset })` — no sponsor, no money, no pricing. Fixed delta toward the winning pole, capped by `PER_NATION_TURN_CAP`, persisted through `normalizeShares`. Writes `countryAlignments` **directly** rather than queuing an `alignmentPlays` row: a play is a *bid* resolved against other bids, and a war outcome is not competing with anyone.

**The split rule:** the **org** comes from the **preset** (an alliance's identity does not expire); the **pole** comes from the **live year** (`polesForYear(resolveGameYear(gs))`). `BLOC_BY_POLE` carries both vocabularies.

- [ ] **Step 3: Commit**

```bash
npm run format
git add -A
git commit -m "feat(alignment): add a bounded conflict-outcome alignment command"
```

---

### Task 7: Static host geometry on both maps

**Files:**
- Create: `src/lib/maps/proxyHostGeometry.ts`
- Modify: `FrontMap.tsx`, `FrontLineMap.tsx`
- Modify: `[conflictId]/page.tsx:287` and `combat/page.tsx:143` (both producers)
- Test: `src/app/world/conflicts/combat/components/__tests__/FrontMap.staticFeatures.test.tsx`

- [ ] **Step 1: Run the grep — two producers, two consumers**

```bash
rg -n 'hostRegionCodes|useRegionGeometry' src/
```

- [ ] **Step 2: Write the failing test**

```ts
it("renders NVN and SVN PATHS for a Vietnam host", () => {
  // ⚠️ Assert the RENDERED REGIONS, not that `features` is non-empty. Both consumers
  // filter features against a roster that is [] for a proxy-war host, so a non-empty
  // assertion passes on the broken build while an EMPTY MAP BOX renders.
});
it("falls back to the METER, not an empty box, for a host with no geometry", () => {
  // hasGeometry must key on the POST-FILTER count.
});
```

- [ ] **Step 3: Feed the roster as well as the features**

`RegionalGeoMap` builds `new Set(regionCodes)` and drops every feature not in it; `FrontLineMap` filters inline against its own `codeKey`. `regionCodesOfCountry` returns `[]` for `NVN`/`SVN`. **So the static feature ids must be appended to the roster too, in both components**, and `hasGeometry` must key on the post-filter count.

Both `MAP_BOX` (`FrontMap`) **and `FRONT_BOX`** (`FrontLineMap`) need an entry per proxy-war host — copied from that country's real map config where one exists, **never invented**.

- [ ] **Step 4: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): draw proxy-war hosts from static map features"
```

---

### Task 8: Final gate

- [ ] **Step 1: Run everything**

```bash
npm run lint
npm run format:check
NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit
npm run test:run
```

- [ ] **Step 2: Manual verification against an isolated database**

1. Create a Vietnam proxy war (PR1 form).
2. Table and pass a NATO Join Conflict resolution on side A (PR3); pass the US bill.
3. Post a general and declare at the front. **Confirm `control` moves** — the report must not be `noContact`.
4. Grind the token force to zero, then push to a pole.
5. Hold three turns → the war resolves, `NVN`/`SVN` join the Warsaw Pact or NATO, and their alignment shifts.
6. `/world/conflicts/<n>` renders the Vietnam map, not the meter alone.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore(conflicts): verify the cold war conflict lifecycle end to end"
```

## What this PR deliberately does not do

- No entity unification (NVN + SVN → VN).
- No era-seeded proxy wars; admin creation only.
- No static geometry for Korea or Angola — their `build-*-geo.mjs` output does not exist yet; they render as the meter.
- Does not retire `Front.enemyBase` (written, read by no production code, one test assertion) or `_coldwar/proxyWar.ts` (dead model behind a live `type Side` alias). Both are separate cleanups.
