import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
  isMember: vi.fn((_db: unknown, organizationId: string, countryId: string) =>
    Promise.resolve(
      membershipsStore.some((m) => m.organizationId === organizationId && m.countryId === countryId)
    )
  ),
  loadOrganizationDef: vi.fn((_db: unknown, organizationId: string) =>
    Promise.resolve({ id: organizationId, name: `${organizationId} (long name)` })
  ),
}));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  removeOrganizationMembership: vi.fn((_db: unknown, countryId: string, organizationId: string) => {
    const i = membershipsStore.findIndex(
      (m) => m.organizationId === organizationId && m.countryId === countryId
    );
    if (i >= 0) membershipsStore.splice(i, 1);
    return Promise.resolve(undefined);
  }),
}));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1953-default"),
}));

const proposalsStore = new Map<string, Record<string, unknown>>();
const billsStore = new Map<string, Record<string, unknown>>();
const membershipsStore: Array<Record<string, unknown>> = [];

function applySet(doc: Record<string, unknown>, update: Record<string, unknown>) {
  const set = update.$set as Record<string, unknown> | undefined;
  if (set) Object.assign(doc, set);
}

vi.mock("@/lib/db/collections", () => ({
  getOrganizationProposalsCollection: vi.fn().mockResolvedValue({
    findOne: (q: { _id: ObjectId }) =>
      Promise.resolve(proposalsStore.get(q._id.toString()) ?? null),
    updateOne: (q: { _id: ObjectId }, u: Record<string, unknown>) => {
      const doc = proposalsStore.get(q._id.toString());
      if (doc) applySet(doc, u);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    },
  }),
  getOrganizationMembershipsCollection: vi.fn().mockResolvedValue({
    updateOne: (q: { organizationId: string; countryId: string }, u: Record<string, unknown>) => {
      const exists = membershipsStore.some(
        (m) => m.organizationId === q.organizationId && m.countryId === q.countryId
      );
      if (!exists) membershipsStore.push({ ...q, ...(u.$setOnInsert as object) });
      return Promise.resolve({ upsertedCount: exists ? 0 : 1 });
    },
  }),
  getOrganizationWithdrawalsCollection: vi.fn().mockResolvedValue({
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  }),
}));

const { resolveJoinApplication, admitMember } = await import("./joinApplication");
const { removeOrganizationMembership } =
  await import("@/lib/internationalOrganizations/withdrawalBills");
const { getOrganizationMembershipsCollection } = await import("@/lib/db/collections");

function fakeDb(): Db {
  return {
    collection: (name: string) => {
      if (name !== "bills") throw new Error(`unexpected collection ${name}`);
      return {
        findOne: (q: { _id: ObjectId }) =>
          Promise.resolve(billsStore.get(q._id.toString()) ?? null),
        updateOne: (q: { _id: ObjectId }, u: Record<string, unknown>) => {
          const doc = billsStore.get(q._id.toString());
          if (doc) applySet(doc, u);
          return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
        },
      };
    },
  } as unknown as Db;
}

function seed(opts: { orgApproved?: boolean; domesticApproved?: boolean; billStatus?: string }): {
  proposalId: ObjectId;
  billId: ObjectId;
} {
  const proposalId = new ObjectId();
  const billId = new ObjectId();
  proposalsStore.set(proposalId.toString(), {
    _id: proposalId,
    organizationId: "EU",
    proposingCountryId: "DE",
    status: "pending",
    domesticBillId: billId,
    ...(opts.orgApproved !== undefined ? { orgApproved: opts.orgApproved } : {}),
    ...(opts.domesticApproved !== undefined ? { domesticApproved: opts.domesticApproved } : {}),
  });
  billsStore.set(billId.toString(), { _id: billId, status: opts.billStatus ?? "active" });
  return { proposalId, billId };
}

beforeEach(() => {
  proposalsStore.clear();
  billsStore.clear();
  membershipsStore.length = 0;
  vi.clearAllMocks();
});

