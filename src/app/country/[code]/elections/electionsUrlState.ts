/**
 * URL <-> filter state for the country elections page.
 *
 * The URL is the single source of truth (see the stockmarket page for the same
 * pattern), so these are pure functions with no React involvement.
 *
 * The `?type=senate&class=2` encoding predates this module and is preserved —
 * it is the documented public shape for inbound links.
 */

import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * A race filter is an office key, a chamber key, or `senate-N` for the classed
 * US Senate. It is validated against the keys some country actually defines, so
 * a junk `?type=` falls back to "all races" instead of filtering the page empty.
 *
 * Previously this was a hand-written union of 16 values. That silently ignored
 * `?type=cameraDeputati`, `?type=riksdag`, `?type=supremeSovietDeputy` and the
 * rest, so most countries had no working race deep-link at all.
 */
export type RaceFilter = string;

/** Every office key and chamber key defined by any country, built once. */
const KNOWN_RACE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(COUNTRY_CONFIGS).flatMap((id) =>
    (COUNTRY_CONFIGS[id as CountryId].officeTypes ?? []).flatMap((o) =>
      o.chamberKey ? [o.key, o.chamberKey] : [o.key]
    )
  )
);

export type PrimaryFilter = "" | "in" | "out";
export type ContestFilter = "" | "uncontested" | "contested";

export interface ElectionsFilters {
  race: RaceFilter;
  state: string;
  view: "list" | "map";
  competitive: boolean;
  hideUpcoming: boolean;
  /** Primary stage: "" = any, "in" = in its primary, "out" = past/before it. */
  primary: PrimaryFilter;
  /** Field size: "" = any, "uncontested" = 0–1 candidates, "contested" = 2+. */
  contest: ContestFilter;
  /**
   * Expanded office sections. `null` means "not specified", so the page picks
   * its own default; an empty array means the viewer collapsed everything and
   * that choice must survive a reload.
   */
  open: string[] | null;
}

export const DEFAULT_FILTERS: ElectionsFilters = {
  race: "",
  state: "",
  view: "list",
  competitive: false,
  hideUpcoming: false,
  primary: "",
  contest: "",
  open: null,
};

function parseRace(params: URLSearchParams): RaceFilter {
  const type = params.get("type");
  if (!type) return "";
  if (type === "senate") {
    const cls = params.get("class");
    if (cls === "2") return "senate-2";
    if (cls === "3") return "senate-3";
    // A classless ?type=senate link keeps its historical meaning: Class I.
    return "senate-1";
  }
  return KNOWN_RACE_KEYS.has(type) ? type : "";
}

// Unrecognised values fall back to "no constraint", the same way a junk
// `?type=` does, so a bad link shows every race rather than an empty page.
function parsePrimary(raw: string | null): PrimaryFilter {
  return raw === "in" || raw === "out" ? raw : "";
}

function parseContest(raw: string | null): ContestFilter {
  return raw === "uncontested" || raw === "contested" ? raw : "";
}

function parseOpen(raw: string | null): string[] | null {
  if (raw === null) return null;
  if (raw === "") return [];
  return raw.split(",").filter(Boolean);
}

export function parseElectionsParams(params: URLSearchParams): ElectionsFilters {
  return {
    race: parseRace(params),
    state: params.get("state") ?? "",
    view: params.get("view") === "map" ? "map" : "list",
    competitive: params.get("competitive") === "1",
    hideUpcoming: params.get("active") === "1",
    primary: parsePrimary(params.get("primary")),
    contest: parseContest(params.get("contest")),
    open: parseOpen(params.get("open")),
  };
}

export function toElectionsParams(f: ElectionsFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (f.race.startsWith("senate-")) {
    params.set("type", "senate");
    params.set("class", f.race.slice("senate-".length));
  } else if (f.race) {
    params.set("type", f.race);
  }

  if (f.state) params.set("state", f.state);
  if (f.view !== "list") params.set("view", f.view);
  if (f.competitive) params.set("competitive", "1");
  if (f.hideUpcoming) params.set("active", "1");
  if (f.primary) params.set("primary", f.primary);
  if (f.contest) params.set("contest", f.contest);
  // `null` is the unset default and stays out of the URL. An empty array is a
  // deliberate "everything collapsed" and is written as `open=`.
  if (f.open !== null) params.set("open", f.open.join(","));

  return params;
}

export function electionsHref(pathname: string, f: ElectionsFilters): string {
  const qs = toElectionsParams(f).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
