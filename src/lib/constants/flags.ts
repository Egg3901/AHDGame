const COUNTRY_FLAG_CODE_OVERRIDES: Record<string, string> = {
  UK: "GB",
  // UK devolved nations — flagcdn serves them as GB subdivision codes
  // (gb-sct/gb-wls/gb-nir), not "sco"/"wal"/"nir" (which 404). Lets the
  // referendum split-flag emblem render the saltire / Welsh / Ulster flag.
  SCO: "GB-SCT",
  WAL: "GB-WLS",
  NIR: "GB-NIR",
  // Belarus is BLR internally (BY collides with Bavaria's Landesliste code),
  // but flagcdn serves ISO alpha-2, so "blr" would 404.
  BLR: "BY",
};

export function resolveCountryFlagCode(value: string): string {
  const upper = value.toUpperCase();
  return COUNTRY_FLAG_CODE_OVERRIDES[upper] ?? upper;
}

/**
 * Historical / non-ISO countries flagcdn doesn't serve (it only carries current
 * ISO-3166 codes). Point these at Wikimedia Commons thumb routes instead
 * (hash dir = md5(filename) prefix). These are rendered through `next/image`,
 * which only allowlists `upload.wikimedia.org`. Use width 500 — Wikimedia
 * returns HTTP 400 for several other widths (incl. 640) of these particular
 * SVGs, so the width is not free to change. The Baltic SSRs (BAL) use the
 * Soviet flag.
 */
const HISTORICAL_FLAG_URLS: Record<string, string> = {
  SU: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Flag_of_the_Soviet_Union.svg/500px-Flag_of_the_Soviet_Union.svg.png",
  BAL: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Flag_of_the_Soviet_Union.svg/500px-Flag_of_the_Soviet_Union.svg.png",
  DD: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Flag_of_East_Germany.svg/500px-Flag_of_East_Germany.svg.png",
  YU: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Flag_of_Yugoslavia_%281946-1992%29.svg/500px-Flag_of_Yugoslavia_%281946-1992%29.svg.png",
  CS: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Flag_of_the_Czech_Republic.svg/500px-Flag_of_the_Czech_Republic.svg.png",
};

export function getCountryFlagUrl(value: string, width = 640): string {
  const upper = value.toUpperCase();
  const historical = HISTORICAL_FLAG_URLS[upper];
  if (historical) return historical;
  const code = resolveCountryFlagCode(value).toLowerCase();
  return `https://flagcdn.com/w${width}/${code}.png`;
}

/**
 * Era-specific flag overrides for countries whose flag changes by era. The
 * Russia/USSR entity (RU) flies the Soviet flag in 1979 — when it shows as
 * "Soviet Union" — and the Russian tricolor otherwise. Keyed by preset,
 * mirroring `ERA_COUNTRY_NAMES`.
 */
const ERA_FLAG_CODE_OVERRIDES: Record<string, Record<string, string>> = {
  "1953-default": { RU: "SU" },
  "1979-default": { RU: "SU" },
};

/** Flag URL honoring per-era overrides when a preset is known. */
export function getCountryFlagUrlForEra(value: string, preset?: string, width = 640): string {
  const override = preset ? ERA_FLAG_CODE_OVERRIDES[preset]?.[value.toUpperCase()] : undefined;
  return getCountryFlagUrl(override ?? value, width);
}

/**
 * Direct Wikimedia URLs for state and UK regional flags.
 *
 * These are consumed by `next/image` components. The local `/api/flags/*`
 * redirect routes remain available for legacy callers, but `next/image` does
 * not treat redirected API responses as valid images.
 */
