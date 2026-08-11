import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";

vi.mock("../bondHolderWriteDown", () => ({
  applyBondHolderWriteDowns: vi.fn(),
}));
vi.mock("../insolvency", () => ({
  isCorporationInsolvent: vi.fn(),
}));
vi.mock("../perCorpCascadeNews", () => ({
  emitPerCorpCascadeNews: vi.fn().mockResolvedValue(undefined),
}));

import { runCascade } from "../cascadeOrchestrator";
import { applyBondHolderWriteDowns } from "../bondHolderWriteDown";
import { isCorporationInsolvent } from "../insolvency";
import { CASCADE_MAX_LEVELS } from "../../constants";

function fakeBond(corpId: ObjectId, isCorp = false): Bond {
  return {
    _id: new ObjectId(),
    issuerType: isCorp ? "corporation" : "sovereign",
    corporationId: corpId,
    countryId: "US",
    currencyCode: "USD",
    faceValue: 0,
    couponRate: 4,
    maturityTurns: 48,
    issuedAtTurn: 0,
    maturityTurn: 48,
    marketPrice: 0.5,
    totalIssued: 0,
    publicFloat: 0,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMockDb(
  corpsAfterEachLevel: Array<
    Array<{
      _id: ObjectId;
      liquidCapital: number;
      name?: string;
      type?: string;
      countryId?: string;
    }>
  >,
  corpBondsByCorpId: Map<string, Bond[]>
) {
  const bondBulkOps: Array<Record<string, unknown>> = [];
  let levelIdx = 0;
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "corporations") {
        const cursor = {
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockImplementation(async () => {
              const out = corpsAfterEachLevel[levelIdx] ?? [];
              levelIdx++;
              return out;
            }),
          }),
        };
        return {
          find: vi.fn().mockReturnValue(cursor),
        };
      }
      if (name === "bonds") {
        return {
          find: vi.fn().mockImplementation((filter: { corporationId?: ObjectId }) => ({
            toArray: vi
              .fn()
              .mockResolvedValue(
                filter.corporationId
                  ? (corpBondsByCorpId.get(filter.corporationId.toString()) ?? [])
                  : []
              ),
          })),
          bulkWrite: vi.fn().mockImplementation(async (ops) => {
            bondBulkOps.push(...ops);
            return { modifiedCount: ops.length };
          }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, bondBulkOps };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyBondHolderWriteDowns).mockReset();
  vi.mocked(isCorporationInsolvent).mockReset();
});

describe("runCascade — single level", () => {
  it("level 0 with no insolvent corps stops at depth 1", async () => {
    const corpId = new ObjectId();
    vi.mocked(applyBondHolderWriteDowns).mockResolvedValueOnce({
      affectedCorpIds: [corpId],
      affectedCharacterIds: [],
      affectedImperialCharacterIds: [],
      affectedCountryStubs: [],
      totalWrittenDownAnchor: 100_000,
    });
    vi.mocked(isCorporationInsolvent).mockReturnValue(false);

    const { db } = makeMockDb([[{ _id: corpId, liquidCapital: 1_000 }]], new Map());
    const r = await runCascade(db, {
      initialBonds: [fakeBond(new ObjectId())],
      reason: "repudiate",
      currentTurn: 100,
      countryCode: "US",
    });
    expect(r.levels).toBe(1);
    expect(r.totalCorpsInsolvent).toBe(0);
  });
});

