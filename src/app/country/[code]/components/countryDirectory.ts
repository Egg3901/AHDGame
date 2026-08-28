/**
 * Builds the country lander's Explore directory.
 *
 * The lander is a hub before it is a data page: a player arrives asking "where
 * do I go", not "what is the debt-to-GDP ratio". So this is a pure function over
 * config plus live figures, kept out of the client component for two reasons:
 * the ordering and the gating are the design, and both are worth testing without
 * mounting a page that fires half a dozen fetches.
 *
 * Every row degrades on its own. A missing figure renders a plain chevron, and a
 * gated surface (SCOTUS, Command Economy, Conflicts) drops out of the list
 * entirely rather than linking to a redirect.
 */
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  type CountryConfig,
  type CountryId,
} from "@/lib/constants/countries";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import type { OverviewCounts } from "@/lib/country/overviewCounts";
import {
  approvalUrl,
  budgetUrl,
  centralBankUrl,
  countryElectionsUrl,
  economyUrl,
  forexUrl,
  metricsUrl,
  partiesUrl,
  policyUrl,
  politicalMetricsUrl,
  politiciansUrl,
  referendumsUrl,
  scotusUrl,
  navairUrl,
  stockmarketUrl,
  unionsUrl,
} from "@/lib/urls";
import { formatGDP } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import type { DirectoryGroup, DirectoryRow } from "./ExploreDirectory";

export interface DirectoryInput {
  countryId: CountryId;
  /** Era preset, so an era that renames or removes an office is respected. */
  preset?: string | null;
  counts: OverviewCounts | null;
  /** National law count from the ideology band, reused as the Policy figure. */
  lawCount?: number | null;
  /** Government approval, already loaded for the hero, reused as the Approval figure. */
  approval?: number | null;
  /** An active or upcoming presidential race, pinned to the top of Politics. */
  activePresidentElection?: { id: string; seatId?: string; status: string } | null;
}

/** Plural-aware "3 bills" / "1 bill", or null when the count is missing or zero. */
export function countFigure(
  value: number | null | undefined,
  singular: string,
  plural = `${singular}s`
): string | null {
  if (value == null || value <= 0) return null;
  return `${value} ${value === 1 ? singular : plural}`;
}

/** "6 live" beats "6 upcoming"; nothing scheduled reads as no figure at all. */
export function electionsFigure(counts: OverviewCounts | null): {
  figure: string | null;
  tone: "default" | "warning";
} {
  if (counts?.activeElections) return { figure: `${counts.activeElections} live`, tone: "warning" };
  if (counts?.upcomingElections)
    return { figure: `${counts.upcomingElections} upcoming`, tone: "default" };
  return { figure: null, tone: "default" };
}

/**
 * Budget balance as a share of GDP. A deficit is not a failure state, so it is
 * plain text with a warning tone only once it is deep enough to matter.
 */
export function budgetFigure(counts: OverviewCounts | null): {
  figure: string | null;
  tone: "default" | "warning";
} {
  const pct = counts?.budgetBalancePctGdp;
  if (pct == null || !Number.isFinite(pct)) return { figure: null, tone: "default" };
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = rounded > 0 ? "+" : "";
  return {
    figure: `${sign}${rounded.toFixed(1)}% GDP`,
    tone: rounded <= -3 ? "warning" : "default",
  };
}

/** DEFCON reads down: 1 is the crisis end, so 1 and 2 carry the warning tone. */
export function defconFigure(counts: OverviewCounts | null): {
  figure: string | null;
  tone: "default" | "warning";
} {
  const defcon = counts?.coldWarDefcon;
  if (defcon == null || !Number.isFinite(defcon)) return { figure: null, tone: "default" };
  return { figure: `DEFCON ${defcon}`, tone: defcon <= 2 ? "warning" : "default" };
}

function politicsRows(input: DirectoryInput): DirectoryRow[] {
  const { counts, countryId } = input;
  const elections = electionsFigure(counts);
  const race = input.activePresidentElection;
  return [
    ...(race
      ? [
          {
            label: "Presidential Election",
            href: `/elections/${race.seatId ?? race.id}`,
            available: true,
            figure: race.status === "upcoming" ? "upcoming" : "live",
            figureTone: "warning" as const,
            highlight: true,
          },
        ]
      : []),
    {
      label: "Elections",
      href: countryElectionsUrl(countryId),
      available: true,
      figure: elections.figure,
      figureTone: elections.tone,
    },
    {
      label: "Parties",
      href: partiesUrl(countryId),
      available: true,
      figure: countFigure(counts?.parties, "active", "active"),
    },
    {
      label: "Politicians",
      href: politiciansUrl(countryId),
      available: true,
      figure: counts?.politicians ? `${counts.politicians}` : null,
    },
    {
      label: "Approval",
      href: approvalUrl(countryId),
      available: true,
      figure: input.approval != null ? `${Math.round(input.approval)}%` : null,
    },
    // Referendums only exist for countries that have run one. Everyone else
    // would get a link to an empty hub.
    ...(counts?.totalReferendums
      ? [
          {
            label: "Referendums",
            href: referendumsUrl(countryId),
            available: true,
            figure: counts.activeReferendums
              ? `${counts.activeReferendums} live`
              : countFigure(counts.totalReferendums, "past", "past"),
            figureTone: counts.activeReferendums ? ("warning" as const) : ("default" as const),
          },
        ]
      : []),
  ];
}

