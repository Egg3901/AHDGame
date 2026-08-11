import { describe, expect, it } from "vitest";
import {
  EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
  PL_CABINET_POSITIONS,
  YU_CABINET_POSITIONS,
} from "./easternBlocCabinet";
import { DD_CABINET_POSITIONS } from "./ddCabinet";
import { isSeatActive, PERPETUAL_YEAR } from "@/lib/cabinet/rosterEra";
import type { CabinetPositionDef } from "./cabinetMechanics";

// Must be CabinetPositionDef, not `{ id: string }` — `tsc --noEmit` covers test
// files, and isSeatActive/`.yearEnabled` both need the real type.
const defence = (positions: ReadonlyArray<CabinetPositionDef>): CabinetPositionDef =>
  positions.find((p) => p.id === "minister_of_defence")!;

describe("eastern bloc defence seat", () => {
  it("is active in 1953 for every non-GDR user of the shape", () => {
    for (const [label, positions] of [
      ["HU/RO/BG/CS", EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS],
      ["PL", PL_CABINET_POSITIONS],
      ["YU", YU_CABINET_POSITIONS],
    ] as const) {
      expect(isSeatActive(defence(positions), 1953), label).toBe(true);
    }
  });

  it("uses the perpetual year rather than the GDR's 1956 stand-up", () => {
    expect(defence(PL_CABINET_POSITIONS).yearEnabled).toBe(PERPETUAL_YEAR);
  });

  it("leaves the GDR's own roster gated to 1956", () => {
    expect(defence(DD_CABINET_POSITIONS).yearEnabled).toBe(1956);
    expect(isSeatActive(defence(DD_CABINET_POSITIONS), 1953)).toBe(false);
  });

  it("changes nothing else about the shared roster", () => {
    expect(EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS.map((p) => p.id)).toEqual(
      DD_CABINET_POSITIONS.map((p) => p.id)
    );
  });

  it("keeps each country's head-of-government remap", () => {
    expect(PL_CABINET_POSITIONS.some((p) => p.id === "firstSecretary")).toBe(true);
    expect(YU_CABINET_POSITIONS.some((p) => p.id === "president")).toBe(true);
  });
});
