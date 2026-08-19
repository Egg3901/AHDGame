import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig, getOfficeTypeConfig } from "@/lib/constants/countries";
import { UK_REGIONS } from "@/lib/constants/uk";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";

/** Shape shared by {@link Character.currentOffice} and career-history snapshots. */
type OfficeLike = {
  type: string;
  state?: string;
  seatsHeld?: number;
  senateClass?: 1 | 2 | 3;
  positionId?: string;
  constituency?: string;
  constituencyId?: string;
};

/**
 * Get Tailwind CSS classes for party affiliation (full styling with bg, text, border)
 * @param party - Party affiliation ("democrat", "republican", "independent", or other)
 * @returns Tailwind CSS classes for styling
 */
export function getPartyColor(party: string | null, partyColor?: string): string {
  switch (party) {
    case "democrat":
      return "bg-blue-500/20 text-blue-400 border-blue-500/50";
    case "republican":
      return "bg-red-500/20 text-red-400 border-red-500/50";
    case "independent":
    case null:
      return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    default:
      // For custom parties, use inline styles if color is provided
      // This function returns empty string when partyColor is provided (caller uses inline style)
      if (partyColor) return "";
      return "bg-gray-500/20 text-gray-400 border-gray-500/50";
  }
}

/**
 * Get Tailwind text color class only for party affiliation
 * @param party - Party affiliation
 * @returns Tailwind text color class
 */
export function getPartyTextColor(party: string | null): string {
  switch (party) {
    case "democrat":
      return "text-blue-400";
    case "republican":
      return "text-red-400";
    case "independent":
    case null:
      return "text-gray-400";
    default:
      return "text-muted";
  }
}

/**
 * Get capitalized party label
 * @param party - Party affiliation or null
 * @returns Capitalized label or fallback
 */
