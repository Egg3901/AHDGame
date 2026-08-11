import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleRuConvocationReset } from "./ruConvocation";

vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  resetParliamentaryGovernmentAfterElection: vi.fn().mockResolvedValue(undefined),
}));

function makeDb(gov: Record<string, unknown> | null) {
  const updateOne = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({});
  return {
    db: {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "electedOfficials") return { deleteMany };
        return {
          findOne: vi.fn().mockResolvedValue(gov),
          updateOne,
        };
      }),
    },
    updateOne,
    deleteMany,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("handleRuConvocationReset", () => {
  it("resets the government and disarms the snap watchdog on a new convocation", async () => {
    const { db, updateOne, deleteMany } = makeDb({ _id: "RU", cycle: 1 });
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
});
