"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { UK_REGIONS, UK_NATIONS } from "@/lib/constants/uk";
import { BRITISH_ISLES_GEO_URL, UK_REGION_CODES } from "@/lib/maps/britishIslesGeometry";
import { GERMANY_GEO_URL, GERMANY_REGION_CODES } from "@/lib/maps/germanyGeometry";
import { BRAZIL_GEO_URL, BR_REGION_CODES, BR_LABEL_OVERRIDES } from "@/lib/maps/brazilGeometry";
import {
  CHINA_GEO_URL,
  CHINA_GEO_URL_PRE_HANDOVER,
  CN_REGION_CODES,
} from "@/lib/maps/chinaGeometry";
import { JAPAN_GEO_URL, JP_REGION_CODES } from "@/lib/maps/japanGeometry";
import { JP_REGIONS } from "@/lib/constants/japan";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { NIGERIA_GEO_URL, NG_REGION_CODES } from "@/lib/maps/nigeriaGeometry";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  type LeanAxis,
  interpolateGreen,
  sectorSpecializationMapEntry,
  NATION_COLORS,
} from "./mapShared";
import { MapFallback } from "./MapFallback";

/**
 * Countries that use the unified parliamentary map. US is intentionally
 * excluded — it carries electoral-college math, a presidential results
 * panel, and a senate split view and stays on USMapWithModes.
 */
export type ParliamentaryMapCountryId = "UK" | "DE" | "JP" | "CN" | "BR" | "NG";

export interface MapModeConfig {
  id: string;
  label: string;
  description: string;
}

export interface NormalizedRegion {
  id: string;
  name: string;
  /** Right-pane secondary label like "650 MPs" or "299 mandates". */
  secondaryLabel: string;
}

export type MapRegionCell = { color: string; label: string; tooltip: string[] };

export interface BuildRegionDataArgs {
  mode: string;
  mapData: MapOverviewResponse | null;
  leanAxis: LeanAxis;
  resourceData: Record<string, { capacity: number; contractedPct: number; openAccessPct: number }>;
  resourceToggle: "capacity" | "contractedPct" | "openAccessPct";
}

/**
 * Current game-time context, used by renderers that swap rendering assets for
 * historical accuracy (e.g. CN's pre-handover map omits Hong Kong / Macau).
 * Both fields are optional because the turn-status fetch is in-flight on first
 * paint; renderers should fall back to modern assets when context is absent.
 *
 * Intentionally distinct from server-side `GameTimeContext`
 * (`src/lib/time/gameTime.ts`), which carries DB-derived clock state for
 * election phase calculations. This client-side shape only needs what the
 * `/api/game/turn/status` endpoint returns to a public consumer.
 */
export interface MapGameTime {
  currentTurn?: number;
  startingYear?: number;
  /** Pre-iteration calendar offset — honors the founding date freeze when set. */
  preIterationTurns?: number;
}

export interface CountryMapConfig {
  countryId: ParliamentaryMapCountryId;
  modes: ReadonlyArray<MapModeConfig>;
  defaultMode: string;
  regions: ReadonlyArray<NormalizedRegion>;
  regionListHeading: string;
  /** Static subtitle for the full region set; the fallback while the live roster loads. */
  headerSubtitle: string;
  /**
   * Live subtitle computed from the regions actually shown (the owned roster), so
   * an era-split or transferred map reflects its current set rather than the full
   * country. Optional: maps whose seat figure can't be region-summed without
   * drifting from a canonical total (UK: region sum 652 vs nation-sourced 650)
   * omit it and keep {@link headerSubtitle}. Revisit once transfers are general.
   */
  formatSubtitle?: (regions: ReadonlyArray<NormalizedRegion>) => string;
  /** Renders the country's SVG map with the given regionData. */
  renderPaths: (props: {
    regionData: Record<string, MapRegionCell>;
    onRegionClick: (id: string) => void;
    gameTime?: MapGameTime;
    /** Live region roster (British-Isles maps); falls back to the static set. */
    regionCodes?: string[];
  }) => ReactNode;
  aspectRatio: string;
  /** Optional map container size override (defaults: max 340px wide, min 280px tall). */
  mapMaxWidth?: string;
  mapMinHeight?: string;
  /** Computes the per-region color/label/tooltip table for the chosen mode. */
  buildRegionData: (args: BuildRegionDataArgs) => Record<string, MapRegionCell>;
}

