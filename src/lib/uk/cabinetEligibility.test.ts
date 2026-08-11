import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  getCabinetEligibleChamberKeys,
  getCabinetEligibleChamberLabel,
  getEligibleCabinetCharacters,
} from "./cabinetEligibility";

describe("cabinetEligibility", () => {
  it("keeps UK cabinet eligibility scoped to the lower chamber", () => {
    expect(getCabinetEligibleChamberKeys("UK")).toEqual(["commons"]);
    expect(getCabinetEligibleChamberLabel("UK")).toBe("House of Commons");
  });

  it("allows JP cabinet eligibility from both Diet chambers", () => {
    expect(getCabinetEligibleChamberKeys("JP")).toEqual(["shugiin", "sangiin"]);
    expect(getCabinetEligibleChamberLabel("JP")).toBe("Shūgiin or Sangiin");
  });

  it("returns both shugiin and sangiin player members for JP cabinet appointments", async () => {
    const db = createMockDb();
    const pmCharacterId = new ObjectId();
    const shugiinCharacterId = new ObjectId();
    const sangiinCharacterId = new ObjectId();

    db.collection("electedOfficials");
    db.collection("cabinetMembers");
    db.collection("characters");
    db.collection("politicalParties");

    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          characterId: shugiinCharacterId,
          officeType: "shugiin",
          countryId: "JP",
          state: "KAN",
          party: "ldp",
        },
        {
          _id: new ObjectId(),
          characterId: sangiinCharacterId,
          officeType: "sangiin",
          countryId: "JP",
          state: "KNS",
          party: "cdp",
        },
        {
          _id: new ObjectId(),
          characterId: pmCharacterId,
          officeType: "shugiin",
          countryId: "JP",
          state: "KAN",
          party: "ldp",
        },
      ],
    });

    db.collectionMocks.cabinetMembers.find.mockReturnValue({
      toArray: async () => [],
    });

    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [
        {
          _id: shugiinCharacterId,
          userId: new ObjectId(),
          name: "Shugiin Member",
          avatarUrl: "/shugiin.png",
          sequentialId: 11,
        },
        {
          _id: sangiinCharacterId,
          userId: new ObjectId(),
          name: "Sangiin Member",
          avatarUrl: "/sangiin.png",
          sequentialId: 12,
        },
      ],
    });

    db.collectionMocks.politicalParties.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: "ldp", name: "Liberal Democratic Party" },
          { sequentialId: "cdp", name: "Constitutional Democratic Party" },
        ],
      }),
    });

    const eligible = await getEligibleCabinetCharacters(db as never, "JP", pmCharacterId);

    expect(eligible).toEqual([
      expect.objectContaining({
        _id: sangiinCharacterId.toString(),
        name: "Sangiin Member",
        chamberName: "Sangiin",
        constituency: "Constituency KNS",
      }),
      expect.objectContaining({
        _id: shugiinCharacterId.toString(),
        name: "Shugiin Member",
        chamberName: "Shūgiin",
        constituency: "Constituency KAN",
      }),
    ]);
  });

  it("includes non-legislator players for a One Party State cabinet", async () => {
    const db = createMockDb();
    const pmCharacterId = new ObjectId();
    const legislatorId = new ObjectId();
    const civilianId = new ObjectId();

    db.collection("electedOfficials");
    db.collection("cabinetMembers");
    db.collection("characters");
    db.collection("politicalParties");

    // No eligible-chamber seats exist at all. A non-OPS country would therefore
    // return an empty candidate set; the OPS branch must still surface players.
    db.collectionMocks.electedOfficials.find.mockReturnValue({ toArray: async () => [] });

    db.collectionMocks.cabinetMembers.find.mockReturnValue({ toArray: async () => [] });

    // OPS branch queries ALL player characters in the country.
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [
        {
          _id: legislatorId,
          userId: new ObjectId(),
          name: "Seated Delegate",
          party: "ccp",
          sequentialId: 21,
        },
        {
          _id: civilianId,
          userId: new ObjectId(),
          name: "Loyal Civilian",
          party: "ccp",
          sequentialId: 22,
        },
      ],
    });

    db.collectionMocks.politicalParties.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: "ccp", name: "Communist Party", regimeStatus: "ruling" },
        ],
      }),
    });

    const eligible = await getEligibleCabinetCharacters(db as never, "CN", pmCharacterId);
    const names = eligible.map((c) => c.name);

    expect(names).toContain("Loyal Civilian");
    expect(names).toContain("Seated Delegate");
  });

  it("excludes banned-party members from One Party State cabinet eligibility", async () => {
    const db = createMockDb();
    const pmCharacterId = new ObjectId();
    const loyalistId = new ObjectId();
    const dissidentId = new ObjectId();

    db.collection("electedOfficials");
    db.collection("cabinetMembers");
    db.collection("characters");
    db.collection("politicalParties");

    db.collectionMocks.electedOfficials.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.cabinetMembers.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [
        {
          _id: loyalistId,
          userId: new ObjectId(),
          name: "Loyalist",
          party: "ccp",
          sequentialId: 31,
        },
        {
          _id: dissidentId,
          userId: new ObjectId(),
          name: "Dissident",
          party: "banned1",
          sequentialId: 32,
        },
      ],
    });
    db.collectionMocks.politicalParties.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: "ccp", name: "Communist Party", regimeStatus: "ruling" },
          { sequentialId: "banned1", name: "Outlawed Front", regimeStatus: "banned" },
        ],
      }),
    });

    const eligible = await getEligibleCabinetCharacters(db as never, "CN", pmCharacterId);
    const names = eligible.map((c) => c.name);

    expect(names).toContain("Loyalist");
    expect(names).not.toContain("Dissident");
  });

  it("excludes the PM and existing cabinet members in a One Party State", async () => {
    const db = createMockDb();
    const pmCharacterId = new ObjectId();
    const sittingMinisterId = new ObjectId();
    const freeCivilianId = new ObjectId();

    db.collection("electedOfficials");
    db.collection("cabinetMembers");
    db.collection("characters");
    db.collection("politicalParties");

    db.collectionMocks.electedOfficials.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.cabinetMembers.find.mockReturnValue({
      toArray: async () => [{ characterId: sittingMinisterId }],
    });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [
        {
          _id: pmCharacterId,
          userId: new ObjectId(),
          name: "The Premier",
          party: "ccp",
          sequentialId: 41,
        },
        {
          _id: sittingMinisterId,
          userId: new ObjectId(),
          name: "Sitting Minister",
          party: "ccp",
          sequentialId: 42,
        },
        {
          _id: freeCivilianId,
          userId: new ObjectId(),
          name: "Free Civilian",
          party: "ccp",
          sequentialId: 43,
        },
      ],
    });
    db.collectionMocks.politicalParties.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: "ccp", name: "Communist Party", regimeStatus: "ruling" },
        ],
      }),
    });

    const eligible = await getEligibleCabinetCharacters(db as never, "CN", pmCharacterId);
    const names = eligible.map((c) => c.name);

    expect(names).toEqual(["Free Civilian"]);
  });
});
