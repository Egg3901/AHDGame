/**
 * Energy units step through SI prefixes instead of stacking a magnitude
 * suffix on a unit that already has one ("1.9 TWh", not "1.9M MWh").
 */
const ENERGY_PREFIX_LADDERS: Record<string, string[]> = {
  MWh: ["MWh", "GWh", "TWh", "PWh"],
};

function trimFixed(value: number): string {
  return value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1);
}

export function formatUnits(value: number, unit: string): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  const ladder = ENERGY_PREFIX_LADDERS[unit];
  if (ladder) {
    let scaled = abs;
    let step = 0;
    while (scaled >= 1000 && step < ladder.length - 1) {
      scaled /= 1000;
      step++;
    }
    if (step === 0) {
      return `${sign}${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${unit}`;
    }
    return `${sign}${trimFixed(scaled)} ${ladder[step]}`;
  }

  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B ${unit}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M ${unit}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ${unit}`;
  if (abs >= 10) return `${sign}${Math.round(abs)} ${unit}`;
  return `${sign}${abs.toFixed(1)} ${unit}`;
}