describe("resolveJoinApplication", () => {
  it("admits when the member vote passed AND the bill passed", async () => {
    const { proposalId } = seed({ orgApproved: true, billStatus: "signed" });
    await resolveJoinApplication(fakeDb(), proposalId, 200);
    expect(membershipsStore).toHaveLength(1);
    expect(proposalsStore.get(proposalId.toString())?.status).toBe("approved");
  });

  it("cancels the bill when the members reject (org side fails)", async () => {
    const { proposalId, billId } = seed({ orgApproved: false, billStatus: "active" });
    await resolveJoinApplication(fakeDb(), proposalId, 200);
    expect(membershipsStore).toHaveLength(0);
    expect(proposalsStore.get(proposalId.toString())?.status).toBe("cancelled");
    expect(proposalsStore.get(proposalId.toString())?.cancelledReason).toMatch(/declined/i);
    expect(billsStore.get(billId.toString())?.status).toBe("failed");
  });

  it("cancels the proposal when the domestic bill fails", async () => {
    const { proposalId } = seed({ orgApproved: true, billStatus: "failed" });
    await resolveJoinApplication(fakeDb(), proposalId, 200);
    expect(membershipsStore).toHaveLength(0);
    expect(proposalsStore.get(proposalId.toString())?.status).toBe("cancelled");
    expect(proposalsStore.get(proposalId.toString())?.cancelledReason).toMatch(/ratification/i);
  });

  it("waits (no admission) when the bill passed but the member vote is pending", async () => {
    const { proposalId } = seed({ billStatus: "signed" });
    await resolveJoinApplication(fakeDb(), proposalId, 200);
    expect(membershipsStore).toHaveLength(0);
    expect(proposalsStore.get(proposalId.toString())?.status).toBe("pending");
  });

  it("waits (no admission) when the member vote passed but the bill is pending", async () => {
    const { proposalId } = seed({ orgApproved: true, billStatus: "active" });
    await resolveJoinApplication(fakeDb(), proposalId, 200);
    expect(membershipsStore).toHaveLength(0);
    expect(proposalsStore.get(proposalId.toString())?.status).toBe("pending");
  });
});

describe("admitMember bloc exclusivity", () => {
  const member = (organizationId: string, countryId: string, status = "founding") => {
    membershipsStore.push({ organizationId, countryId, status });
  };

  it("withdraws a country from the rival alliance when it joins the other one", async () => {
    // Greece sat in NATO from turn 0 and was admitted to the Warsaw Pact on turn
    // 657, holding both for 36 turns (ticket #1285).
    member("NATO", "GR");
    await admitMember(fakeDb(), "WARSAW_PACT", "GR", 657);

    expect(membershipsStore.map((m) => m.organizationId)).toEqual(["WARSAW_PACT"]);
    expect(vi.mocked(removeOrganizationMembership)).toHaveBeenCalledWith(
      expect.anything(),
      "GR",
      "NATO",
      "NATO (long name)",
      657
    );
  });

  it("withdraws from the Warsaw Pact when a country joins NATO", async () => {
    member("WARSAW_PACT", "YU", "active");
    await admitMember(fakeDb(), "NATO", "YU", 700);

    expect(membershipsStore.map((m) => m.organizationId)).toEqual(["NATO"]);
  });

  it("gives up the rival row before taking the new one", async () => {
    // Order is load-bearing. `loadBlocMembership` writes one bloc per row with no
    // precedence, so a country holding both reads as whichever document Mongo
    // returned last. Failing between the two steps must leave it in NEITHER pole
    // (wrong, but deterministic and visible), never in BOTH.
    member("NATO", "GR");
    await admitMember(fakeDb(), "WARSAW_PACT", "GR", 657);

    const removedAt = vi.mocked(removeOrganizationMembership).mock.invocationCallOrder[0]!;
    const addedAt = vi.mocked(getOrganizationMembershipsCollection).mock.invocationCallOrder[0]!;
    expect(removedAt).toBeLessThan(addedAt);
  });

  it("touches nothing when the org does not govern accession", async () => {
    member("NATO", "GR");
    await admitMember(fakeDb(), "UN", "GR", 700);

    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
    expect(membershipsStore.map((m) => m.organizationId).sort()).toEqual(["NATO", "UN"]);
  });

  it("does not tombstone a rival alliance the country was never in", async () => {
    // `removeOrganizationMembership` writes a withdrawal tombstone and a history
    // line for every remaining member, so calling it for a non-member would
    // announce a departure that never happened and block a later accession.
    await admitMember(fakeDb(), "NATO", "SE", 700);

    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
  });

  it("leaves a world entity alone, having no country to withdraw", async () => {
    // A proxy war's hosts are world entities, not countries: North Vietnam is not
    // a playable id and holds no alliance rows to give up.
    await admitMember(fakeDb(), "WARSAW_PACT", "NVN", 574);

    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
  });
});
