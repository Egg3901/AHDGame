import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("manualOfficeHistory");
});

async function asAdmin() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: new ObjectId().toString(), username: "adminuser", isAdmin: true },
  } as never);
}

async function asAnon() {
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  const { NextResponse } = await import("next/server");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  } as never);
}

function post(body: unknown) {
  return new Request("http://localhost/api/wiki/office-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  countryId: "US",
  officeKind: "executive",
  officeType: "president",
  iteration: { type: "Beta", number: 1 },
  name: "Old President",
  party: "1",
  startWeek: 4,
  startYear: 2017,
  endWeek: 30,
  endYear: 2019,
};

describe("POST /api/wiki/office-history", () => {
  it("rejects non-admins with 403", async () => {
    await asAnon();
    const { POST } = await import("./route");
    const res = await POST(post(VALID));
    expect(res.status).toBe(403);
  });

  it("inserts a manual entry with a derived officeKey", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(post(VALID));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const insert = db.collectionMocks.manualOfficeHistory!.insertOne.mock.calls[0][0];
    expect(insert.officeKey).toBe("US:executive:president");
    expect(insert.createdBy).toBe("adminuser");
    expect(insert.iteration).toEqual({ type: "Beta", number: 1 });
  });

  it("rejects out-of-range week with 400", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(post({ ...VALID, startWeek: 99 }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown countryId with 400", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(post({ ...VALID, countryId: "ZZ" }));
    expect(res.status).toBe(400);
  });

  it("accepts an entry with only real-world dates and stores them as Dates", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      post({
        countryId: "US",
        officeKind: "executive",
        officeType: "president",
        iteration: { type: "Alpha", number: 1 },
        name: "Date Only",
        startDate: "2026-06-16",
        endDate: "2026-06-19",
      })
    );
    expect(res.status).toBe(200);
    const insert = db.collectionMocks.manualOfficeHistory!.insertOne.mock.calls[0][0];
    expect(insert.startDate).toBeInstanceOf(Date);
    expect(insert.startDate.toISOString()).toBe("2026-06-16T12:00:00.000Z");
    expect(insert.endDate.toISOString()).toBe("2026-06-19T12:00:00.000Z");
    expect(insert.startWeek).toBeUndefined();
  });

  it("rejects an entry with no start week/year and no start date (400)", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      post({
        countryId: "US",
        officeKind: "executive",
        officeType: "president",
        iteration: { type: "Alpha", number: 1 },
        name: "No Start",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a start week without a start year (400)", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      post({
        countryId: "US",
        officeKind: "executive",
        officeType: "president",
        iteration: { type: "Alpha", number: 1 },
        name: "Half",
        startWeek: 4,
      })
    );
    expect(res.status).toBe(400);
  });

  it("drops the real-world end date when incumbent", async () => {
    await asAdmin();
    const { POST } = await import("./route");
    const res = await POST(
      post({
        countryId: "US",
        officeKind: "executive",
        officeType: "president",
        iteration: { type: "Beta", number: 2 },
        name: "Sitting",
        startDate: "2026-06-16",
        endDate: "2026-06-19",
        isIncumbent: true,
      })
    );
    expect(res.status).toBe(200);
    const insert = db.collectionMocks.manualOfficeHistory!.insertOne.mock.calls[0][0];
    expect(insert.startDate).toBeInstanceOf(Date);
    expect(insert.endDate).toBeUndefined();
  });
});

describe("PATCH/DELETE /api/wiki/office-history/[id]", () => {
  function ctx(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("DELETE removes the entry by id", async () => {
    await asAdmin();
    const id = new ObjectId();
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(
      new Request("http://localhost/api/wiki/office-history/" + id.toString(), {
        method: "DELETE",
      }),
      ctx(id.toString())
    );
    expect(res.status).toBe(200);
    expect(db.collectionMocks.manualOfficeHistory!.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  it("DELETE rejects an invalid id with 400", async () => {
    await asAdmin();
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(
      new Request("http://localhost/api/wiki/office-history/bad", { method: "DELETE" }),
      ctx("not-an-objectid")
    );
    expect(res.status).toBe(400);
  });

  it("PATCH updates editable fields", async () => {
    await asAdmin();
    const id = new ObjectId();
    const { PATCH } = await import("./[id]/route");
    const res = await PATCH(
      new Request("http://localhost/api/wiki/office-history/" + id.toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed", startWeek: 10, startYear: 2018 }),
      }),
      ctx(id.toString())
    );
    expect(res.status).toBe(200);
    const call = db.collectionMocks.manualOfficeHistory!.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: id });
    expect(call[1].$set).toEqual(expect.objectContaining({ name: "Renamed", startWeek: 10 }));
  });
});
