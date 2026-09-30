/** Executives are appointed and vacated using their effective constitutional office. */
import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ preset: "1991-default", currentTurn: 40 }),
}));
vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govFormed: 0 },
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/singleplayer", () => ({ isSingleplayer: () => false }));

import { appointPrimeMinister, unformGovernmentAndVacatePM } from "./parliamentaryGovernment";

const phases = [
  { markers: {}, executive: "chairmanOfCabinet", headOfState: "sovietPresident" },
  {
    markers: { ruSovietSuccessionSinceTurn: 24 },
    executive: "primeMinister",
    headOfState: "chairmanOfSupremeSoviet",
  },
  {
    markers: { ruSovietSuccessionSinceTurn: 24, ruFederalAssemblySinceTurn: 30 },
    executive: "primeMinister",
    headOfState: "president",
  },
];

describe("effective parliamentary executive offices", () => {
  it.each(phases)("appoints the active $executive without clearing $headOfState", async (phase) => {
    const mem = createInMemoryDb();
    const successorId = new ObjectId();
    const previousId = new ObjectId();
    const headOfStateId = new ObjectId();
    mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 40 }]);
    mem.seed("countryGameStates", [{ _id: "RU", ...phase.markers }]);
    mem.seed("governmentFormations", [{ _id: "RU", status: "pending" }]);
    mem.seed("npps", [
      { _id: successorId, countryId: "RU", currentOffice: null },
      { _id: previousId, countryId: "RU", currentOffice: { type: phase.executive } },
      { _id: headOfStateId, countryId: "RU", currentOffice: { type: phase.headOfState } },
    ]);
    await appointPrimeMinister(
      mem as unknown as Db,
      "RU",
      null,
      successorId,
      "New Cabinet Chair",
      new Date(0),
      "1991-default"
    );
    expect(await mem.collection("npps").findOne({ _id: successorId })).toMatchObject({
      currentOffice: { type: phase.executive },
    });
    expect(await mem.collection("npps").findOne({ _id: previousId })).toMatchObject({
      currentOffice: null,
    });
    expect(await mem.collection("npps").findOne({ _id: headOfStateId })).toMatchObject({
      currentOffice: { type: phase.headOfState },
    });
  });

  it.each(phases)(
    "vacates $executive while preserving $headOfState and foreign offices",
    async (phase) => {
      const mem = createInMemoryDb();
      const pmId = new ObjectId();
      const hosId = new ObjectId();
      const foreignId = new ObjectId();
      mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 40 }]);
      mem.seed("countryGameStates", [{ _id: "RU", ...phase.markers }]);
      mem.seed("governmentFormations", [{ _id: "RU", status: "formed", pmNppId: pmId }]);
      mem.seed("npps", [
        { _id: pmId, countryId: "RU", currentOffice: { type: phase.executive } },
        { _id: hosId, countryId: "RU", currentOffice: { type: phase.headOfState } },
        { _id: foreignId, countryId: "UK", currentOffice: { type: phase.executive } },
      ]);
      await unformGovernmentAndVacatePM(mem as unknown as Db, "RU", new Date(0), {
        reason: "no-confidence",
      });
      expect(await mem.collection("npps").findOne({ _id: pmId })).toMatchObject({
        currentOffice: null,
      });
      expect(await mem.collection("npps").findOne({ _id: hosId })).toMatchObject({
        currentOffice: { type: phase.headOfState },
      });
      expect(await mem.collection("npps").findOne({ _id: foreignId })).toMatchObject({
        currentOffice: { type: phase.executive },
      });
      expect(await mem.collection("governmentFormations").findOne({ _id: "RU" })).toMatchObject({
        status: "pending",
        pmNppId: null,
        pmVacancyDeadlineTurn: 136,
      });
    }
  );
});
