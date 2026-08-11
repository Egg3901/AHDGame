import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { draftCharter } from "./draftCharter";

function makeDb(opts: {
  founderCharactersOk?: boolean;
  founderCountryMismatch?: boolean;
  founderMissingUser?: boolean;
  founderCountry?: string;
  /** Home state assigned to all founder characters in the mock. Defaults to "CA". */
  founderHomeState?: string;
  /** Per-founder homeState overrides (index-aligned); null/undefined = no homeState. */
  founderHomeStates?: Array<string | null>;
  livePartyConflict?: { name?: string; abbreviation?: string } | null;
  liveCharterConflict?: { proposedName?: string; proposedAbbr?: string } | null;
}) {
  const founderCharacterIds = [new ObjectId(), new ObjectId(), new ObjectId()];
  const resolvedCountry = opts.founderCountry ?? (opts.founderCountryMismatch ? "UK" : "US");
  const resolvedHomeState = opts.founderHomeState ?? "CA";
  const founderCharacters =
    (opts.founderCharactersOk ?? true)
      ? founderCharacterIds.map((cid, index) => ({
          _id: cid,
          userId: opts.founderMissingUser ? null : new ObjectId(),
          countryId: resolvedCountry,
          homeState: opts.founderHomeStates ? opts.founderHomeStates[index] : resolvedHomeState,
        }))
      : [];

  const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") {
      return {
        find: () => ({
          project: () => ({
            toArray: vi.fn().mockResolvedValue(founderCharacters),
          }),
        }),
      };
    }
    if (name === "politicalParties") {
      return {
        findOne: vi.fn().mockResolvedValue(opts.livePartyConflict ?? null),
      };
    }
    if (name === "partyCharters") {
      return {
        findOne: vi.fn().mockResolvedValue(opts.liveCharterConflict ?? null),
        insertOne,
      };
    }
    if (name === "gameState") {
      return {
        findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 50 }),
      };
    }
    return {};
  });

  return { db: { collection } as unknown as Db, founderCharacterIds, insertOne };
}

