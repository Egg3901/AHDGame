"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { CountryId } from "@/lib/constants/countries";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { getCabinetActionCopy } from "./actionCopy";
import { Chop, Badge } from "./dossier";
import { CabinetTabBar } from "./CabinetTabBar";
import type { CabinetTab, CabinetTabId } from "../cabinetTabs";

interface Member {
  characterId: string;
  sequentialId?: number | null;
  characterName: string;
  avatarUrl?: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  party: string | null;
  partyName?: string | null;
  partyColor?: string | null;
  partyLogoUrl?: string | null;
  ministerialActions: number;
  bannerImageUrl: string | null;
}

interface Props {
  positionName: string;
  department: string;
  sealImage?: string | null;
  countryId?: CountryId;
  member: Member | null;
  bannerImageUrl?: string | null;
  bannerOverlay?: ReactNode;
  identityGlyph: string;
  identitySerif: "cjk" | "mono";
  group?: string;
  registry?: string;
  tabs: CabinetTab[];
  activeTab: CabinetTabId;
  onSelectTab: (id: CabinetTabId) => void;
  statStrip: ReactNode;
}

export function CabinetOfficeLayout({
  positionName,
  department,
  sealImage,
  countryId,
  member,
  bannerImageUrl,
  bannerOverlay,
  identityGlyph,
  identitySerif,
  group,
  registry,
  tabs,
  activeTab,
  onSelectTab,
  statStrip,
}: Props) {
  const hasBanner = Boolean(bannerImageUrl);
  const actionsRemaining = member?.ministerialActions ?? 0;
  const actionCopy = countryId ? getCabinetActionCopy(countryId) : null;

  return (
    <header className="relative overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--gov)_25%,transparent)] bg-card shadow-lg gov-glow">
      <div className="masthead relative px-5 pb-0 pt-5 sm:px-7 sm:pt-6">
        {/* uploaded banner photo, faint under the gradient */}
        {hasBanner && (
          <Image
            src={bannerImageUrl as string}
            alt=""
            fill
            className="object-cover object-center opacity-25"
            sizes="(max-width: 1280px) 100vw, 1280px"
            priority
            unoptimized={bypassNextImageOptimization(bannerImageUrl as string)}
          />
        )}
        {/* giant faded country glyph */}
        <div
          className="pointer-events-none absolute -right-4 -top-12 select-none font-black"
          style={{
            fontSize: 200,
            lineHeight: 1,
            color: "color-mix(in srgb, var(--gov-soft) 6%, transparent)",
            fontFamily:
              identitySerif === "cjk"
                ? "var(--font-dossier-cjk), serif"
                : "var(--font-dossier-serif), serif",
          }}
          aria-hidden
        >
          {identityGlyph}
        </div>

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <Chop glyph={identityGlyph} serif={identitySerif} sealImage={sealImage} size={76} />
          <div className="min-w-0 flex-1">
            {registry && (
              <div className="dossier-label whitespace-nowrap text-gov-soft/80">{registry}</div>
            )}
            <h1
              className={`mt-1.5 text-[22px] font-bold leading-[1.1] tracking-tight text-white sm:text-[26px] ${
                identitySerif === "cjk" ? "font-serif" : ""
              }`}
            >
              {positionName}
            </h1>
            <div className="mt-0.5 text-[13px] text-gov-soft/90">{department}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {member ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-2.5 py-1">
                  <Avatar
                    url={member.avatarUrl}
                    name={member.characterName}
                    size="h-6 w-6"
                    className="shrink-0 rounded-md"
                    borderKey={member.borderKey}
                    tintColor={member.tintColor}
                  />
                  <Link
                    href={`/character/${member.sequentialId ?? member.characterId}`}
                    className="text-xs font-medium text-white/90 hover:text-white"
                  >
                    {member.characterName}
                  </Link>
                  {member.partyName && member.partyColor && (
                    <PartyChip
                      partyName={member.partyName}
                      partyColor={member.partyColor}
                      partyId={member.party}
                      logoUrl={member.partyLogoUrl}
                      countryId={countryId}
                    />
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-warning/40 bg-black/30 px-2.5 py-1 text-xs font-semibold text-warning">
                  Vacant
                </span>
              )}
              {group && (
                <Badge
                  tone="gov"
                  className="!border-[color-mix(in_srgb,var(--gov)_40%,transparent)] !bg-[color-mix(in_srgb,var(--gov)_25%,transparent)] !text-white"
                >
                  {group}
                </Badge>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-xs font-medium text-white/80">
                <svg
                  className="h-3 w-3 text-gov-soft"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 1L3 5v6c0 5.25 3.75 10.2 9 11.25C17.25 21.2 21 16.25 21 11V5l-9-4z" />
                </svg>
                {actionsRemaining}/{MINISTERIAL_ACTION_CAP} {actionCopy?.title ?? "Actions"}
              </span>
            </div>
          </div>

          {/* No `relative` here on purpose: from `sm` up the overlay positions
              itself absolutely and must anchor to the masthead row, not to this
              wrapper — a positioned wrapper collapses to zero size and drops the
              button onto the tab bar. Below `sm` the overlay is a normal flow
              element, so it simply sits here at the end of the stacked header. */}
          {bannerOverlay && <div className="shrink-0">{bannerOverlay}</div>}
        </div>

        <div className="relative mt-4">
          <CabinetTabBar tabs={tabs} activeTab={activeTab} onSelect={onSelectTab} />
        </div>
      </div>

      <div className="gov-rule" />

      {statStrip}
    </header>
  );
}
