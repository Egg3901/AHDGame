import { describe, expect, it } from "vitest";
import { regionalLawLevels } from "../../src/lib/resetLegislation/regionalCatalog";
import { runResetRegionalLaw240 } from "./resetRegionalLaw240";

describe("1991 regional public-health options, 240 turns each", () => {
  const runs = runResetRegionalLaw240();

  it("covers all 71 regions and five locally authored positions", () => {
    expect(runs).toHaveLength(355);
    expect(runs.filter((run) => run.country === "US")).toHaveLength(255);
    expect(runs.filter((run) => run.country === "UK")).toHaveLength(60);
    expect(runs.filter((run) => run.country === "JP")).toHaveLength(40);
  });

  it("exposes regional shortfalls as reduced delivery, not automatic grants or arrears", () => {
    expect(
      runs.filter((run) => run.country === "US" && run.minimumDeliveryRatio < 0.9999)
    ).toHaveLength(102);
    expect(
      runs.filter((run) => run.country !== "US" && run.minimumDeliveryRatio < 0.9999)
    ).toHaveLength(0);
    expect(runs.every((run) => run.finalRegionalArrears === 0)).toBe(true);
    expect(runs.every((run) => run.maximumAccountingResidual < 0.01)).toBe(true);
  });

  it("prices the five newly authored education families across the same regional fiscal books", () => {
    const education = runResetRegionalLaw240(["L10", "L11", "L12", "L13", "L14"]);
    expect(education).toHaveLength(1_775);
    expect(new Set(education.map((run) => run.familyId)).size).toBe(5);
    expect(education.every((run) => run.maximumAccountingResidual < 0.01)).toBe(true);
    expect(education.every((run) => run.finalRegionalArrears === 0)).toBe(true);
  });

  it("sweeps every authored regional service family without silently granting funding", () => {
    const familyIds = [...new Set(regionalLawLevels.map((level) => level.familyId))];
    const authored = runResetRegionalLaw240(familyIds);
    expect(familyIds).toHaveLength(48);
    expect(authored).toHaveLength(16_840);
    expect(authored.filter((run) => run.country === "US")).toHaveLength(12_240);
    expect(authored.filter((run) => run.country === "UK")).toHaveLength(2_760);
    expect(authored.filter((run) => run.country === "JP")).toHaveLength(1_840);
    expect(authored.some((run) => run.minimumDeliveryRatio < 0.6)).toBe(true);
    expect(authored.every((run) => run.finalRegionalArrears === 0)).toBe(true);
    expect(authored.every((run) => run.maximumAccountingResidual < 0.01)).toBe(true);
  });
});
