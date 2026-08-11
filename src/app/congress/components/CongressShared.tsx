"use client";

import type { CountryId } from "@/lib/constants/countries";
import { PartyLogo } from "@/components/PartyLogo";
import { EmptyState as UIEmptyState } from "@/components/ui";
import { ensureReadableOnDark } from "@/lib/utils/politics";

export function PartyChip({
  partyName,
  partyColor,
  partyId,
  isVacant,
  logoUrl,
  countryId,
}: {
  partyName: string;
  partyColor: string;
  partyId?: string | null;
  isVacant?: boolean;
  logoUrl?: string | null;
  countryId?: CountryId | null;
}) {
  if (isVacant)
    return (
      <span className="rounded-full border border-card-border bg-card-elevated px-2 py-0.5 text-[10px] text-muted">
        Vacant
      </span>
    );
  const id = partyId ?? "independent";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        borderColor: partyColor + "60",
        backgroundColor: partyColor + "18",
        color: ensureReadableOnDark(partyColor),
      }}
    >
      <PartyLogo
        partyId={id}
        partyColor={partyColor}
        logoUrl={logoUrl}
        size="h-2 w-2"
        countryId={countryId}
      />
      {partyName}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    proposed: "bg-info/20 text-info",
    active: "bg-success/20 text-success",
    passed: "bg-success/20 text-success",
    failed: "bg-error/20 text-error",
    vetoed: "bg-warning/20 text-warning",
    open: "bg-warning/20 text-warning",
    voting: "bg-info/20 text-info",
    confirmed: "bg-success/20 text-success",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? "bg-card-elevated text-muted/80"}`}
    >
      {status}
    </span>
  );
}

const DocumentIcon = (
  <svg className="h-7 w-7 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-12">
      <UIEmptyState icon={DocumentIcon} title={title} description={body} action={cta} />
    </div>
  );
}

export function partyAbbrev(party: string | null | undefined, partyName?: string | null): string {
  if (!party) return "I";
  const name = partyName?.toLowerCase() ?? "";
  if (party === "republican" || name.includes("republican")) return "R";
  if (party === "democrat" || name.includes("democrat")) return "D";
  return "I";
}

/** Format (D-MA) or (D) for display next to names; never use full party name. */
export function formatPartyState(
  party: string | null | undefined,
  state?: string | null,
  partyName?: string | null
): string {
  const abbrev = partyAbbrev(party, partyName);
  if (state?.trim()) return `(${abbrev}-${state})`;
  return `(${abbrev})`;
}
