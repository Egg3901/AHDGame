import type { EraId } from "@/lib/seeds/presetSelector";
import { deriveRegionLeans } from "./deriveRegionLeans";
import { getTarget } from "./targets";
import type { CellResult, CountryId } from "./types";

export function evaluateCell(country: string, era: EraId): CellResult | null {
  const target = getTarget(country, era);
  if (!target) return null;
  const rows = deriveRegionLeans(country, era);
  const byId = new Map(rows.map((r) => [r.regionId, r]));
  const displays = rows.map((r) => r.display);
  const n = displays.length || 1;
  const meanDisplay = displays.reduce((a, b) => a + b, 0) / n;
  const spread = Math.max(...displays) - Math.min(...displays);

  const failures: string[] = [];
  let loss = 0;

  // Two-axis cells are graded per axis: the display lean collapses both axes and
  // would force social to act as a threshold constant (#3760).
  if (target.twoAxis) {
    const economics = rows.map((r) => r.economic);
    const socials = rows.map((r) => r.social);
    const meanEcon = economics.reduce((a, b) => a + b, 0) / n;
    const econSpread = Math.max(...economics) - Math.min(...economics);
    const socialSpread = Math.max(...socials) - Math.min(...socials);

    const econCenter = target.twoAxis.economicCenter ?? 0;
    const econCenterErr = Math.abs(meanEcon - econCenter);
    if (econCenterErr > target.twoAxis.economicCenterTol) {
      failures.push(
        `economic center ${meanEcon.toFixed(2)} outside ${econCenter}±${target.twoAxis.economicCenterTol}`
      );
      loss += econCenterErr - target.twoAxis.economicCenterTol;
    }
    if (econSpread < target.twoAxis.minEconomicSpread) {
      failures.push(
        `economic spread ${econSpread.toFixed(2)} < ${target.twoAxis.minEconomicSpread}`
      );
      loss += target.twoAxis.minEconomicSpread - econSpread;
    }
    if (socialSpread < target.twoAxis.minSocialSpread) {
      failures.push(`social spread ${socialSpread.toFixed(2)} < ${target.twoAxis.minSocialSpread}`);
      loss += target.twoAxis.minSocialSpread - socialSpread;
    }
    for (const id of target.expectLeft) {
      const v = byId.get(id)?.economic;
      if (v === undefined) failures.push(`expectLeft region ${id} missing`);
      else if (v >= 0) {
        failures.push(`${id} should be economically LEFT but is ${v.toFixed(2)}`);
        loss += v + 0.1;
      }
    }
    for (const id of target.expectRight) {
      const v = byId.get(id)?.economic;
      if (v === undefined) failures.push(`expectRight region ${id} missing`);
      else if (v <= 0) {
        failures.push(`${id} should be economically RIGHT but is ${v.toFixed(2)}`);
        loss += -v + 0.1;
      }
    }
    for (const [a, b] of target.ordering ?? []) {
      const va = byId.get(a)?.economic;
      const vb = byId.get(b)?.economic;
      if (va !== undefined && vb !== undefined && !(va < vb)) {
        failures.push(`ordering ${a}<${b} violated (${va.toFixed(2)} !< ${vb.toFixed(2)})`);
        loss += va - vb + 0.1;
      }
    }
    return {
      country: country as CountryId,
      era,
      meanDisplay,
      spread,
      failures,
      loss: Math.max(0, Math.round(loss * 100) / 100),
    };
  }

  const centerErr = Math.abs(meanDisplay - target.center);
  if (centerErr > target.centerTol) {
    failures.push(`center ${meanDisplay.toFixed(2)} outside ${target.center}±${target.centerTol}`);
    loss += centerErr - target.centerTol;
  }
  if (spread < target.minSpread) {
    failures.push(`spread ${spread.toFixed(2)} < minSpread ${target.minSpread}`);
    loss += target.minSpread - spread;
  }
  for (const id of target.expectLeft) {
    const v = byId.get(id)?.display;
    if (v === undefined) failures.push(`expectLeft region ${id} missing`);
    else if (v >= 0) {
      failures.push(`${id} should be LEFT but is ${v.toFixed(2)}`);
      loss += v + 0.1;
    }
  }
  for (const id of target.expectRight) {
    const v = byId.get(id)?.display;
    if (v === undefined) failures.push(`expectRight region ${id} missing`);
    else if (v <= 0) {
      failures.push(`${id} should be RIGHT but is ${v.toFixed(2)}`);
      loss += -v + 0.1;
    }
  }
  for (const [a, b] of target.ordering ?? []) {
    const va = byId.get(a)?.display;
    const vb = byId.get(b)?.display;
    if (va !== undefined && vb !== undefined && !(va < vb)) {
      failures.push(`ordering ${a}<${b} violated (${va.toFixed(2)} !< ${vb.toFixed(2)})`);
      loss += va - vb + 0.1;
    }
  }

  return {
    country: country as CountryId,
    era,
    meanDisplay,
    spread,
    failures,
    loss: Math.max(0, Math.round(loss * 100) / 100),
  };
}
