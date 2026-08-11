/**
 * Defect 3 regression coverage: `governmentFormations.seatsByParty` is a
 * write-triggered cache (only refreshed on specific turn-processor events —
 * NC-vote resolution, cycle rollover, PM appointment) that can drift
 * arbitrarily far from the real chamber between those events. Measured in the
 * sandbox world: BR/NG summed to 0 against real totals of 513/360, DE showed
 * 630 against a real 487, DD showed 6 against 500.
 *
 * `getPmAppointmentCandidates` / `getHosAppointmentCandidates` feed the
 * cabinet-formation UI's per-candidate seat counts. Both must report seats
 * tallied LIVE from `electedOfficials`, never the stale stored field.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  db = createMockDb();
});

import { getPmAppointmentCandidates, getHosAppointmentCandidates } from "./parliamentaryGovernment";

describe("getPmAppointmentCandidates — seatsByParty display", () => {
  const chairId = new ObjectId();
  const candidateCharId = new ObjectId();
  const candidateUserId = new ObjectId();

  it("reports the live Commons tally, not the stale stored governmentFormations.seatsByParty", async () => {
    // Party "2" actually holds 110 Commons seats in electedOfficials (source of
    // truth), but the stored governmentFormations cache says 0 — reproducing
    // the sandbox-world measurement (BR/NG summed to 0 against real totals).
    const officials = [
      ...Array.from({ length: 500 }, () => ({
        countryId: "UK",
        officeType: "commons",
        party: "1",
        characterId: null,
      })),
      ...Array.from({ length: 109 }, () => ({
        countryId: "UK",
        officeType: "commons",
        party: "2",
        characterId: null,
      })),
      {
        countryId: "UK",
        officeType: "commons",
        party: "2",
        characterId: candidateCharId,
      },
    ];

    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(officials) }),
      // checkAppointmentEligibility's "≥1 player-character MP" gate.
      countDocuments: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
        const partyFilter = (filter as { party?: string | { $in: string[] } }).party;
        const wanted =
          partyFilter == null
            ? null
            : typeof partyFilter === "string"
              ? new Set([partyFilter])
              : new Set(partyFilter.$in);
        const count = officials.filter(
          (o) => (wanted == null || wanted.has(o.party)) && o.characterId != null
        ).length;
        return Promise.resolve(count);
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      findOne: vi.fn().mockResolvedValue({ sequentialId: 2, countryId: "UK", chairId }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ sequentialId: 2, name: "Test Party" }]),
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["coalitions"] = {
      ...db.collection("coalitions"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({
        _id: "UK",
        countryId: "UK",
        status: "pending",
        majorityThreshold: 326,
        // Deliberately wrong/stale — the fix must NOT surface this value.
        seatsByParty: { "2": 0 },
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ _id: candidateCharId, name: "Test MP", userId: candidateUserId }]),
      }),
    } as MockDb["collectionMocks"][string];

    const { candidates } = await getPmAppointmentCandidates(db as unknown as Db, "UK", chairId);

    expect(candidates).toHaveLength(1);
    // Live tally (109 + 1 = 110), not the stale stored 0.
    expect(candidates[0]!.seatsByParty).toBe(110);
  });
});

describe("getHosAppointmentCandidates — seatsByParty display spans joint-sitting chambers", () => {
  const chairId = new ObjectId();
  const candidateCharId = new ObjectId();
  const candidateUserId = new ObjectId();

  it("sums both RU joint-sitting chambers live, not the stale stored governmentFormations.seatsByParty", async () => {
    // Party "3" holds seats in BOTH RU joint-sitting chambers (Union +
    // Nationalities deputies). The stale stored cache under-reports it as 6,
    // reproducing the sandbox-world DD measurement (6 vs a real 500).
    const deputies = [
      ...Array.from({ length: 200 }, () => ({
        countryId: "RU",
        officeType: "supremeSovietDeputy",
        party: "3",
        characterId: null,
      })),
      ...Array.from({ length: 150 }, () => ({
        countryId: "RU",
        officeType: "nationalitiesDeputy",
        party: "3",
        characterId: null,
      })),
      {
        countryId: "RU",
        officeType: "supremeSovietDeputy",
        party: "3",
        characterId: candidateCharId,
      },
    ];

    db.collectionMocks["electedOfficials"] = {
      ...db.collection("electedOfficials"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(deputies) }),
      // checkAppointmentEligibility's "≥1 player-character MP" gate. It scopes
      // to the LOWER chamber only (`officeType: lowerOfficeType`) even for the
      // HOS path, so count against the lower-chamber subset only.
      countDocuments: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
        const partyFilter = (filter as { party?: string | { $in: string[] } }).party;
        const wanted =
          partyFilter == null
            ? null
            : typeof partyFilter === "string"
              ? new Set([partyFilter])
              : new Set(partyFilter.$in);
        const count = deputies.filter(
          (o) =>
            o.officeType === "supremeSovietDeputy" &&
            (wanted == null || wanted.has(o.party)) &&
            o.characterId != null
        ).length;
        return Promise.resolve(count);
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["politicalParties"] = {
      ...db.collection("politicalParties"),
      findOne: vi
        .fn()
        .mockResolvedValue({ sequentialId: 3, countryId: "RU", chairId, regimeStatus: "ruling" }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ sequentialId: 3, name: "Test Party" }]),
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["coalitions"] = {
      ...db.collection("coalitions"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({
        _id: "RU",
        countryId: "RU",
        status: "pending",
        majorityThreshold: 376,
        hosCharacterId: null,
        hosNppId: null,
        // Deliberately wrong/stale — the fix must NOT surface this value.
        seatsByParty: { "3": 6 },
      }),
    } as MockDb["collectionMocks"][string];

    db.collectionMocks["characters"] = {
      ...db.collection("characters"),
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { _id: candidateCharId, name: "Test Deputy", userId: candidateUserId },
          ]),
      }),
    } as MockDb["collectionMocks"][string];

    const { candidates } = await getHosAppointmentCandidates(db as unknown as Db, "RU", chairId);

    expect(candidates).toHaveLength(1);
    // Live tally across both chambers (350 + 1 = 351), not the stale stored 6.
    expect(candidates[0]!.seatsByParty).toBe(351);
  });
});
