import { describe, it, expect } from "vitest";
import { mergeOffensives, defendersAtFront, autoJoinersAtFront } from "../coalition";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { BattleDeclarationDoc } from "@/lib/db/types/battleDeclaration";

const conflict = {
  _id: "t1",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition", backer: "west" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
} as unknown as ConflictDoc;

// The era's bloc roll, as `loadMilitaryBlocs` would return it. Only outsiders — the
// countries on neither roster — are placed through it.
const BLOCS = { US: "west", UK: "west", CN: "east", RU: "east" } as const;

// String ids keep the fixtures readable; the resolver only ever stringifies them.
type DeclOverrides = Partial<Omit<BattleDeclarationDoc, "_id">> & { _id?: string };
const decl = (o: DeclOverrides) =>
  ({
    _id: "d1",
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "t1",
    declaredTurn: 40,
    status: "pending",
    declaredByCharacterId: null,
    ...o,
  }) as unknown as BattleDeclarationDoc;

describe("mergeOffensives", () => {
  // Order is not cosmetic. The resolver fights the offensives it is handed in order,
  // and each one leaves the front and both armies changed for the next, so whichever
  // comes first fights at full strength and takes its ground first. Declarations
  // arrive in database order, which is not specified — the same rule the attacker
  // roster is already normalised by decides this too: earliest declaration wins.
  it("orders offensives by the earliest declaration, not by database order", () => {
    const out = mergeOffensives(
      conflict,
      [
        decl({ _id: "d9", declarerCountry: "CN", targetCountry: "US", declaredTurn: 40 }),
        decl({ _id: "d2", declarerCountry: "US", targetCountry: "CN", declaredTurn: 39 }),
      ],
      41,
      BLOCS
    );
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.side)).toEqual(["A", "B"]);
  });

  it("breaks an order tie on the same turn by declaration id", () => {
    const out = mergeOffensives(
      conflict,
      [
        decl({ _id: "d9", declarerCountry: "CN", targetCountry: "US" }),
        decl({ _id: "d2", declarerCountry: "US", targetCountry: "CN" }),
      ],
      41,
      BLOCS
    );
    expect(out.map((o) => o.side)).toEqual(["A", "B"]);
  });

  it("merges two allies attacking the same enemy side at the same front", () => {
    const out = mergeOffensives(
      conflict,
      [decl({ _id: "d1", declarerCountry: "US" }), decl({ _id: "d2", declarerCountry: "UK" })],
      41,
      BLOCS
    );
    expect(out).toHaveLength(1);
    expect([...out[0].attackers].sort()).toEqual(["UK", "US"]);
    expect(out[0].side).toBe("A");
    expect(out[0].enemySide).toBe("B");
  });

  it("merges allies naming DIFFERENT enemies on the same side", () => {
    const two = {
      ...conflict,
      sideB: { ...conflict.sideB, countries: ["CN", "RU"] },
    } as unknown as ConflictDoc;
    const out = mergeOffensives(
      two,
      [
        decl({ _id: "d1", declarerCountry: "US", targetCountry: "CN" }),
        decl({ _id: "d2", declarerCountry: "UK", targetCountry: "RU" }),
      ],
      41,
      BLOCS
    );
    expect(out).toHaveLength(1);
    expect([...out[0].attackers].sort()).toEqual(["UK", "US"]);
  });

  it("does not merge declarations at different fronts", () => {
    const out = mergeOffensives(
      conflict,
      [decl({ _id: "d1" }), decl({ _id: "d2", declarerCountry: "UK", theaterId: "t2" })],
      41,
      BLOCS
    );
    expect(out).toHaveLength(2);
  });

  it("skips declarations not yet eligible (declaredTurn >= currentTurn)", () => {
    expect(mergeOffensives(conflict, [decl({ declaredTurn: 41 })], 41, BLOCS)).toEqual([]);
  });

  it("picks the principal deterministically: earliest turn, then _id", () => {
    const out = mergeOffensives(
      conflict,
      [
        decl({ _id: "d9", declarerCountry: "UK", declaredTurn: 40 }),
        decl({ _id: "d2", declarerCountry: "US", declaredTurn: 39 }),
      ],
      41,
      BLOCS
    );
    expect(String(out[0].principal._id)).toBe("d2");
  });

  it("breaks a same-turn tie by _id so the principal is stable", () => {
    const out = mergeOffensives(
      conflict,
      [
        decl({ _id: "d9", declarerCountry: "UK", declaredTurn: 40 }),
        decl({ _id: "d1", declarerCountry: "US", declaredTurn: 40 }),
      ],
      41,
      BLOCS
    );
    expect(String(out[0].principal._id)).toBe("d1");
  });

  it("keeps an unplaceable matchup as a null-sided offensive: it fights, moves nothing", () => {
    // Long-standing behaviour: a matchup that cannot be resolved to opposing sides
    // still fights the battle, it just cannot move the front. Dropping it here would
    // silently turn those declarations into fizzles.
    const noBacker = {
      ...conflict,
      sideA: { ...conflict.sideA, countries: [], backer: undefined },
      sideB: { ...conflict.sideB, countries: [], backer: undefined },
    } as unknown as ConflictDoc;
    const out = mergeOffensives(noBacker, [decl({ declarerCountry: "US" })], 41, BLOCS);
    expect(out).toHaveLength(1);
    expect(out[0].side).toBeNull();
    expect(out[0].enemySide).toBeNull();
    expect(out[0].attackers).toEqual(["US"]);
  });

  it("never merges two unplaceable declarations together", () => {
    // With no sides there is nothing to pool them on, so each fights its own battle.
    const noBacker = {
      ...conflict,
      sideA: { ...conflict.sideA, countries: [], backer: undefined },
      sideB: { ...conflict.sideB, countries: [], backer: undefined },
    } as unknown as ConflictDoc;
    const out = mergeOffensives(
      noBacker,
      [decl({ _id: "d1", declarerCountry: "US" }), decl({ _id: "d2", declarerCountry: "UK" })],
      41,
      BLOCS
    );
    expect(out).toHaveLength(2);
  });

  it("drops a declaration whose target is on the declarer's own side", () => {
    // US and UK are both on side A; one cannot attack the other here.
    expect(
      mergeOffensives(conflict, [decl({ declarerCountry: "US", targetCountry: "UK" })], 41, BLOCS)
    ).toEqual([]);
  });

  it("keeps every merged declaration so all of them can be marked resolved", () => {
    const out = mergeOffensives(
      conflict,
      [decl({ _id: "d1", declarerCountry: "US" }), decl({ _id: "d2", declarerCountry: "UK" })],
      41,
      BLOCS
    );
    expect(out[0].declarations.map((d) => String(d._id)).sort()).toEqual(["d1", "d2"]);
  });

  it("puts the principal first and the rest in a stable order", () => {
    // Pending declarations arrive in database order; the roster must not.
    const forward = mergeOffensives(
      conflict,
      [
        decl({ _id: "d3", declarerCountry: "UK", declaredTurn: 40 }),
        decl({ _id: "d1", declarerCountry: "US", declaredTurn: 39 }),
      ],
      41,
      BLOCS
    );
    const reversed = mergeOffensives(
      conflict,
      [
        decl({ _id: "d1", declarerCountry: "US", declaredTurn: 39 }),
        decl({ _id: "d3", declarerCountry: "UK", declaredTurn: 40 }),
      ],
      41,
      BLOCS
    );
    expect(forward[0].attackers).toEqual(["US", "UK"]);
    expect(reversed[0].attackers).toEqual(forward[0].attackers);
  });

  it("does not double-list a country that declared twice at one front", () => {
    const out = mergeOffensives(
      conflict,
      [decl({ _id: "d1", declarerCountry: "US" }), decl({ _id: "d2", declarerCountry: "US" })],
      41,
      BLOCS
    );
    expect(out[0].attackers).toEqual(["US"]);
    expect(out[0].declarations).toHaveLength(2);
  });
});

