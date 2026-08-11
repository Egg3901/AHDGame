/**
 * Pure builder for the Nation dropdown's "National Details" links, grouped into
 * four ordered sub-sections (Government / Politics / Economy / Other). Consumed
 * by both the desktop `NationDropdown` and the mobile list in `Navbar`, so the
 * two stay in sync from one source. Conditional Politics items (presidential
 * election, party charters, referendums) are appended in that order only when
 * their option is supplied; empty sections are dropped.
 */
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  isDirectElection,
  type CountryId,
} from "@/lib/constants/countries";
import {
  budgetUrl,
  centralBankUrl,
  countryElectionsUrl,
  economyUrl,
  metricsUrl,
  partiesUrl,
  policyUrl,
  politicalMetricsUrl,
  politiciansUrl,
  referendumsUrl,
  scotusUrl,
  unionsUrl,
} from "@/lib/urls";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";

export type NationDetailItemId =
  | "executive"
  | "legislature"
  | "policy"
  | "scotus"
  | "parties"
  | "politicians"
  | "elections"
  | "presidentialElection"
  | "charters"
  | "referendums"
  | "politicalMetrics"
  | "economy"
  | "budget"
  | "centralBank"
  | "metrics"
  | "unions"
  | "map";

export interface NationDetailItem {
  id: NationDetailItemId;
  label: string;
  href: string;
}

export interface NationDetailSection {
  title: "Government" | "Politics" | "Economy" | "Other";
  items: NationDetailItem[];
  /** When true, renderers may collapse this section behind a click-to-expand header. */
  collapsible?: boolean;
}

export interface NationDetailsOpts {
  /** Active direct-election presidential race (direct-election countries only). */
  activePresidentElection?: { id: string; seatId?: string } | null;
  /** Resolved charter entry (active founders only). */
  charters?: { href: string; label: string } | null;
  /** True when a referendum is campaigning in this country. */
  hasActiveReferendumCampaign?: boolean;
  /** True when the unions feature is enabled — adds the Unions link to the Economy group. */
  unionsEnabled?: boolean;
}

export function buildNationalDetailsSections(
  countryId: CountryId,
  opts: NationDetailsOpts = {}
): NationDetailSection[] {
  const config = getCountryConfig(countryId);

  // Traffic-ordered: election pages outdraw party pages, which outdraw the
  // politician roster (see the share breakdown above `sections` below).
  const politics: NationDetailItem[] = [
    { id: "elections", label: "Elections", href: countryElectionsUrl(countryId) },
    { id: "parties", label: "Political Parties", href: partiesUrl(countryId) },
    { id: "politicians", label: "Politicians", href: politiciansUrl(countryId) },
  ];
  // SP1 political registry — playable-pipeline countries only. Shipped without
  // a nav consumer originally; this is its primary entry point.
  const isPlayablePipeline = (POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(
    countryId
  );
  // Pushed ahead of Political Metrics deliberately: this link points at
  // /elections/[id], which is the #6 destination site-wide at 4.45% of all
  // pageviews, whereas the metrics registry barely registers.
  if (isDirectElection(config) && opts.activePresidentElection) {
    politics.push({
      id: "presidentialElection",
      label: "Presidential Election",
      href: `/elections/${opts.activePresidentElection.seatId ?? opts.activePresidentElection.id}`,
    });
  }
  if (isPlayablePipeline) {
    politics.push({
      id: "politicalMetrics",
      label: "Political Metrics",
      href: politicalMetricsUrl(countryId),
    });
  }
  if (opts.charters) {
    politics.push({ id: "charters", label: opts.charters.label, href: opts.charters.href });
  }
  if (opts.hasActiveReferendumCampaign) {
    politics.push({
      id: "referendums",
      label: "Referendums",
      href: referendumsUrl(countryId),
    });
  }

  // Traffic-ordered: the central bank is the most-visited Economy page by a
  // wide margin (0.68% of all pageviews vs 0.24% for Economy, 0.13% Budget).
  const economy: NationDetailItem[] = [
    { id: "centralBank", label: config.centralBank.name, href: centralBankUrl(countryId) },
    { id: "economy", label: "Economy", href: economyUrl(countryId) },
    { id: "budget", label: "National Budget", href: budgetUrl(countryId) },
  ];
  // SP6: playables have exactly one metrics entry — the registry (Politics
  // section above). Non-playables keep the legacy National Metrics page.
  if (!isPlayablePipeline) {
    economy.push({ id: "metrics", label: "National Metrics", href: metricsUrl(countryId) });
  }
  if (opts.unionsEnabled) {
    // Country-scoped unions roster (mirrors the other Economy-group links).
    economy.push({ id: "unions", label: "Unions", href: unionsUrl(countryId) });
  }

  // Section and item order below is set by measured traffic (Umami, 24 days
  // to 2026-07-23, 318k pageviews) rather than by taxonomy. Shares quoted as
  // % of all site pageviews:
  //   Politics  ~8%   — /elections/[id] 4.45 (the #6 page site-wide),
  //                     party pages 2.46 + party list 1.07, politicians 0.37
  //   Other     4.58% — Map alone, and it is the gateway into
  //                     /country/[code]/region/[id] and its sub-pages, the
  //                     ~20% traffic cluster that is the largest in the app
  //   Government 2.8% — legislature 2.24, executive 0.47, policy 0.12
  //   Economy   ~1.2% — central bank 0.68, economy 0.24, metrics 0.17,
  //                     budget 0.13
  const sections: NationDetailSection[] = [
    { title: "Politics", items: politics },
    // Map outranks every Government and Economy link and no longer sits last.
    // Its section title is still "Other", which undersells a top-five
    // destination — renaming or promoting it to a pinned link is a structural
    // change left for a separate decision.
    { title: "Other", items: [{ id: "map", label: "Map", href: config.mapPath }] },
    {
      title: "Government",
      items: [
        { id: "legislature", label: config.legislature.name, href: config.legislature.path },
        { id: "executive", label: config.executiveLabel, href: config.executivePath },
        { id: "policy", label: "Policy", href: policyUrl(countryId) },
        // SCOTUS is a US-only mechanic (#3581) — same country-literal
        // convention as the executive surface / CountryOverviewClient.
        ...(countryId === COUNTRY_CONFIGS.US.id
          ? [{ id: "scotus" as const, label: "Supreme Court", href: scotusUrl(countryId) }]
          : []),
      ],
    },
    // Economy collapses behind a click-to-expand header — it carries the most
    // links (and the Unions page when that feature is on).
    { title: "Economy", collapsible: true, items: economy },
  ];

  return sections.filter((s) => s.items.length > 0);
}
