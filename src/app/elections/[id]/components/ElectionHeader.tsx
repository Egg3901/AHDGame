"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PhaseTag, electionPageTitle } from "./ElectionDetailHelpers";
import type { ElectionDetail } from "./ElectionDetailTypes";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "@/lib/countries/jp/data/jpShugiinConstituencies1994";

interface ElectionHeaderProps {
  election: ElectionDetail;
  electionYear: number | null;
  localInPrimary: boolean;
  localIsEnded: boolean;
  localIsUpcoming: boolean;
  canEnter: boolean;
  canWithdraw: boolean;
  actionLoading: boolean;
  onEnter: () => void;
  onWithdraw: () => void;
}

export function ElectionHeader({
  election,
  electionYear,
  localInPrimary,
  localIsEnded,
  localIsUpcoming,
  canEnter,
  canWithdraw,
  actionLoading,
  onEnter,
  onWithdraw,
}: ElectionHeaderProps) {
  const t = useTranslations("elections.huModernByElection");
  const titleText = electionPageTitle(election, electionYear);

  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center flex-wrap gap-3 mb-1">
          <h1 className="text-2xl font-bold sm:text-3xl">{titleText}</h1>
          <PhaseTag
            inPrimary={localInPrimary}
            isEnded={localIsEnded}
            isUpcoming={localIsUpcoming}
          />
        </div>
        {election.electionType === "president" && (
          <p className="text-sm text-muted">
            <Link
              href="/wiki/reference-offices"
              className="text-primary underline-offset-2 hover:underline"
            >
              What the presidency can do
            </Link>
            {" · "}
            <Link
              href="/guides/running-for-office"
              className="text-primary underline-offset-2 hover:underline"
            >
              How to run for president
            </Link>
          </p>
        )}
        {election.hungarianModernByElection && (
          <p className="text-sm text-muted">
            {t("description", { district: election.hungarianModernByElection.districtId })}
          </p>
        )}
        {election.japanShugiinRules?.ruleVersion === "mixed-1994-v1" && (
          <div className="mt-2 max-w-3xl text-sm text-muted">
            <p>
              This 500-seat chamber has {election.japanShugiinRules.districtSeats} district
              constituencies and {election.japanShugiinRules.listSeats} regional party-list seats.
              Constituency and list nominations are separate; a direct winner cannot take a second
              list seat.
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer font-medium">
                1994 statutory constituency map
              </summary>
              <ol className="mt-2 max-h-72 list-decimal space-y-1 overflow-y-auto pl-6">
                {JP_SHUGIIN_1994_CONSTITUENCIES.filter(
                  (district) => district.regionId === election.state
                ).map((district, index) => (
                  <li key={district.id}>
                    <span className="font-medium">
                      {index + 1}. {district.prefecture}
                    </span>{" "}
                    {district.statutoryBoundary}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        )}
      </div>
      {election.myCharId && !localIsEnded && (
        <div className="shrink-0">
          {canEnter && (
            <button
              onClick={onEnter}
              disabled={actionLoading}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {actionLoading ? "…" : "Enter Race"}
            </button>
          )}
          {canWithdraw && (
            <button
              onClick={onWithdraw}
              disabled={actionLoading}
              className="rounded-lg border border-error/50 bg-error/10 px-5 py-2.5 text-sm font-semibold text-error transition-colors hover:bg-error/20 disabled:opacity-50"
            >
              {actionLoading ? "…" : "Withdraw"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
