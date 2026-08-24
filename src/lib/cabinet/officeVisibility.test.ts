import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(async () => null),
}));

import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import {
  resolveCabinetOfficeVisibility,
  cabinetOfficeViewerTitles,
  cabinetOfficeRealmPhrase,
} from "./officeVisibility";

/** Seat the country's head-of-state office with `characterId` (null = vacant). */
function seatHeadOfState(db: MockDb, characterId: ObjectId | null) {
  db.collection("electedOfficials");
  db.collectionMocks.electedOfficials.findOne.mockResolvedValue(
    characterId ? { characterId } : null
  );
}

/** Crown the imperial head of state, held by `userId` (null = no monarch). */
function crownImperial(db: MockDb, userId: string | null) {
  db.collection("imperialCharacters");
  db.collectionMocks.imperialCharacters.findOne.mockResolvedValue(
    userId ? { userId, name: "The Monarch" } : null
  );
}

describe("resolveCabinetOfficeVisibility", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    seatHeadOfState(db, null);
    crownImperial(db, null);
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(null);
  });

  it("lets the seated officeholder view and act", async () => {
    const holder = new ObjectId();

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: holder,
      viewerCharacterId: holder,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: true, canAct: true, viewerRole: "holder" });
  });

  it("lets the head of government view but not act", async () => {
    const hog = new ObjectId();
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(hog);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: hog,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: true, canAct: false, viewerRole: "headOfGovernment" });
  });

  it("lets the ceremonial head of state view but not act", async () => {
    const hos = new ObjectId();
    seatHeadOfState(db, hos);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "IE",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: hos,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: true, canAct: false, viewerRole: "headOfState" });
  });

  it("lets an admin view and act on a seat they do not hold", async () => {
    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: new ObjectId(),
      isAdmin: true,
    });

    expect(result).toEqual({ canView: true, canAct: true, viewerRole: "admin" });
  });

  it("hides the office from another player of the same country", async () => {
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(new ObjectId());
    seatHeadOfState(db, new ObjectId());

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: new ObjectId(),
      isAdmin: false,
    });

    expect(result).toEqual({ canView: false, canAct: false, viewerRole: null });
  });

  it("hides the office from a signed-out visitor", async () => {
    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: null,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: false, canAct: false, viewerRole: null });
  });

  it("does not treat a vacant seat as held by a signed-out visitor", async () => {
    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: null,
      viewerCharacterId: null,
      isAdmin: false,
    });

    expect(result.canView).toBe(false);
    expect(result.viewerRole).toBeNull();
  });

  it("keeps a vacant seat visible to the head of government", async () => {
    const hog = new ObjectId();
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(hog);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "UK",
      holderCharacterId: null,
      viewerCharacterId: hog,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: true, canAct: false, viewerRole: "headOfGovernment" });
  });

  it("resolves the head of government for the office's own country, not the viewer's", async () => {
    const viewer = new ObjectId();
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(new ObjectId());

    await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "UK",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: viewer,
      isAdmin: false,
    });

    expect(getHeadOfGovernmentCharacterId).toHaveBeenCalledWith(expect.anything(), "UK");
  });

  // Nothing seats a monarch in electedOfficials — only RU's presidium chairman and
  // CN's party-chair sync write those rows — so a crowned head of state is found on
  // the imperial roll or not at all. The UK and Japan have no isHeadOfState office
  // whatsoever, which is why the elected path cannot stand in for this one.
  it("lets the reigning monarch view their own country's cabinet", async () => {
    const monarchUserId = new ObjectId().toString();
    crownImperial(db, monarchUserId);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "UK",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: new ObjectId(),
      viewerUserId: monarchUserId,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: true, canAct: false, viewerRole: "headOfState" });
  });

  // A player who reigns need not hold an ordinary character at all, so the
  // signed-out bail cannot key on the character id alone.
  it("recognises a monarch who holds no ordinary character", async () => {
    const monarchUserId = new ObjectId().toString();
    crownImperial(db, monarchUserId);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "UK",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: null,
      viewerUserId: monarchUserId,
      isAdmin: false,
    });

    expect(result).toEqual({ canView: true, canAct: false, viewerRole: "headOfState" });
  });

  it("scopes the imperial lookup to the office's own country", async () => {
    const monarchUserId = new ObjectId().toString();
    crownImperial(db, monarchUserId);

    await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "UK",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: new ObjectId(),
      viewerUserId: monarchUserId,
      isAdmin: false,
    });

    expect(db.collectionMocks.imperialCharacters.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "UK" }),
      expect.anything()
    );
  });

  it("does not consult the imperial roll for a country that has no crown", async () => {
    await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "US",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: new ObjectId(),
      viewerUserId: new ObjectId().toString(),
      isAdmin: false,
    });

    expect(db.collectionMocks.imperialCharacters.findOne).not.toHaveBeenCalled();
  });

  it("hides an imperial country's cabinet from a signed-in commoner", async () => {
    crownImperial(db, null);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "UK",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: new ObjectId(),
      viewerUserId: new ObjectId().toString(),
      isAdmin: false,
    });

    expect(result).toEqual({ canView: false, canAct: false, viewerRole: null });
  });

  // Spain is the sharp case: canonically the head of state is the `monarch`, but
  // under 1953-default it is the `caudillo`. Reading the canonical config in a
  // 1953 world would look up an office nobody holds and lock the actual head of
  // state out of their own cabinet.
  it("resolves the head of state against the active preset's office types", async () => {
    const hos = new ObjectId();
    seatHeadOfState(db, hos);

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "ES",
      preset: "1953-default",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: hos,
      isAdmin: false,
    });

    expect(db.collectionMocks.electedOfficials.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "ES", officeType: "caudillo" }),
      expect.anything()
    );
    expect(result.viewerRole).toBe("headOfState");
  });

  it("reads the active preset from the world when the caller does not supply one", async () => {
    const hos = new ObjectId();
    seatHeadOfState(db, hos);
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });

    const result = await resolveCabinetOfficeVisibility(db as unknown as Db, {
      countryId: "ES",
      holderCharacterId: new ObjectId(),
      viewerCharacterId: hos,
      isAdmin: false,
    });

    expect(db.collectionMocks.electedOfficials.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "caudillo" }),
      expect.anything()
    );
    expect(result.viewerRole).toBe("headOfState");
  });
});

