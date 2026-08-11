import type { PolicyRecordResponse } from "@/lib/policy/types";

/** Client-side shapes of GET /api/country/[code]/policy/record. */
export interface RecordTimelinePoint {
  enactedAt: string;
  enactedYear: number;
  economicAvg: number | null;
  socialAvg: number | null;
}

export interface RecordEvent {
  typeKey: string;
  title: string;
  enactedAt: string;
  enactedYear: number;
  economic: number | null;
  social: number | null;
  economicBefore: number | null;
  economicAfter: number | null;
  socialBefore: number | null;
  socialAfter: number | null;
}

export interface RecordPayload {
  points: RecordTimelinePoint[];
  events: RecordEvent[];
  era: { label: string; sinceDate: string | null; sinceTurn: number | null } | null;
  provenance: Record<
    string,
    { title: string; enactedAt: string; enactedYear: number; annualCost: number | null }
  >;
}

export const DOMAIN_LABELS: Record<string, string> = {
  agriculture: "Agriculture",
  defense: "Defense",
  economic: "Economic",
  education: "Education",
  environment: "Environment",
  foreign_policy: "Foreign Policy",
  governance: "Governance",
  healthcare: "Healthcare",
  immigration: "Immigration",
  infrastructure: "Infrastructure",
  law_justice: "Law & Justice",
  mediaInformation: "Media & Information",
  publicSafety: "Public Safety",
  social: "Social",
  tax: "Taxation",
  technology: "Technology",
  trade: "Trade & Tariffs",
};

export const DOMAIN_ORDER = [
  "tax",
  "economic",
  "education",
  "environment",
  "governance",
  "healthcare",
  "infrastructure",
  "defense",
  "foreign_policy",
  "immigration",
  "mediaInformation",
  "law_justice",
  "publicSafety",
  "social",
  "agriculture",
  "technology",
  "trade",
];

export function getDomainLabel(domain: string): string {
  const explicitLabel = DOMAIN_LABELS[domain];
  if (explicitLabel) return explicitLabel;

  return domain
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function groupByDomain(
  records: PolicyRecordResponse[]
): Map<string, PolicyRecordResponse[]> {
  const grouped = new Map<string, PolicyRecordResponse[]>();
  for (const record of records) {
    const domain = record.policyDomain || "governance";
    const list = grouped.get(domain) ?? [];
    list.push(record);
    grouped.set(domain, list);
  }
  const ordered = new Map<string, PolicyRecordResponse[]>();
  for (const domain of DOMAIN_ORDER) {
    const list = grouped.get(domain);
    if (list?.length) ordered.set(domain, list);
  }
  for (const [domain, list] of grouped) {
    if (!ordered.has(domain)) ordered.set(domain, list);
  }
  return ordered;
}

/** The lean a domain (or law) is summarized by: the axis with the larger |value| (econ on ties). */
export function dominantAxis(
  economic: number | null,
  social: number | null
): { axis: "economic" | "social"; value: number } | null {
  if (economic === null && social === null) return null;
  if (social !== null && (economic === null || Math.abs(social) > Math.abs(economic))) {
    return { axis: "social", value: social };
  }
  return { axis: "economic", value: economic! };
}

const ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function romanNumeral(index: number): string {
  return ROMANS[index] ?? `${index + 1}`;
}

export function formatEnactedStamp(enactedYear: number, enactedAt: string): string {
  const date = new Date(enactedAt);
  if (Number.isNaN(date.getTime())) return String(enactedYear);
  return `${enactedYear} · ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