describe("defendersAtFront", () => {
  const units = [
    { countryId: "CN", theaterId: "t1" },
    { countryId: "RU", theaterId: "t1" },
    { countryId: "US", theaterId: "t1" },
    { countryId: "CN", theaterId: "t2" },
  ];

  it("includes every country at the front that resolves to the defending side", () => {
    const two = {
      ...conflict,
      sideB: { ...conflict.sideB, countries: ["CN", "RU"] },
    } as unknown as ConflictDoc;
    expect([...defendersAtFront(two, units, "t1", "B", BLOCS)].sort()).toEqual(["CN", "RU"]);
  });

  it("resolves an unrostered ally by a unique bloc match", () => {
    // RU is not on either roster; bloc east matches sideB.backer and not sideA's.
    expect(defendersAtFront(conflict, units, "t1", "B", BLOCS)).toContain("RU");
  });

  it("never returns a country that resolves to the attacking side", () => {
    expect(defendersAtFront(conflict, units, "t1", "B", BLOCS)).not.toContain("US");
  });

  it("excludes countries whose units are at a different front", () => {
    const elsewhere = [{ countryId: "CN", theaterId: "t2" }];
    expect(defendersAtFront(conflict, elsewhere, "t1", "B", BLOCS)).toEqual([]);
  });

  it("lists each country once however many units it has there", () => {
    const many = [
      { countryId: "CN", theaterId: "t1" },
      { countryId: "CN", theaterId: "t1" },
      { countryId: "CN", theaterId: "t1" },
    ];
    expect(defendersAtFront(conflict, many, "t1", "B", BLOCS)).toEqual(["CN"]);
  });
});

