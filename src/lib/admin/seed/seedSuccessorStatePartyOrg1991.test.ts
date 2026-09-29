import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { SUCCESSOR_PARTIES_1991 } from "@/lib/seeds/reference/successorParties1991";
import { seedSuccessorStatePartyOrg1991 } from "./seedSuccessorStatePartyOrg1991";

describe("1991 Soviet party organization seed", () => {
  it("seeds the CPSU throughout the Union, including non-Russian republics", async () => {
    const mem = createInMemoryDb();
    let sequentialId = 0;
    mem.seed(
      "politicalParties",
      Object.entries(SUCCESSOR_PARTIES_1991).flatMap(([countryId, parties]) =>
        parties.map((party) => ({
          _id: `${countryId}-${party.abbreviation}`,
          countryId,
          name: party.name,
          sequentialId: ++sequentialId,
          isDefault: true,
        }))
      )
    );

    await seedSuccessorStatePartyOrg1991(mem as unknown as Db, false, "1991-default", () => {});

    const ruOrgs = await mem.collection("statePartyOrg").find({ countryId: "RU" }).toArray();
    const regionIds = new Set(ruOrgs.map((row) => row.stateId));
    expect(regionIds.size).toBe(24);
    expect(regionIds).toContain("SU_UKR");
    expect(regionIds).toContain("SU_EE");
    expect(ruOrgs.filter((row) => row.stateId === "SU_UKR")).toHaveLength(1);
  });
});
