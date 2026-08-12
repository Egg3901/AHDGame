# PR1 — Cold War Conflict Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can create a Cold War Conflict hosted in one or more third-party world entities, and it persists, renders on the conflict record page, and refuses invalid hosts.

**Architecture:** Widen `ConflictDoc.hostCountry` from `CountryId` to `WorldEntityId` so non-playable entities (`NVN`, `SVN`) can host a war; add the `cold_war` conflict type with its faction and pole-hold fields; add a pure validator; expose it through one admin `POST` route and a form in the existing `ConflictsManager`.

**Tech Stack:** TypeScript, Next.js App Router route handlers, MongoDB (native driver), Vitest, Zod, React (client components).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-09-bloc-join-conflict-and-cold-war-conflicts-design.md`. Read "Part 3 — Cold War Conflicts" before starting.
- **Gate:** every surface added here sits behind `gameState.conflictsEnabled`. `coldWarEnabled` is **retired** — do not read, set, or reference it.
- **Do not set `gameState.coldWarEndedTurn`.** Setting it makes `resolveOrgCategory` revert NATO/Warsaw Pact to `security`, silently disabling bloc war entry in PR3.
- **Commit style:** commitlint requires a **lowercase-leading** subject, ≤100 chars.
- **Prettier:** run `npm run format` on the whole repo before the final commit of each task; do not scope-limit it.
- **Typecheck needs headroom:** `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`. The default 4 GB OOMs.
- **Never chain `npm run build` and `npm run test:run` in one command** — CPU contention produces ~14 spurious failures.
- **This branch has pre-existing baseline test failures** inherited from `origin/development`. A failure in a file you did not touch is not yours; confirm against `origin/development` before investigating.
- **These files are CRLF.** Any scripted edit must match `\r\n`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/db/types/conflict.ts` | *Modify* — widen `hostCountry`; add `cold_war` to `ConflictType`; add `factionEntity`/`tokenStrength` to `ConflictSide`; add `hostEntities`/`poleSide`/`poleSinceTurn` to `ConflictDoc` |
| `src/lib/military/occupation.ts` | *Modify* — widen `initialControl` and `occupationOf`/`OccupationView.host`; two roster comparisons need explicit widening |
| `src/lib/military/createConflict.ts` | *Modify* — widen `BuildConflictInput.hostCountry`; thread `hostEntities`; throw on a missing home region for `cold_war` |
| `src/lib/military/hostEntities.ts` | *Create* — the single `hostEntities ?? [hostCountry]` fallback, so no caller re-derives it |
| `src/lib/maps/regionOwnership.ts` | *Modify* — widen `regionCodesOfCountry` |
| `src/lib/military/regionTopology.ts` | *Modify* — add `NVN`/`SVN` home-region rows |
| `src/lib/military/validateCreateConflict.ts` | *Create* — pure validator for admin creation (hosts, collision, backers) |
| `src/app/api/admin/conflicts/cold-war/create/route.ts` | *Create* — the admin `POST` |
| `src/components/admin/conflicts/CreateColdWarConflictForm.tsx` | *Create* — the form |
| `src/components/admin/conflicts/ConflictsManager.tsx` | *Modify* — render the form under the existing toggle |

---

### Task 1: Widen the conflict host to a world entity

`CountryId` is a closed 29-member union. `NVN`, `SVN`, `VN`, `KR` and `KP` are none of them, so a proxy war cannot be typed until `hostCountry` widens. Two functions compare the host against a `CountryId[]` roster and will not compile with a widened parameter.

**Files:**
- Modify: `src/lib/db/types/conflict.ts`
- Modify: `src/lib/military/occupation.ts` (`initialControl` ~line 71, `occupationOf` ~line 159)
- Modify: `src/lib/military/createConflict.ts` (`BuildConflictInput` ~line 55)
- Modify: `src/lib/maps/regionOwnership.ts` (`regionCodesOfCountry` ~line 108)
- Test: `src/lib/military/occupation.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ConflictDoc.hostCountry: WorldEntityId`; `initialControl(hostCountry: WorldEntityId, sideA: ConflictSide, sideB: ConflictSide): number`; `OccupationView.host: WorldEntityId`; `regionCodesOfCountry(db: Db, countryId: WorldEntityId): Promise<string[]>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/military/occupation.test.ts`:

```ts
describe("initialControl with a non-playable host", () => {
  it("returns 50 when the host is on neither side", () => {
    // SVN is a world entity, not a CountryId — a proxy war's host is not a belligerent.
    expect(initialControl("SVN", sideA({ countries: ["US"] }), sideB({ countries: ["RU"] }))).toBe(
      50
    );
  });

  it("reports no occupier for a host on neither side", () => {
    const view = occupationOf({
      hostCountry: "SVN",
      control: 40,
      sideA: sideA({ countries: ["US"] }),
      sideB: sideB({ countries: ["RU"] }),
    });
    expect(view.host).toBe("SVN");
    expect(view.occupier).toBeNull();
    expect(view.pctA).toBe(60);
    expect(view.pctB).toBe(40);
  });
});
```

Ensure the file imports what the new test uses — add to the existing import block if missing:

```ts
import { initialControl, occupationOf } from "./occupation";
import type { ConflictSide } from "@/lib/db/types/conflict";
```