export const STATE_FLAGS: Record<string, string> = {
  AL: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Flag_of_Alabama.svg/330px-Flag_of_Alabama.svg.png",
  AK: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Flag_of_Alaska.svg/330px-Flag_of_Alaska.svg.png",
  AZ: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Flag_of_Arizona.svg/330px-Flag_of_Arizona.svg.png",
  AR: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Flag_of_Arkansas.svg/330px-Flag_of_Arkansas.svg.png",
  CA: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Flag_of_California.svg/330px-Flag_of_California.svg.png",
  CO: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Flag_of_Colorado.svg/330px-Flag_of_Colorado.svg.png",
  CT: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Flag_of_Connecticut.svg/330px-Flag_of_Connecticut.svg.png",
  DE: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Flag_of_Delaware.svg/330px-Flag_of_Delaware.svg.png",
  FL: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Flag_of_Florida.svg/330px-Flag_of_Florida.svg.png",
  GA: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Flag_of_the_State_of_Georgia.svg/330px-Flag_of_the_State_of_Georgia.svg.png",
  HI: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Flag_of_Hawaii.svg/330px-Flag_of_Hawaii.svg.png",
  ID: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Flag_of_Idaho.svg/330px-Flag_of_Idaho.svg.png",
  IL: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Flag_of_Illinois.svg/330px-Flag_of_Illinois.svg.png",
  IN: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Flag_of_Indiana.svg/330px-Flag_of_Indiana.svg.png",
  IA: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Flag_of_Iowa.svg/330px-Flag_of_Iowa.svg.png",
  KS: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Flag_of_Kansas.svg/330px-Flag_of_Kansas.svg.png",
  KY: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Flag_of_Kentucky.svg/330px-Flag_of_Kentucky.svg.png",
  LA: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Flag_of_Louisiana.svg/330px-Flag_of_Louisiana.svg.png",
  ME: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Flag_of_Maine.svg/330px-Flag_of_Maine.svg.png",
  MD: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Flag_of_Maryland.svg/330px-Flag_of_Maryland.svg.png",
  MA: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Flag_of_Massachusetts.svg/330px-Flag_of_Massachusetts.svg.png",
  MI: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Flag_of_Michigan.svg/330px-Flag_of_Michigan.svg.png",
  MN: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Flag_of_Minnesota.svg/330px-Flag_of_Minnesota.svg.png",
  MS: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Flag_of_Mississippi.svg/330px-Flag_of_Mississippi.svg.png",
  MO: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Flag_of_Missouri.svg/330px-Flag_of_Missouri.svg.png",
  MT: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Flag_of_Montana.svg/330px-Flag_of_Montana.svg.png",
  NE: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Flag_of_Nebraska.svg/330px-Flag_of_Nebraska.svg.png",
  NV: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Flag_of_Nevada.svg/330px-Flag_of_Nevada.svg.png",
  NH: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Flag_of_New_Hampshire.svg/330px-Flag_of_New_Hampshire.svg.png",
  NJ: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Flag_of_New_Jersey.svg/330px-Flag_of_New_Jersey.svg.png",
  NM: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Flag_of_New_Mexico.svg/330px-Flag_of_New_Mexico.svg.png",
  NY: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Flag_of_New_York.svg/330px-Flag_of_New_York.svg.png",
  NC: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Flag_of_North_Carolina.svg/330px-Flag_of_North_Carolina.svg.png",
  ND: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Flag_of_North_Dakota.svg/330px-Flag_of_North_Dakota.svg.png",
  OH: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Flag_of_Ohio.svg/330px-Flag_of_Ohio.svg.png",
  OK: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Flag_of_Oklahoma.svg/330px-Flag_of_Oklahoma.svg.png",
  OR: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Flag_of_Oregon.svg/330px-Flag_of_Oregon.svg.png",
  PA: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Flag_of_Pennsylvania.svg/330px-Flag_of_Pennsylvania.svg.png",
  RI: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Flag_of_Rhode_Island.svg/330px-Flag_of_Rhode_Island.svg.png",
  SC: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Flag_of_South_Carolina.svg/330px-Flag_of_South_Carolina.svg.png",
  SD: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Flag_of_South_Dakota.svg/330px-Flag_of_South_Dakota.svg.png",
  TN: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Flag_of_Tennessee.svg/330px-Flag_of_Tennessee.svg.png",
  TX: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Flag_of_Texas.svg/330px-Flag_of_Texas.svg.png",
  UT: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Flag_of_Utah.svg/330px-Flag_of_Utah.svg.png",
  VT: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Flag_of_Vermont.svg/330px-Flag_of_Vermont.svg.png",
  VA: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Flag_of_Virginia.svg/330px-Flag_of_Virginia.svg.png",
  WA: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Flag_of_Washington.svg/330px-Flag_of_Washington.svg.png",
  WV: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Flag_of_West_Virginia.svg/330px-Flag_of_West_Virginia.svg.png",
  WI: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Flag_of_Wisconsin.svg/330px-Flag_of_Wisconsin.svg.png",
  WY: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Flag_of_Wyoming.svg/330px-Flag_of_Wyoming.svg.png",
  DC: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Flag_of_Washington%2C_D.C.svg/330px-Flag_of_Washington%2C_D.C.svg.png",
  ENG: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  SCO: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Flag_of_Scotland.svg/330px-Flag_of_Scotland.svg.png",
  WAL: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Flag_of_Wales.svg/330px-Flag_of_Wales.svg.png",
  NIR: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Flag_of_Northern_Ireland_%281953%E2%80%931972%29.svg/330px-Flag_of_Northern_Ireland_%281953%E2%80%931972%29.svg.png",
  LON: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  SEE: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  SWE: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  EAE: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  EMI: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  WMI: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  YHU: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  NWE: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
  NEE: "https://upload.wikimedia.org/wikipedia/en/thumb/b/be/Flag_of_England.svg/330px-Flag_of_England.svg.png",
};
