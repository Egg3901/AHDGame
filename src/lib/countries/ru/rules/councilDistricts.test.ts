import { describe, expect, it } from "vitest";
import { planRussianCouncilDistricts as plan } from "./councilDistricts";

function register() {
  return Object.fromEntries(
    Array.from({ length: 89 }, (_, i) => [`RU-council-${i + 1}`, 1000 + i])
  );
}

describe("First Council subject boundaries", () => {
  it("retains all 89 subjects and 178 mandates, including historical unheld districts", () => {
    const input = register();
    const districts = plan(input);
    expect(districts).toHaveLength(89);
    expect(districts.reduce((sum, row) => sum + row.totalSeats, 0)).toBe(178);
    expect(districts.find((row) => row.districtNumber === 16)?.name).toBe("Tatarstan");
    expect(districts.find((row) => row.districtNumber === 20)?.name).toBe("Chechnya");
    expect(districts.find((row) => row.districtNumber === 74)?.name).toBe("Chelyabinsk Oblast");
    expect(districts.reduce((sum, row) => sum + row.registeredVoters, 0)).toBe(
      Object.values(input).reduce((sum, value) => sum + value, 0)
    );
  });
  it("keeps parent regions and nested autonomous okrugs as separate districts", () => {
    const districts = plan(register());
    for (const [parent, children] of [
      [24, [84, 88]],
      [29, [83]],
      [38, [85]],
      [41, [82]],
      [59, [81]],
      [72, [86, 89]],
      [75, [80]],
    ] as const) {
      const parentDistrict = districts.find((row) => row.districtNumber === parent)!;
      for (const child of children) {
        const district = districts.find((row) => row.districtNumber === child)!;
        expect(district.seatId).not.toBe(parentDistrict.seatId);
        expect(district.regionId).toBe(parentDistrict.regionId);
      }
    }
  });
  it("permits a zero-register subject without omitting its vacant mandates", () => {
    const input = register();
    input["RU-council-20"] = 0;
    expect(plan(input).find((row) => row.districtNumber === 20)).toMatchObject({
      registeredVoters: 0,
      totalSeats: 2,
    });
  });
  it.each([
    "missing",
    "extra",
    "renumbered",
    "negative",
    "fractional",
    "unsafe",
    "empty",
    "total-overflow",
  ])("rejects %s registers", (reason) => {
    const input = register();
    if (reason === "missing") delete input["RU-council-20"];
    if (reason === "extra") input["RU-council-90"] = 1000;
    if (reason === "renumbered") {
      delete input["RU-council-20"];
      input["RU-council-90"] = 1000;
    }
    if (reason === "negative") input["RU-council-20"] = -1;
    if (reason === "fractional") input["RU-council-20"] = 0.5;
    if (reason === "unsafe") input["RU-council-20"] = Number.MAX_SAFE_INTEGER + 1;
    if (reason === "empty")
      Object.keys(input).forEach((id) => {
        input[id] = 0;
      });
    if (reason === "total-overflow") input["RU-council-20"] = Number.MAX_SAFE_INTEGER;
    expect(() => plan(input)).toThrow();
  });
});
