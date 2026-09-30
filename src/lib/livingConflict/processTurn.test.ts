import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { LivingConflictState } from "./types";

vi.mock("@/lib/crises/featureFlag", () => ({
  isCrisisInteractionEnabled: vi.fn().mockResolvedValue(true),
  isCrisisAidBillsEnabled: vi.fn().mockResolvedValue(false),
}));

import { processLivingConflictsTurn } from "./processTurn";

function pathValue(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = pathValue(row, key);
    if (expected && typeof expected === "object" && !(expected instanceof ObjectId)) {
      if ("$exists" in expected) return (actual !== undefined) === expected.$exists;
    }
    if (expected === null) return actual == null;
    return equalValue(actual, expected);
  });
}

function fakeDb() {
  const reads: { collection: string; projection?: Record<string, number> }[] = [];
  const stores = new Map<string, Record<string, unknown>[]>([
    ["states", Object.keys(COUNTRY_CONFIGS).map((countryId) => ({ countryId }))],
    ["macroCountries", ["SVN", "NVN", "CD", "EG", "SY"].map((entityId) => ({ entityId }))],
  ]);
  const rows = (name: string) => {
    const found = stores.get(name) ?? [];
    stores.set(name, found);
    return found;
  };
  const db = {
    collection(name: string) {
      return {
        find(
          query: Record<string, unknown> = {},
          options?: { projection?: Record<string, number> }
        ) {
          reads.push({ collection: name, projection: options?.projection });
          return {
            sort() {
              return this;
            },
            async toArray() {
              return rows(name).filter((row) => matches(row, query));
            },
          };
        },
        async findOne(query: Record<string, unknown>) {
          return rows(name).find((row) => matches(row, query)) ?? null;
        },
        async insertOne(doc: Record<string, unknown>) {
          const inserted = { ...doc, _id: doc._id ?? new ObjectId() };
          rows(name).push(inserted);
          return { insertedId: inserted._id };
        },
        async updateOne(
          query: Record<string, unknown>,
          update: { $set?: Record<string, unknown> },
          options?: { upsert?: boolean }
        ) {
          let row = rows(name).find((candidate) => matches(candidate, query));
          if (!row && options?.upsert) {
            row = { ...query };
            rows(name).push(row);
          }
          if (!row) return { modifiedCount: 0 };
          Object.assign(row, update.$set ?? {});
          return { modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
  return { db, stores, reads };
}

describe("living-conflict turn integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens Vietnam in 1955 as one role-aware crisis and is replay-safe", async () => {
    const { db, stores } = fakeDb();
    const first = await processLivingConflictsTurn(db, 97, 1955, true);
    expect(first.eventsOpened).toBe(1);

    const crisis = stores.get("crises")?.[0] as unknown as Crisis;
    expect(crisis.livingConflictEventId).toBe("vietnam:advisors:97:advisors_entry");
    expect(crisis.globalResponse?.roleByCountry).toMatchObject({
      US: "backer_a",
      RU: "backer_b",
      CN: "neighbor",
      UK: "bloc",
      IE: "bystander",
    });
    expect(crisis.globalResponse?.campaign).toMatchObject({
      stage: "posture",
      cycle: 1,
      consequences: {
        civilianStrain: 0,
        refugees: 0,
        infrastructureDamage: 0,
        armsProliferation: 0,
        regionalSpillover: 0,
        casualties: 0,
        settlementMomentum: 0,
      },
    });
    const interaction = stores.get("crisisInteractions")?.[0] as unknown as CrisisInteraction;
    expect(interaction.decisionTree[0].optionsByRole?.backer_a?.length).toBeGreaterThan(1);
    expect(interaction.decisionDeadline).toBeInstanceOf(Date);

    const stateBefore = {
      ...(stores.get("livingConflicts")?.[0] as unknown as LivingConflictState),
    };
    const replay = await processLivingConflictsTurn(db, 97, 1955, true);
    const stateAfter = stores.get("livingConflicts")?.[0] as unknown as LivingConflictState;
    expect(replay.eventsOpened).toBe(0);
    expect(stateAfter.totalTurns).toBe(stateBefore.totalTurns);
    expect(stateAfter.phaseTurns).toBe(stateBefore.phaseTurns);
  });

  it("opens the Northern Ireland crisis in 1991 and closes it after actual reunification", async () => {
    const { db, stores } = fakeDb();
    await processLivingConflictsTurn(db, 1, 1991, true);
    const northernIreland = () =>
      (stores.get("livingConflicts") ?? []).find((row) => row.defKey === "northern_ireland");
    expect(northernIreland()).toMatchObject({
      hasOpened: true,
      status: "active",
      openedYear: 1991,
    });

    stores.set("referendums", [
      {
        countryId: "UK",
        regionId: "NIR",
        kind: "reunification",
        targetCountryId: "IE",
        status: "completed",
      },
    ]);
    await processLivingConflictsTurn(db, 2, 1991, true);
    expect(northernIreland()?.status).toBe("closed");
    const crisisCount = (stores.get("crises") ?? []).filter((row) =>
      String(row.livingConflictEventId ?? "").startsWith("northern_ireland:")
    ).length;
    await processLivingConflictsTurn(db, 3, 1991, true);
    expect(northernIreland()?.status).toBe("closed");
    expect(
      (stores.get("crises") ?? []).filter((row) =>
        String(row.livingConflictEventId ?? "").startsWith("northern_ireland:")
      )
    ).toHaveLength(crisisCount);
  });

  it("persists and exposes Yugoslav local actors without assigning other countries their roles", async () => {
    const { db, stores } = fakeDb();
    stores.set(
      "states",
      ["US", "UK", "DE", "CS", "HU"].map((countryId) => ({ countryId }))
    );
    stores.set("macroCountries", []);
    await processLivingConflictsTurn(db, 1, 1991, true);
    const state = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "yugoslav_dissolution"
    );
    expect(state?.hasOpened).toBe(true);
    expect(state?.representedActors).toHaveLength(6);
    const crisis = (stores.get("crises") ?? []).find(
      (row) => pathValue(row, "globalResponse.conflictKey") === "yugoslav_dissolution"
    );
    expect(crisis?.description).toContain("Bosnian authorities");
    expect(pathValue(crisis!, "globalResponse.roleByCountry.CS")).toBeUndefined();
    expect(pathValue(crisis!, "globalResponse.roleByCountry.HU")).toBeUndefined();
  });

  it("keeps Northern Ireland open while a passed reunification vote awaits consent bills", async () => {
    const { db, stores } = fakeDb();
    stores.set("referendums", [
      {
        countryId: "UK",
        regionId: "NIR",
        kind: "reunification",
        targetCountryId: "IE",
        status: "actuating",
        result: { passed: true },
      },
    ]);
    await processLivingConflictsTurn(db, 1, 1991, true);
    expect(
      (stores.get("livingConflicts") ?? []).find((row) => row.defKey === "northern_ireland")
    ).toMatchObject({ hasOpened: true, status: "active" });
  });

  it("materializes non-Vietnam chains through the same crisis interaction path", async () => {
    const { db, stores } = fakeDb();
    await processLivingConflictsTurn(db, 241, 1960, true);
    const crises = (stores.get("crises") ?? []) as unknown as Crisis[];
    const keys = crises.map((crisis) => crisis.globalResponse?.conflictKey);
    expect(keys).toEqual(
      expect.arrayContaining(["vietnam", "berlin", "congo", "suez_aftermath", "oil_disruption"])
    );
    expect(keys).not.toContain("nuclear_incident");
    expect(crises.every((crisis) => crisis.interactionDefinition?.decisionTree.length === 1)).toBe(
      true
    );
  });

  it("retains a background sovereign actor even without domestic state rows", async () => {
    const { db, stores, reads } = fakeDb();
    stores.set(
      "states",
      ["RU", "US", "UK", "DE"].map((countryId) => ({ countryId }))
    );
    stores.set("macroCountries", [{ entityId: "UKR" }]);
    await processLivingConflictsTurn(db, 1057, 2013, true);
    const state = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "russia_ukraine_security"
    );
    expect(state?.hasOpened).toBe(true);
    const crisis = (stores.get("crises") ?? []).find(
      (row) => pathValue(row, "globalResponse.conflictKey") === "russia_ukraine_security"
    );
    expect(crisis).toBeDefined();
    expect(pathValue(crisis!, "globalResponse.roleByCountry.UKR")).toBe("belligerent");
    expect(pathValue(crisis!, "globalResponse.roleByCountry.RU")).toBe("backer_a");
    expect(reads.filter((read) => read.collection === "macroCountries")).toEqual([
      { collection: "macroCountries", projection: { entityId: 1, _id: 0 } },
    ]);
    expect(reads.filter((read) => read.collection === "states")).toEqual([
      { collection: "states", projection: { countryId: 1, _id: 0 } },
    ]);
  });

  it.each([[], [{ entityId: "UKR", retiredAt: new Date("2012-01-01") }]])(
    "does not open a crisis for a missing or retired background belligerent: %j",
    async (...macroCountries: Record<string, unknown>[]) => {
      const { db, stores } = fakeDb();
      stores.set(
        "states",
        ["RU", "US", "UK", "DE"].map((countryId) => ({ countryId }))
      );
      stores.set("macroCountries", macroCountries);
      await processLivingConflictsTurn(db, 1057, 2013, true);
      expect(
        (stores.get("livingConflicts") ?? []).find(
          (row) => row.defKey === "russia_ukraine_security"
        )
      ).toBeUndefined();
      expect(
        (stores.get("crises") ?? []).some(
          (row) => pathValue(row, "globalResponse.conflictKey") === "russia_ukraine_security"
        )
      ).toBe(false);
    }
  );

  it("does not invent participants from static country configs in an empty world", async () => {
    const { db, stores } = fakeDb();
    stores.set("states", []);
    stores.set("macroCountries", []);
    const result = await processLivingConflictsTurn(db, 1057, 2013, true);
    expect(result.eventsOpened).toBe(0);
    expect(stores.get("livingConflicts") ?? []).toEqual([]);
  });

  it("opens the nuclear alert only after two countries field credible arsenals", async () => {
    const { db, stores } = fakeDb();
    stores.set("nuclearPrograms", [
      {
        _id: "US",
        adopted: { "device-fission": 1, "delivery-bombers": 1 },
        warheads: 4,
        productionRate: 0,
        updatedAt: new Date(),
      },
      {
        _id: "RU",
        adopted: { "device-fission": 1, "delivery-bombers": 1 },
        warheads: 4,
        productionRate: 0,
        updatedAt: new Date(),
      },
    ]);

    await processLivingConflictsTurn(db, 241, 1960, true);
    const keys = ((stores.get("crises") ?? []) as unknown as Crisis[]).map(
      (crisis) => crisis.globalResponse?.conflictKey
    );
    expect(keys).toContain("nuclear_incident");
  });

  it("opens the next consultation on the exact turn the prior window expires", async () => {
    const { db, stores } = fakeDb();
    await processLivingConflictsTurn(db, 97, 1955, true);
    for (let turn = 98; turn <= 121; turn++) {
      await processLivingConflictsTurn(db, turn, 1955, true);
    }

    const vietnamCrises = ((stores.get("crises") ?? []) as unknown as Crisis[]).filter(
      (crisis) => crisis.globalResponse?.conflictKey === "vietnam"
    );
    expect(vietnamCrises.map((crisis) => crisis.startTurn)).toEqual([97, 121]);
    expect(vietnamCrises[1].livingConflictEventId).toContain("advisors_world_response");
  });

  it("imports the live legacy Vietnam rung before opening the 1.3 response", async () => {
    const { db, stores } = fakeDb();
    stores.set("vietnamEscalation", [
      {
        _id: "current",
        hasOpened: true,
        level: 3,
        westSupport: 18,
        eastSupport: 9,
        warTurns: 4,
        westSpend: 100,
        eastSpend: 50,
        updatedAt: new Date(),
      },
    ]);

    await processLivingConflictsTurn(db, 250, 1964, true);
    const vietnam = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "vietnam"
    ) as unknown as LivingConflictState;
    expect(vietnam.phaseLevel).toBe(3);
    expect(vietnam.pressure).toEqual({ a: 18, b: 9 });
    expect(vietnam.totalTurns).toBe(5);

    const crisis = (stores.get("crises") ?? []).find(
      (row) => row["globalResponse"] && pathValue(row, "globalResponse.conflictKey") === "vietnam"
    ) as unknown as Crisis;
    expect(crisis.livingConflictEventId).toBe("vietnam:tonkin_incident:250:tonkin_incident_entry");
  });

  it("advances Vietnam when a high-tension superpower war supplies external pressure", async () => {
    const { db, stores } = fakeDb();
    stores.set("livingConflicts", [
      {
        defKey: "vietnam",
        hasOpened: true,
        phaseLevel: 1,
        intensity: 23,
        openedYear: 1955,
        pressure: { a: 24, b: 0 },
        phaseTurns: 103,
        totalTurns: 104,
        lastProcessedTurn: 440,
        updatedAt: new Date(),
      },
    ]);
    stores.set("coldWarTension", [{ _id: "current", value: 100 }]);
    stores.set("conflicts", [
      {
        _id: "war_us_dd_415",
        name: "The War for Germany",
        status: "active",
        intensity: 70,
        hostCountry: "DD",
        hostEntities: ["DD", "DE"],
        sideA: { countries: ["US"] },
        sideB: { countries: ["DD", "RU"] },
      },
    ]);

    await processLivingConflictsTurn(db, 441, 1961, true);

    const vietnam = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "vietnam"
    ) as unknown as LivingConflictState;
    expect(vietnam.phaseLevel).toBe(2);
  });

  it("retries a new Vietnam phase entry after the prior response window closes", async () => {
    const { db, stores } = fakeDb();
    stores.set("livingConflicts", [
      {
        defKey: "vietnam",
        hasOpened: true,
        phaseLevel: 1,
        intensity: 23,
        openedYear: 1955,
        pressure: { a: 24, b: 0 },
        phaseTurns: 103,
        totalTurns: 104,
        lastProcessedTurn: 440,
        updatedAt: new Date(),
      },
    ]);
    stores.set("coldWarTension", [{ _id: "current", value: 100 }]);
    stores.set("conflicts", [
      {
        _id: "war_us_dd_415",
        status: "active",
        intensity: 70,
        hostCountry: "DD",
        hostEntities: ["DD", "DE"],
        sideA: { countries: ["US"] },
        sideB: { countries: ["DD", "RU"] },
      },
    ]);
    stores.set("crises", [
      {
        _id: new ObjectId(),
        name: "Vietnam advisory response",
        status: "active",
        startTurn: 433,
        durationTurns: 24,
        livingConflictEventId: "vietnam:advisors:433:advisors_world_response",
        globalResponse: { conflictKey: "vietnam" },
      },
    ]);

    await processLivingConflictsTurn(db, 441, 1961, true);

    let vietnam = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "vietnam"
    ) as unknown as LivingConflictState;
    expect(vietnam.phaseLevel).toBe(2);
    expect(vietnam.emitPhaseEntryNextTurn).toBe(true);
    expect(
      (stores.get("crises") ?? []).some((row) =>
        String(row.livingConflictEventId).includes(":materiel:")
      )
    ).toBe(false);

    const priorResponse = (stores.get("crises") ?? []).find(
      (row) => row.livingConflictEventId === "vietnam:advisors:433:advisors_world_response"
    );
    if (!priorResponse) throw new Error("expected the prior Vietnam response");
    priorResponse.status = "resolved";

    await processLivingConflictsTurn(db, 442, 1961, true);

    vietnam = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "vietnam"
    ) as unknown as LivingConflictState;
    expect(vietnam.emitPhaseEntryNextTurn).toBe(false);
    expect(
      (stores.get("crises") ?? []).some(
        (row) => row.livingConflictEventId === "vietnam:materiel:442:materiel_entry"
      )
    ).toBe(true);
  });

  it("does not apply external Vietnam pressure when the game year is unavailable", async () => {
    const { db, stores } = fakeDb();
    stores.set("livingConflicts", [
      {
        defKey: "vietnam",
        hasOpened: true,
        phaseLevel: 1,
        intensity: 23,
        openedYear: 1955,
        pressure: { a: 24, b: 0 },
        phaseTurns: 103,
        totalTurns: 104,
        lastProcessedTurn: 440,
        updatedAt: new Date(),
      },
    ]);
    stores.set("coldWarTension", [{ _id: "current", value: 100 }]);
    stores.set("conflicts", [
      {
        _id: "war_us_dd_415",
        status: "active",
        intensity: 70,
        hostCountry: "DD",
        hostEntities: ["DD", "DE"],
        sideA: { countries: ["US"] },
        sideB: { countries: ["DD", "RU"] },
      },
    ]);

    await processLivingConflictsTurn(db, 441, null, true);

    const vietnam = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "vietnam"
    ) as unknown as LivingConflictState;
    expect(vietnam.phaseLevel).toBe(1);
    expect(vietnam.pressure).toEqual({ a: 24, b: 0 });
  });
});