export function getPartyLabel(party: string | null): string {
  if (!party) return "No Party";

  // Normalize: strip country-prefixed party ids (matches politicalParties _id slugs)
  const normalized = party.toLowerCase().replace(/^(uk|us|ca|de)_/, "");

  // Handle specific party mappings
  if (normalized === "conservative") return "Conservative";
  if (normalized === "labour") return "Labour";
  if (normalized === "libdem" || normalized === "liberal-democrat") return "Liberal Democrat";
  if (normalized === "snp") return "SNP";
  if (normalized === "green") return "Green";
  if (normalized === "plaid" || normalized === "plaid-cymru") return "Plaid Cymru";
  if (normalized === "reform") return "Reform UK";
  if (normalized === "democrat") return "Democrat";
  if (normalized === "republican") return "Republican";
  if (normalized === "independent") return "Independent";

  // Default: capitalize each word
  return normalized
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Best-effort mapping from an office type key to its owning country.
 * Returns undefined for ambiguous keys (e.g. `governor` exists in US and JP)
 * or unknown/generic types — callers should fall back to the character's
 * countryId when this returns undefined.
 */
export function getOfficeCountry(officeType: string | undefined): CountryId | undefined {
  if (!officeType) return undefined;
  switch (officeType) {
    case "house":
    case "senate":
    case "stateSenate":
    case "vicePresident":
    case "usCabinet":
      return "US";
    case "commons":
    case "regionalCouncil":
    case "primeMinister":
    case "ukCabinet":
    case "parliamentaryCabinet":
      return "UK";
    case "bundestag":
    case "chancellor":
    case "ministerPresident":
    case "landtag":
    case "deCabinet":
      return "DE";
    case "npcDelegate":
    case "peoplesCongress":
      return "CN";
    case "supremeSovietDeputy":
    case "nationalitiesDeputy":
    case "republicSupremeSoviet":
      return "RU";
    case "volkskammerDeputy":
      return "DD";
    case "landAssembly":
      return "DD";
    // "premier" is deliberately NOT mapped: both CN and RU use it (like
    // "governor" across US/JP), so callers fall back to the character's own
    // countryId per this function's ambiguity contract.
    case "dail":
    case "seanad":
    case "uachtaran":
    case "localCouncil":
      return "IE";
    default:
      return undefined;
  }
}

/**
 * Get political lean label and Tailwind color class
 * @param lean - Political lean value (-5 to +5)
 * @returns Object with label and Tailwind color class
 */
export function getLeanLabel(lean: number): { label: string; color: string } {
  return {
    label: getEconomicPositionName(lean),
    color: positionBucketColorClass(lean, "economic"),
  };
}

/**
 * Get economic lean label and hex color (for inline styles / map fills)
 * @param lean - Turnout-weighted display lean (national spread is well under ±1 in current worlds)
 * @returns Object with label and hex color code
 */
export function getLeanLabelHex(lean: number): { label: string; color: string } {
  return { label: getEconomicPositionName(lean), color: positionBucketHex(lean, "economic") };
}

/**
 * UK map fills: same thresholds as {@link getLeanLabelHex}, but swap red/blue so the
 * negative side reads as Labour-red and the positive side as Conservative-blue.
 *
 * Used for UK **economic** and **combined** (display) leans, and for **social** map colouring
 * (liberal = negative, traditional = positive on the same scale; labels still from
 * {@link getSocialLeanLabelHex}).
 */
export function getUkEconomicLeanLabelHex(lean: number): { label: string; color: string } {
  return { label: getEconomicPositionName(lean), color: positionBucketHex(lean, "economic", true) };
}

/**
 * Get social lean label and hex color (for inline styles / map fills).
 * Teal (liberal) → purple (moderate) → amber (traditional).
 */
export function getSocialLeanLabelHex(lean: number): { label: string; color: string } {
  return { label: getSocialPositionName(lean), color: positionBucketHex(lean, "social") };
}

/** Default half-range for player character policy axes (−5…+5). Used by compass, sliders, PositionBadges. */
export const POLICY_INTEGER_AXIS_RANGE = 5;

/**
 * Canonical position-value resolution. Positions move on this grid; a future
 * gradual-drift mechanic nudges in multiples of it. Current shift magnitudes
 * (±1 deliberate, ±0.25 per bill provision) are already multiples.
 */
export const POSITION_GRID = 0.05;

/** Snap a position value to the nearest POSITION_GRID step. */
export function snapToPositionGrid(value: number): number {
  return Math.round(value / POSITION_GRID) * POSITION_GRID;
}

/**
 * Canonical economic axis tick labels (word-only; no numeric scale in UI).
 * @param _range — reserved for future use; positions still use −range…+range internally.
 */
export function getEconomicAxisTickLabels(_range: number = POLICY_INTEGER_AXIS_RANGE) {
  return {
    negative: "Left",
    center: "Center",
    positive: "Right",
  } as const;
}

/**
 * Canonical social axis tick labels (word-only; no numeric scale in UI).
 */
export function getSocialAxisTickLabels(_range: number = POLICY_INTEGER_AXIS_RANGE) {
  return {
    negative: "Liberal",
    center: "Moderate",
    positive: "Traditional",
  } as const;
}

/**
 * Tailwind text color for social policy value (teal liberal → muted center → amber traditional).
 * Pairs with {@link getPolicyColor} for economic (blue / red).
 */
export function getSocialPolicyColor(value: number): string {
  return positionBucketColorClass(value, "social");
}

/**
 * Get policy position label based on value
 * @param value - Policy value (-5 to +5)
 * @returns Label string (e.g., "Extremely Left", "Centrist", "Right")
 */
export function getPolicyLabel(value: number): string {
  if (value < -3) return "Extremely Left";
  if (value < -1) return "Left";
  if (value < 1) return "Centrist";
  if (value < 3) return "Right";
  return "Extremely Right";
}

/**
 * Round a −5…+5 ideology value to its integer label bucket, rounding half
 * AWAY from zero so ±0.50 lands on the next whole symmetrically
 * (−0.5 → −1, +0.5 → +1). The single source of truth for bucketing a
 * position/lean into a label or colour. Threshold between buckets is 0.5.
 */
export function roundLabelBucket(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

// Eleven-stop ramps indexed by bucket −5…+5 (offset +5). Economic: deep blue
// (left) → muted purple (centre) → deep red (right). Social: teal (liberal) →
// muted purple (moderate) → amber (traditional). Anchor hexes reuse the prior
// five-stop palette so the map's look is preserved.
const ECON_BUCKET_HEX = [
  "#1d4ed8",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#a855f7",
  "#fca5a5",
  "#f87171",
  "#ef4444",
  "#dc2626",
  "#b91c1c",
];
const SOCIAL_BUCKET_HEX = [
  "#0d9488",
  "#14b8a6",
  "#2dd4bf",
  "#5eead4",
  "#99f6e4",
  "#a855f7",
  "#fde68a",
  "#fbbf24",
  "#f59e0b",
  "#d97706",
  "#b45309",
];
const ECON_BUCKET_CLASS = [
  "text-blue-500",
  "text-blue-500",
  "text-blue-400",
  "text-blue-400",
  "text-blue-300",
  "text-purple-400",
  "text-red-300",
  "text-red-400",
  "text-red-400",
  "text-red-500",
  "text-red-500",
];
const SOCIAL_BUCKET_CLASS = [
  "text-teal-500",
  "text-teal-500",
  "text-teal-400",
  "text-teal-400",
  "text-teal-300",
  "text-purple-400",
  "text-amber-300",
  "text-amber-400",
  "text-amber-400",
  "text-amber-500",
  "text-amber-500",
];

function bucketIndex(value: number, axis: "economic" | "social", european: boolean): number {
  const bucket = roundLabelBucket(value);
  const signed = axis === "economic" && european ? -bucket : bucket;
  return Math.max(0, Math.min(10, signed + 5));
}

/** Ramp stops for a lean axis in value order (−range … +range), honouring the European swap. */
export function leanRampStops(axis: "economic" | "social", european = false): string[] {
  const ramp = axis === "economic" ? ECON_BUCKET_HEX : SOCIAL_BUCKET_HEX;
  return axis === "economic" && european ? [...ramp].reverse() : ramp;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((c, i) => lerpChannel(c, pb[i], t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Continuous diverging map fill for a lean value. `positionBucketHex` quantizes
 * to the 0.5 label ruler, which collapses compressed state leans (national
 * spread is often well under ±1) into one flat centre colour; this interpolates
 * across the same 11-stop ramp with the domain fitted to `halfRange` (the
 * largest |lean| currently on the map), so relative differences stay visible at
 * any spread. Zero always maps to the centre stop.
 */
export function interpolateLeanHex(
  value: number,
  axis: "economic" | "social",
  halfRange: number,
  european = false
): string {
  const stops = leanRampStops(axis, european);
  const range = Math.max(halfRange, 0.01);
  const t = Math.max(-1, Math.min(1, value / range));
  const pos = ((t + 1) / 2) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  return lerpHex(stops[i], stops[i + 1], pos - i);
}

/**
 * Hex colour for a position/lean value, bucketed on the 0.5 ruler. European
 * swaps economic left/right (Labour-red left, Conservative-blue right).
 */
export function positionBucketHex(
  value: number,
  axis: "economic" | "social",
  european = false
): string {
  const ramp = axis === "economic" ? ECON_BUCKET_HEX : SOCIAL_BUCKET_HEX;
  return ramp[bucketIndex(value, axis, european)];
}

/** Tailwind text-colour class for a position/lean value, bucketed on the ruler. */
export function positionBucketColorClass(
  value: number,
  axis: "economic" | "social",
  european = false
): string {
  const ramp = axis === "economic" ? ECON_BUCKET_CLASS : SOCIAL_BUCKET_CLASS;
  return ramp[bucketIndex(value, axis, european)];
}

/**
 * Get the full display name for an economic position value (-5 to +5).
 * @param value - Economic position (-5 = Far Left … +5 = Far Right)
 * @returns Human-readable name, e.g. "Center-Left", "Centrist", "Lean Right"
 */
export function getEconomicPositionName(value: number): string {
  const map: Record<number, string> = {
    [-5]: "Far Left",
    [-4]: "Strong Left",
    [-3]: "Left",
    [-2]: "Lean Left",
    [-1]: "Center-Left",
    [0]: "Centrist",
    [1]: "Center-Right",
    [2]: "Lean Right",
    [3]: "Right",
    [4]: "Strong Right",
    [5]: "Far Right",
  };
  const rounded = roundLabelBucket(value);
  return map[rounded] ?? (value < 0 ? "Left" : value > 0 ? "Right" : "Centrist");
}

/**
 * Get the full display name for a social position value (-5 to +5).
 * @param value - Social position (-5 = Far Liberal … +5 = Far Traditional)
 * @returns Human-readable name, e.g. "Center-Liberal", "Moderate", "Lean Trad"
 */
export function getSocialPositionName(value: number): string {
  const map: Record<number, string> = {
    [-5]: "Far Liberal",
    [-4]: "Strong Liberal",
    [-3]: "Liberal",
    [-2]: "Lean Liberal",
    [-1]: "Center-Liberal",
    [0]: "Moderate",
    [1]: "Center-Trad",
    [2]: "Lean Trad",
    [3]: "Traditional",
    [4]: "Strong Trad",
    [5]: "Far Traditional",
  };
  const rounded = roundLabelBucket(value);
  return map[rounded] ?? (value < 0 ? "Liberal" : value > 0 ? "Traditional" : "Moderate");
}

/**
 * Political compass archetypes: (economic, social) ideal points.
 * economic: -5 = left, +5 = right. social: -5 = authoritarian, +5 = libertarian.
 * Returns the label whose ideal point is closest (Euclidean) to (economic, social).
 */
const COMPASS_ARCHETYPES: { econ: number; social: number; label: string }[] = [
  { econ: -4, social: 3.5, label: "Democratic Socialist" },
  { econ: -3, social: 2.5, label: "Progressive" },
  { econ: -1.5, social: 2, label: "Social Liberal" },
  { econ: 0, social: 0, label: "Centrist" },
  { econ: 0, social: 1.5, label: "Reformist" },
  { econ: 1.5, social: 2, label: "Liberal Conservative" },
  { econ: 3.5, social: 3, label: "Libertarian" },
  { econ: 2.5, social: 1, label: "Neoliberal" },
  { econ: 2.5, social: -1, label: "Conservative" },
  { econ: 3, social: -2.5, label: "Right-Wing Populist" },
  { econ: 2, social: -3.5, label: "Nationalist" },
  { econ: -3.5, social: -2.5, label: "Authoritarian Left" },
  { econ: -4, social: -1.5, label: "State Socialist" },
  { econ: -1, social: -2, label: "Communitarian" },
  { econ: 1, social: -2.5, label: "Traditionalist" },
];

/**
 * Get a short, creative label for a character's position on the political compass.
 * @param economic - Economic axis (-5 left to +5 right)
 * @param social - Social axis (-5 authoritarian to +5 libertarian)
 * @returns Label such as "Progressive", "Right-Wing Populist", "Centrist"
 */
export function getCompassPositionLabel(economic: number, social: number): string {
  const e = Math.max(-5, Math.min(5, economic));
  const s = Math.max(-5, Math.min(5, social));
  let best = COMPASS_ARCHETYPES[0];
  let bestD = Infinity;
  for (const a of COMPASS_ARCHETYPES) {
    const d = (a.econ - e) ** 2 + (a.social - s) ** 2;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best.label;
}

/**
 * Format a bill/provision position for display using economic and social axes when present.
 * Not every bill has both; only include axes that are set (non-zero). If both are missing/zero, returns null so caller can omit or use directionLabel.
 * @param economic - Economic position (-5 to +5, or -3 to +3 from legislation options)
 * @param social - Social position (-5 to +5, or -3 to +3 from legislation options)
 * @returns Formatted string (e.g. "Center-Left econ" or "Moderate social"), or null if no position to show
 */
export function formatBillPositionLabel(
  economic: number | null | undefined,
  social: number | null | undefined
): string | null {
  const e = economic ?? 0;
  const s = social ?? 0;
  if (e === 0 && s === 0) return null;
  const parts: string[] = [];
  if (e !== 0) parts.push(`${getEconomicPositionName(e)} econ`);
  if (s !== 0) parts.push(`${getSocialPositionName(s)} social`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Get Tailwind color class for policy value
 * @param value - Policy value (-5 to +5)
 * @returns Tailwind text color class
 */
export function getPolicyColor(value: number): string {
  return positionBucketColorClass(value, "economic");
}

// ─── Party hex colours ────────────────────────────────────────────────────────

/** Canonical hex colour for the two default parties; falls back to the stored
 *  partyColor for custom parties. */
export function getPartyHex(partyId: string, storedColor?: string): string {
  // Normalize party ID (lowercase, strip prefixes)
  const normalized = partyId.toLowerCase().replace(/^(uk|us|ca|de)_/, "");

  // US parties
  if (normalized === "democrat") return "#3B82F6"; // blue-500
  if (normalized === "republican") return "#EF4444"; // red-500
  if (normalized === "independent") return "#9CA3AF"; // gray-400

  // UK parties
  if (normalized === "labour") return "#E4003B"; // Labour red
  if (normalized === "conservative") return "#0087DC"; // Conservative blue
  if (normalized === "libdem" || normalized === "liberal-democrat") return "#FAA61A"; // Lib Dem orange
  if (normalized === "snp") return "#FDF38E"; // SNP yellow
  if (normalized === "green") return "#6AB023"; // Green
  if (normalized === "plaid" || normalized === "plaid-cymru") return "#008142"; // Plaid Cymru green
  if (normalized === "reform") return "#12B6CF"; // Reform turquoise

  return storedColor ?? "#8B5CF6";
}

/**
 * Returns a readable version of a hex colour for use as text on dark backgrounds.
 * If the colour is too dark (low luminance), it lightens it enough to be visible
 * against dark UI backgrounds like zinc-900.
 */
export function ensureReadableOnDark(hex: string): string {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived brightness (0–255)
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  if (brightness >= 100) return hex; // Already bright enough
  // Shift toward a lighter version
  const factor = 100 / Math.max(brightness, 1);
  const clamp = (v: number) => Math.min(255, Math.round(v * factor));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

/**
 * For a general election (one candidate per party) return each candidate's
 * canonical party colour.
 */
export function buildGeneralColors(
  candidates: { id: string; party: string; partyColor: string }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of candidates) {
    map.set(c.id, getPartyHex(c.party, c.partyColor));
  }
  return map;
}

/**
 * For a primary (multiple candidates inside ONE party) return a shade of the
 * party colour for each candidate ranked by index (frontrunner gets the purest
 * shade, others get progressively lighter/muted variants).
 *
 * Shades are pre-computed for blue and red; for custom parties we derive them
 * by alpha-blending the base colour toward white.
 */
export function buildPrimaryShades(partyId: string, storedColor: string, count: number): string[] {
  if (count === 1) return [getPartyHex(partyId, storedColor)];

  // For Democrat (blue) and Republican (red) use high-contrast shades so close races
  // are distinguishable (blue+teal, red+orange for 2 candidates)
  const BLUE_SHADES = ["#2563EB", "#14B8A6", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE"];
  const RED_SHADES = ["#DC2626", "#F97316", "#F87171", "#FCA5A5", "#FECACA", "#FEE2E2"];

  if (partyId === "democrat") return BLUE_SHADES.slice(0, count);
  if (partyId === "republican") return RED_SHADES.slice(0, count);

  // Custom party: start from their hex and blend toward white
  const base = storedColor.replace("#", "");
  const r = parseInt(base.slice(0, 2), 16);
  const g = parseInt(base.slice(2, 4), 16);
  const b = parseInt(base.slice(4, 6), 16);

  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1); // 0 = pure, 1 = very light
    const blend = (channel: number) => Math.round(channel + (255 - channel) * t * 0.7);
    const hex = (n: number) => blend(n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  });
}

/**
 * Human-readable office title for profile, career history, and listings.
 *
 * @param office - Current office or career event office payload
 * @param countryId - When set, uses {@link getOfficeTypeConfig} for chamber/executive titles
 *                    (required for correct PM/Chancellor wording across countries).
 */
export function getOfficeLabel(office: OfficeLike | null, countryId?: CountryId): string {
  if (!office) return "Private Citizen";

  const cfg = countryId ? getOfficeTypeConfig(countryId, office.type) : undefined;
  const nation = countryId ? getCountryConfig(countryId) : undefined;
  const realm = nation ? (nation.executiveRealmPhrase ?? nation.name) : undefined;

  if (cfg?.key === "centralBankChair") {
    return cfg.label;
  }

  if (cfg && nation && cfg.isExecutive && !cfg.isSubNational && realm) {
    const execConstituency =
      "constituency" in office && typeof office.constituency === "string"
        ? office.constituency
        : undefined;
    return execConstituency
      ? `${cfg.label} of ${realm} (for ${execConstituency})`
      : `${cfg.label} of ${realm}`;
  }

  switch (office.type) {
    case "house": {
      const seats = office.seatsHeld ?? 1;
      const rep = cfg?.label ?? "Representative";
      return `${rep} (${office.state}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "senate": {
      const senator = cfg?.label ?? "Senator";
      const cls = office.senateClass ? `, Class ${office.senateClass}` : "";
      return `${senator} (${office.state}${cls})`;
    }
    case "stateSenate": {
      const seats = office.seatsHeld ?? 1;
      const label = cfg?.label ?? "State Senator";
      return `${label} (${office.state}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "governor": {
      const gov = cfg?.label ?? "Governor";
      return `${gov} of ${office.state}`;
    }
    case "premier":
    case "ministerPresident": {
      const sub = cfg?.label ?? (office.type === "premier" ? "Premier" : "Minister-President");
      return `${sub} of ${office.state}`;
    }
    case "commons": {
      const regionName = UK_REGIONS.find((r) => r.id === office.state)?.name ?? office.state;
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "MP";
      if (office.constituency) {
        return `${member} for ${office.constituency}`;
      }
      return `${member} (${regionName}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "bundestag": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Member of Bundestag";
      return `${member} (${office.state ?? "?"}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "landtag": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Mitglied des Landtags";
      return `${member} (${office.state ?? "?"}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "landAssembly": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Landtag Deputy";
      return `${member} (${office.state ?? "?"}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "regionalCouncil": {
      const regionName = UK_REGIONS.find((r) => r.id === office.state)?.name ?? office.state;
      const seats = office.seatsHeld ?? 1;
      const base = cfg?.label ?? "Regional Councillor";
      return `${base} (${regionName}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "shugiin": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Shūgiin Member";
      return `${member} (${office.state}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "sangiin": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Sangiin Member";
      const cls = (office as { chamberClass?: number }).chamberClass
        ? `, Class ${(office as { chamberClass?: number }).chamberClass}`
        : "";
      return `${member} (${office.state}${cls}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "president":
      return "President of the United States";
    case "vicePresident":
      return "Vice President of the United States";
    case "primeMinister": {
      const pmRealm = realm ?? "the United Kingdom";
      return `Prime Minister of ${pmRealm}`;
    }
    case "chancellor":
      return "Chancellor of Germany";
    case "usCabinet":
    case "ukCabinet":
    case "parliamentaryCabinet":
    case "deCabinet": {
      const positionId = office.positionId;
      const cabinetCountry =
        office.type === "usCabinet"
          ? "US"
          : office.type === "ukCabinet"
            ? "UK"
            : office.type === "deCabinet"
              ? "DE"
              : countryId;
      if (!cabinetCountry) return "Cabinet Minister";
      const defaultLabel = office.type === "usCabinet" ? "Cabinet Secretary" : "Cabinet Minister";
      if (!positionId) return defaultLabel;
      const positions = getCabinetPositions(cabinetCountry);
      const position = positions.find((p) => p.id === positionId);
      return position?.name ?? defaultLabel;
    }
    case "dail": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "TD";
      return `${member} (${office.state}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "seanad": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Senator";
      return `${member} (${office.state}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    case "localCouncil": {
      const seats = office.seatsHeld ?? 1;
      const member = cfg?.label ?? "Councillor";
      return `${member} (${office.state}, ${seats} seat${seats > 1 ? "s" : ""})`;
    }
    default: {
      // Any office type with a country config entry but no bespoke case above
      // (e.g. CN npcDelegate / peoplesCongress) surfaces its configured label
      // rather than the raw key, so member rosters read cleanly across countries.
      const label = cfg?.label ?? office.type;
      return label ? `${label}${office.state ? ` (${office.state})` : ""}` : "Private Citizen";
    }
  }
}

/**
 * Get a label and Tailwind color class for a state's political lean (-5 to +5, integer scale).
 * Distinct from getLeanLabel (which operates on the continuous character/position scale).
 * @param lean - Integer from -5 (solid blue) to +5 (solid red); 0 = swing
 * @returns Object with a partisan label and a theme-token color class
 */
export function getStateLeanLabel(lean: number): { label: string; color: string } {
  if (lean <= -4) return { label: "Solid Blue", color: "text-info" };
  if (lean < 0) return { label: lean <= -2 ? "Lean Blue" : "Tilt Blue", color: "text-info" };
  if (lean === 0) return { label: "Swing State", color: "text-warning" };
  if (lean < 4) return { label: lean < 2 ? "Tilt Red" : "Lean Red", color: "text-error" };
  return { label: "Solid Red", color: "text-error" };
}
