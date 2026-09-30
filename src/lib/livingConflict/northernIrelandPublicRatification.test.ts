import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Referendum } from "@/lib/db/types/referendum";
import { NORTHERN_IRELAND_DEF as def } from "./defs/northernIreland";
import { normalizeConflictState } from "./engine";
import { reconcileNorthernIrelandRatification } from "./northernIrelandRatification";
import { northernIrelandCampaignSupport } from "./rules/northernIrelandRatification";
import { build2027ConflictOpening } from "./initialState2027";

vi.mock("@/lib/referendum/wire", () => ({ recordWireEvent: vi.fn() }));
import { recordWireEvent } from "@/lib/referendum/wire";

function agreement() {
  return normalizeConflictState(def, {
    defKey: def.key,
    hasOpened: true,
    phaseLevel: 5,
    status: "negotiating",
    tracks: {
      unionistConsent: 65,
      nationalistConsent: 70,
      legitimacy: 68,
      institutionalStability: 70,
      decommissioning: 65,
      settlementMomentum: 80,
      domesticConsent: 65,
      violence: 20,
    },
  });
}
type ReferendumQuery = {
  _id?: ObjectId;
  "result.passed"?: boolean;
  status?: { $in: Referendum["status"][] };
};

function setup() {
  const mock = createMockDb();
  const bills = [
    { _id: new ObjectId(), countryId: "UK", status: "signed", proposedTurn: 10 },
    { _id: new ObjectId(), countryId: "IE", status: "signed", proposedTurn: 11 },
  ];
  mock.collection("bills").find().toArray.mockResolvedValue(bills);
  const rows: Referendum[] = [];
  const refs = mock.collection("referendums");
  refs.findOne.mockImplementation(async (filter: ReferendumQuery) => {
    if (filter._id) return rows.find((r) => String(r._id) === String(filter._id)) ?? null;
    if (filter["result.passed"] === false)
      return (
        rows
          .filter((r) => r.result?.passed === false)
          .sort((a, b) => b.result!.resolvedTurn - a.result!.resolvedTurn)[0] ?? null
      );
    return rows.find((r) => filter.status?.$in.includes(r.status)) ?? null;
  });
  refs.updateOne.mockImplementation(
    async (filter: ReferendumQuery, update: { $setOnInsert: Referendum }) => {
      if (!rows.some((r) => String(r._id) === String(filter._id)))
        rows.push({ ...update.$setOnInsert });
      return { upsertedCount: 1 };
    }
  );
  return { mock, db: mock as unknown as Db, bills, rows, refs };
}

beforeEach(() => vi.mocked(recordWireEvent).mockResolvedValue(undefined));

