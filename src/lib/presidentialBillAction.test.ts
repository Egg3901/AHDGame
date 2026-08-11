import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { executePresidentialBillAction } from "./presidentialBillAction";

vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({
  onBillEnacted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/news", () => ({
  generateBillSignedNews: vi.fn().mockResolvedValue(undefined),
  generateBillVetoedNews: vi.fn().mockResolvedValue(undefined),
}));
// Keep the real pure embed builder; spy only on the network send.
vi.mock("@/lib/discordWebhooks", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/discordWebhooks")>();
  return { ...actual, sendCountryGameEvent: vi.fn().mockResolvedValue(undefined) };
});

describe("executePresidentialBillAction", () => {
  const billId = new ObjectId();
  const charId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when bill not found", async () => {
    const billsFindOne = vi.fn().mockResolvedValue(null);
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        findOne: billsFindOne,
        updateOne: vi.fn(),
      }),
    };

    const result = await executePresidentialBillAction(mockDb as never, billId, charId, "sign");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Bill not found");
  });

  it("returns error when bill not enrolled", async () => {
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "bills") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: billId,
              status: "active",
              title: "Test Bill",
            }),
            updateOne: vi.fn(),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };

    const result = await executePresidentialBillAction(mockDb as never, billId, charId, "sign");

    expect(result.success).toBe(false);
    expect(result.error).toBe("This bill is not awaiting presidential action.");
  });

  it("emits a US game-event webhook naming the vetoed bill and president", async () => {
    const sponsorId = new ObjectId();
    const bill = {
      _id: billId,
      status: "enrolled",
      title: "Clean Air Act",
      countryId: "US",
      sponsorId,
      sponsorName: "Bob",
    };
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "bills") {
          return {
            findOne: vi.fn().mockResolvedValue(bill),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockImplementation((q: { _id?: ObjectId }) => {
              if (q?._id?.equals?.(charId)) {
                return Promise.resolve({ _id: charId, name: "Jane Doe" });
              }
              if (q?._id?.equals?.(sponsorId)) {
                return Promise.resolve({ _id: sponsorId, userId: new ObjectId(), name: "Bob" });
              }
              return Promise.resolve(null);
            }),
          };
        }
        if (name === "gameState") {
          return { findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 10 }) };
        }
        if (name === "electedOfficials") {
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn(),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    };

    const result = await executePresidentialBillAction(
      mockDb as never,
      billId,
      charId,
      "veto",
      "Too costly"
    );

    expect(result.success).toBe(true);

    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
    const [countryArg, embedArg] = vi.mocked(sendCountryGameEvent).mock.calls[0];
    expect(countryArg).toBe("US");
    expect(embedArg.title).toBe("USA — Bill Vetoed — Federal");
    expect(embedArg.description).toContain("Clean Air Act");
    expect(embedArg.description).toContain("President Jane Doe");
    expect(embedArg.fields?.find((f) => f.name === "Veto Message")?.value).toBe("Too costly");
  });

  it("does not enact when a concurrent request already signed the bill (lost the claim)", async () => {
    const bill = {
      _id: billId,
      status: "enrolled",
      title: "Test Bill",
      provisions: [],
      legislationTypeId: null,
    };
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "bills") {
          return {
            findOne: vi.fn().mockResolvedValue(bill),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
          };
        }
        if (name === "gameState") {
          return { findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 5 }) };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    };

    const { onBillEnacted } = await import("@/lib/billEnactment");
    const result = await executePresidentialBillAction(mockDb as never, billId, charId, "sign");

    expect(onBillEnacted).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("does not announce a veto when a concurrent request already acted (lost the claim)", async () => {
    const bill = { _id: billId, status: "enrolled", title: "Clean Air Act", countryId: "US" };
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "bills") {
          return {
            findOne: vi.fn().mockResolvedValue(bill),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
          };
        }
        if (name === "gameState") {
          return { findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 10 }) };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    };

    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const result = await executePresidentialBillAction(
      mockDb as never,
      billId,
      charId,
      "veto",
      "Too costly"
    );

    expect(sendCountryGameEvent).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
