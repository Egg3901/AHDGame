"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import type { ReferendumKind, ReferendumStatus } from "@/lib/db/types/referendum";

/** Server-serialized summary of a region's current/most-recent referendum. */
export interface ReferendumSummary {
  id: string;
  status: ReferendumStatus;
  kind: ReferendumKind;
  yesShare: number;
  campaignCloseTurn: number | null;
  cooldownReadyAtTurn: number | null;
}

export interface ReferendumPanelData {
  referendum: ReferendumSummary | null;
  eligible: boolean;
  eligibilityReason?: string;
}

interface Props {
  countryId: CountryId;
  stateId: string;
  currentTurn: number;
  viewerCanManage: boolean;
  data: ReferendumPanelData;
}

function kindNoun(stateId: string): string {
  return stateId.toUpperCase() === "NIR" ? "Reunification" : "Independence";
}

/** "in N turns" suffix, or empty when the target turn has passed/absent. */
function inTurns(targetTurn: number | null, currentTurn: number): string {
  if (targetTurn == null) return "";
  const remaining = targetTurn - currentTurn;
  return remaining > 0 ? ` (in ${remaining} ${remaining === 1 ? "turn" : "turns"})` : "";
}

/** One-line human status for an in-flight or terminal referendum. */
function statusLine(ref: ReferendumSummary, currentTurn: number): string {
  switch (ref.status) {
    case "requested":
      return "Requested — awaiting the Prime Minister to put it to the House of Commons.";
    case "granted":
    case "campaigning":
      return ref.campaignCloseTurn != null
        ? `Campaign under way — the vote is held on turn ${ref.campaignCloseTurn}${inTurns(
            ref.campaignCloseTurn,
            currentTurn
          )}.`
        : "Campaign under way.";
    case "polling":
      return "The ballots are being counted.";
    case "actuating":
      return "Carried at the ballot box — the conversion is under way.";
    case "declined":
      return "Westminster declined the referendum.";
    case "settled":
      return "The referendum was defeated.";
    case "cancelled":
      return "The conversion was blocked.";
    case "completed":
      return "The referendum has concluded.";
    default:
      return "";
  }
}

export function ReferendumPanel({ countryId, stateId, currentTurn, viewerCanManage, data }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noun = kindNoun(stateId);
  const ref = data.referendum;
  const showCampaignBar = ref?.status === "granted" || ref?.status === "campaigning";

  // An in-flight referendum blocks a new request; a terminal one (declined /
  // settled / cancelled / completed) does not, so the request controls reappear
  // once it resolves — gated by the server-computed eligibility (cooldown + desire).
  const ACTIVE_STATUSES: ReferendumStatus[] = [
    "requested",
    "granted",
    "campaigning",
    "polling",
    "actuating",
  ];
  const hasActiveReferendum = ref != null && ACTIVE_STATUSES.includes(ref.status);
  const cooldownTurnsLeft =
    ref?.cooldownReadyAtTurn != null && ref.cooldownReadyAtTurn > currentTurn
      ? ref.cooldownReadyAtTurn - currentTurn
      : 0;

  async function handleRequest() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/referendum`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Failed to request a referendum.");
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-base font-semibold">{noun} Referendum</h3>

      {ref && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted">{statusLine(ref, currentTurn)}</p>
          {showCampaignBar && (
            <div>
              <div className="flex justify-between text-xs text-muted">
                <span>Yes {Math.round(ref.yesShare)}%</span>
                <span>No {Math.round(100 - ref.yesShare)}%</span>
              </div>
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-background/60"
                role="progressbar"
                aria-valuenow={Math.round(ref.yesShare)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${noun} support`}
              >
                <div className="h-full bg-primary" style={{ width: `${ref.yesShare}%` }} />
              </div>
            </div>
          )}
          {cooldownTurnsLeft > 0 && (
            <p className="text-xs text-muted">
              Cooldown Remaining: {cooldownTurnsLeft} {cooldownTurnsLeft === 1 ? "turn" : "turns"}
            </p>
          )}
        </div>
      )}

      {!hasActiveReferendum && (
        <div className="mt-3 space-y-3">
          {!ref && (
            <p className="text-sm text-muted">
              With sufficient {noun.toLowerCase()} desire, the First Minister may formally request a
              referendum. The Prime Minister must then put it to the House of Commons.
            </p>
          )}
          {/* The cooldown line above already explains a cooldown block, so only
              surface other ineligibility reasons (e.g. insufficient desire) here. */}
          {!data.eligible && data.eligibilityReason && cooldownTurnsLeft === 0 && (
            <p className="text-xs text-amber-500">{data.eligibilityReason}</p>
          )}
          {error && (
            <div className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={handleRequest}
            disabled={!viewerCanManage || !data.eligible || submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Requesting…" : `Request ${noun} Referendum`}
          </button>
          {!viewerCanManage && (
            <p className="text-xs text-muted">Only the office-holder may request a referendum.</p>
          )}
        </div>
      )}
    </div>
  );
}
