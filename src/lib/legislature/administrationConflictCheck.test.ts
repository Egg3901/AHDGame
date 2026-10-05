import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { findAdministrationConflict } from "./administrationConflictCheck";

describe("findAdministrationConflict", () => {
  it("includes legacy unscoped US laws and resolves authored conflicts", async () => {
    const enactedFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ legislationTypeId: "existing" }]),
    });
    const typeFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "existing",
          administration: { policyFamilyId: "existing", conflictSetIds: ["regime"] },
        },
      ]),
    });
    const db = {
      collection: vi.fn((name: string) => ({
        find: name === "enactedLaws" ? enactedFind : typeFind,
      })),
    } as unknown as Db;

    await expect(
      findAdministrationConflict(db, "US", [
        {
          _id: "proposed",
          administration: {
            primaryPortfolioId: "health",
            lawKind: "regulation",
            implementationMode: "regulation",
            allowedJurisdictionModes: ["national_direct"],
            defaultJurisdictionMode: "national_direct",
            policyFamilyId: "proposed",
            conflictSetIds: ["regime"],
          },
        },
      ])
    ).resolves.toMatchObject({ existingLegislationTypeId: "existing", conflictSetId: "regime" });
    expect(enactedFind).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "national",
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      }),
      expect.anything()
    );
  });

  it("does not query when a bill has no administered policy provisions", async () => {
    const collection = vi.fn();
    await expect(
      findAdministrationConflict({ collection } as unknown as Db, "UK", [])
    ).resolves.toBe(undefined);
    expect(collection).not.toHaveBeenCalled();
  });

  it("rejects conflicts inside one proposed bill even when no law is active", async () => {
    const enactedFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const db = {
      collection: vi.fn(() => ({ find: enactedFind })),
    } as unknown as Db;
    const administration = (family: string) => ({
      primaryPortfolioId: "health" as const,
      lawKind: "regulation" as const,
      implementationMode: "regulation" as const,
      allowedJurisdictionModes: ["national_direct" as const],
      defaultJurisdictionMode: "national_direct" as const,
      policyFamilyId: family,
      conflictSetIds: ["exclusive-regime"],
    });

    await expect(
      findAdministrationConflict(db, "US", [
        { _id: "proposed-a", administration: administration("family-a") },
        { _id: "proposed-b", administration: administration("family-b") },
      ])
    ).resolves.toMatchObject({
      proposedLegislationTypeId: "proposed-a",
      existingLegislationTypeId: "proposed-b",
      conflictSetId: "exclusive-regime",
    });
  });
});
