/**
 * Static country-map coordinate tables for the Recruitment Slate's national
 * country-map view. Coordinates are in a 700x420 viewport — same scale used
 * by the design handoff.
 *
 * Keys match `State._id` directly (e.g. `"CA"`, `"LON"`, `"KAN"`, `"BW"`),
 * which is also the value persisted on `Election.state` and denormalized to
 * `RecruitmentSlate.state`. **Do not prefix keys with the country code** —
 * the slate panel looks up by the raw state id.
 */

export interface StateMapEntry {
  /** Display label drawn inside the circle. 2–3 chars. */
  label: string;
  /** Verbose name for hover panels. */
  name: string;
  cx: number;
  cy: number;
}

// ─── United States — 50 states ─────────────────────────────────────────────────
export const US_STATE_MAP: Record<string, StateMapEntry> = {
  AL: { label: "AL", name: "Alabama", cx: 480, cy: 320 },
  AK: { label: "AK", name: "Alaska", cx: 70, cy: 380 },
  AZ: { label: "AZ", name: "Arizona", cx: 180, cy: 290 },
  AR: { label: "AR", name: "Arkansas", cx: 380, cy: 290 },
  CA: { label: "CA", name: "California", cx: 70, cy: 230 },
  CO: { label: "CO", name: "Colorado", cx: 230, cy: 230 },
  CT: { label: "CT", name: "Connecticut", cx: 620, cy: 165 },
  DE: { label: "DE", name: "Delaware", cx: 590, cy: 215 },
  FL: { label: "FL", name: "Florida", cx: 540, cy: 360 },
  GA: { label: "GA", name: "Georgia", cx: 510, cy: 320 },
  HI: { label: "HI", name: "Hawaii", cx: 130, cy: 380 },
  ID: { label: "ID", name: "Idaho", cx: 165, cy: 130 },
  IL: { label: "IL", name: "Illinois", cx: 410, cy: 200 },
  IN: { label: "IN", name: "Indiana", cx: 440, cy: 200 },
  IA: { label: "IA", name: "Iowa", cx: 380, cy: 175 },
  KS: { label: "KS", name: "Kansas", cx: 320, cy: 245 },
  KY: { label: "KY", name: "Kentucky", cx: 460, cy: 240 },
  LA: { label: "LA", name: "Louisiana", cx: 380, cy: 340 },
  ME: { label: "ME", name: "Maine", cx: 640, cy: 105 },
  MD: { label: "MD", name: "Maryland", cx: 580, cy: 215 },
  MA: { label: "MA", name: "Massachusetts", cx: 625, cy: 145 },
  MI: { label: "MI", name: "Michigan", cx: 460, cy: 160 },
  MN: { label: "MN", name: "Minnesota", cx: 360, cy: 130 },
  MS: { label: "MS", name: "Mississippi", cx: 420, cy: 320 },
  MO: { label: "MO", name: "Missouri", cx: 380, cy: 230 },
  MT: { label: "MT", name: "Montana", cx: 220, cy: 105 },
  NE: { label: "NE", name: "Nebraska", cx: 320, cy: 195 },
  NV: { label: "NV", name: "Nevada", cx: 110, cy: 195 },
  NH: { label: "NH", name: "New Hampshire", cx: 625, cy: 130 },
  NJ: { label: "NJ", name: "New Jersey", cx: 600, cy: 195 },
  NM: { label: "NM", name: "New Mexico", cx: 230, cy: 290 },
  NY: { label: "NY", name: "New York", cx: 580, cy: 150 },
  NC: { label: "NC", name: "North Carolina", cx: 550, cy: 270 },
  ND: { label: "ND", name: "North Dakota", cx: 320, cy: 110 },
  OH: { label: "OH", name: "Ohio", cx: 480, cy: 195 },
  OK: { label: "OK", name: "Oklahoma", cx: 320, cy: 290 },
  OR: { label: "OR", name: "Oregon", cx: 90, cy: 130 },
  PA: { label: "PA", name: "Pennsylvania", cx: 555, cy: 190 },
  RI: { label: "RI", name: "Rhode Island", cx: 640, cy: 160 },
  SC: { label: "SC", name: "South Carolina", cx: 525, cy: 290 },
  SD: { label: "SD", name: "South Dakota", cx: 320, cy: 150 },
  TN: { label: "TN", name: "Tennessee", cx: 460, cy: 270 },
  TX: { label: "TX", name: "Texas", cx: 290, cy: 340 },
  UT: { label: "UT", name: "Utah", cx: 165, cy: 230 },
  VT: { label: "VT", name: "Vermont", cx: 615, cy: 125 },
  VA: { label: "VA", name: "Virginia", cx: 555, cy: 240 },
  WA: { label: "WA", name: "Washington", cx: 100, cy: 80 },
  WV: { label: "WV", name: "West Virginia", cx: 525, cy: 215 },
  WI: { label: "WI", name: "Wisconsin", cx: 405, cy: 145 },
  WY: { label: "WY", name: "Wyoming", cx: 220, cy: 165 },
};

