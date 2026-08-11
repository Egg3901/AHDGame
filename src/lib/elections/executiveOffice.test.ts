import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  getExecutiveOfficeKeys,
  isExecutiveOffice,
  getExecutiveCharacterIds,
} from "./executiveOffice";

// ─── Pure predicate tests ────────────────────────────────────────────────────

describe("getExecutiveOfficeKeys", () => {
  it("includes national heads of government, deputies, and ceremonial heads of state", () => {
    const keys = getExecutiveOfficeKeys();
    expect(keys.has("president")).toBe(true); // US head of state+gov / CN ceremonial
    expect(keys.has("vicePresident")).toBe(true); // US deputy
    expect(keys.has("primeMinister")).toBe(true); // UK head of gov
    expect(keys.has("chancellor")).toBe(true); // DE head of gov
    expect(keys.has("taoiseach")).toBe(true); // IE head of gov
    expect(keys.has("tanaiste")).toBe(true); // IE deputy
    expect(keys.has("uachtaran")).toBe(true); // IE ceremonial head of state
    expect(keys.has("premier")).toBe(true); // CN head of gov
  });

  it("excludes legislators and subnational executives", () => {
    const keys = getExecutiveOfficeKeys();
    expect(keys.has("senate")).toBe(false);
    expect(keys.has("house")).toBe(false);
    expect(keys.has("governor")).toBe(false); // subnational
    expect(keys.has("centralBankChair")).toBe(false);
  });
});

describe("isExecutiveOffice", () => {
  it("returns false for null / undefined office", () => {
    expect(isExecutiveOffice(null)).toBe(false);
    expect(isExecutiveOffice(undefined)).toBe(false);
  });

  it("returns true for a directly-typed executive office", () => {
    expect(isExecutiveOffice({ type: "president" })).toBe(true);
    expect(isExecutiveOffice({ type: "vicePresident" })).toBe(true);
    expect(isExecutiveOffice({ type: "primeMinister" })).toBe(true);
    expect(isExecutiveOffice({ type: "premier" })).toBe(true);
  });

  it("returns true for a Tánaiste seated as a parliamentary cabinet office", () => {
    expect(isExecutiveOffice({ type: "parliamentaryCabinet", positionId: "tanaiste" })).toBe(true);
  });

  it("returns false for a non-executive cabinet office", () => {
    expect(
      isExecutiveOffice({ type: "parliamentaryCabinet", positionId: "minister_for_finance" })
    ).toBe(false);
    expect(isExecutiveOffice({ type: "usCabinet", positionId: "secretary_of_state" })).toBe(false);
  });

  it("returns false for legislative and subnational offices", () => {
    expect(isExecutiveOffice({ type: "senate", state: "CA" })).toBe(false);
    expect(isExecutiveOffice({ type: "governor", state: "CA" })).toBe(false);
    expect(isExecutiveOffice({ type: "commons", state: "ENG" })).toBe(false);
  });
});

// ─── DB-helper tests ─────────────────────────────────────────────────────────

/** Wire a collection's `find(...).project(...).toArray()` chain to return `rows`. */
function wireFind(db: MockDb, name: string, rows: unknown[]): void {
  const cursor = {
    project: () => cursor,
    sort: () => cursor,
    limit: () => cursor,
    skip: () => cursor,
    toArray: async () => rows,
  };
  db.collection(name).find = (() => cursor) as never;
}

describe("getExecutiveCharacterIds", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("collects currentOffice executives, cabinet deputies, but not backbenchers", async () => {
    const pmId = new ObjectId();
    const tanaisteId = new ObjectId();
    const backbencherId = new ObjectId();

    wireFind(db, "characters", [
      { _id: pmId, currentOffice: { type: "taoiseach" } },
      { _id: tanaisteId, currentOffice: { type: "parliamentaryCabinet", positionId: "tanaiste" } },
      { _id: backbencherId, currentOffice: { type: "dail", state: "DUB" } },
    ]);
    wireFind(db, "electedOfficials", []);

    const ids = await getExecutiveCharacterIds(db as unknown as Db, ["IE"]);
    expect(ids.has(pmId.toString())).toBe(true);
    expect(ids.has(tanaisteId.toString())).toBe(true);
    expect(ids.has(backbencherId.toString())).toBe(false);
  });

  it("collects CN ceremonial president from electedOfficials even without an executive currentOffice", async () => {
    const ceremonialId = new ObjectId();

    wireFind(db, "characters", [
      { _id: ceremonialId, currentOffice: { type: "npcDelegate", state: "BEI" } },
    ]);
    wireFind(db, "electedOfficials", [
      { countryId: "CN", officeType: "president", characterId: ceremonialId },
    ]);

    const ids = await getExecutiveCharacterIds(db as unknown as Db, ["CN"]);
    expect(ids.has(ceremonialId.toString())).toBe(true);
  });
});
