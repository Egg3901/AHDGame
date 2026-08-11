import { POLICY_INTEGER_AXIS_RANGE } from "@/lib/utils/politics";

/**
 * National Ideology axes — SSOT for the "Social Axis" / "Economic Axis"
 * figures on the country lander and National Policy mastheads.
 *
 * Semantics (locked at design review, 2026-06-11):
 * - Equal weight: every implemented national law is one vote.
 * - Explicit values count, including 0 (a genuinely centrist law pulls the
 *   average toward center); a record missing an axis (`has*` false) is
 *   excluded from that axis only — mirrors the policy API's
 *   `hasEconomic`/`hasSocial` flags.
 * - Tariff and subsidy records never contribute.
 * - Display goes through the existing PositionLabel / bucket utilities.
 */

/** Minimal shape of a national policy row as served by the policy API. */
export interface AxisInputRecord {
  /** Optional to match PolicyRecordResponse — an untagged record is a policy record. */
  recordType?: "policy" | "tariff" | "subsidy";
  economic: number;
  social: number;
  hasEconomic: boolean;
  hasSocial: boolean;
  /** Domain key for per-domain grouping; the policy page falls back to governance. */
  policyDomain?: string;
}

export interface NationalAxes {
  /** Equal-weight mean of laws carrying the axis, clamped to ±5; null when none. */
  economic: number | null;
  social: number | null;
  /** Policy records contributing to at least one axis. */
  lawCount: number;
  economicCount: number;
  socialCount: number;
}

const clamp = (value: number) =>
  Math.max(-POLICY_INTEGER_AXIS_RANGE, Math.min(POLICY_INTEGER_AXIS_RANGE, value));

export function computeNationalAxes(records: readonly AxisInputRecord[]): NationalAxes {
  let econSum = 0;
  let econCount = 0;
  let socSum = 0;
  let socCount = 0;
  let lawCount = 0;
  for (const record of records) {
    if ((record.recordType ?? "policy") !== "policy") continue;
    if (!record.hasEconomic && !record.hasSocial) continue;
    lawCount += 1;
    if (record.hasEconomic) {
      econSum += record.economic;
      econCount += 1;
    }
    if (record.hasSocial) {
      socSum += record.social;
      socCount += 1;
    }
  }
  return {
    economic: econCount ? clamp(econSum / econCount) : null,
    social: socCount ? clamp(socSum / socCount) : null,
    lawCount,
    economicCount: econCount,
    socialCount: socCount,
  };
}

/** Matches the policy page's groupByDomain fallback. */
const FALLBACK_DOMAIN = "governance";

/**
 * Per-domain axes for the National Policy titles rail and domain mini-ticks.
 * Same per-record rules as computeNationalAxes; a domain whose records carry
 * no axes still appears (with per-axis nulls) so the UI can render its muted
 * "no axis positions" track instead of dropping the row.
 */
export function computeDomainAxes(records: readonly AxisInputRecord[]): Map<string, NationalAxes> {
  const grouped = new Map<string, AxisInputRecord[]>();
  for (const record of records) {
    const domain = record.policyDomain || FALLBACK_DOMAIN;
    const list = grouped.get(domain) ?? [];
    list.push(record);
    grouped.set(domain, list);
  }
  const out = new Map<string, NationalAxes>();
  for (const [domain, list] of grouped) {
    out.set(domain, computeNationalAxes(list));
  }
  return out;
}