describe("draftCharter", () => {
  it("creates a charter with the proposer auto-signed (happy path)", async () => {
    const { db, founderCharacterIds, insertOne } = makeDb({});
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "Working Families Party",
        proposedAbbr: "WFP",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result.ok).toBe(true);
    expect(insertOne).toHaveBeenCalledTimes(1);
    const charterArg = insertOne.mock.calls[0]![0]!;
    expect(charterArg.status).toBe("pending-signatures");
    expect(charterArg.signatures[0]!.signedAt).toBeInstanceOf(Date);
    expect(charterArg.signatures[1]!.signedAt).toBeUndefined();
    expect(charterArg.signatures[2]!.signedAt).toBeUndefined();
    expect(charterArg.foundersCharacterIds).toHaveLength(3);
  });

  it("rejects when fewer than 3 founders supplied", async () => {
    const { db } = makeDb({});
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "X",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: [new ObjectId()],
        proposedBy: new ObjectId(),
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "founders-not-3" });
  });

  it("rejects when founder characters are not unique", async () => {
    const dupCid = new ObjectId();
    const { db } = makeDb({});
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "X",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: [dupCid, dupCid, new ObjectId()],
        proposedBy: dupCid,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "founders-not-unique" });
  });

  it("rejects when proposer's character is not in foundersCharacterIds", async () => {
    const { db } = makeDb({});
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "X",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: [new ObjectId(), new ObjectId(), new ObjectId()],
        proposedBy: new ObjectId(),
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "proposer-not-founder" });
  });

  it("rejects when a founder character doesn't exist", async () => {
    const { db, founderCharacterIds } = makeDb({ founderCharactersOk: false });
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "X",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "founder-not-found" });
  });

  it("rejects when a founder character has no owning user (not human)", async () => {
    const { db, founderCharacterIds } = makeDb({ founderMissingUser: true });
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "X",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "founder-not-human" });
  });

  it("rejects when a founder character is in a different country", async () => {
    const { db, founderCharacterIds } = makeDb({ founderCountryMismatch: true });
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "X",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "founder-wrong-country" });
  });

  it("rejects when a live party uses the same name", async () => {
    const { db, founderCharacterIds } = makeDb({
      livePartyConflict: { name: "X", abbreviation: "OTHER" },
    });
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "X",
        proposedAbbr: "WFP",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "name-taken" });
  });

  it("rejects when an in-flight charter uses the same abbreviation", async () => {
    const { db, founderCharacterIds } = makeDb({
      liveCharterConflict: { proposedName: "Other", proposedAbbr: "WFP" },
    });
    const result = await draftCharter(
      {
        countryId: "US",
        proposedName: "Working Families Party",
        proposedAbbr: "WFP",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "abbreviation-taken" });
  });

  it("rejects names reserved for preset-gated defaults (UUP under 2019)", async () => {
    // UUP is a 1991-only default in `ukParties.ts`. Under 2019-default the
    // party isn't in DB, so the live-DB check would let it through — but
    // the reserved-name guard blocks the draft so a future preset switch
    // can't create a duplicate-name row.
    const { db, founderCharacterIds } = makeDb({ founderCountry: "UK" });
    const result = await draftCharter(
      {
        countryId: "UK",
        proposedName: "Ulster Unionist Party",
        proposedAbbr: "OTHER",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "name-taken" });
  });

  it("rejects abbreviations reserved for preset-gated defaults (PDS under 2019)", async () => {
    // PDS is a 1991-only default in `deParties.ts`. Same reservation logic
    // — block the abbreviation even if the live DB doesn't currently hold it.
    const { db, founderCharacterIds } = makeDb({ founderCountry: "DE" });
    const result = await draftCharter(
      {
        countryId: "DE",
        proposedName: "Other Name",
        proposedAbbr: "PDS",
        platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    expect(result).toEqual({ ok: false, reason: "abbreviation-taken" });
  });

  it("clamps platform values outside [-60, +60]", async () => {
    const { db, founderCharacterIds, insertOne } = makeDb({});
    await draftCharter(
      {
        countryId: "US",
        proposedName: "Y",
        proposedAbbr: "Y",
        platform: { economic: 999, social: -999, foreignPolicy: 0, culture: 0 },
        foundersCharacterIds: founderCharacterIds,
        proposedBy: founderCharacterIds[0]!,
      },
      db
    );
    const inserted = insertOne.mock.calls[0]![0]!;
    expect(inserted.platform.economic).toBe(60);
    expect(inserted.platform.social).toBe(-60);
  });

  describe("founder adjacency validation", () => {
    const platform = { economic: 0, social: 0, foreignPolicy: 0, culture: 0 };

    it("accepts founders in states adjacent to the proposer's home state", async () => {
      // Proposer in CA; co-founders in OR and NV (both CA-adjacent).
      const { db, founderCharacterIds } = makeDb({ founderHomeStates: ["CA", "OR", "NV"] });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform,
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
        },
        db
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a founder in a state that is not the proposer's or adjacent to it", async () => {
      // Proposer in CA; NY is not CA-adjacent.
      const { db, founderCharacterIds } = makeDb({ founderHomeStates: ["CA", "OR", "NY"] });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform,
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
        },
        db
      );
      expect(result).toEqual({ ok: false, reason: "founder-not-adjacent" });
    });

    it("rejects a founder with no homeState when the proposer has one", async () => {
      const { db, founderCharacterIds } = makeDb({ founderHomeStates: ["CA", "NV", null] });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform,
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
        },
        db
      );
      expect(result).toEqual({ ok: false, reason: "founder-not-adjacent" });
    });

    it("skips adjacency enforcement when the proposer has no homeState (legacy data)", async () => {
      const { db, founderCharacterIds } = makeDb({ founderHomeStates: [null, "NY", "FL"] });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform,
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
        },
        db
      );
      expect(result.ok).toBe(true);
    });

    it("validates adjacency against the proposer even when they are not founder slot 0", async () => {
      // Proposer is slot 1 (NV). Slot 0 is in CA (NV-adjacent), slot 2 in NY (not).
      const { db, founderCharacterIds } = makeDb({ founderHomeStates: ["CA", "NV", "NY"] });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform,
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[1]!,
        },
        db
      );
      expect(result).toEqual({ ok: false, reason: "founder-not-adjacent" });
    });
  });

  describe("F4 founding-cohort validation", () => {
    it("accepts a cohort with the chair's home state in both slots (double-up)", async () => {
      const { db, founderCharacterIds, insertOne } = makeDb({ founderHomeState: "CA" });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
          foundingCohort: [
            { stateId: "CA", economicPosition: -2, socialPosition: -3 },
            { stateId: "CA", economicPosition: -2, socialPosition: -3 },
          ],
        },
        db
      );
      expect(result.ok).toBe(true);
      const inserted = insertOne.mock.calls[0]![0]!;
      expect(inserted.foundingCohort).toHaveLength(2);
      expect(inserted.foundingCohort[0]!.stateId).toBe("CA");
      expect(inserted.foundingCohort[1]!.stateId).toBe("CA");
    });

    it("accepts a cohort with adjacent states", async () => {
      // CA borders AZ, NV, OR per STATE_ADJACENCY.US
      const { db, founderCharacterIds, insertOne } = makeDb({ founderHomeState: "CA" });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
          foundingCohort: [
            { stateId: "OR", economicPosition: -2, socialPosition: -3 },
            { stateId: "NV", economicPosition: -2, socialPosition: -3 },
          ],
        },
        db
      );
      expect(result.ok).toBe(true);
      const inserted = insertOne.mock.calls[0]![0]!;
      expect(inserted.foundingCohort[0]!.stateId).toBe("OR");
      expect(inserted.foundingCohort[1]!.stateId).toBe("NV");
    });

    it("rejects a cohort with a non-adjacent state", async () => {
      // CA does NOT border NY — should produce cohort-state-not-adjacent.
      const { db, founderCharacterIds } = makeDb({ founderHomeState: "CA" });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
          foundingCohort: [
            { stateId: "OR", economicPosition: -2, socialPosition: -3 },
            { stateId: "NY", economicPosition: -2, socialPosition: -3 },
          ],
        },
        db
      );
      expect(result).toEqual({ ok: false, reason: "cohort-state-not-adjacent" });
    });

    it("absent cohort produces a charter row with no foundingCohort field (legacy path)", async () => {
      const { db, founderCharacterIds, insertOne } = makeDb({ founderHomeState: "CA" });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
        },
        db
      );
      expect(result.ok).toBe(true);
      const inserted = insertOne.mock.calls[0]![0]!;
      expect(inserted.foundingCohort).toBeUndefined();
    });

    it("validates against the chair's adjacency, not other founders'", async () => {
      // Proposer is founder[0]. Both founders share homeState CA in the
      // mock. Pick must validate against CA's neighbors. AZ is adjacent;
      // FL is not.
      const { db, founderCharacterIds } = makeDb({ founderHomeState: "CA" });
      const result = await draftCharter(
        {
          countryId: "US",
          proposedName: "Working Families Party",
          proposedAbbr: "WFP",
          platform: { economic: 0, social: 0, foreignPolicy: 0, culture: 0 },
          foundersCharacterIds: founderCharacterIds,
          proposedBy: founderCharacterIds[0]!,
          foundingCohort: [
            { stateId: "AZ", economicPosition: 0, socialPosition: 0 },
            { stateId: "FL", economicPosition: 0, socialPosition: 0 },
          ],
        },
        db
      );
      expect(result).toEqual({ ok: false, reason: "cohort-state-not-adjacent" });
    });
  });
});
