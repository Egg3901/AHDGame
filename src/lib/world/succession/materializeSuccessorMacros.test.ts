import type { ClientSession, Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { materializeFederationSuccessorMacros } from "./materializeSuccessorMacros";

describe("federation successor macro materialization", () => {
  it("publishes only a matched sovereign background economy", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    const successor = {
      presetId: "1991-default",
      entityId: "UKR",
      status: "sovereign",
      simulationTier: "background-macro",
    } as WorldEntityManifestEntry;
    const country = {
      _id: "UKR",
      entityId: "UKR",
      presetId: "1991-default",
      simulationTier: "background-macro",
      dataQuality: { provenance: "succession-derived" },
    } as MacroCountryState;
    expect(
      await materializeFederationSuccessorMacros({
        db,
        session: {} as ClientSession,
        successors: [successor],
        countries: [country],
      })
    ).toBe(1);
    expect(await db.collection("macroCountries").findOne({ _id: "UKR" })).toEqual(country);
    await expect(
      materializeFederationSuccessorMacros({
        db,
        session: {} as ClientSession,
        successors: [successor],
        countries: [{ ...country, entityId: "BLR" }],
      })
    ).rejects.toThrow("macro inventory");
  });
});
