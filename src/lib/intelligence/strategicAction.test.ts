import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { CovertProgramState } from "@/lib/military/covertNuclear";
import { COVERT_PATRON, isCovertProgrammeActive, sabotagedCovertState } from "./strategicAction";

vi.mock("@/lib/db/collections/covertNuclearPrograms", () => ({
  getCovertNuclearProgram: vi.fn(),
  putCovertNuclearProgram: vi.fn(),
}));
vi.mock("@/lib/military/covertCrackdown", () => ({ applyCovertCrackdown: vi.fn() }));

const { getCovertNuclearProgram, putCovertNuclearProgram } =
  await import("@/lib/db/collections/covertNuclearPrograms");
const { applyCovertCrackdown } = await import("@/lib/military/covertCrackdown");

function state(over: Partial<CovertProgramState> = {}): CovertProgramState {
  return {
    stage: 3,
    progress: 40,
    funding: "steady",
    suspicion: 40,
    exposureCount: 0,
    completed: false,
    ...over,
  };
}

const db = {} as Db;

describe("sabotagedCovertState", () => {
  it("loses the stage in progress and one completed stage", () => {
    const after = sabotagedCovertState(state());
    expect(after.stage).toBe(2);
    expect(after.progress).toBe(0);
  });

  it("never falls below stage zero", () => {
    expect(sabotagedCovertState(state({ stage: 0 })).stage).toBe(0);
  });

  it("leaves funding and suspicion alone", () => {
    // Sabotage is something breaking for reasons the programme cannot see. A
    // CRACKDOWN is the government being caught and reacting; that one cuts
    // funding and resets suspicion. These must not be conflated.
    const after = sabotagedCovertState(state());
    expect(after.funding).toBe("steady");
    expect(after.suspicion).toBe(40);
  });

  it("cannot un-build a device already banked", () => {
    expect(sabotagedCovertState(state({ completed: true })).completed).toBe(true);
  });
});

describe("isCovertProgrammeActive", () => {
  it("counts a funded programme with no stages yet", () => {
    expect(isCovertProgrammeActive(state({ stage: 0, funding: "trickle" }))).toBe(true);
  });

  it("counts a defunded programme that has stages", () => {
    expect(isCovertProgrammeActive(state({ stage: 2, funding: "none" }))).toBe(true);
  });

  it("does not count a programme nobody ever started", () => {
    expect(isCovertProgrammeActive(state({ stage: 0, funding: "none" }))).toBe(false);
  });
});

describe("applyStrategicAction", () => {
  it("does nothing to a country that cannot run a covert programme", async () => {
    const { applyStrategicAction } = await import("./strategicAction");
    const r = await applyStrategicAction(db, "US", "UK", 10);
    expect(r).toEqual({ sabotaged: false, crackdown: false });
    expect(putCovertNuclearProgram).not.toHaveBeenCalled();
  });

  it("does nothing when the programme was never started", async () => {
    vi.mocked(getCovertNuclearProgram).mockResolvedValue(
      state({ stage: 0, funding: "none" }) as never
    );
    const { applyStrategicAction } = await import("./strategicAction");
    const r = await applyStrategicAction(db, "US", "DD", 10);
    expect(r.sabotaged).toBe(false);
    expect(putCovertNuclearProgram).not.toHaveBeenCalled();
  });

  it("knocks the programme back QUIETLY for a non-patron", async () => {
    vi.clearAllMocks();
    vi.mocked(getCovertNuclearProgram).mockResolvedValue(state() as never);
    const { applyStrategicAction } = await import("./strategicAction");
    const r = await applyStrategicAction(db, "US", "DD", 10);
    expect(r).toEqual({ sabotaged: true, crackdown: false });
    expect(putCovertNuclearProgram).toHaveBeenCalled();
    // Washington breaking a centrifuge is not a Soviet inspection.
    expect(applyCovertCrackdown).not.toHaveBeenCalled();
  });

  it("triggers the public crackdown when the PATRON acts", async () => {
    vi.clearAllMocks();
    vi.mocked(getCovertNuclearProgram).mockResolvedValue(state() as never);
    const { applyStrategicAction } = await import("./strategicAction");
    const r = await applyStrategicAction(db, "RU", "DD", 10);
    expect(r).toEqual({ sabotaged: true, crackdown: true });
    expect(applyCovertCrackdown).toHaveBeenCalledWith(db, "DD", 10);
  });

  it("names Moscow as East Germany's patron", () => {
    expect(COVERT_PATRON.DD).toBe("RU");
  });
});