If `sideA`/`sideB` helpers are not already defined in that file, add them above the new `describe`:

```ts
const sideA = (over: Partial<ConflictSide> = {}): ConflictSide => ({
  label: "A",
  countries: [],
  kind: "state",
  ...over,
});
const sideB = (over: Partial<ConflictSide> = {}): ConflictSide => ({
  label: "B",
  countries: [],
  kind: "state",
  ...over,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/military/occupation.test.ts`
Expected: FAIL — TypeScript rejects `"SVN"` because `initialControl` and `occupationOf` require `CountryId`.

- [ ] **Step 3: Widen the type**

In `src/lib/db/types/conflict.ts`, add the import and change the field:

```ts
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
```

```ts
  /**
   * Where it's fought — the map anchor. May not be a belligerent.
   *
   * WorldEntityId, not CountryId: a proxy war is hosted in a third-party state the
   * game does not implement as playable (NVN, SVN, KR). Same widening `OrgMemberId`
   * already made for org membership. `WorldEntityId` is `string`, so validation moves
   * to the admin creation route — the only writer.
   */
  hostCountry: WorldEntityId;
```

- [ ] **Step 4: Widen the two comparison sites**

In `src/lib/military/occupation.ts`:

```ts
/** The `control` a conflict is born at — the host's own side holds all of its soil. */
export function initialControl(
  hostCountry: WorldEntityId,
  sideA: ConflictSide,
  sideB: ConflictSide
): number {
  // Rosters are CountryId[]; the host may be a world entity that is not one. Widen the
  // comparison rather than the roster — a faction's entity is never a belligerent.
  if ((sideA.countries as string[]).includes(hostCountry)) return 0;
  if ((sideB.countries as string[]).includes(hostCountry)) return 100;
  return 50;
}
```

```ts
export interface OccupationView {
  /** The country whose soil is contested. */
  host: WorldEntityId;
  /** The side standing on foreign soil, or null when the host is on neither side. */
  occupier: Side | null;
  /** Percent of the host held by each side; integers summing to 100. */
  pctA: number;
  pctB: number;
}

/** The readout: who holds how much of the host, and who is the occupier. */
export function occupationOf(c: OccupationInput): OccupationView {
  const pctB = Math.round(c.control);
  const hostOnA = (c.sideA.countries as string[]).includes(c.hostCountry);
  const hostOnB = (c.sideB.countries as string[]).includes(c.hostCountry);
  return {
    host: c.hostCountry,
    occupier: hostOnA ? "B" : hostOnB ? "A" : null,
    pctA: 100 - pctB,
    pctB,
  };
}
```

Add the import at the top of `occupation.ts`:

```ts
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
```

- [ ] **Step 5: Widen the two remaining signatures**

In `src/lib/military/createConflict.ts`, change `BuildConflictInput`:

```ts
  hostCountry: WorldEntityId;
```

and add `import type { WorldEntityId } from "@/lib/world/worldEntityManifest";`.

In `src/lib/maps/regionOwnership.ts`:

```ts
export async function regionCodesOfCountry(db: Db, countryId: WorldEntityId): Promise<string[]> {
```

and add the same import. The body is unchanged: it queries `states` by `countryId` and filters to drawable codes, so an entity with no rows returns `[]`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/military/occupation.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck the whole repo to find any other comparison break**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`
Expected: no NEW errors mentioning `hostCountry`, `initialControl`, `occupationOf` or `regionCodesOfCountry`. Pre-existing errors in untouched files are the known baseline — leave them.

If tsc reports a `CountryId` mismatch at a site not listed above, widen that site the same way (`as string[]` on the roster, `WorldEntityId` on the parameter) and note it in the commit body.

- [ ] **Step 8: Commit**

```bash
npm run format
git add -A
git commit -m "refactor(conflicts): widen conflict host to a world entity"
```

---

### Task 2: Proxy-host home regions, and a loud failure when one is missing

`buildConflict` does `homeRegionOf(input.hostCountry) ?? "noa"`. `COUNTRY_HOME_REGION` has `VN`, `KR` and `KP` but **no `NVN` or `SVN`** — so a Vietnam proxy war would be filed in North America with a map pin in the wrong hemisphere, silently.

**Files:**
- Modify: `src/lib/military/regionTopology.ts` (the `COUNTRY_HOME_REGION` table, near the `VN: "sea"` row ~line 202)
- Modify: `src/lib/military/createConflict.ts` (`buildConflict` ~line 82)
- Test: `src/lib/military/__tests__/regionTopology.test.ts` (or the existing region-topology test file — use whichever exists)
- Test: `src/lib/military/createConflict.test.ts`

**Interfaces:**
- Consumes: `WorldEntityId` host from Task 1.
- Produces: `PROXY_WAR_HOSTS: readonly string[]` exported from `regionTopology.ts` — the entity ids a proxy war may be hosted in, each guaranteed a home-region row.

- [ ] **Step 1: Write the failing tests**

Append to the region-topology test file:

```ts
import { PROXY_WAR_HOSTS, homeRegionOf } from "@/lib/military/regionTopology";

