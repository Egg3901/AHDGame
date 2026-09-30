import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { allLivingConflictDefs } from "./registry";
import { AUTHORED_2027_FAMILIES, build2027ConflictOpening } from "./initialState2027";
import { driveConflictTurn } from "./driver";
import { resolveConflictParticipants } from "./rules/participants";
import { reconcileNorthernIrelandRatification } from "./northernIrelandRatification";
import type { LivingConflictState } from "./types";

const countries = new Set([
  "US",
  "UK",
  "IE",
  "FR",
  "DE",
  "RU",
  "CN",
  "UKR",
  "PL",
  "RO",
  "TR",
  "TN",
  "EG",
  "LY",
  "SY",
  "YE",
  "JO",
  "LB",
  "IQ",
]);
const populations = Object.fromEntries([...countries].map((id) => [id, 1_000_000]));
const context = { countries, populations };

describe("fresh 2027 crisis opening", () => {
  it("authors exactly seven source-dated dispositions without replaying old opening phases", () => {
    const defs = allLivingConflictDefs().filter((def) => AUTHORED_2027_FAMILIES.includes(def.key));
    expect(defs).toHaveLength(7);
    const states = Object.fromEntries(
      defs.map((def) => [def.key, build2027ConflictOpening(def, context)])
    );
    expect(states.northern_ireland).toMatchObject({
      status: "settled",
      phaseLevel: 6,
      hasOpened: true,
    });
    expect(states.yugoslav_dissolution).toMatchObject({
      status: "closed",
      openingDisposition: "not_applicable",
    });
    expect(states.transnational_terrorism).toMatchObject({ status: "active", phaseLevel: 6 });
    expect(states.global_financial_crisis).toMatchObject({
      status: "closed",
      phaseLevel: 7,
      openingDisposition: "settled",
    });
    expect(states.pandemic).toMatchObject({ status: "settled", phaseLevel: 5 });
    expect(states.arab_uprisings).toMatchObject({ status: "active", phaseLevel: 6 });
    expect(states.russia_ukraine_security).toMatchObject({ status: "active", phaseLevel: 5 });
    expect(states.arab_uprisings.arabRegional?.origins.YE?.trajectory).toBe("civil_war");
    expect(states.arab_uprisings.arabRegional?.origins.SY?.trajectory).toBe("transition");
    expect(states.arab_uprisings.arabRegional?.origins.LY?.trajectory).toBe("frozen");
    for (const origin of Object.values(states.arab_uprisings.arabRegional?.origins ?? {})) {
      expect(origin?.openingSourceUrl).toMatch(/^https:\/\//);
      expect(origin?.openingEvidenceAsOf).toBe("2026-09-30");
    }
    expect(states.arab_uprisings.arabRegional?.hosts.TR?.refugeePeople).toBeGreaterThan(0);
    for (const def of defs) {
      const state = states[def.key];
      expect(state.openingProvenance).toMatchObject({
        preset: "2027-default",
        evidenceAsOf: "2026-09-30",
        scale: "modeled_continuity",
      });
      expect(state.openingProvenance?.sourceUrls.length).toBeGreaterThan(0);
      if (state.hasOpened) {
        expect(state.phaseTurns).toBeGreaterThan(0);
        expect(state.totalTurns).toBeGreaterThan(0);
        expect(state.emitPhaseEntryNextTurn).toBe(false);
        for (const key of Object.keys(def.tracks ?? {}))
          expect(Number.isFinite(state.tracks?.[key])).toBe(true);
      }
    }
  });

  it("retains a surviving Yugoslav federation as an explicit counterfactual", () => {
    const def = allLivingConflictDefs().find((item) => item.key === "yugoslav_dissolution")!;
    expect(
      build2027ConflictOpening(def, { ...context, countries: new Set([...countries, "YU"]) })
    ).toMatchObject({ status: "dormant", hasOpened: false, openingDisposition: "counterfactual" });
  });

  it("opens only an explicitly surviving Yugoslav federation in 2027", async () => {
    const def = allLivingConflictDefs().find((item) => item.key === "yugoslav_dissolution")!;
    const db = createMockDb();
    const live = new Map<string, LivingConflictState>();
    const collection = db.collection("livingConflicts");
    collection.findOne.mockImplementation(async (filter) => live.get(filter.defKey));
    collection.updateOne.mockImplementation(async (filter, update) => {
      live.set(filter.defKey, { ...live.get(filter.defKey), ...update.$set } as LivingConflictState);
    });
    live.set(def.key, build2027ConflictOpening(def, context));
    const absent = await driveConflictTurn(db as unknown as Db, def, resolveConflictParticipants(def, countries), 1249, 2027);
    expect(absent.state.status).toBe("closed");
    expect(absent.events).toEqual([]);

    const surviving = new Set([...countries, "YU"]);
    live.set(def.key, build2027ConflictOpening(def, { ...context, countries: surviving }));
    const reopened = await driveConflictTurn(db as unknown as Db, def, resolveConflictParticipants(def, surviving), 1249, 2027);
    expect(reopened.state).toMatchObject({ hasOpened: true, phaseLevel: 1, openedYear: 2027, openingDisposition: "counterfactual" });
    expect(reopened.events.map((event) => event.fired.phaseKey)).toEqual(["federal_crisis"]);
  });

  it("advances actual persisted opening states once without expired phase-entry events", async () => {
    const db = createMockDb();
    const stored = new Map<string, LivingConflictState>();
    const collection = db.collection("livingConflicts");
    collection.findOne.mockImplementation(async (filter) => stored.get(filter.defKey));
    collection.updateOne.mockImplementation(async (filter, update) => {
      stored.set(filter.defKey, {
        ...stored.get(filter.defKey),
        ...update.$set,
      } as LivingConflictState);
    });
    for (const def of allLivingConflictDefs().filter((item) =>
      AUTHORED_2027_FAMILIES.includes(item.key)
    )) {
      stored.set(def.key, build2027ConflictOpening(def, context));
    }
    for (const def of allLivingConflictDefs().filter((item) =>
      AUTHORED_2027_FAMILIES.includes(item.key)
    )) {
      const participants = resolveConflictParticipants(def, countries);
      const first = await driveConflictTurn(db as unknown as Db, def, participants, 1249, 2027);
      const replay = await driveConflictTurn(db as unknown as Db, def, participants, 1249, 2027);
      expect(replay.events).toEqual([]);
      if (first.state.status === "closed") continue;
      expect(first.state.lastProcessedTurn).toBe(1249);
      expect(first.events.every(({ fired }) => fired.phaseKey !== def.phases[0].key)).toBe(true);
      expect(first.state.phaseLevel).toBeGreaterThan(1);
      expect(stored.get(def.key)?.lastProcessedTurn).toBe(1249);
    }
  });

  it("never assigns the represented Ukrainian authority to Russia when Ukraine is absent", () => {
    const def = allLivingConflictDefs().find((item) => item.key === "russia_ukraine_security")!;
    const participants = resolveConflictParticipants(def, new Set(["RU", "US", "PL", "UK", "DE"]));
    expect(participants.belligerents).toEqual(["PL"]);
    expect(participants.backerA).toBe("RU");
  });

  it("preserves historical Northern Ireland ratification without new player-era bills", async () => {
    const def = allLivingConflictDefs().find((item) => item.key === "northern_ireland")!;
    const seeded = build2027ConflictOpening(def, context);
    const db = createMockDb();
    const next = await reconcileNorthernIrelandRatification(
      db as unknown as Db,
      def,
      seeded,
      2027,
      1249
    );
    expect(next).toBe(seeded);
    expect(next.tracks?.ratificationAuthorization).toBe(2);
    expect(next.tracks?.referendumRatification).toBe(1);
  });
});
