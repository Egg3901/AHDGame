"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  approvalApiUrl,
  approvalUrl,
  countryElectionsUrl,
  executiveUrl,
  legislatureUrl,
} from "@/lib/urls";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { useImperialPossessive } from "@/hooks/useImperialPossessive";
import {
  InstitutionMasthead,
  MastheadChip,
  MastheadStat,
} from "@/components/national/InstitutionMasthead";
import { getExecutiveIdentity } from "@/lib/constants/institutionIdentity";
import { getExecutiveSeal } from "@/lib/constants/executiveSeals";

export type UKGovernmentHeroProps = {
  image: string;
  alt: string;
  title: string;
  tagline: string;
  breadcrumbLast: string;
};

export interface UKGovernmentLayoutProps {
  pmSummary: {
    name: string | null;
    profileHref: string | null;
    partyName: string | null;
    partyColor: string | null;
    partyId: string | null;
  };
  pluralityParty: {
    partyName: string;
    partyColor: string;
    partyId: string;
  } | null;
  commonsLine: {
    seatsSupporting: number;
    threshold: number;
    isMinority: boolean;
    isPending?: boolean;
    lostMajority?: boolean;
    formationType?: "majority" | "coalition" | "minority" | "admin";
  };
  statusText: string;
  /** Override hero for Downing Street hub (`/country/uk/executive`) */
  hero?: Partial<UKGovernmentHeroProps>;
  /** `hub` omits the self-link to `/country/uk/executive` */
  quickLinksMode?: "default" | "hub";
  /** Country override — defaults to UK for backwards compat */
  countryId?: CountryId;
  children: React.ReactNode;
}

export function UKGovernmentLayout({
  pmSummary,
  pluralityParty,
  commonsLine,
  statusText,
  hero: heroOverrides,
  quickLinksMode = "default",
  countryId: countryIdProp,
  children,
}: UKGovernmentLayoutProps) {
  const [approval, setApproval] = useState<number | null>(null);
  const [approvalModifiers, setApprovalModifiers] = useState<ActiveModifier[]>([]);
  const cid: CountryId = countryIdProp ?? COUNTRY_CONFIGS.UK.id;

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ governmentApproval?: number; modifiers?: ActiveModifier[] }>(approvalApiUrl(cid), {
      feature: "uk-government-approval",
    })
      .catch(() => null)
      .then((json) => {
        if (cancelled) return;
        if (typeof json?.governmentApproval === "number") setApproval(json.governmentApproval);
        if (Array.isArray(json?.modifiers)) setApprovalModifiers(json.modifiers);
      });
    return () => {
      cancelled = true;
    };
  }, [cid]);
  const imperialPossessive = useImperialPossessive(cid);
  const config = COUNTRY_CONFIGS[cid];
  const lowerChamberShort = config?.legislature?.lowerChamber?.shortName ?? "Commons";
  const legislatureName = config?.legislature?.name ?? "Parliament";
  const defaultHero = {
    image: "/api/images/hero/house-of-commons",
    alt: "House of Commons chamber",
    title: `${imperialPossessive} Government`,
    tagline: "Westminster executive, Commons confidence, and the composition of the House.",
    breadcrumbLast: "Government",
  };
  const hero = { ...defaultHero, ...heroOverrides };

  const statusLabel = (statusText ?? "").replace(/_/g, " ");
  const statusTone: "success" | "warning" =
    commonsLine.isPending || commonsLine.lostMajority || commonsLine.isMinority
      ? "warning"
      : "success";
  const seatsChip = commonsLine.isPending
    ? `— / ${commonsLine.threshold} ${lowerChamberShort}`
    : `${commonsLine.seatsSupporting} / ${commonsLine.threshold} ${lowerChamberShort}${
        commonsLine.isMinority
          ? " (minority)"
          : commonsLine.lostMajority
            ? " (lost majority)"
            : commonsLine.formationType === "coalition"
              ? " (coalition)"
              : ""
      }`;
  const identity = getExecutiveIdentity(cid);

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        {/* S photo hero fused with the B identity band (locked composite). */}
        <div className="mb-8">
          <InstitutionMasthead
            countryId={cid}
            identity={identity}
            sealImage={getExecutiveSeal(cid)}
            heroImage={{ src: hero.image, alt: hero.alt }}
            chips={
              <>
                <MastheadChip>
                  {config?.executiveTitle ?? "Prime Minister"}:{" "}
                  {pmSummary.name && pmSummary.profileHref ? (
                    <Link
                      href={pmSummary.profileHref}
                      className="underline-offset-2 hover:underline"
                    >
                      {pmSummary.name}
                    </Link>
                  ) : (
                    <span className="italic text-white/60">Vacant</span>
                  )}
                </MastheadChip>
                {pluralityParty && (
                  <MastheadChip>
                    <PartyChip
                      partyName={pluralityParty.partyName}
                      partyColor={pluralityParty.partyColor}
                      partyId={pluralityParty.partyId}
                      countryId={cid}
                    />
                  </MastheadChip>
                )}
                <MastheadChip tone="mono">{seatsChip}</MastheadChip>
                {statusLabel && <MastheadChip tone={statusTone}>{statusLabel}</MastheadChip>}
              </>
            }
            rightSlot={
              <MastheadStat
                label="Approval"
                value={
                  approval !== null ? (
                    <ApprovalTooltip
                      summary
                      approval={approval}
                      modifiers={approvalModifiers}
                      href={approvalUrl(cid)}
                    />
                  ) : (
                    "—"
                  )
                }
                accentSoft={identity.accentSoft}
              />
            }
          />
        </div>

        {/* Chamber composition charts live on the legislature pages — the
            masthead's seats chip carries the executive-relevant figure. */}
        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href={countryElectionsUrl(cid)}
            className="rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-body-sm font-medium text-foreground card-hover"
          >
            {lowerChamberShort} elections
          </Link>
          {quickLinksMode === "default" && (
            <Link
              href={executiveUrl(cid)}
              className="rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-body-sm font-medium text-foreground card-hover"
            >
              Executive
            </Link>
          )}
          <Link
            href={legislatureUrl(cid)}
            className="rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-body-sm font-medium text-foreground card-hover"
          >
            {legislatureName}
          </Link>
        </div>

        {children}
      </main>
    </div>
  );
}
