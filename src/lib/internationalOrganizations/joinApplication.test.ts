import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
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

const { resolveJoinApplication } = await import("./joinApplication");

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