// ---------------------------------------------------------------------------
// Dynamically-imported path components — keep the per-country SVG out of the
// initial bundle. SSR is disabled because the SVG renderers use browser-only
// APIs (window resize observers, etc.).
// ---------------------------------------------------------------------------

const RegionalGeoMap = dynamic(
  () => import("@/components/maps/RegionalGeoMap").then((m) => ({ default: m.RegionalGeoMap })),
  { loading: MapFallback, ssr: false }
);

const DE_REGION_GROUPING_COLORS: Record<string, string> = {
  Norden: "#4f7ac7",
  Westen: "#9b59b6",
  Osten: "#2a7c3e",
  Suden: "#c7842a",
  Süden: "#c7842a",
};

// ---------------------------------------------------------------------------
// Shared cell renderers
// ---------------------------------------------------------------------------

function leanCell(
  d: NonNullable<MapOverviewResponse["lean"]>[string] | undefined,
  regionName: string,
  leanAxis: LeanAxis
): MapRegionCell {
  if (!d) {
    return { color: "#334155", label: regionName, tooltip: [regionName, "No lean data"] };
  }
  const color =
    leanAxis === "economic"
      ? (d.economicColor ?? d.color)
      : leanAxis === "social"
        ? (d.socialColor ?? d.color)
        : d.color;
  const label =
    leanAxis === "economic"
      ? (d.economicLabel ?? d.label)
      : leanAxis === "social"
        ? (d.socialLabel ?? d.label)
        : d.label;
  return { color, label, tooltip: d.tooltip };
}

