import { describe, expect, it, vi } from "vitest";
import type { MongoClient } from "mongodb";
import { runRegistrationHeal } from "./heal-registration-without-presence";

type Row = Record<string, unknown>;
function fixture() {
  const data: Record<string, Row[]> = {
    gameState: [{ _id: "current", currentTurn: 48, isActive: false, isProcessing: false }],
    gameConfig: [{ _id: "default", maintenanceMode: "full" }],
    states: [{ _id: "SCO", countryId: "UK" }],
    statePartyOrg: [
      {
        _id: "SCO_1",
        countryId: "UK",
        stateId: "SCO",
        partyId: "1",
        registration: 10,
        organization: 20,
      },
      {
        _id: "SCO_2",
        countryId: "UK",
        stateId: "SCO",
        partyId: "2",
        registration: 2,
        organization: 0,
      },
    ],
    stateRegistrationPool: [
      { _id: "UK_SCO", countryId: "UK", stateId: "SCO", independent: 80, unregistered: 8 },
    ],
    characters: [{ party: "1", countryId: "UK", homeState: "SCO" }],
    npps: [],
    electedOfficials: [],
  };
  const writes = vi.fn();
  const match = (r: Row, filter: Row) =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === "object" && "$ne" in v) return r[k] !== v.$ne;
      return v === null ? r[k] == null : r[k] === v;
    });
  const update = (name: string, filter: Row, change: Row) => {
    writes(name);
    const row = (data[name] ?? []).find((r) => match(r, filter));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, change.$set);
    for (const [key, value] of Object.entries((change.$inc ?? {}) as Row))
      row[key] = Number(row[key]) + Number(value);
    return { matchedCount: 1 };
  };
  const session = {
    endSession: vi.fn(),
    withTransaction: async (fn: () => Promise<unknown>) => {
      const before = structuredClone(data);
      try {
        return await fn();
      } catch (e) {
        Object.assign(data, before);
        throw e;
      }
    },
  };
  const client = {
    startSession: () => session,
    db: () => ({
      collection: (name: string) => ({
        findOne: async (filter: Row) =>
          structuredClone((data[name] ?? []).find((r) => match(r, filter)) ?? null),
        find: (filter: Row) => ({
          toArray: async () => structuredClone((data[name] ?? []).filter((r) => match(r, filter))),
        }),
        updateOne: async (filter: Row, change: Row) => update(name, filter, change),
        bulkWrite: async (ops: { updateOne: { filter: Row; update: Row } }[]) => ({
          matchedCount: ops.reduce(
            (n, op) => n + update(name, op.updateOne.filter, op.updateOne.update).matchedCount,
            0
          ),
        }),
        insertOne: async (row: Row) => {
          writes(name);
          (data[name] ??= []).push(row);
        },
        insertMany: async (rows: Row[]) => {
          writes(name);
          (data[name] ??= []).push(...rows);
        },
      }),
    }),
  } as unknown as MongoClient;
  return { data, writes, session, client };
}

describe("registration heal database shell", () => {
  it("defaults to a write-free snapshot even when the game is active", async () => {
    const f = fixture();
    f.data.gameState[0].isActive = true;
    const result = await runRegistrationHeal(f.client);
    expect(result.transfers).toHaveLength(1);
    expect(result.poolChanges[0].amount).toBe(2);
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.session.endSession).toHaveBeenCalledOnce();
  });
  it("applies a conserved transfer with audit/ledger and is idempotent", async () => {
    const f = fixture();
    await runRegistrationHeal(f.client, { apply: true, expectedTurn: 48 });
    expect(f.data.statePartyOrg[0].registration).toBe(10);
    expect(f.data.statePartyOrg[1]).toMatchObject({ registration: 0, organization: 0 });
    expect(f.data.stateRegistrationPool[0]).toMatchObject({ independent: 82, unregistered: 8 });
    expect(f.data.orgRegLedger.map((r) => r.delta)).toEqual([-2, 2]);
    expect(f.data.adminLogs).toHaveLength(1);
    f.writes.mockClear();
    expect(
      (await runRegistrationHeal(f.client, { apply: true, expectedTurn: 48 })).transfers
    ).toEqual([]);
    expect(f.writes).not.toHaveBeenCalled();
  });
  it.each(["active", "processing", "maintenance", "turn", "invalidPool"])(
    "blocks unsafe apply: %s",
    async (kind) => {
      const f = fixture();
      if (kind === "active") f.data.gameState[0].isActive = true;
      if (kind === "processing") f.data.gameState[0].isProcessing = true;
      if (kind === "maintenance") f.data.gameConfig[0].maintenanceMode = "partial";
      if (kind === "invalidPool") f.data.stateRegistrationPool[0].independent = 81;
      await expect(
        runRegistrationHeal(f.client, { apply: true, expectedTurn: kind === "turn" ? 47 : 48 })
      ).rejects.toThrow();
      expect(f.writes).not.toHaveBeenCalled();
    }
  );
  it.each(["npp", "official"])("retains a party with only an active %s", async (kind) => {
    const f = fixture();
    if (kind === "npp") f.data.npps.push({ party: "2", countryId: "UK", homeState: "SCO" });
    else f.data.electedOfficials.push({ party: "2", countryId: "UK", state: "SCO" });
    expect((await runRegistrationHeal(f.client)).transfers).toEqual([]);
  });
  it("does not treat a retired NPP as presence", async () => {
    const f = fixture();
    f.data.npps.push({ party: "2", countryId: "UK", homeState: "SCO", retiredAt: new Date() });
    expect((await runRegistrationHeal(f.client)).transfers).toHaveLength(1);
  });
  it("ignores national NPC countries with no regional registration to heal", async () => {
    const f = fixture();
    f.data.npps.push({ party: "2", countryId: "BR", homeState: "BR" });
    f.data.electedOfficials.push({ party: "2", countryId: "IE", state: "IE" });
    expect((await runRegistrationHeal(f.client)).transfers).toHaveLength(1);
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("does not treat country-code NPC homes as regional presence in regionalized countries", async () => {
    const f = fixture();
    f.data.npps.push({ party: "2", countryId: "UK", homeState: "UK" });
    f.data.electedOfficials.push({ party: "2", countryId: "UK", state: "UK" });
    expect((await runRegistrationHeal(f.client)).transfers).toHaveLength(1);
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("still rejects unknown home regions in countries included in the heal", async () => {
    const f = fixture();
    f.data.npps.push({ party: "2", countryId: "UK", homeState: "MISSING" });
    await expect(runRegistrationHeal(f.client)).rejects.toThrow("Ambiguous or unknown");
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("blocks ambiguous legacy rosters rather than deleting potentially valid registration", async () => {
    const f = fixture();
    f.data.states.push({ _id: "SCO", countryId: "US" });
    f.data.characters.push({ party: "2", homeState: "SCO" });
    await expect(runRegistrationHeal(f.client)).rejects.toThrow("Ambiguous");
    expect(f.writes).not.toHaveBeenCalled();
  });
});