describe("proxy-war hosts", () => {
  // Table-completeness, not spot-checks: homeRegionOf's caller falls back to "noa",
  // so a missing row files a war in North America with no error anywhere.
  it("gives every proxy-war host a home region", () => {
    for (const host of PROXY_WAR_HOSTS) {
      expect(homeRegionOf(host), `${host} has no COUNTRY_HOME_REGION row`).toBeTruthy();
    }
  });

  it("places the two Vietnams in south-east asia", () => {
    expect(homeRegionOf("NVN")).toBe("sea");
    expect(homeRegionOf("SVN")).toBe("sea");
  });
});
```

Append to `src/lib/military/createConflict.test.ts`:

```ts
describe("buildConflict host-region guard", () => {
  it("throws for a cold_war host with no home region", () => {
    expect(() =>
      buildConflict(base({ type: "cold_war", hostCountry: "ZZZ", sideA: rebels, sideB: rebels }))
    ).toThrow(/ZZZ/);
  });

  it("still falls back for other conflict types", () => {
    // Only the proxy-war path is strict: every other type reaches here from a
    // declaration, whose target is already a validated CountryId.
    expect(buildConflict(base({ hostCountry: "ZZZ" })).region).toBe("noa");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/military/createConflict.test.ts src/lib/military/__tests__/regionTopology.test.ts`
Expected: FAIL — `PROXY_WAR_HOSTS` is not exported; `buildConflict` does not throw.

- [ ] **Step 3: Add the home-region rows and the host list**

In `src/lib/military/regionTopology.ts`, beside the existing `VN: "sea",` row add:

```ts
  // The two Vietnams (1954–1976). Unified VN above keeps its own row — a 1953 game
  // has NVN/SVN, a modern one has VN, and both must resolve.
  NVN: "sea",
  SVN: "sea",
```

Then, after the `COUNTRY_HOME_REGION` declaration, add:

```ts
/**
 * Entity ids a Cold War Conflict may be hosted in.
 *
 * Every entry MUST have a `COUNTRY_HOME_REGION` row — `buildConflict` throws for a
 * `cold_war` host without one, because its `?? "noa"` fallback would otherwise file the
 * war in North America with no error. A completeness test pins the pair.
 *
 * Korea and Angola are listed but have no static map geometry yet; they render as the
 * territory meter alone until their builders land.
 */
export const PROXY_WAR_HOSTS: readonly string[] = ["NVN", "SVN", "KR", "KP", "AO"];
```

If `AO` has no `COUNTRY_HOME_REGION` row, add `AO: "ssa",` beside the other African rows — the completeness test above is what tells you.

- [ ] **Step 4: Make buildConflict throw for a cold_war host with no region**

In `src/lib/military/createConflict.ts`, replace the first line of `buildConflict`:

```ts
export function buildConflict(input: BuildConflictInput): ConflictDoc {
  const home = homeRegionOf(input.hostCountry);
  // A proxy war's host is a world entity supplied by an admin, not a validated
  // CountryId from a declaration — so the `?? "noa"` fallback below is a silent
  // mis-file rather than a safe default. Fail loudly; the admin route surfaces it.
  if (!home && input.type === "cold_war") {
    throw new Error(
      `No home region for proxy-war host ${input.hostCountry}. ` +
        `Add a COUNTRY_HOME_REGION row before creating this conflict.`
    );
  }
  const region = (home ?? "noa") as RegionCode;
```

The rest of the function is unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/military/createConflict.test.ts src/lib/military/__tests__/regionTopology.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): add proxy-war host regions and guard the noa fallback"
```

---

### Task 3: The `cold_war` conflict type, faction sides, and host roster

Both factions are `kind: "generated"` with `countries: []`, carrying a `factionEntity` (the declarable target) and a `tokenStrength` (a small force). `hostEntities` is the roster that changes bloc at resolution; `poleSide`/`poleSinceTurn` are the three-turn hold's state. All are additive and optional — **no migration**.

**Files:**
- Modify: `src/lib/db/types/conflict.ts`
- Modify: `src/lib/military/createConflict.ts` (`BuildConflictInput`, `buildConflict`)
- Create: `src/lib/military/hostEntities.ts`
- Test: `src/lib/military/createConflict.test.ts`
- Test: `src/lib/military/__tests__/hostEntities.test.ts`

**Interfaces:**
- Consumes: `WorldEntityId` host (Task 1); the throw guard (Task 2).
- Produces: `ConflictType` includes `"cold_war"`; `ConflictSide.factionEntity?: WorldEntityId`; `ConflictSide.tokenStrength?: number`; `ConflictDoc.hostEntities?: WorldEntityId[]`; `ConflictDoc.poleSide?: "A" | "B"`; `ConflictDoc.poleSinceTurn?: number`; `hostEntitiesOf(c: Pick<ConflictDoc, "hostCountry" | "hostEntities">): WorldEntityId[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/military/__tests__/hostEntities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hostEntitiesOf } from "../hostEntities";

describe("hostEntitiesOf", () => {
  it("returns the explicit roster when present", () => {
    expect(hostEntitiesOf({ hostCountry: "SVN", hostEntities: ["NVN", "SVN"] })).toEqual([
      "NVN",
      "SVN",
    ]);
  });

  it("falls back to the anchor alone when absent", () => {
    // A missing roster must mean "just the anchor", never "no countries change bloc" —
    // the latter makes the whole resolution outcome a silent no-op.
    expect(hostEntitiesOf({ hostCountry: "SVN" })).toEqual(["SVN"]);
  });

  it("falls back for an explicitly empty roster too", () => {
    expect(hostEntitiesOf({ hostCountry: "SVN", hostEntities: [] })).toEqual(["SVN"]);
  });
});
```

Append to `src/lib/military/createConflict.test.ts`:

```ts
describe("cold_war conflicts", () => {
  const faction = (label: string, entity: string, backer: "west" | "east"): ConflictSide => ({
    label,
    countries: [],
    kind: "generated",
    backer,
    factionEntity: entity,
    tokenStrength: 40,
  });

  it("opens at a 50/50 split and carries its host roster", () => {
    const c = buildConflict(
      base({
        type: "cold_war",
        hostCountry: "SVN",
        hostEntities: ["NVN", "SVN"],
        sideA: faction("Republic of Vietnam", "SVN", "west"),
        sideB: faction("DRV", "NVN", "east"),
      })
    );
    // Neither faction entity is on a roster, so nobody holds the host's soil at birth.
    expect(c.control).toBe(50);
    expect(c.hostEntities).toEqual(["NVN", "SVN"]);
    expect(c.region).toBe("sea");
    // Both backers set and differing.
    expect(c.bloc).toBe("contested");
  });

  it("preserves each side's faction entity and token strength", () => {
    const c = buildConflict(
      base({
        type: "cold_war",
        hostCountry: "SVN",
        sideA: faction("Republic of Vietnam", "SVN", "west"),
        sideB: faction("DRV", "NVN", "east"),
      })
    );
    expect(c.sideA.factionEntity).toBe("SVN");
    expect(c.sideB.factionEntity).toBe("NVN");
    expect(c.sideB.tokenStrength).toBe(40);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/military/createConflict.test.ts src/lib/military/__tests__/hostEntities.test.ts`
Expected: FAIL — `hostEntities.ts` does not exist; `"cold_war"` is not a `ConflictType`; `factionEntity` is not on `ConflictSide`.

- [ ] **Step 3: Extend the types**

In `src/lib/db/types/conflict.ts`:

```ts
export type ConflictType =
  | "interstate"
  | "intervention"
  | "civil_war"
  | "independence"
  /** A proxy war fought on third-party soil; the sides are internal factions. */
  | "cold_war";
```

```ts
export interface ConflictSide {
  /** Display label, e.g. "Insurgent Bloc" / "Government" / "United States". */
  label: string;
  /** Real belligerents whose units fight on this side; `[]` = a generated force. */
  countries: CountryId[];
  kind: SideKind;
  /** Cold War patron, if any. */
  backer?: "west" | "east";
  /**
   * Faction sides only: the world entity this faction represents.
   *
   * This is the DECLARABLE TARGET — `belligerentSideOf` and `sideOf` match it, so a
   * player declares on "North Vietnam" rather than needing a side-addressed mode.
   * Must never collide with a real CountryId; the admin route enforces that, and the
   * fog resolver depends on it.
   */
  factionEntity?: WorldEntityId;
  /**
   * Faction sides only: the weight of the token force it brings. Small by design.
   * Decremented by its casualties and floored at zero; at zero the side is a walkover.
   */
  tokenStrength?: number;
}
```

Add to `ConflictDoc`:

```ts
  /**
   * Every third-party country in the theatre — the roster that changes bloc when the
   * war resolves. `hostCountry` stays the single map anchor. Read through
   * `hostEntitiesOf`, never directly: absent must mean "just the anchor".
   */
  hostEntities?: WorldEntityId[];
  /** `cold_war`: which side currently holds 100% of the host territory. */
  poleSide?: "A" | "B";
  /** `cold_war`: the turn that side reached the pole. Cleared if it comes off. */
  poleSinceTurn?: number;
```

- [ ] **Step 4: Create the host-roster helper**

Create `src/lib/military/hostEntities.ts`:

```ts
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/**
 * Every entity whose bloc changes when this conflict resolves.
 *
 * The ONE place the `hostEntities ?? [hostCountry]` fallback lives. A missing or empty
 * roster means "just the map anchor" — never "no countries change bloc", which would
 * make the whole resolution outcome a silent no-op on any single-host proxy war and on
 * every conflict document that predates the field.
 */
export function hostEntitiesOf(
  c: Pick<ConflictDoc, "hostCountry" | "hostEntities">
): WorldEntityId[] {
  return c.hostEntities && c.hostEntities.length > 0 ? c.hostEntities : [c.hostCountry];
}
```

- [ ] **Step 5: Thread `hostEntities` through the builder**

In `src/lib/military/createConflict.ts`, add to `BuildConflictInput`:

```ts
  /** `cold_war`: every third-party country in the theatre. Defaults to the anchor. */
  hostEntities?: WorldEntityId[];
```

and add to the object `buildConflict` returns, beside the other conditional spreads:

```ts
    ...(input.hostEntities ? { hostEntities: input.hostEntities } : {}),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/military/createConflict.test.ts src/lib/military/__tests__/hostEntities.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): add the cold_war type, faction sides and host roster"
```

---

### Task 4: The pure creation validator

Widening `hostCountry` to `WorldEntityId` (which is `string`) removed all compile-time checking, so the admin route is the **sole validation boundary**. Keeping the rules in a pure function makes each one directly testable without a database or a request.

**Files:**
- Create: `src/lib/military/validateCreateConflict.ts`
- Test: `src/lib/military/__tests__/validateCreateConflict.test.ts`

**Interfaces:**
- Consumes: `ConflictSide` with `factionEntity`/`tokenStrength` (Task 3); `PROXY_WAR_HOSTS` (Task 2).
- Produces:
  ```ts
  export interface ColdWarConflictDraft {
    name: string;
    hostCountry: WorldEntityId;
    hostEntities: WorldEntityId[];
    sideA: ConflictSide;
    sideB: ConflictSide;
  }
  export type ValidationResult = { ok: true } | { ok: false; status: number; error: string };
  export function validateColdWarConflict(
    draft: ColdWarConflictDraft,
    ctx: { knownEntityIds: ReadonlySet<string>; isCountryId: (id: string) => boolean }
  ): ValidationResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/military/__tests__/validateCreateConflict.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateColdWarConflict,
  type ColdWarConflictDraft,
} from "../validateCreateConflict";
import type { ConflictSide } from "@/lib/db/types/conflict";

const faction = (label: string, entity: string, backer: "west" | "east"): ConflictSide => ({
  label,
  countries: [],
  kind: "generated",
  backer,
  factionEntity: entity,
  tokenStrength: 40,
});

const ctx = {
  knownEntityIds: new Set(["NVN", "SVN", "KR", "KP"]),
  isCountryId: (id: string) => ["US", "UK", "RU", "DE"].includes(id),
};

const draft = (over: Partial<ColdWarConflictDraft> = {}): ColdWarConflictDraft => ({
  name: "Vietnam War",
  hostCountry: "SVN",
  hostEntities: ["NVN", "SVN"],
  sideA: faction("Republic of Vietnam", "SVN", "west"),
  sideB: faction("DRV", "NVN", "east"),
  ...over,
});

describe("validateColdWarConflict", () => {
  it("accepts a well-formed Vietnam draft", () => {
    expect(validateColdWarConflict(draft(), ctx)).toEqual({ ok: true });
  });

  it("refuses a host that is not in the world entity manifest", () => {
    const r = validateColdWarConflict(draft({ hostEntities: ["NVN", "ZZZ"] }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ZZZ/);
  });

  it("refuses a host that is in the manifest but has no home region", () => {
    // The discriminating case: the entity EXISTS, so the manifest check passes and only
    // the region check can refuse it. Without that check buildConflict's `?? "noa"`
    // fallback files the war in North America with no error anywhere.
    const r = validateColdWarConflict(draft({ hostCountry: "ZQ", hostEntities: ["ZQ"] }), {
      ...ctx,
      knownEntityIds: new Set(["ZQ"]),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/home region/i);
  });

  it("refuses a factionEntity that collides with a real country", () => {
    // The fog resolver is safe only because no player country id can be a faction.
    const r = validateColdWarConflict(
      draft({ sideA: faction("Puppet", "US", "west") }),
      ctx
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/US/);
  });

  it("refuses two sides backed by the same bloc", () => {
    const r = validateColdWarConflict(
      draft({ sideB: faction("DRV", "NVN", "west") }),
      ctx
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/opposing blocs/i);
  });

  it("refuses an anchor that is not in the host roster", () => {
    const r = validateColdWarConflict(draft({ hostCountry: "KR" }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anchor/i);
  });

  it("refuses a side with no faction entity", () => {
    const bare: ConflictSide = { label: "Nobody", countries: [], kind: "generated" };
    const r = validateColdWarConflict(draft({ sideA: bare }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/faction/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/military/__tests__/validateCreateConflict.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validator**

Create `src/lib/military/validateCreateConflict.ts`:

```ts
import type { ConflictSide } from "@/lib/db/types/conflict";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { homeRegionOf } from "@/lib/military/regionTopology";

export interface ColdWarConflictDraft {
  name: string;
  /** The map anchor. Must be one of `hostEntities`. */
  hostCountry: WorldEntityId;
  /** Every third-party country in the theatre; at least one. */
  hostEntities: WorldEntityId[];
  sideA: ConflictSide;
  sideB: ConflictSide;
}

export type ValidationResult = { ok: true } | { ok: false; status: number; error: string };

const bad = (error: string): ValidationResult => ({ ok: false, status: 400, error });

/**
 * Every rule an admin-created Cold War Conflict must clear.
 *
 * Pure on purpose: `hostCountry` is a `WorldEntityId`, which is `string`, so widening it
 * removed all compile-time checking and this route is the ONLY writer. Keeping the rules
 * here means each is testable without a database, and there is one place to read them.
 */
export function validateColdWarConflict(
  draft: ColdWarConflictDraft,
  ctx: { knownEntityIds: ReadonlySet<string>; isCountryId: (id: string) => boolean }
): ValidationResult {
  if (!draft.name.trim()) return bad("A conflict needs a name.");

  if (draft.hostEntities.length === 0) {
    return bad("A proxy war needs at least one host country.");
  }

  // The anchor drives `region`, the map pin and COUNTRY_ANCHOR, so it must be one of
  // the countries actually in the theatre.
  if (!draft.hostEntities.includes(draft.hostCountry)) {
    return bad(`The map anchor ${draft.hostCountry} must be one of the host countries.`);
  }

  for (const host of draft.hostEntities) {
    if (!ctx.knownEntityIds.has(host)) {
      return bad(`${host} is not a world entity in this preset.`);
    }
    // buildConflict falls back to "noa" for an unknown host, which would file the war
    // in North America. Refuse here so the failure is a message, not a wrong map pin.
    if (!homeRegionOf(host)) {
      return bad(`${host} has no home region. Add a COUNTRY_HOME_REGION row first.`);
    }
  }

  for (const [name, side] of [
    ["Side A", draft.sideA],
    ["Side B", draft.sideB],
  ] as const) {
    if (!side.label.trim()) return bad(`${name} needs a label.`);
    if (!side.factionEntity) return bad(`${name} needs a faction entity.`);
    if (!ctx.knownEntityIds.has(side.factionEntity)) {
      return bad(`${name}'s faction ${side.factionEntity} is not a world entity.`);
    }
    // The `sideOf`/`belligerentSideOf` faction clause is exact-match, and two fog
    // consumers rely on a faction never being a real country. Enforce it at the only
    // writer rather than leaving it an accident.
    if (ctx.isCountryId(side.factionEntity)) {
      return bad(
        `${name}'s faction id ${side.factionEntity} collides with a playable country.`
      );
    }
    if (side.tokenStrength != null && side.tokenStrength < 0) {
      return bad(`${name}'s token strength cannot be negative.`);
    }
  }

  // Both backers must be set and differ: a proxy war is two blocs backing two factions,
  // and `blocOfSides` reads "contested" from exactly that.
  if (!draft.sideA.backer || !draft.sideB.backer) {
    return bad("Both sides of a proxy war need a bloc backer.");
  }
  if (draft.sideA.backer === draft.sideB.backer) {
    return bad("The two sides must be backed by opposing blocs.");
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/military/__tests__/validateCreateConflict.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): add the cold war conflict creation validator"
```

---

### Task 5: The admin creation route

**Files:**
- Create: `src/app/api/admin/conflicts/cold-war/create/route.ts`
- Test: `src/app/api/admin/conflicts/cold-war/create/route.test.ts`

**Interfaces:**
- Consumes: `validateColdWarConflict` (Task 4); `createConflict` (existing, `createConflict(db, Omit<BuildConflictInput, "conflictId">)`).
- Produces: `POST /api/admin/conflicts/cold-war/create` → `{ ok: true, conflictId: number, theaterId: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/admin/conflicts/cold-war/create/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
const getDb = vi.fn();
const createConflict = vi.fn();

vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/mongodb", () => ({ getDb: () => getDb() }));
vi.mock("@/lib/military/createConflict", () => ({
  createConflict: (...args: unknown[]) => createConflict(...args),
}));

import { POST } from "./route";

const body = {
  name: "Vietnam War",
  hostCountry: "SVN",
  hostEntities: ["NVN", "SVN"],
  sideA: { label: "Republic of Vietnam", factionEntity: "SVN", backer: "west", tokenStrength: 40 },
  sideB: { label: "DRV", factionEntity: "NVN", backer: "east", tokenStrength: 40 },
};

const req = (over: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/admin/conflicts/cold-war/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...over }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, admin: { username: "root" } });
  getDb.mockResolvedValue({
    collection: () => ({
      findOne: vi.fn().mockResolvedValue({ conflictsEnabled: true, currentTurn: 12, preset: "1953-default" }),
    }),
  });
  createConflict.mockResolvedValue({ _id: "cw_svn_12", conflictId: 3 });
});

describe("POST /api/admin/conflicts/cold-war/create", () => {
  it("creates a cold_war conflict and returns its number", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, conflictId: 3 });

    const [, input] = createConflict.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(input.type).toBe("cold_war");
    expect(input.createdBy).toBe("event");
    expect(input.hostEntities).toEqual(["NVN", "SVN"]);
  });

  it("404s when the conflicts subsystem is off", async () => {
    getDb.mockResolvedValue({
      collection: () => ({ findOne: vi.fn().mockResolvedValue({ conflictsEnabled: false }) }),
    });
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(createConflict).not.toHaveBeenCalled();
  });

  it("400s a faction id that collides with a playable country", async () => {
    const res = await POST(
      req({ sideA: { ...body.sideA, factionEntity: "US" } })
    );
    expect(res.status).toBe(400);
    expect(createConflict).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(createConflict).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/api/admin/conflicts/cold-war/create/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `src/app/api/admin/conflicts/cold-war/create/route.ts`:

```ts
// POST /api/admin/conflicts/cold-war/create
// Create a Cold War Conflict hosted in one or more third-party world entities.
// This is the SOLE validation boundary for `hostCountry`/`hostEntities`: widening them
// to WorldEntityId (which is `string`) removed all compile-time checking.
// Auth: requireAdmin. Errors: 400, 401, 404, 409.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";
import type { ConflictSide } from "@/lib/db/types/conflict";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/alignmentSeeds";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import { createConflict } from "@/lib/military/createConflict";
import { validateColdWarConflict } from "@/lib/military/validateCreateConflict";

const sideSchema = z.object({
  label: z.string().min(1).max(80),
  factionEntity: z.string().min(2).max(8),
  backer: z.enum(["west", "east"]),
  tokenStrength: z.number().min(0).max(500).optional(),
});

const bodySchema = z.object({
  name: z.string().min(3).max(120),
  hostCountry: z.string().min(2).max(8),
  hostEntities: z.array(z.string().min(2).max(8)).min(1).max(6),
  sideA: sideSchema,
  sideB: sideSchema,
});

/** A faction side: generated, empty roster, addressed by its entity id. */
function toSide(input: z.infer<typeof sideSchema>): ConflictSide {
  return {
    label: input.label.trim(),
    // `countries: []` is the generated contract. It stays empty for the life of the
    // conflict even after patrons join, which is what keeps peace offers refused.
    countries: [],
    kind: "generated",
    backer: input.backer,
    factionEntity: input.factionEntity.toUpperCase(),
    ...(input.tokenStrength != null ? { tokenStrength: input.tokenStrength } : {}),
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gs = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { conflictsEnabled: 1, currentTurn: 1, preset: 1 } }
      );
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const preset = typeof gs.preset === "string" ? gs.preset : DEFAULT_SEED_PRESET;
    const knownEntityIds = new Set(
      getWorldEntityPresetManifest(preset).entries.map((e) => e.entityId)
    );

    const draft = {
      name: parsed.data.name.trim(),
      hostCountry: parsed.data.hostCountry.toUpperCase(),
      hostEntities: parsed.data.hostEntities.map((h) => h.toUpperCase()),
      sideA: toSide(parsed.data.sideA),
      sideB: toSide(parsed.data.sideB),
    };

    const check = validateColdWarConflict(draft, {
      knownEntityIds,
      isCountryId: (id) => id in COUNTRY_CONFIGS,
    });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const currentTurn = gs.currentTurn ?? 0;
    const conflict = await createConflict(db, {
      id: `cw_${draft.hostCountry}_${currentTurn}`.toLowerCase(),
      name: draft.name,
      hostCountry: draft.hostCountry,
      hostEntities: draft.hostEntities,
      type: "cold_war",
      sideA: draft.sideA,
      sideB: draft.sideB,
      // Not "player": no player declared this, and `createdBy` drives the record page's
      // "Undeclared" copy.
      createdBy: "event",
      startTurn: currentTurn,
    });

    return NextResponse.json({
      ok: true,
      conflictId: conflict.conflictId,
      theaterId: conflict._id,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
```

⚠️ If `DEFAULT_SEED_PRESET` is not exported from `@/lib/constants/alignmentSeeds`, find its real module with `rg -n "export const DEFAULT_SEED_PRESET" src/` and import from there — do not inline a preset string.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/api/admin/conflicts/cold-war/create/route.test.ts"`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): add the admin cold war conflict creation route"
```

---

### Task 6: The admin creation form

`ConflictsManager` currently renders one toggle and nothing else, so there is no list or form to extend.

**Files:**
- Create: `src/components/admin/conflicts/CreateColdWarConflictForm.tsx`
- Modify: `src/components/admin/conflicts/ConflictsManager.tsx`
- Test: `src/components/admin/conflicts/CreateColdWarConflictForm.test.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/conflicts/cold-war/create` (Task 5).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `src/components/admin/conflicts/CreateColdWarConflictForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateColdWarConflictForm } from "./CreateColdWarConflictForm";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CreateColdWarConflictForm", () => {
  it("posts the draft and reports the created conflict number", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, conflictId: 3, theaterId: "cw_svn_12" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateColdWarConflictForm />);
    fireEvent.change(screen.getByLabelText(/conflict name/i), {
      target: { value: "Vietnam War" },
    });
    fireEvent.change(screen.getByLabelText(/host entities/i), {
      target: { value: "NVN, SVN" },
    });
    fireEvent.change(screen.getByLabelText(/map anchor/i), { target: { value: "SVN" } });
    fireEvent.change(screen.getByLabelText(/side a label/i), {
      target: { value: "Republic of Vietnam" },
    });
    fireEvent.change(screen.getByLabelText(/side a faction/i), { target: { value: "SVN" } });
    fireEvent.change(screen.getByLabelText(/side b label/i), { target: { value: "DRV" } });
    fireEvent.change(screen.getByLabelText(/side b faction/i), { target: { value: "NVN" } });
    fireEvent.click(screen.getByRole("button", { name: /create conflict/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Vietnam War",
      hostCountry: "SVN",
      hostEntities: ["NVN", "SVN"],
    });
    expect(await screen.findByText(/#3/)).toBeInTheDocument();
  });

  it("surfaces the server's refusal reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "SVN has no home region." }),
      })
    );

    render(<CreateColdWarConflictForm />);
    fireEvent.change(screen.getByLabelText(/conflict name/i), { target: { value: "Test War" } });
    fireEvent.click(screen.getByRole("button", { name: /create conflict/i }));

    expect(await screen.findByText(/no home region/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/admin/conflicts/CreateColdWarConflictForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the form**

Create `src/components/admin/conflicts/CreateColdWarConflictForm.tsx`:

```tsx
"use client";

import { useState } from "react";

/**
 * Admin creation for a Cold War Conflict.
 *
 * Nothing else in the game creates one — `declareWar` only builds interstate wars
 * between playable countries — so this form is what makes the whole proxy-war feature
 * reachable, and it is the only writer of `hostCountry`/`hostEntities`.
 */
export function CreateColdWarConflictForm() {
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const [anchor, setAnchor] = useState("");
  const [aLabel, setALabel] = useState("");
  const [aFaction, setAFaction] = useState("");
  const [bLabel, setBLabel] = useState("");
  const [bFaction, setBFaction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/admin/conflicts/cold-war/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          hostCountry: anchor.trim().toUpperCase(),
          hostEntities: hosts
            .split(",")
            .map((h) => h.trim().toUpperCase())
            .filter(Boolean),
          sideA: { label: aLabel, factionEntity: aFaction, backer: "west", tokenStrength: 40 },
          sideB: { label: bLabel, factionEntity: bFaction, backer: "east", tokenStrength: 40 },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Creation failed.");
        return;
      }
      setCreated(data.conflictId);
    } catch {
      setError("Creation failed.");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        className="rounded border border-default bg-card px-2 py-1 text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <section className="mt-6 rounded-lg border border-default bg-card p-4">
      <h3 className="text-sm font-semibold">Create Cold War Conflict</h3>
      <p className="mt-1 text-xs text-muted">
        A proxy war fought on third-party soil. Both sides are factions backed by a bloc;
        host entities are the countries that change bloc when it resolves.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {field("cw-name", "Conflict name", name, setName, "Vietnam War")}
        {field("cw-hosts", "Host entities (comma separated)", hosts, setHosts, "NVN, SVN")}
        {field("cw-anchor", "Map anchor", anchor, setAnchor, "SVN")}
        <div />
        {field("cw-a-label", "Side A label (West)", aLabel, setALabel, "Republic of Vietnam")}
        {field("cw-a-faction", "Side A faction entity", aFaction, setAFaction, "SVN")}
        {field("cw-b-label", "Side B label (East)", bLabel, setBLabel, "DRV")}
        {field("cw-b-faction", "Side B faction entity", bFaction, setBFaction, "NVN")}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="mt-4 rounded bg-accent px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create conflict"}
      </button>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
      {created != null && (
        <p className="mt-3 text-sm text-success">
          Created conflict #{created}. View it at /world/conflicts/{created}.
        </p>
      )}
    </section>
  );
}
```

⚠️ The class names above follow this repo's semantic tokens (`bg-card`, `border-default`, `text-muted`). If `design:check` rejects any of them, replace with the nearest token the check accepts — do not introduce raw hex colours.

- [ ] **Step 4: Mount it**

Replace `src/components/admin/conflicts/ConflictsManager.tsx`:

```tsx
import { ConflictsGeneralToggle } from "./ConflictsGeneralToggle";
import { CreateColdWarConflictForm } from "./CreateColdWarConflictForm";

export function ConflictsManager() {
  return (
    <>
      <ConflictsGeneralToggle />
      <CreateColdWarConflictForm />
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/admin/conflicts/CreateColdWarConflictForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full gate**

```bash
npm run lint
npm run format:check
NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit
npx vitest run src/lib/military src/app/api/admin/conflicts src/components/admin/conflicts
```

Expected: lint 0 errors, format clean, no new tsc errors, all touched suites green. Run `npm run test:run` separately if you want the full suite — **never chained with `npm run build`**.

- [ ] **Step 7: Commit**

```bash
npm run format
git add -A
git commit -m "feat(conflicts): add the admin cold war conflict creation form"
```

---

## Manual verification

With the dev server running (see `feedback_dev_server_heap_cap` — `HEAP_WATCHDOG_RSS_CAP_BYTES=12e9`) **against an isolated database**, because `next dev` boots cron and auto-seed against whatever DB is configured:

1. Admin ▸ World ▸ Conflicts — enable the Conflicts toggle.
2. Fill the form with the Vietnam values above and submit.
3. Expect "Created conflict #N".
4. Visit `/world/conflicts/N` — the record page should render the conflict's name, both faction labels, and a 50/50 territory split.
5. The front map will show **the territory meter only**. That is correct for PR1: `regionCodesOfCountry` returns `[]` for `NVN`/`SVN`, and static-feature rendering lands in PR4.

## What this PR deliberately does not do

- No faction placement chain, token force, three-turn hold, or resolution — PR4.
- No `join_conflict` resolution type or mirrored bill — PR3.
- No `active_both` bill status or concurrent vote stage — PR2.
- No static map geometry — PR4.
- No era-seeded proxy wars; admin creation only.

## Follow-on plans

| PR | Plan | Depends on |
|---|---|---|
| PR2 | Concurrent bicameral vote (`active_both`, `ConcurrentVoteStage`, B1–B6) | nothing — ships independently, inert until PR3 |
| PR3 | Join Conflict resolution + mirrored bill | PR2 (the stage), PR1 (something to join) |
| PR4 | Cold War Conflicts: faction placement, token force, hold, resolution, map | PR1 (the type and creation surface) |
