import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("GET /api/country/[code]/legislature/leaders (UK)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ukParams = {
    params: Promise.resolve({ code: "uk" }),
  };

  it("returns PM, Opposition Leader, and Speaker when present", async () => {
    const pmId = new ObjectId();
    const oppositionId = new ObjectId();

    const mockPM = {
      _id: pmId,
      name: "Keir Starmer",
      party: "1",
      currentOffice: {
        type: "primeMinister",
      },
      updatedAt: new Date("2024-07-05"),
    };

    const mockOppositionLeader = {
      _id: oppositionId,
      name: "Rishi Sunak",
      party: "2",
      currentOffice: {
        type: "commons",
        state: "Richmond",
      },
      updatedAt: new Date("2024-07-10"),
    };

    const mockGovDoc = {
      _id: "UK",
      countryId: "UK",
      cycle: 1,
      status: "formed",
      governingPartyId: "1",
      seatsByParty: {
        "1": 411,
        "2": 121,
        "3": 72,
        "4": 9,
      },
      totalSeats: 650,
      createdAt: new Date("2024-07-01"),
      updatedAt: new Date("2024-07-05"),
    };

    const mockParties = [
      {
        _id: "uk_labour_id",
        sequentialId: 1,
        countryId: "UK",
        name: "Labour Party",
        chairId: null,
      },
      {
        _id: "uk_conservative_id",
        sequentialId: 2,
        countryId: "UK",
        name: "Conservative Party",
        chairId: oppositionId,
      },
      {
        _id: "uk_libdem_id",
        sequentialId: 3,
        countryId: "UK",
        name: "Liberal Democrats",
        chairId: null,
      },
    ];

    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockImplementation((query: any) => {
              if (query["currentOffice.type"] === "primeMinister") {
                return Promise.resolve(mockPM);
              }
              if (query._id) {
                const queryId = query._id.toString();
                if (queryId === oppositionId.toString()) {
                  return Promise.resolve(mockOppositionLeader);
                }
              }
              return Promise.resolve(null);
            }),
          };
        }
        if (name === "parliamentaryGovernments") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGovDoc),
          };
        }
        if (name === "governmentFormations") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (name === "politicalParties") {
          return {
            findOne: vi.fn().mockImplementation((query: any) => {
              if (typeof query.sequentialId === "number") {
                return Promise.resolve(
                  mockParties.find(
                    (p) =>
                      p.sequentialId === query.sequentialId &&
                      (!query.countryId || p.countryId === query.countryId)
                  ) ?? null
                );
              }
              return Promise.resolve(null);
            }),
            find: vi.fn().mockImplementation((query: any) => {
              if (query.sequentialId?.$in) {
                const requested = query.sequentialId.$in as number[];
                const filtered = mockParties.filter((p) => requested.includes(p.sequentialId));
                return {
                  toArray: vi.fn().mockResolvedValue(filtered),
                };
              }
              return {
                toArray: vi.fn().mockResolvedValue(mockParties),
              };
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);

    const { GET } = await import("@/app/api/country/[code]/legislature/leaders/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/leaders"),
      ukParams
    );
    expect(response.status).toBe(200);

    const data = await response.json();

    // Prime Minister
    expect(data).toHaveProperty("primeMinister");
    expect(data.primeMinister).toHaveProperty("characterId", pmId.toString());
    expect(data.primeMinister).toHaveProperty("characterName", "Keir Starmer");
    expect(data.primeMinister).toHaveProperty("party", "Labour Party");
    expect(data.primeMinister).toHaveProperty("since");

    // Opposition Leader
    expect(data).toHaveProperty("oppositionLeader");
    expect(data.oppositionLeader).toHaveProperty("characterId", oppositionId.toString());
    expect(data.oppositionLeader).toHaveProperty("characterName", "Rishi Sunak");
    expect(data.oppositionLeader).toHaveProperty("party", "Conservative Party");
    expect(data.oppositionLeader).toHaveProperty("since");

    // Speaker (not implemented yet)
    expect(data).toHaveProperty("speaker");
    expect(data.speaker).toBeNull();
  });

  it("resolves PM and Opposition Leader from governmentFormations when parliamentaryGovernments is empty (post-election)", async () => {
    // Regression: after a UK Commons general election, parliamentaryGovernments is cleared
    // but governmentFormations remains canonical. Legislature leaders must not fall through
    // to "Vacant" in that state while the Executive page correctly resolves both.
    const pmId = new ObjectId();
    const oppositionId = new ObjectId();

    const mockPM = {
      _id: pmId,
      name: "Cassius MacInnis",
      party: "8",
      // PMs sit as MPs, so currentOffice.type is "commons", not "primeMinister".
      currentOffice: { type: "commons", state: "SEE", seatsHeld: 8 },
      updatedAt: new Date("2026-04-20"),
    };

    const mockOppositionLeader = {
      _id: oppositionId,
      name: "Kevin Piastri",
      party: "2",
      currentOffice: { type: "commons", state: "LON" },
      updatedAt: new Date("2026-04-20"),
    };

    const mockGovFormation = {
      _id: "UK",
      countryId: "UK",
      status: "formed",
      governingPartyId: "8",
      coalitionPartyIds: [],
      coalitionId: null,
      pmCharacterId: pmId,
      pmName: "Cassius MacInnis",
      seatsByParty: { "1": 168, "2": 132, "8": 81 },
      totalSeats: 650,
    };

    const mockParties = [
      { _id: "uk_labour", sequentialId: 1, countryId: "UK", name: "Labour Party", chairId: null },
      {
        _id: "uk_conservative",
        sequentialId: 2,
        countryId: "UK",
        name: "Conservative Party",
        chairId: oppositionId,
      },
      {
        _id: "uk_dup",
        sequentialId: 8,
        countryId: "UK",
        name: "Democratic Unionist Party",
        chairId: pmId,
      },
    ];

    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockImplementation((query: any) => {
              // First pass: currentOffice.type = primeMinister → nothing matches (PM sits as MP)
              if (query["currentOffice.type"] === "primeMinister") {
                return Promise.resolve(null);
              }
              if (query._id) {
                const queryId = query._id.toString();
                if (queryId === pmId.toString()) return Promise.resolve(mockPM);
                if (queryId === oppositionId.toString())
                  return Promise.resolve(mockOppositionLeader);
              }
              return Promise.resolve(null);
            }),
          };
        }
        if (name === "parliamentaryGovernments") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (name === "governmentFormations") {
          return {
            findOne: vi.fn().mockResolvedValue(mockGovFormation),
          };
        }
        if (name === "politicalParties") {
          return {
            findOne: vi.fn().mockImplementation((query: any) => {
              if (typeof query.sequentialId === "number") {
                return Promise.resolve(
                  mockParties.find(
                    (p) =>
                      p.sequentialId === query.sequentialId &&
                      (!query.countryId || p.countryId === query.countryId)
                  ) ?? null
                );
              }
              return Promise.resolve(null);
            }),
            find: vi.fn().mockImplementation((query: any) => {
              if (query.sequentialId?.$in) {
                const requested = query.sequentialId.$in as number[];
                const filtered = mockParties.filter(
                  (p) =>
                    requested.includes(p.sequentialId) &&
                    (!query.countryId || p.countryId === query.countryId)
                );
                return { toArray: vi.fn().mockResolvedValue(filtered) };
              }
              return { toArray: vi.fn().mockResolvedValue(mockParties) };
            }),
          };
        }
        if (name === "coalitions") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);

    const { GET } = await import("@/app/api/country/[code]/legislature/leaders/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/leaders"),
      ukParams
    );
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.primeMinister).toMatchObject({
      characterId: pmId.toString(),
      characterName: "Cassius MacInnis",
      party: "Democratic Unionist Party",
    });
    // Labour (seq 1) has 168 seats but chairId: null, so the largest opposition
    // party with a resolvable chair is Conservative (132 seats, chair = oppositionId).
    expect(data.oppositionLeader).toMatchObject({
      characterId: oppositionId.toString(),
      characterName: "Kevin Piastri",
      party: "Conservative Party",
    });
  });

  it("picks a larger opposition coalition over a single party when its combined seat total dominates", async () => {
    // Regression: matches ParliamentaryExecutiveHub behaviour. Labour (168) has a chair and
    // would win the single-party comparison, but a non-governing coalition of Conservative +
    // Reform + Concerned Craiglang Pensioners (132 + 80 + 45 = 257) outranks it.
    const labourChairId = new ObjectId();
    const coalitionChairId = new ObjectId();
    const pmId = new ObjectId();

    const mockPM = {
      _id: pmId,
      name: "Cassius MacInnis",
      party: "8",
      currentOffice: { type: "commons", state: "SEE" },
      updatedAt: new Date("2026-04-20"),
    };
    const mockCoalitionChair = {
      _id: coalitionChairId,
      name: "Kevin Piastri",
      party: "2",
      currentOffice: { type: "commons", state: "LON" },
      updatedAt: new Date("2026-04-20"),
    };

    const mockGovFormation = {
      _id: "UK",
      countryId: "UK",
      status: "formed",
      governingPartyId: "8",
      coalitionPartyIds: ["8"],
      coalitionId: null,
      pmCharacterId: pmId,
      pmName: "Cassius MacInnis",
      seatsByParty: { "1": 168, "2": 132, "7": 80, "8": 81, "14": 45 },
      totalSeats: 650,
    };

    const mockParties = [
      {
        _id: "uk_labour",
        sequentialId: 1,
        countryId: "UK",
        name: "Labour Party",
        chairId: labourChairId,
      },
      {
        _id: "uk_conservative",
        sequentialId: 2,
        countryId: "UK",
        name: "Conservative Party",
        chairId: coalitionChairId,
      },
      {
        _id: "uk_reform",
        sequentialId: 7,
        countryId: "UK",
        name: "Reform UK",
        chairId: new ObjectId(),
      },
      { _id: "uk_dup", sequentialId: 8, countryId: "UK", name: "DUP", chairId: pmId },
      {
        _id: "uk_ccp",
        sequentialId: 14,
        countryId: "UK",
        name: "Concerned Craiglang Pensioners",
        chairId: new ObjectId(),
      },
    ];

    const mockCoalition = {
      _id: "coalition_opp",
      sequentialId: 1,
      countryId: "UK",
      chairCharacterId: coalitionChairId,
      members: [
        { partyId: new ObjectId(), partySequentialId: 2 },
        { partyId: new ObjectId(), partySequentialId: 7 },
        { partyId: new ObjectId(), partySequentialId: 14 },
      ],
    };

    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockImplementation((query: any) => {
              if (query["currentOffice.type"] === "primeMinister") return Promise.resolve(null);
              if (query._id) {
                const id = query._id.toString();
                if (id === pmId.toString()) return Promise.resolve(mockPM);
                if (id === coalitionChairId.toString()) return Promise.resolve(mockCoalitionChair);
              }
              return Promise.resolve(null);
            }),
          };
        }
        if (name === "parliamentaryGovernments") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        if (name === "governmentFormations") {
          return { findOne: vi.fn().mockResolvedValue(mockGovFormation) };
        }
        if (name === "politicalParties") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockImplementation((query: any) => {
              if (query.sequentialId?.$in) {
                const requested = query.sequentialId.$in as number[];
                return {
                  toArray: vi
                    .fn()
                    .mockResolvedValue(
                      mockParties.filter((p) => requested.includes(p.sequentialId))
                    ),
                };
              }
              return { toArray: vi.fn().mockResolvedValue(mockParties) };
            }),
          };
        }
        if (name === "coalitions") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([mockCoalition]),
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);

    const { GET } = await import("@/app/api/country/[code]/legislature/leaders/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/leaders"),
      ukParams
    );
    const data = await response.json();

    expect(data.oppositionLeader).toMatchObject({
      characterId: coalitionChairId.toString(),
      characterName: "Kevin Piastri",
      // party comes from the largest member of the winning coalition
      party: "Conservative Party",
    });
  });

  it("excludes the plurality party from Opposition Leader when no government has formed (DE pending)", async () => {
    // Regression (Germany, no coalition yet): governmentFormations is "pending" with
    // governingPartyId null, so resolveGoverningPartyIdsFromDocuments returns an empty
    // set. The UI header treats the largest party by seats (CDU, 268) as the Majority
    // Party, so the Opposition Leader must be the chair of the *second* largest party
    // (SPD, 239) — not the chair of the plurality winner.
    const cduChairId = new ObjectId(); // Helmut Kohl — must NOT be opposition leader
    const spdChairId = new ObjectId(); // Wolfgang Clement — expected opposition leader

    const mockCduChair = {
      _id: cduChairId,
      name: "Helmut Kohl",
      party: "2",
      currentOffice: { type: "bundestag", state: "BY" },
      updatedAt: new Date("2026-05-01"),
    };
    const mockSpdChair = {
      _id: spdChairId,
      name: "Wolfgang Clement",
      party: "1",
      currentOffice: { type: "bundestag", state: "NW" },
      updatedAt: new Date("2026-05-01"),
    };

    const mockGovFormation = {
      _id: "DE",
      countryId: "DE",
      status: "pending",
      governingPartyId: null,
      coalitionPartyIds: null,
      coalitionId: null,
      pmCharacterId: null,
      pmName: null,
      seatsByParty: { "1": 239, "2": 268, "5": 79 },
      totalSeats: 630,
    };

    const mockParties = [
      {
        _id: "de_spd",
        sequentialId: 1,
        countryId: "DE",
        name: "Sozialdemokratische Partei Deutschlands",
        chairId: spdChairId,
      },
      {
        _id: "de_cdu",
        sequentialId: 2,
        countryId: "DE",
        name: "Christlich Demokratische Union",
        chairId: cduChairId,
      },
      {
        _id: "de_fdp",
        sequentialId: 5,
        countryId: "DE",
        name: "Freie Demokratische Partei",
        chairId: new ObjectId(),
      },
    ];

    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockImplementation((query: any) => {
              // No seated head of government — chancellor office is vacant.
              if (query["currentOffice.type"]) return Promise.resolve(null);
              if (query._id) {
                const id = query._id.toString();
                if (id === cduChairId.toString()) return Promise.resolve(mockCduChair);
                if (id === spdChairId.toString()) return Promise.resolve(mockSpdChair);
              }
              return Promise.resolve(null);
            }),
          };
        }
        if (name === "parliamentaryGovernments") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        if (name === "governmentFormations") {
          return { findOne: vi.fn().mockResolvedValue(mockGovFormation) };
        }
        if (name === "politicalParties") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockImplementation((query: any) => {
              if (query.sequentialId?.$in) {
                const requested = query.sequentialId.$in as number[];
                return {
                  toArray: vi
                    .fn()
                    .mockResolvedValue(
                      mockParties.filter((p) => requested.includes(p.sequentialId))
                    ),
                };
              }
              return { toArray: vi.fn().mockResolvedValue(mockParties) };
            }),
          };
        }
        if (name === "coalitions") {
          return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);

    const { GET } = await import("@/app/api/country/[code]/legislature/leaders/route");
    const response = await GET(new Request("http://localhost/api/country/de/legislature/leaders"), {
      params: Promise.resolve({ code: "de" }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.primeMinister).toBeNull();
    expect(data.oppositionLeader).toMatchObject({
      characterId: spdChairId.toString(),
      characterName: "Wolfgang Clement",
      party: "Sozialdemokratische Partei Deutschlands",
    });
  });

  it("returns null for all positions when vacant", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "parliamentaryGovernments") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Db);

    const { GET } = await import("@/app/api/country/[code]/legislature/leaders/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/legislature/leaders"),
      ukParams
    );
    const data = await response.json();

    expect(data.primeMinister).toBeNull();
    expect(data.oppositionLeader).toBeNull();
    expect(data.speaker).toBeNull();
  });
});