function resourceRegionData<R extends { id?: string; _id?: string; name: string }>(
  regions: ReadonlyArray<R>,
  args: Pick<BuildRegionDataArgs, "resourceData" | "resourceToggle">
): Record<string, MapRegionCell> {
  const result: Record<string, MapRegionCell> = {};
  const maxCap = Math.max(...Object.values(args.resourceData).map((e) => e.capacity), 1);
  for (const region of regions) {
    const id = (region.id ?? region._id) as string;
    const entry = args.resourceData[id];
    if (entry) {
      const value = entry[args.resourceToggle];
      const normalized = args.resourceToggle === "capacity" ? value / maxCap : value;
      result[id] = {
        color: entry.capacity === 0 ? "#374151" : interpolateGreen(normalized),
        label:
          args.resourceToggle === "capacity"
            ? `${value.toLocaleString("en-US")} units/turn`
            : `${(value * 100).toFixed(1)}%`,
        tooltip: [region.name],
      };
    } else {
      result[id] = { color: "#374151", label: region.name, tooltip: [region.name, "No reserves"] };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// UK
// ---------------------------------------------------------------------------

const UK_MODES: MapModeConfig[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per region" },
  { id: "commons", label: "Commons", description: "MPs by party per region" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  {
    id: "lean",
    label: "Lean",
    description:
      "Combined, economic, or social lean (UK: red = left/liberal, blue = right/traditional)",
  },
  { id: "nations", label: "Nations", description: "Regions by home nation" },
  { id: "resources", label: "Resources", description: "Extractable resource capacity by region" },
  {
    id: "sectorBonuses",
    label: "Sector Bonus",
    description: "Primary sector profit margin bonus by region",
  },
];

function buildUKRegionData(args: BuildRegionDataArgs): Record<string, MapRegionCell> {
  if (args.mode === "resources") return resourceRegionData(UK_REGIONS, args);

  const result: Record<string, MapRegionCell> = {};
  const partyOrg = args.mapData?.partyOrg ?? {};
  const commons = args.mapData?.commons ?? {};
  const approval = args.mapData?.approval ?? {};
  const lean = args.mapData?.lean ?? {};

  for (const region of UK_REGIONS) {
    const id = region.id;
    if (args.mode === "sectorBonuses") {
      result[id] = sectorSpecializationMapEntry(id, region.name, args.mapData);
    } else if (args.mode === "partyOrg") {
      const d = partyOrg[id];
      result[id] = d
        ? { color: d.leadColor, label: region.name, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No party org"] };
    } else if (args.mode === "commons") {
      const d = commons[id];
      result[id] = d
        ? { color: d.leadColor, label: `${d.seats}/${d.total}`, tooltip: d.tooltip }
        : {
            color: "#334155",
            label: region.name,
            tooltip: [region.name, `${region.constituencies} constituencies`, "No MPs yet"],
          };
    } else if (args.mode === "approval") {
      const d = approval[id];
      result[id] = d
        ? { color: d.color, label: `${d.approval.toFixed(0)}%`, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No approval data"] };
    } else if (args.mode === "lean") {
      result[id] = leanCell(lean[id], region.name, args.leanAxis);
    } else {
      result[id] = {
        color: NATION_COLORS[region.nationId] ?? "#4f7ac7",
        label: region.name,
        tooltip: [`${region.constituencies} constituencies`, "Click to explore"],
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// DE
// ---------------------------------------------------------------------------

const DE_MODES: MapModeConfig[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per Land" },
  { id: "bundestag", label: "Bundestag", description: "Bundestag seats by party per Land" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  { id: "lean", label: "Lean", description: "Combined, economic, or social lean per Land" },
  { id: "regions", label: "Regions", description: "Bundesländer by regional grouping" },
  { id: "resources", label: "Resources", description: "Extractable resource capacity by Land" },
  {
    id: "sectorBonuses",
    label: "Sector Bonus",
    description: "Primary sector profit margin bonus by Land",
  },
];

function buildDERegionData(
  args: BuildRegionDataArgs,
  regions: typeof deRegions = deRegions
): Record<string, MapRegionCell> {
  if (args.mode === "resources") return resourceRegionData(regions, args);

  const result: Record<string, MapRegionCell> = {};
  const partyOrg = args.mapData?.partyOrg ?? {};
  const bundestag = args.mapData?.house ?? {};
  const approval = args.mapData?.approval ?? {};
  const lean = args.mapData?.lean ?? {};

  for (const region of regions) {
    const id = region._id;
    if (args.mode === "sectorBonuses") {
      result[id] = sectorSpecializationMapEntry(id, region.name, args.mapData);
    } else if (args.mode === "partyOrg") {
      const d = partyOrg[id];
      result[id] = d
        ? { color: d.leadColor, label: region.name, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No party org"] };
    } else if (args.mode === "bundestag") {
      const d = bundestag[id];
      result[id] = d
        ? { color: d.leadColor, label: `${d.seats}/${d.total}`, tooltip: d.tooltip }
        : {
            color: "#334155",
            label: region.name,
            tooltip: [region.name, `${region.houseDistricts} direct mandates`, "No seats filled"],
          };
    } else if (args.mode === "approval") {
      const d = approval[id];
      result[id] = d
        ? { color: d.color, label: `${d.approval.toFixed(0)}%`, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No approval data"] };
    } else if (args.mode === "lean") {
      result[id] = leanCell(lean[id], region.name, args.leanAxis);
    } else {
      result[id] = {
        color: DE_REGION_GROUPING_COLORS[region.region] ?? "#4f7ac7",
        label: region.name,
        tooltip: [
          region.name,
          `${region.houseDistricts} direct mandates`,
          `Region: ${region.region}`,
        ],
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// JP
// ---------------------------------------------------------------------------

const JP_MODES: MapModeConfig[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per region" },
  { id: "shugiin", label: "Shugiin", description: "House of Representatives seats by party" },
  { id: "sangiin", label: "Sangiin", description: "House of Councillors seats by party" },
  { id: "governor", label: "Governor", description: "Regional governor by party" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  { id: "lean", label: "Lean", description: "Combined, economic, or social lean per region" },
  { id: "resources", label: "Resources", description: "Extractable resource capacity by region" },
  {
    id: "sectorBonuses",
    label: "Sector Bonus",
    description: "Primary sector profit margin bonus by region",
  },
];

function buildJPRegionData(args: BuildRegionDataArgs): Record<string, MapRegionCell> {
  if (args.mode === "resources") return resourceRegionData(JP_REGIONS, args);

  const result: Record<string, MapRegionCell> = {};
  const partyOrg = args.mapData?.partyOrg ?? {};
  const house = args.mapData?.house ?? {};
  const senate = args.mapData?.senate ?? {};
  const governorMap = args.mapData?.governor ?? {};
  const approval = args.mapData?.approval ?? {};
  const lean = args.mapData?.lean ?? {};

  for (const region of JP_REGIONS) {
    const id = region.id;
    if (args.mode === "sectorBonuses") {
      result[id] = sectorSpecializationMapEntry(id, region.name, args.mapData);
    } else if (args.mode === "partyOrg") {
      const d = partyOrg[id];
      result[id] = d
        ? { color: d.leadColor, label: region.name, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No party org"] };
    } else if (args.mode === "shugiin") {
      const d = house[id];
      result[id] = d
        ? { color: d.leadColor, label: `${d.seats}/${d.total}`, tooltip: d.tooltip }
        : {
            color: "#334155",
            label: region.name,
            tooltip: [region.name, `${region.shugiinDistricts} seats`, "No data"],
          };
    } else if (args.mode === "sangiin") {
      const d = senate[id];
      const seatColor = d?.seat1?.color ?? d?.seat2?.color ?? "#334155";
      result[id] = d
        ? {
            color: seatColor,
            label: region.name,
            tooltip: [region.name, `${region.sangiinSeats} Sangiin seats`],
          }
        : {
            color: "#334155",
            label: region.name,
            tooltip: [region.name, `${region.sangiinSeats} seats`, "No data"],
          };
    } else if (args.mode === "governor") {
      const d = governorMap[id];
      result[id] = d
        ? { color: d.leadColor, label: d.governorName ?? region.name, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No governor"] };
    } else if (args.mode === "approval") {
      const d = approval[id];
      result[id] = d
        ? { color: d.color, label: `${d.approval.toFixed(0)}%`, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No approval data"] };
    } else if (args.mode === "lean") {
      result[id] = leanCell(lean[id], region.name, args.leanAxis);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// CN
// ---------------------------------------------------------------------------

// Hong Kong handover: July 1, 1997. Before this game-time, render the
// pre-handover CN map (no HK, no Macau). Macau's own handover (Dec 1999) is
// not modeled separately — accepted limitation, see
// docs/plans/2026-05-28-cn-region-map-1991.md.
const CN_HK_HANDOVER_YEAR = 1997;
const CN_HK_HANDOVER_MONTH = 7;

export function isPreHKHandover(gameTime: MapGameTime | undefined): boolean {
  const currentTurn = gameTime?.currentTurn;
  const startingYear = gameTime?.startingYear;
  if (!Number.isFinite(currentTurn) || !Number.isFinite(startingYear)) return false;
  // Use the CALENDAR turn so the handover gate honors the pre-iteration date
  // freeze and stays correct once the calendar resumes with the offset applied.
  const calTurn = calendarTurn(currentTurn!, { preIterationTurns: gameTime?.preIterationTurns });
  const yearOffset = Math.floor((calTurn - 1) / TURNS_PER_YEAR);
  const gameYear = startingYear! + yearOffset;
  if (gameYear < CN_HK_HANDOVER_YEAR) return true;
  if (gameYear > CN_HK_HANDOVER_YEAR) return false;
  // gameYear === handover year — switch at the start of the handover month.
  // TURNS_PER_YEAR = 48, so 4 turns per month.
  const turnInYear = ((calTurn - 1) % TURNS_PER_YEAR) + 1; // 1..48
  const gameMonth = Math.floor((turnInYear - 1) / 4) + 1; // 1..12
  return gameMonth < CN_HK_HANDOVER_MONTH;
}

const CN_MODES: MapModeConfig[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per region" },
  { id: "npc", label: "NPC", description: "National People's Congress seats by party per region" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  { id: "lean", label: "Lean", description: "Combined, economic, or social lean per region" },
  { id: "resources", label: "Resources", description: "Extractable resource capacity by region" },
  {
    id: "sectorBonuses",
    label: "Sector Bonus",
    description: "Primary sector profit margin bonus by region",
  },
];

function buildCNRegionData(args: BuildRegionDataArgs): Record<string, MapRegionCell> {
  if (args.mode === "resources") return resourceRegionData(cnRegions, args);

  const result: Record<string, MapRegionCell> = {};
  const partyOrg = args.mapData?.partyOrg ?? {};
  const house = args.mapData?.house ?? {};
  const approval = args.mapData?.approval ?? {};
  const lean = args.mapData?.lean ?? {};

  for (const region of cnRegions) {
    const id = region._id;
    if (args.mode === "sectorBonuses") {
      result[id] = sectorSpecializationMapEntry(id, region.name, args.mapData);
    } else if (args.mode === "partyOrg") {
      const d = partyOrg[id];
      result[id] = d
        ? { color: d.leadColor, label: region.name, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No party org"] };
    } else if (args.mode === "npc") {
      const d = house[id];
      result[id] = d
        ? { color: d.leadColor, label: `${d.seats}/${d.total}`, tooltip: d.tooltip }
        : {
            color: "#334155",
            label: region.name,
            tooltip: [region.name, `${region.houseDistricts} NPC seats`, "No data"],
          };
    } else if (args.mode === "approval") {
      const d = approval[id];
      result[id] = d
        ? { color: d.color, label: `${d.approval.toFixed(0)}%`, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No approval data"] };
    } else if (args.mode === "lean") {
      result[id] = leanCell(lean[id], region.name, args.leanAxis);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// BR
// ---------------------------------------------------------------------------

const BR_MODES: MapModeConfig[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per region" },
  { id: "chamber", label: "Chamber", description: "Câmara dos Deputados seats by party" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  { id: "lean", label: "Lean", description: "Combined, economic, or social lean per region" },
  { id: "resources", label: "Resources", description: "Extractable resource capacity by region" },
  {
    id: "sectorBonuses",
    label: "Sector Bonus",
    description: "Primary sector profit margin bonus by region",
  },
];

function buildBRRegionData(args: BuildRegionDataArgs): Record<string, MapRegionCell> {
  if (args.mode === "resources") return resourceRegionData(brRegions, args);

  const result: Record<string, MapRegionCell> = {};
  const partyOrg = args.mapData?.partyOrg ?? {};
  const house = args.mapData?.house ?? {};
  const approval = args.mapData?.approval ?? {};
  const lean = args.mapData?.lean ?? {};

  for (const region of brRegions) {
    const id = region._id;
    if (args.mode === "sectorBonuses") {
      result[id] = sectorSpecializationMapEntry(id, region.name, args.mapData);
    } else if (args.mode === "partyOrg") {
      const d = partyOrg[id];
      result[id] = d
        ? { color: d.leadColor, label: region.name, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No party org"] };
    } else if (args.mode === "chamber") {
      const d = house[id];
      result[id] = d
        ? { color: d.leadColor, label: `${d.seats}/${d.total}`, tooltip: d.tooltip }
        : {
            color: "#334155",
            label: region.name,
            tooltip: [region.name, `${region.houseDistricts} Chamber seats`, "No data"],
          };
    } else if (args.mode === "approval") {
      const d = approval[id];
      result[id] = d
        ? { color: d.color, label: `${d.approval.toFixed(0)}%`, tooltip: d.tooltip }
        : { color: "#334155", label: region.name, tooltip: [region.name, "No approval data"] };
    } else if (args.mode === "lean") {
      result[id] = leanCell(lean[id], region.name, args.leanAxis);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// COUNTRY_MAP_CONFIGS
// ---------------------------------------------------------------------------

const totalUKConstituencies = UK_NATIONS.reduce((s, n) => s + n.constituencies, 0);
const totalShugiin = JP_REGIONS.reduce((s, r) => s + r.shugiinDistricts, 0);
const totalNpcSeats = cnRegions.reduce((s, r) => s + r.houseDistricts, 0);
const totalBRChamber = brRegions.reduce((s, r) => s + r.houseDistricts, 0);

// All 16 Länder are the DE map's fixed metadata; which of them render is the live
// owned roster (West Germany's 11 in the 1979 era, all 16 unified), resolved from
// `states.countryId` at render time — no preset branch in the config. Mandate
// counts keyed by code so the subtitle can sum just the shown set.
const DE_MANDATES_BY_ID = new Map(deRegions.map((r) => [r._id, r.houseDistricts] as const));
const totalDeMandates = deRegions.reduce((s, r) => s + r.houseDistricts, 0);

// ---------------------------------------------------------------------------
// NG — six geopolitical zones; bicameral National Assembly + zone governors.
// Mode set mirrors JP (the full chamber+governor template), English labels.
// ---------------------------------------------------------------------------
const NG_MODES: MapModeConfig[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per zone" },
  { id: "house", label: "House of Reps", description: "House of Representatives seats by party" },
  { id: "senate", label: "Senate", description: "Senate seats by party" },
  { id: "governor", label: "Governor", description: "Zone governor by party" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  { id: "lean", label: "Lean", description: "Combined, economic, or social lean per zone" },
  { id: "sectorBonuses", label: "Sectors", description: "Sector specialization by zone" },
];

function buildNGRegionData(args: BuildRegionDataArgs): Record<string, MapRegionCell> {
  const result: Record<string, MapRegionCell> = {};
  const partyOrg = args.mapData?.partyOrg ?? {};
  const house = args.mapData?.house ?? {};
  const senate = args.mapData?.senate ?? {};
  const governorMap = args.mapData?.governor ?? {};
  const approval = args.mapData?.approval ?? {};
  const lean = args.mapData?.lean ?? {};

  for (const region of ngRegions) {
    const id = region._id;
    const name = region.name;
    if (args.mode === "sectorBonuses") {
      result[id] = sectorSpecializationMapEntry(id, name, args.mapData);
    } else if (args.mode === "partyOrg") {
      const d = partyOrg[id];
      result[id] = d
        ? { color: d.leadColor, label: name, tooltip: d.tooltip }
        : { color: "#334155", label: name, tooltip: [name, "No party org"] };
    } else if (args.mode === "house") {
      const d = house[id];
      result[id] = d
        ? { color: d.leadColor, label: `${d.seats}/${d.total}`, tooltip: d.tooltip }
        : {
            color: "#334155",
            label: name,
            tooltip: [name, `${region.houseDistricts} seats`, "No data"],
          };
    } else if (args.mode === "senate") {
      const d = senate[id];
      const seatColor = d?.seat1?.color ?? d?.seat2?.color ?? "#334155";
      result[id] = d
        ? {
            color: seatColor,
            label: name,
            tooltip: [name, `${region.stateSenateSeats} Senate seats`],
          }
        : {
            color: "#334155",
            label: name,
            tooltip: [name, `${region.stateSenateSeats} seats`, "No data"],
          };
    } else if (args.mode === "governor") {
      const d = governorMap[id];
      result[id] = d
        ? { color: d.leadColor, label: d.governorName ?? name, tooltip: d.tooltip }
        : { color: "#334155", label: name, tooltip: [name, "No governor"] };
    } else if (args.mode === "approval") {
      const d = approval[id];
      result[id] = d
        ? { color: d.color, label: `${d.approval.toFixed(0)}%`, tooltip: d.tooltip }
        : { color: "#334155", label: name, tooltip: [name, "No approval data"] };
    } else if (args.mode === "lean") {
      result[id] = leanCell(lean[id], name, args.leanAxis);
    }
  }
  return result;
}

export const COUNTRY_MAP_CONFIGS: Record<ParliamentaryMapCountryId, CountryMapConfig> = {
  UK: {
    countryId: "UK",
    modes: UK_MODES,
    defaultMode: "commons",
    regions: UK_REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      secondaryLabel: `${r.constituencies} MPs`,
    })),
    regionListHeading: "All Regions",
    headerSubtitle: `${UK_REGIONS.length} regions · ${totalUKConstituencies} Westminster constituencies`,
    renderPaths: ({ regionData, onRegionClick, regionCodes }) => (
      <RegionalGeoMap
        zoomable
        sourceUrl={BRITISH_ISLES_GEO_URL}
        regionCodes={regionCodes ?? [...UK_REGION_CODES]}
        regionData={regionData}
        onRegionClick={onRegionClick}
      />
    ),
    aspectRatio: "280/400",
    buildRegionData: buildUKRegionData,
  },
  DE: {
    countryId: "DE",
    modes: DE_MODES,
    defaultMode: "bundestag",
    regions: deRegions.map((r) => ({
      id: r._id,
      name: r.name,
      secondaryLabel: `${r.houseDistricts} mandates`,
    })),
    regionListHeading: "All Länder",
    headerSubtitle: `${deRegions.length} Länder · ${totalDeMandates} direct mandates`,
    // Live subtitle: in the 1979 era only West Germany's 11 Länder are owned, so
    // this reads "11 Länder · N direct mandates"; unified eras show all 16.
    formatSubtitle: (regions) => {
      const mandates = regions.reduce((s, r) => s + (DE_MANDATES_BY_ID.get(r.id) ?? 0), 0);
      return `${regions.length} Länder · ${mandates} direct mandates`;
    },
    renderPaths: ({ regionData, onRegionClick, regionCodes }) => (
      <RegionalGeoMap
        zoomable
        sourceUrl={GERMANY_GEO_URL}
        regionCodes={regionCodes ?? [...GERMANY_REGION_CODES]}
        regionData={regionData}
        onRegionClick={onRegionClick}
      />
    ),
    aspectRatio: "280/400",
    buildRegionData: (args) => buildDERegionData(args, deRegions),
  },
  JP: {
    countryId: "JP",
    modes: JP_MODES,
    defaultMode: "approval",
    regions: JP_REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      secondaryLabel: `${r.shugiinDistricts} Shugiin`,
    })),
    regionListHeading: "All Regions",
    headerSubtitle: `${JP_REGIONS.length} regions · ${totalShugiin} Shugiin seats`,
    renderPaths: ({ regionData, onRegionClick, regionCodes }) => (
      <RegionalGeoMap
        zoomable
        sourceUrl={JAPAN_GEO_URL}
        regionCodes={regionCodes ?? [...JP_REGION_CODES]}
        regionData={regionData}
        onRegionClick={onRegionClick}
      />
    ),
    aspectRatio: "280/400",
    buildRegionData: buildJPRegionData,
  },
  CN: {
    countryId: "CN",
    modes: CN_MODES,
    defaultMode: "partyOrg",
    regions: cnRegions.map((r) => ({
      id: r._id,
      name: r.name,
      secondaryLabel: `${r.houseDistricts} seats`,
    })),
    regionListHeading: "All Regions",
    headerSubtitle: `${cnRegions.length} regions · ${totalNpcSeats} NPC seats`,
    renderPaths: ({ regionData, onRegionClick, regionCodes, gameTime }) => (
      <RegionalGeoMap
        zoomable
        sourceUrl={isPreHKHandover(gameTime) ? CHINA_GEO_URL_PRE_HANDOVER : CHINA_GEO_URL}
        regionCodes={regionCodes ?? [...CN_REGION_CODES]}
        regionData={regionData}
        onRegionClick={onRegionClick}
        width={480}
        height={340}
      />
    ),
    aspectRatio: "480/340",
    mapMaxWidth: "420px",
    mapMinHeight: "260px",
    buildRegionData: buildCNRegionData,
  },
  BR: {
    countryId: "BR",
    modes: BR_MODES,
    defaultMode: "partyOrg",
    regions: brRegions.map((r) => ({
      id: r._id,
      name: r.name,
      secondaryLabel: `${r.houseDistricts} Chamber`,
    })),
    regionListHeading: "All Regions",
    headerSubtitle: `${brRegions.length} regions · ${totalBRChamber} Chamber seats`,
    renderPaths: ({ regionData, onRegionClick, regionCodes }) => (
      <RegionalGeoMap
        zoomable
        sourceUrl={BRAZIL_GEO_URL}
        regionCodes={regionCodes ?? [...BR_REGION_CODES]}
        regionData={regionData}
        onRegionClick={onRegionClick}
        labelOverrides={BR_LABEL_OVERRIDES}
      />
    ),
    aspectRatio: "280/400",
    buildRegionData: buildBRRegionData,
  },
  NG: {
    countryId: "NG",
    modes: NG_MODES,
    defaultMode: "partyOrg",
    regions: ngRegions.map((r) => ({
      id: r._id,
      name: r.name,
      secondaryLabel: `${r.houseDistricts} seats`,
    })),
    regionListHeading: "All Zones",
    headerSubtitle: `${ngRegions.length} geopolitical zones`,
    renderPaths: ({ regionData, onRegionClick, regionCodes }) => (
      <RegionalGeoMap
        zoomable
        sourceUrl={NIGERIA_GEO_URL}
        regionCodes={regionCodes ?? [...NG_REGION_CODES]}
        regionData={regionData}
        onRegionClick={onRegionClick}
        width={480}
        height={340}
      />
    ),
    aspectRatio: "480/340",
    mapMaxWidth: "420px",
    mapMinHeight: "260px",
    buildRegionData: buildNGRegionData,
  },
};

export function isParliamentaryMapCountry(id: string): id is ParliamentaryMapCountryId {
  return id in COUNTRY_MAP_CONFIGS;
}