// ─── United Kingdom — 12 regions ───────────────────────────────────────────────
// Geographic-ish: Scotland top, Northern Ireland top-left, Wales mid-left,
// English regions stacked from north to south, London anchored in the
// south-east.
export const UK_STATE_MAP: Record<string, StateMapEntry> = {
  SCO: { label: "SCO", name: "Scotland", cx: 350, cy: 70 },
  NIR: { label: "NIR", name: "Northern Ireland", cx: 200, cy: 130 },
  NEE: { label: "NEE", name: "North East England", cx: 380, cy: 140 },
  NWE: { label: "NWE", name: "North West England", cx: 320, cy: 175 },
  YHU: { label: "YHU", name: "Yorkshire & the Humber", cx: 400, cy: 195 },
  WAL: { label: "WAL", name: "Wales", cx: 280, cy: 240 },
  WMI: { label: "WMI", name: "West Midlands", cx: 360, cy: 240 },
  EMI: { label: "EMI", name: "East Midlands", cx: 420, cy: 245 },
  EAE: { label: "EAE", name: "East of England", cx: 470, cy: 285 },
  SWE: { label: "SWE", name: "South West England", cx: 300, cy: 320 },
  SEE: { label: "SEE", name: "South East England", cx: 420, cy: 325 },
  LON: { label: "LON", name: "London", cx: 470, cy: 335 },
};

// ─── Japan — 8 super-regions ───────────────────────────────────────────────────
// Archipelago shape: Hokkaido top-right, Tohoku → Kanto → Chubu → Kansai →
// Chugoku → Shikoku → Kyushu sweeping south-west.
export const JP_STATE_MAP: Record<string, StateMapEntry> = {
  HOK: { label: "HOK", name: "Hokkaido", cx: 540, cy: 80 },
  TOH: { label: "TOH", name: "Tohoku", cx: 470, cy: 145 },
  KAN: { label: "KAN", name: "Kanto", cx: 430, cy: 215 },
  CHU: { label: "CHU", name: "Chubu", cx: 365, cy: 220 },
  KNS: { label: "KNS", name: "Kansai", cx: 300, cy: 250 },
  CGK: { label: "CGK", name: "Chugoku", cx: 230, cy: 270 },
  SHI: { label: "SHI", name: "Shikoku", cx: 240, cy: 320 },
  KYU: { label: "KYU", name: "Kyushu & Okinawa", cx: 165, cy: 320 },
};

// ─── Germany — 16 Bundesländer ────────────────────────────────────────────────
// City-states (HH, HB, BE) sit in their geographic hosts; coords are loose
// representations rather than a precise atlas — the panel is informational.
export const DE_STATE_MAP: Record<string, StateMapEntry> = {
  SH: { label: "SH", name: "Schleswig-Holstein", cx: 360, cy: 75 },
  HH: { label: "HH", name: "Hamburg", cx: 360, cy: 110 },
  MV: { label: "MV", name: "Mecklenburg-Vorpommern", cx: 440, cy: 95 },
  BRE: { label: "HB", name: "Bremen", cx: 320, cy: 130 },
  NI: { label: "NI", name: "Niedersachsen", cx: 340, cy: 165 },
  BB: { label: "BB", name: "Brandenburg", cx: 460, cy: 170 },
  BE: { label: "BE", name: "Berlin", cx: 470, cy: 145 },
  ST: { label: "ST", name: "Sachsen-Anhalt", cx: 410, cy: 200 },
  NW: { label: "NW", name: "Nordrhein-Westfalen", cx: 270, cy: 215 },
  TH: { label: "TH", name: "Thüringen", cx: 390, cy: 240 },
  SN: { label: "SN", name: "Sachsen", cx: 460, cy: 240 },
  HE: { label: "HE", name: "Hessen", cx: 320, cy: 250 },
  RP: { label: "RP", name: "Rheinland-Pfalz", cx: 270, cy: 285 },
  SL: { label: "SL", name: "Saarland", cx: 240, cy: 315 },
  BW: { label: "BW", name: "Baden-Württemberg", cx: 320, cy: 320 },
  BY: { label: "BY", name: "Bayern", cx: 410, cy: 305 },
};

export const STATE_MAPS: Record<string, Record<string, StateMapEntry>> = {
  US: US_STATE_MAP,
  UK: UK_STATE_MAP,
  JP: JP_STATE_MAP,
  DE: DE_STATE_MAP,
};

export type StateMapRenderMode = "bubble" | "usa_paths" | "uk_paths" | "jp_paths" | "de_paths";

export const STATE_MAP_RENDER_MODE: Record<string, StateMapRenderMode> = {
  US: "usa_paths",
  UK: "uk_paths",
  JP: "jp_paths",
  DE: "de_paths",
};

export function getStateMap(countryId: string): Record<string, StateMapEntry> | null {
  return STATE_MAPS[countryId] ?? null;
}

export function getStateMapRenderMode(countryId: string): StateMapRenderMode {
  return STATE_MAP_RENDER_MODE[countryId] ?? "bubble";
}