describe("Northern Ireland public ratification", () => {
  it("allows a new rejection and a fresh agreement after inherited 2027 consent", async () => {
    const { db, bills, rows } = setup();
    const inherited = build2027ConflictOpening(def, { countries: new Set(["UK", "IE"]), populations: {} });
    const proposed = await reconcileNorthernIrelandRatification(db, def, inherited, 2027, 1249);
    expect(proposed.tracks?.referendumRatification).toBe(0);
    const awaitingVote = await reconcileNorthernIrelandRatification(
      db, def, { ...proposed, phaseLevel: 5, status: "negotiating" }, 2027, 1250
    );
    expect(rows).toHaveLength(1);
    rows[0].status = "settled";
    rows[0].result = { finalYesShare: 40, turnout: 60, passed: false, resolvedTurn: 1251 };
    const rejected = await reconcileNorthernIrelandRatification(db, def, inherited, 2027, 1251);
    expect(rejected).toMatchObject({ phaseLevel: 4, status: "negotiating", tracks: { referendumRatification: 0 } });
    bills[0] = { ...bills[0], _id: new ObjectId(), proposedTurn: 1252 };
    bills[1] = { ...bills[1], _id: new ObjectId(), proposedTurn: 1252 };
    await reconcileNorthernIrelandRatification(db, def, { ...rejected, phaseLevel: 5 }, 2027, 1252);
    expect(rows).toHaveLength(2);
    rows[1].status = "completed";
    rows[1].result = { finalYesShare: 65, turnout: 64, passed: true, resolvedTurn: 1253 };
    const restored = await reconcileNorthernIrelandRatification(db, def, { ...awaitingVote, phaseLevel: 5 }, 2027, 1253);
    expect(restored).toMatchObject({ phaseLevel: 6, status: "settled", tracks: { ratificationAuthorization: 2, referendumRatification: 1 } });
  });
  it("opens one ordinary campaign only after both laws; a retry preserves its mandate and deadline", async () => {
    const { db, bills, rows } = setup();
    bills[1].status = "active";
    const waiting = await reconcileNorthernIrelandRatification(db, def, agreement(), 1998, 20);
    expect(rows).toHaveLength(0);
    expect(waiting.phaseLevel).toBe(5);
    bills[1].status = "signed";
    const opened = await reconcileNorthernIrelandRatification(db, def, waiting, 1998, 21);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "peace_agreement",
      status: "granted",
      campaignBaseYesShare: 65,
      campaignCloseTurn: 69,
      targetCountryId: null,
    });
    expect(String(rows[0].westminsterBillId)).toBe(String(bills[0]._id));
    expect(opened.phaseLevel).toBe(5);
    await reconcileNorthernIrelandRatification(
      db,
      def,
      { ...opened, tracks: { ...opened.tracks, unionistConsent: 100 } },
      1998,
      22
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignBaseYesShare).toBe(65);
    expect(rows[0].campaignCloseTurn).toBe(69);
  });

  it("preserves idle state identity and timestamp without writing or advancing another phase", async () => {
    const { db, mock } = setup();
    const opened = await reconcileNorthernIrelandRatification(db, def, agreement(), 1998, 20);
    mock.collection("livingConflicts").updateOne.mockClear();
    const retry = await reconcileNorthernIrelandRatification(db, def, opened, 1998, 20);
    expect(retry).toBe(opened);
    expect(retry.updatedAt).toBe(opened.updatedAt);
    expect(mock.collection("livingConflicts").updateOne).not.toHaveBeenCalled();
  });

  it("requires a counted public majority on the exact authorized agreement", async () => {
    const { db, rows } = setup();
    const opened = await reconcileNorthernIrelandRatification(db, def, agreement(), 1998, 20);
    rows[0].status = "completed";
    rows[0].result = { finalYesShare: 65, turnout: 64, passed: true, resolvedTurn: 70 };
    const settled = await reconcileNorthernIrelandRatification(db, def, opened, 1998, 70);
    expect(settled).toMatchObject({
      phaseLevel: 6,
      status: "settled",
      tracks: { ratificationAuthorization: 2, referendumRatification: 1 },
    });
  });

  it("returns rejection to talks once and forbids another vote on old authorizations", async () => {
    const { db, rows, bills } = setup();
    const opened = await reconcileNorthernIrelandRatification(db, def, agreement(), 1998, 20);
    rows[0].status = "settled";
    rows[0].result = { finalYesShare: 45, turnout: 58, passed: false, resolvedTurn: 70 };
    const rejected = await reconcileNorthernIrelandRatification(db, def, opened, 1998, 70);
    expect(rejected).toMatchObject({
      phaseLevel: 4,
      status: "negotiating",
      tracks: { ratificationAuthorization: 0, referendumRatification: 0, legitimacy: 58 },
    });
    const retry = await reconcileNorthernIrelandRatification(db, def, rejected, 1998, 70);
    expect(retry.tracks?.legitimacy).toBe(58);
    await reconcileNorthernIrelandRatification(db, def, { ...retry, phaseLevel: 5 }, 1998, 71);
    expect(rows).toHaveLength(1);
    bills[0] = { ...bills[0], _id: new ObjectId(), proposedTurn: 72 };
    await reconcileNorthernIrelandRatification(db, def, { ...retry, phaseLevel: 5 }, 1998, 73);
    expect(rows).toHaveLength(1);
    bills[1] = { ...bills[1], _id: new ObjectId(), proposedTurn: 73 };
    await reconcileNorthernIrelandRatification(db, def, { ...retry, phaseLevel: 5 }, 1998, 74);
    expect(rows).toHaveLength(2);
  });

  it("does not replace a live border poll", async () => {
    const { db, refs } = setup();
    refs.findOne.mockImplementation(async (query: ReferendumQuery) =>
      query.status ? { _id: new ObjectId() } : null
    );
    await reconcileNorthernIrelandRatification(db, def, agreement(), 1998, 20);
    expect(refs.updateOne).not.toHaveBeenCalled();
  });

  it("a national leader cannot lift public support above either community's consent", () => {
    const state = agreement();
    expect(
      northernIrelandCampaignSupport({
        ...state,
        tracks: {
          ...state.tracks,
          legitimacy: 100,
          domesticConsent: 100,
          settlementMomentum: 100,
          unionistConsent: 20,
        },
      })
    ).toBe(20);
  });
});
