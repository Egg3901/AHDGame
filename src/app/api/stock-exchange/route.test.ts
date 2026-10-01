import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { GET } from "./route";
import { getDb } from "@/lib/mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const findOne = vi.fn();
const request = (headers?: HeadersInit) =>
  new Request("http://localhost/api/stock-exchange?exchange=nyse", { headers });

describe("live stock quote snapshots", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockResolvedValue({ collection: () => ({ findOne }) } as unknown as Db);
    findOne.mockResolvedValue({
      _id: "nyse",
      exchangeName: "NYSE",
      turn: 100,
      listings: [],
      createdAt: new Date("2026-10-01T12:00:00Z"),
    });
  });

  it("revalidates snapshots rather than serving stale shared quotes", async () => {
    const first = await GET(request());
    expect(first.headers.get("cache-control")).toBe("private, no-cache, no-transform");
    expect(await first.json()).toMatchObject({
      exchange: "NYSE",
      turn: 100,
      asOf: "2026-10-01T12:00:00.000Z",
    });
    const etag = first.headers.get("etag")!;
    expect((await GET(request({ "if-none-match": etag }))).status).toBe(304);
    findOne.mockResolvedValue({
      _id: "nyse",
      exchangeName: "NYSE",
      turn: 100,
      listings: [],
      createdAt: new Date("2026-10-01T12:05:00Z"),
    });
    const updated = await GET(request({ "if-none-match": etag }));
    expect(updated.status).toBe(200);
    expect((await updated.json()).asOf).toBe("2026-10-01T12:05:00.000Z");
  });

  it("makes the uninitialized snapshot explicit", async () => {
    findOne.mockResolvedValue(null);
    const res = await GET(request());
    expect(await res.json()).toMatchObject({ listings: [], turn: 0, asOf: null });
  });

  it("rejects an unknown venue", async () => {
    expect(
      (await GET(new Request("http://localhost/api/stock-exchange?exchange=unknown"))).status
    ).toBe(400);
  });
});