describe("runCascade — multi-level", () => {
  it("cascades through 2 levels when level-0 write-downs make a holder corp insolvent", async () => {
    const holderCorpId = new ObjectId();
    const downstreamHolderCorpId = new ObjectId();

    vi.mocked(applyBondHolderWriteDowns)
      .mockResolvedValueOnce({
        affectedCorpIds: [holderCorpId],
        affectedCharacterIds: [],
        affectedImperialCharacterIds: [],
        affectedCountryStubs: [],
        totalWrittenDownAnchor: 100_000,
      })
      .mockResolvedValueOnce({
        affectedCorpIds: [downstreamHolderCorpId],
        affectedCharacterIds: [],
        affectedImperialCharacterIds: [],
        affectedCountryStubs: [],
        totalWrittenDownAnchor: 50_000,
      });

    // Level 0 affected corp is insolvent; level 1 affected corp is solvent
    vi.mocked(isCorporationInsolvent)
      .mockReturnValueOnce(true) // holderCorpId
      .mockReturnValueOnce(false); // downstreamHolderCorpId

    const corpBond = fakeBond(holderCorpId, true);
    const { db, bondBulkOps } = makeMockDb(
      [
        [{ _id: holderCorpId, liquidCapital: -50_000 }],
        [{ _id: downstreamHolderCorpId, liquidCapital: 1000 }],
      ],
      new Map([[holderCorpId.toString(), [corpBond]]])
    );

    const r = await runCascade(db, {
      initialBonds: [fakeBond(new ObjectId())],
      reason: "repudiate",
      currentTurn: 100,
      countryCode: "US",
    });
    expect(r.levels).toBe(2);
    expect(r.totalCorpsInsolvent).toBe(1);
    expect(r.insolventCorpIdsByLevel[0].map((id) => id.toString())).toEqual([
      holderCorpId.toString(),
    ]);
    // The corp's bond got flagged defaulted via bulk write
    expect(bondBulkOps).toHaveLength(1);
    const op = bondBulkOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    expect(op.updateOne.update.$set.defaulted).toBe(true);
    expect(op.updateOne.update.$set.defaultedAtTurn).toBe(100);
  });

  it("stops at CASCADE_MAX_LEVELS (3) even when each level keeps producing insolvents", async () => {
    const c0 = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    vi.mocked(applyBondHolderWriteDowns)
      .mockResolvedValueOnce({
        affectedCorpIds: [c0],
        affectedCharacterIds: [],
        affectedImperialCharacterIds: [],
        affectedCountryStubs: [],
        totalWrittenDownAnchor: 1,
      })
      .mockResolvedValueOnce({
        affectedCorpIds: [c1],
        affectedCharacterIds: [],
        affectedImperialCharacterIds: [],
        affectedCountryStubs: [],
        totalWrittenDownAnchor: 1,
      })
      .mockResolvedValueOnce({
        affectedCorpIds: [c2],
        affectedCharacterIds: [],
        affectedImperialCharacterIds: [],
        affectedCountryStubs: [],
        totalWrittenDownAnchor: 1,
      });
    vi.mocked(isCorporationInsolvent).mockReturnValue(true);

    const { db } = makeMockDb(
      [
        [{ _id: c0, liquidCapital: -1 }],
        [{ _id: c1, liquidCapital: -1 }],
        [{ _id: c2, liquidCapital: -1 }],
      ],
      new Map([
        [c0.toString(), [fakeBond(c0, true)]],
        [c1.toString(), [fakeBond(c1, true)]],
        [c2.toString(), [fakeBond(c2, true)]],
      ])
    );

    const r = await runCascade(db, {
      initialBonds: [fakeBond(new ObjectId())],
      reason: "repudiate",
      currentTurn: 100,
      countryCode: "US",
    });
    expect(r.levels).toBe(CASCADE_MAX_LEVELS);
  });
});

describe("runCascade — per-corp news (phase 9a)", () => {
  it("emits one news per insolvent corp at each level", async () => {
    const { emitPerCorpCascadeNews } = await import("../perCorpCascadeNews");
    vi.mocked(emitPerCorpCascadeNews).mockClear();

    const holderCorpId = new ObjectId();
    vi.mocked(applyBondHolderWriteDowns).mockResolvedValueOnce({
      affectedCorpIds: [holderCorpId],
      affectedCharacterIds: [],
      affectedImperialCharacterIds: [],
      affectedCountryStubs: [],
      totalWrittenDownAnchor: 100_000,
    });
    vi.mocked(isCorporationInsolvent).mockReturnValueOnce(true);

    const corpRow = {
      _id: holderCorpId,
      liquidCapital: -100,
      name: "TestCo",
      type: "financial",
      countryId: "JP",
    };

    const { db } = makeMockDb([[corpRow]], new Map());
    await runCascade(db, {
      initialBonds: [fakeBond(new ObjectId())],
      reason: "repudiate",
      currentTurn: 100,
      countryCode: "US",
    });

    expect(emitPerCorpCascadeNews).toHaveBeenCalled();
    const callArgs = vi.mocked(emitPerCorpCascadeNews).mock.calls[0][0];
    expect(callArgs.corpName).toBe("TestCo");
    expect(callArgs.corpType).toBe("financial");
    expect(callArgs.corpCountryId).toBe("JP");
    expect(callArgs.countryCode).toBe("US");
    expect(callArgs.level).toBe(1);
  });
});
