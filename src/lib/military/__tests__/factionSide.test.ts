import { describe, it, expect } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { Front } from "@/lib/military/combat";
import { buildFactionSide } from "../factionSide";

const front = { id: "vietnam", name: "Vietnam", terr: 1.1, infra: 20 } as unknown as Front;

const vietnam = {
  _id: "vietnam",
  enemyMix: ["infantry", "mech"],
  sideA: {
    label: "Republic of Vietnam",
    countries: [],
    kind: "generated",
    backer: "west",
    factionEntity: "SVN",
    tokenStrength: 40,
  },
  sideB: {
    label: "DRV",
    countries: [],
    kind: "generated",
    backer: "east",
    factionEntity: "NVN",
    tokenStrength: 40,
  },
} as unknown as ConflictDoc;

const withStrength = (n: number) =>
  ({ ...vietnam, sideB: { ...vietnam.sideB, tokenStrength: n } }) as unknown as ConflictDoc;

describe("faction token force", () => {
  it("produces a BattleSide named for the faction", () => {
    const side = buildFactionSide(vietnam, "B", front);

    expect(side.country).toBe("NVN");
    expect(side.units.length).toBeGreaterThan(0);
    // A faction fields no generals and holds no doctrine.
    expect(side.assignments).toEqual([]);
    expect(side.generalsById).toEqual({});
    expect(side.side).toBe("B");
  });

  it("puts its units at the front so the battle math can find them", () => {
    const side = buildFactionSide(vietnam, "B", front);
    for (const u of side.units) expect(u.theaterId).toBe("vietnam");
  });

  it("scales with tokenStrength", () => {
    const weak = buildFactionSide(withStrength(10), "B", front);
    const strong = buildFactionSide(withStrength(100), "B", front);

    expect(strong.units.length).toBeGreaterThanOrEqual(weak.units.length);
    const power = (s: { units: { basePower: number }[] }) =>
      s.units.reduce((t, u) => t + u.basePower, 0);
    // Not just a longer roster — a stronger one, so grinding a faction down actually
    // weakens it.
    expect(power(strong)).toBeGreaterThan(power(weak));
  });

  it("still fields a formation for a nearly-destroyed faction", () => {
    // A faction with 5 strength left is a beaten army, not an absent one. Rounding it
    // to zero units would hand the attacker the walkover this whole thing prevents.
    const remnant = buildFactionSide(withStrength(5), "B", front);
    expect(remnant.units.length).toBe(1);
  });

  it("fields nothing once its strength is gone", () => {
    expect(buildFactionSide(withStrength(0), "B", front).units).toHaveLength(0);
  });

  it("is deterministic — the same conflict yields the same force", () => {
    const a = buildFactionSide(vietnam, "B", front);
    const b = buildFactionSide(vietnam, "B", front);

    expect(a.units.map((u) => [u.type, u.basePower])).toEqual(
      b.units.map((u) => [u.type, u.basePower])
    );
  });
});
