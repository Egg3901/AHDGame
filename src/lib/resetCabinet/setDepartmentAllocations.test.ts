import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { setResetDepartmentAllocations } from "./setDepartmentAllocations";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";

function fixture() {
  const memory = createInMemoryDb();
  memory.seed("resetDepartmentAccounts", [
    {
      _id: "US:us_health_department",
      worldId: "reset-world",
      countryId: "US",
      departmentId: "us_health_department",
      controllingSeatId: "secretary_of_health",
      sourceTurn: 1,
      accruedThroughTurn: 1,
      externallySettled: false,
      familyAnnualDemand: { L18: 100, L19: 200 },
      programAllocationPercents: {},
    },
  ]);
  return memory as unknown as Db;
}

function request(db: Db) {
  return {
    db,
    worldId: "reset-world",
    countryId: "US" as const,
    departmentId: "us_health_department",
    positionId: "secretary_of_health",
    turn: 2,
    actorId: "holder-1",
    allocations: { L18: 50, L19: 150 },
  };
}

describe("v2 Cabinet allocation persistence", () => {
  it("writes only within the current reset world, once per turn", async () => {
    const db = fixture();
    expect(await setResetDepartmentAllocations(request(db))).toEqual({ ok: true });
    const stored = await db
      .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
      .findOne({
        _id: "US:us_health_department",
      });
    expect(stored).toMatchObject({
      programAllocationPercents: { L18: 50, L19: 150 },
      lastAllocationChangedTurn: 2,
      lastAllocationChangedBy: "holder-1",
      accruedThroughTurn: 1,
    });
    expect(await setResetDepartmentAllocations(request(db))).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("rejects a stale world, wrong office, and incomplete family request", async () => {
    const db = fixture();
    expect(
      await setResetDepartmentAllocations({ ...request(db), worldId: "old-world" })
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await setResetDepartmentAllocations({ ...request(db), positionId: "secretary_of_state" })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await setResetDepartmentAllocations({ ...request(db), allocations: { L18: 100 } })
    ).toMatchObject({ ok: false, status: 400 });
  });
});