describe("cabinetOfficeViewerTitles", () => {
  it("names only the president where the office fuses both roles", () => {
    expect(cabinetOfficeViewerTitles("US")).toEqual(["President"]);
  });

  // The crown holds no officeType, so its title comes from the head-of-state
  // title rather than from `officeTypes`. Naming only the Prime Minister would
  // contradict the gate, which now admits the reigning monarch.
  it("names the crown where the head of state reigns rather than holds an office", () => {
    expect(cabinetOfficeViewerTitles("UK")).toEqual(["Prime Minister", "Monarch"]);
  });

  it("uses the country's own word for its crown", () => {
    expect(cabinetOfficeViewerTitles("JP")).toContain("Emperor");
  });

  it("does not name the crown twice where it also holds an office", () => {
    // Spain's monarch has a `monarch` officeType, so the office label already
    // covers them and the imperial title must not be appended on top.
    expect(cabinetOfficeViewerTitles("ES")).toEqual(["Prime Minister", "King"]);
  });

  it("names the head of government and the separate ceremonial head of state", () => {
    expect(cabinetOfficeViewerTitles("IE")).toEqual(["Taoiseach", "Uachtarán"]);
  });
});

describe("cabinetOfficeRealmPhrase", () => {
  it("carries the definite article where the country's name needs one", () => {
    expect(cabinetOfficeRealmPhrase("US")).toBe("the United States");
    expect(cabinetOfficeRealmPhrase("UK")).toBe("the United Kingdom");
  });

  it("leaves a bare country name bare", () => {
    expect(cabinetOfficeRealmPhrase("IE")).toBe("Ireland");
  });
});
