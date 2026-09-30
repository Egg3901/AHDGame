import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRuConvocationReset } from "./ruConvocation";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import { resolveCountryOfficeLayout } from "@/lib/countries/rules/officeLayout";

vi.mock("@/lib/countries/runtimeOffices", () => ({ loadRuntimeCountryOffices: vi.fn() }));

vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  resetParliamentaryGovernmentAfterElection: vi.fn().mockResolvedValue(undefined),
}));

function makeDb(gov: Record<string, unknown> | null) {
  const updateOne = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({});
  return {
    db: {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "electedOfficials") return { deleteMany };
        return {
          updateMany,
          findOne: vi.fn().mockResolvedValue(gov),
          updateOne,
        };
      }),
    },
    updateOne,
    deleteMany,
    updateMany,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadRuntimeCountryOffices).mockResolvedValue(
    resolveCountryOfficeLayout(getCountryConfigForRuntime("RU", "1953-default"))
  );
});

describe("handleRuConvocationReset", () => {
  it("resets the government and disarms the snap watchdog on a new convocation", async () => {
    const { db, updateOne, deleteMany, updateMany } = makeDb({ _id: "RU", cycle: 1 });
    await handleRuConvocationReset(db as never, 1, new Date());
    const { resetParliamentaryGovernmentAfterElection } =
      await import("@/lib/turn/parliamentaryGovernment");
    expect(resetParliamentaryGovernmentAfterElection).toHaveBeenCalledWith(
      expect.anything(),
      "RU",
      expect.any(Date)
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "RU" },
      { $set: expect.objectContaining({ pmVacancyDeadlineTurn: null }) }
    );
    // Convocation vacates the Chairman of the Presidium (4b).
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "RU" },
      { $set: expect.objectContaining({ hosCharacterId: null, hosNppId: null, hosName: null }) }
    );
    expect(deleteMany).toHaveBeenCalledWith({
      countryId: "RU",
      officeType: "chairmanOfPresidium",
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith(
      { countryId: "RU", "currentOffice.type": "chairmanOfPresidium" },
      { $set: expect.objectContaining({ currentOffice: null }) }
    );
  });

  it("no-ops when the formation already advanced past this convocation (double-fire guard)", async () => {
    const { db, updateOne } = makeDb({ _id: "RU", cycle: 2 });
    await handleRuConvocationReset(db as never, 1, new Date());
    const { resetParliamentaryGovernmentAfterElection } =
      await import("@/lib/turn/parliamentaryGovernment");
    expect(resetParliamentaryGovernmentAfterElection).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("treats a missing formation doc as cycle 0 and resets", async () => {
    const { db } = makeDb(null);
    await handleRuConvocationReset(db as never, 1, new Date());
    const { resetParliamentaryGovernmentAfterElection } =
      await import("@/lib/turn/parliamentaryGovernment");
    expect(resetParliamentaryGovernmentAfterElection).toHaveBeenCalled();
  });
  it("reopens provisional Congress appointments without disarming its vacancy deadline", async () => {
    vi.mocked(loadRuntimeCountryOffices).mockResolvedValue(
      resolveCountryOfficeLayout(
        getCountryConfigForRuntime("RU", "1991-default", {
          ruSovietSuccessionSinceTurn: 2,
          ruProvisionalCongressSeats: 10,
        })
      )
    );
    const { db, updateOne, deleteMany } = makeDb({ _id: "RU", cycle: 1 });
    await handleRuConvocationReset(db as never, 1, new Date(0), "congressDeputy");
    expect(updateOne).not.toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({ pmVacancyDeadlineTurn: null }),
    });
    expect(deleteMany).toHaveBeenCalledWith({
      countryId: "RU",
      officeType: "chairmanOfSupremeSoviet",
    });
  });

  it("keeps a direct president's mandate after a Duma election", async () => {
    vi.mocked(loadRuntimeCountryOffices).mockResolvedValue(
      resolveCountryOfficeLayout(
        getCountryConfigForRuntime("RU", "1991-default", {
          ruSovietSuccessionSinceTurn: 2,
          ruFederalAssemblySinceTurn: 3,
        })
      )
    );
    const { db, updateOne, deleteMany } = makeDb({ _id: "RU", cycle: 1 });
    await handleRuConvocationReset(db as never, 1, new Date(0), "snap_stateDuma");
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    const { resetParliamentaryGovernmentAfterElection } =
      await import("@/lib/turn/parliamentaryGovernment");
    expect(resetParliamentaryGovernmentAfterElection).toHaveBeenCalledOnce();
  });

  it("ignores a stale Supreme Soviet result after Soviet succession", async () => {
    vi.mocked(loadRuntimeCountryOffices).mockResolvedValue(
      resolveCountryOfficeLayout(
        getCountryConfigForRuntime("RU", "1991-default", { ruSovietSuccessionSinceTurn: 2 })
      )
    );
    const { db, updateOne, deleteMany } = makeDb({ _id: "RU", cycle: 1 });
    await handleRuConvocationReset(db as never, 1, new Date(0));
    expect(updateOne).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    const { resetParliamentaryGovernmentAfterElection } =
      await import("@/lib/turn/parliamentaryGovernment");
    expect(resetParliamentaryGovernmentAfterElection).not.toHaveBeenCalled();
  });
  it("does not reset a government from a dissolved Congress result", async () => {
    vi.mocked(loadRuntimeCountryOffices).mockResolvedValue(
      resolveCountryOfficeLayout(
        getCountryConfigForRuntime("RU", "1991-default", {
          ruSovietSuccessionSinceTurn: 2,
          ruCongressDissolvedSinceTurn: 3,
        })
      )
    );
    const { db, updateOne, deleteMany } = makeDb({ _id: "RU", cycle: 1 });
    await handleRuConvocationReset(db as never, 1, new Date(0), "congressOfPeoplesDeputies");
    expect(updateOne).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    const { resetParliamentaryGovernmentAfterElection } =
      await import("@/lib/turn/parliamentaryGovernment");
    expect(resetParliamentaryGovernmentAfterElection).not.toHaveBeenCalled();
  });
});
