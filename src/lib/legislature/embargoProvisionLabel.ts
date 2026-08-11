import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { EmbargoProvision, EndEmbargoProvision } from "@/lib/db/types/legislation";

/**
 * Prefix a country name with "the" when convention calls for it ("the United
 * Kingdom", "the United States", "the Netherlands", "the Czech Republic") and
 * leave plain names ("Germany", "Japan") alone.
 */
export function withCountryArticle(name: string): string {
  return /\b(United|States|Kingdom|Republic|Netherlands|Philippines|Emirates|Bahamas|Gambia|Czechia)\b/.test(
    name
  )
    ? `the ${name}`
    : name;
}

export interface EmbargoProvisionLabel {
  /** Provision-kind heading. */
  kind: "Trade Embargo" | "Embargo Repeal";
  /** One-line action summary, e.g. "Block all goods traded with the United Kingdom". */
  summary: string;
  /** Supporting sentence explaining the mechanical effect. */
  description: string;
}

/**
 * Human-readable label parts for a durable trade-embargo bill provision. Shared
 * by the congress bill-detail enrichment and the country legislature bill list
 * so the two surfaces describe an embargo identically. Direction phrasing is
 * from the enacting country's perspective ("exported to" / "imported from"),
 * matching the clearing engine's `embargoMatches` semantics.
 */
export function formatEmbargoProvisionLabel(
  provision: EmbargoProvision | EndEmbargoProvision
): EmbargoProvisionLabel {
  const country = withCountryArticle(
    COUNTRY_CONFIGS[provision.targetCountry]?.name ?? provision.targetCountry
  );
  const goods = provision.commodity === "all" ? "all goods" : COMMODITY_LABELS[provision.commodity];
  const goodsLower =
    provision.commodity === "all"
      ? "all goods"
      : COMMODITY_LABELS[provision.commodity].toLowerCase();
  const dir =
    provision.direction === "export"
      ? `exported to ${country}`
      : provision.direction === "import"
        ? `imported from ${country}`
        : `traded with ${country}`;

  if (provision.type === "end_embargo") {
    return {
      kind: "Embargo Repeal",
      summary: `Lift embargo on ${goods} ${dir}`,
      description: `Repeals the matching legislated embargo, letting ${goodsLower} ${dir} flow freely again.`,
    };
  }

  if (provision.mode === "cap") {
    const capUnits = (provision.cap ?? 0).toLocaleString("en-US");
    return {
      kind: "Trade Embargo",
      summary: `Cap ${goods} ${dir} at ${capUnits} units`,
      description: `Limits ${goodsLower} ${dir} to ${capUnits} units per turn; any flow above the cap is cut.`,
    };
  }

  return {
    kind: "Trade Embargo",
    summary: `Block ${goods} ${dir}`,
    description: `Cuts off ${goodsLower} ${dir} entirely while this law is in force.`,
  };
}
