import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";
import {
  sovereignBondCapError,
  sovereignBondRemainingCapacityUnits,
  currentHolderUnits,
  SOVEREIGN_BOND_HOLDER_CAP,
} from "./holderCap";

const buyer = new ObjectId();
const other = new ObjectId();

// `totalIssued` is denominated in currency (dollars), not units — sovereign.ts
// sets it to `normalizedIssueAmount` while `publicFloat` carries the unit count.
// Each unit is BOND_UNIT_FACE_VALUE (1000) currency, so 1_000_000 issued = 1000
// units and a 25% cap = 250 units, matching the unit-count assertions below.
function bond(partial: Partial<Bond>): Bond {
  return {
    issuerType: "sovereign",
    faceValue: 1000,
    totalIssued: 1_000_000,
    holders: [],
    ...partial,
  } as unknown as Bond;
}

describe("sovereignBondCapError", () => {
  it("allows a purchase up to the cap", () => {
    // cap = 25% of 1000 units (1_000_000 / 1000 face) = 250 units
    expect(sovereignBondCapError(bond({}), "characterId", buyer, 250)).toBeNull();
  });

  it("blocks a purchase that exceeds the cap", () => {
    const err = sovereignBondCapError(bond({}), "characterId", buyer, 251);
    expect(err).toContain("Sovereign bond position limit");
  });

  it("counts the buyer's existing holding toward the cap", () => {
    const b = bond({ holders: [{ characterId: buyer, units: 200 } as never] });
    // already holds 200; +51 would reach 251 > 250 cap
    expect(sovereignBondCapError(b, "characterId", buyer, 51)).toContain("position limit");
    expect(sovereignBondCapError(b, "characterId", buyer, 50)).toBeNull();
  });

  it("does not cap another holder's units against this buyer", () => {
    const b = bond({ holders: [{ characterId: other, units: 900 } as never] });
    expect(sovereignBondCapError(b, "characterId", buyer, 250)).toBeNull();
  });

  it("never caps corporate bonds", () => {
    const b = bond({ issuerType: "corporation", totalIssued: 1000 });
    expect(sovereignBondCapError(b, "characterId", buyer, 1000)).toBeNull();
  });

  it("no-ops when issue size is unknown", () => {
    expect(sovereignBondCapError(bond({ totalIssued: 0 }), "characterId", buyer, 1e9)).toBeNull();
  });

  it("currentHolderUnits reads the matching holder", () => {
    const b = bond({ holders: [{ characterId: buyer, units: 42 } as never] });
    expect(currentHolderUnits(b, "characterId", buyer)).toBe(42);
    expect(currentHolderUnits(b, "characterId", other)).toBe(0);
  });

  it("cap fraction is 25%", () => {
    expect(SOVEREIGN_BOND_HOLDER_CAP).toBe(0.25);
  });

  it("reports remaining capacity for fund allocators", () => {
    const fundId = new ObjectId();
    const b = bond({ holders: [{ fundId, units: 175 } as never] });
    expect(sovereignBondRemainingCapacityUnits(b, "fundId", fundId)).toBe(75);
  });
});