function governmentRows(input: DirectoryInput, config: CountryConfig): DirectoryRow[] {
  const { counts, countryId } = input;
  const isPresidential = config.governmentType === "presidential";
  const isUS = countryId === COUNTRY_CONFIGS.US.id;
  const budget = budgetFigure(counts);
  return [
    {
      label: config.legislature.name,
      href: config.legislature.path,
      available: true,
      figure: countFigure(counts?.bills, "bill"),
    },
    ...(config.executivePath
      ? [
          {
            label: isPresidential ? "White House" : config.executiveTitle,
            href: config.executivePath,
            available: true,
          },
        ]
      : []),
    {
      label: "National Budget",
      href: budgetUrl(countryId),
      available: true,
      figure: budget.figure,
      figureTone: budget.tone,
    },
    {
      label: "National Policy",
      href: policyUrl(countryId),
      available: true,
      figure: countFigure(input.lawCount, "law"),
    },
    // SCOTUS is a US-only mechanic (#3581).
    ...(isUS ? [{ label: "Supreme Court", href: scotusUrl(countryId), available: true }] : []),
  ];
}

function economyRows(input: DirectoryInput, currencyPrefix: string): DirectoryRow[] {
  const { counts, countryId } = input;
  return [
    {
      label: "Economy",
      href: economyUrl(countryId),
      available: true,
      figure: counts?.gdpMillions ? formatGDP(counts.gdpMillions, currencyPrefix) : null,
    },
    {
      label: "Stock Market",
      href: stockmarketUrl(countryId),
      available: true,
    },
    {
      label: getCountryConfig(countryId, input.preset ?? undefined).centralBank.abbreviation,
      href: centralBankUrl(countryId),
      available: true,
      figure: counts?.primeRate != null ? `${counts.primeRate.toFixed(2)}%` : null,
    },
    {
      label: "Foreign Exchange",
      href: forexUrl(countryId),
      available: true,
    },
    {
      label: "Unions",
      href: unionsUrl(countryId),
      available: true,
      figure: countFigure(counts?.unions, "union"),
    },
    // Public takings and privatization auctions. Ungated: every country can run
    // them, and the page carries its own empty state when none are open.
    {
      label: "Nationalization",
      href: `/country/${countryId.toLowerCase()}/nationalization`,
      available: true,
    },
    // Command Economy dashboard - only for flag-on planned economies.
    ...(counts?.commandEconomy
      ? [
          {
            label: "Command Economy",
            href: `/country/${countryId.toLowerCase()}/command-economy`,
            available: true,
            figure: "plan" as string | null,
          },
        ]
      : []),
  ];
}

function nationRows(input: DirectoryInput, config: CountryConfig): DirectoryRow[] {
  const { counts, countryId } = input;
  const hasPoliticalMetrics = (POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(
    countryId
  );
  const defcon = defconFigure(counts);
  return [
    {
      label: "Map",
      href: config.mapPath,
      available: true,
      figure: counts?.regions
        ? `${counts.regions} ${config.regionLabelPlural.toLowerCase()}`
        : null,
    },
    // SP6: playables have one metrics product; non-playables keep the legacy
    // National Metrics page.
    hasPoliticalMetrics
      ? { label: "Political Metrics", href: politicalMetricsUrl(countryId), available: true }
      : { label: "National Metrics", href: metricsUrl(countryId), available: true },
    // The wiki is one hub for the whole game rather than per country, so this
    // links to the index. It earns a place here because "how does this work"
    // is the other question a player arrives on a country page with.
    { label: "Wiki", href: "/wiki", available: true },
    // Naval and air command. Shown whenever the country owns hulls or wings, which is
    // the same gate the page itself applies: a nation with no fleet and no air force has
    // nothing to command and gets no row.
    ...(input.counts?.navairFormations
      ? [
          {
            label: "Naval and Air Command",
            href: navairUrl(countryId),
            available: true,
            figure: countFigure(input.counts.navairFormations, "formation"),
          },
        ]
      : []),
    // Cold War entry, present only when the subsystem is on and this country is
    // a principal. The figure's absence IS the gate: the counts route only
    // returns a DEFCON under those two conditions.
    ...(defcon.figure
      ? [
          {
            label: "Cold War",
            href: "/world/conflicts",
            available: true,
            figure: defcon.figure,
            figureTone: defcon.tone,
          },
        ]
      : []),
  ];
}

/**
 * The directory, in reading order: what you vote in, who governs, what it costs,
 * and where it all sits. Groups with no rows are dropped so a country that is
 * missing a whole area does not render an empty card.
 */
export function buildCountryDirectory(input: DirectoryInput): DirectoryGroup[] {
  const config = getCountryConfig(input.countryId, input.preset ?? undefined);
  const currencyPrefix = getCurrencyPrefix(input.countryId);
  return [
    { label: "Politics", rows: politicsRows(input) },
    { label: "Government", rows: governmentRows(input, config) },
    { label: "Economy", rows: economyRows(input, currencyPrefix) },
    { label: "Nation", rows: nationRows(input, config) },
  ].filter((group) => group.rows.length > 0);
}