describe("autoJoinersAtFront", () => {
  const units = [
    { countryId: "US", theaterId: "t1" },
    { countryId: "UK", theaterId: "t1" },
    { countryId: "CN", theaterId: "t1" },
    { countryId: "UK", theaterId: "t2" },
  ];

  it("includes an ally that opted in and has troops at the front", () => {
    expect(autoJoinersAtFront(conflict, units, "t1", "A", BLOCS, new Set(["UK"]))).toEqual(["UK"]);
  });

  it("excludes an ally that has not opted in", () => {
    // The whole point of the toggle: silence means the old behaviour.
    expect(autoJoinersAtFront(conflict, units, "t1", "A", BLOCS, new Set())).toEqual([]);
  });

  it("excludes an opted-in country with no troops at THIS front", () => {
    // US is posted to t1 only. Opting in does not teleport an army to t2, and UK, which
    // IS at t2, has not opted in.
    expect(autoJoinersAtFront(conflict, units, "t2", "A", BLOCS, new Set(["US"]))).toEqual([]);
  });

  it("never pulls in a country on the other side, however it opted in", () => {
    // CN is at t1 and opted in, but resolves to the defending side.
    expect(autoJoinersAtFront(conflict, units, "t1", "A", BLOCS, new Set(["CN", "UK"]))).toEqual([
      "UK",
    ]);
  });

  it("mirrors defendersAtFront when everyone has opted in", () => {
    // The two functions ask the same question of opposite sides. With the opt-in
    // satisfied, attacking-side membership must select exactly what defending-side
    // membership would select for the other side.
    const all = new Set(["US", "UK", "CN"]);
    const attackers = autoJoinersAtFront(conflict, units, "t1", "A", BLOCS, all);
    const defenders = defendersAtFront(conflict, units, "t1", "B", BLOCS);
    expect(attackers.sort()).toEqual(["UK", "US"]);
    expect(defenders).toEqual(["CN"]);
    // No country can be in both.
    expect(attackers.filter((c) => defenders.includes(c))).toEqual([]);
  });

  it("returns each country once even when it has many formations posted", () => {
    const many = [
      { countryId: "UK", theaterId: "t1" },
      { countryId: "UK", theaterId: "t1" },
      { countryId: "UK", theaterId: "t1" },
    ];
    expect(autoJoinersAtFront(conflict, many, "t1", "A", BLOCS, new Set(["UK"]))).toEqual(["UK"]);
  });
});
