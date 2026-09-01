"use client";

import { useCallback, useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { WhippedBadge } from "@/components/bills/WhippedBadge";

type Stage = "house" | "senate" | "convicted" | "acquitted" | "dismissed" | "cancelled";

interface ImpeachmentDoc {
  _id: string;
  stage: Stage;
  targetName: string;
  filedByName: string;
  houseVotesFor: number;
  houseVotesAgainst: number;
  houseVotesAbstain: number;
  houseVotingEndsOnTurn: number;
  senateVotesFor: number;
  senateVotesAgainst: number;
  senateVotesAbstain: number;
  senateVotingEndsOnTurn: number | null;
  /** All-seats bar for the open stage: chamber size + ayes needed to pass. */
  chamber?: { seats: number; needed: number } | null;
  /**
   * The viewer's own pre-whip ballot when a hard Player Whip force-set their
   * vote on this case ("for" | "against" | "abstain" | "unvoted"), else null.
   */
  myWhippedFromOriginal?: string | null;
}

type Office = "president" | "governor";

interface Props {
  countryId: CountryId;
  /** Office being impeached. Defaults to president for backward compatibility. */
  office?: Office;
  /** President: the sitting president's characterId (used to find the case). */
  targetCharacterId?: string | null;
  targetName?: string | null;
  /** Governor: the state whose legislature tries the case. */
  state?: string;
  /** True when the viewer holds the office (hides the "File" affordance). */
  isViewerTarget: boolean;
}

const ACTIVE_STAGES: Stage[] = ["house", "senate"];

/**
 * Minimal impeachment surface on an executive page. Shows an in-progress case
 * (stage, live cached tally + vote buttons) or a "File Articles" affordance.
 * All eligibility is enforced server-side; the panel surfaces the resulting
 * error rather than pre-gating. Works for both the president (national two-
 * chamber) and a governor (single state-legislature vote).
 */
export default function ImpeachmentPanel({
  countryId,
  office = "president",
  targetCharacterId,
  targetName,
  state,
  isViewerTarget,
}: Props) {
  const isGovernor = office === "governor";
  const [active, setActive] = useState<ImpeachmentDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // President cases are keyed by the target's characterId; governor cases by
  // state + office (the client need not know the sitting governor's id).
  const hasTarget = isGovernor ? Boolean(state && targetName) : Boolean(targetCharacterId);

  const load = useCallback(async () => {
    if (!hasTarget) {
      setLoading(false);
      return;
    }
    try {
      const params = isGovernor
        ? `countryId=${countryId}&office=governor&state=${encodeURIComponent(state ?? "")}`
        : `countryId=${countryId}&targetCharacterId=${targetCharacterId}`;
      const res = await fetch(`/api/impeachments?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { impeachments: ImpeachmentDoc[] };
        setActive(data.impeachments.find((i) => ACTIVE_STAGES.includes(i.stage)) ?? null);
      }
    } catch {
      /* ignore — panel stays quiet on network error */
    } finally {
      setLoading(false);
    }
  }, [countryId, isGovernor, state, targetCharacterId, hasTarget]);

  useEffect(() => {
    void load();
  }, [load]);

  const file = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = isGovernor
        ? { countryId, office: "governor", state }
        : { countryId, targetCharacterId };
      const res = await fetch("/api/impeachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMessage(res.ok ? "Articles of impeachment filed." : (data.error ?? "Failed to file."));
      if (res.ok) await load();
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const vote = async (value: "aye" | "nay" | "abstain") => {
    if (!active) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/impeachments/${active._id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: value }),
      });
      const data = await res.json();
      setMessage(res.ok ? "Vote recorded." : (data.error ?? "Failed to vote."));
      if (res.ok) await load();
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  };

  if (!hasTarget || loading) return null;

  const officeLabel = isGovernor ? "Governor" : "president";
  // Governor cases run as a single conviction vote at the "senate" stage.
  const stageChip = active
    ? active.stage === "house"
      ? "House vote — impeach"
      : isGovernor
        ? "State legislature — convict"
        : "Senate trial — convict"
    : null;

  const votes =
    active && active.stage === "house"
      ? {
          for: active.houseVotesFor,
          against: active.houseVotesAgainst,
          abstain: active.houseVotesAbstain,
        }
      : active
        ? {
            for: active.senateVotesFor,
            against: active.senateVotesAgainst,
            abstain: active.senateVotesAbstain,
          }
        : null;

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-foreground">Impeachment</h2>
        {stageChip && (
          <span className="text-[11px] rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning font-semibold uppercase tracking-wide">
            {stageChip}
          </span>
        )}
      </div>

      {!active ? (
        <div className="mt-3">
          <p className="text-xs text-muted">
            No impeachment is in progress against {targetName ?? `the ${officeLabel}`}.
          </p>
          {!isViewerTarget && (
            <button
              type="button"
              onClick={file}
              disabled={busy}
              className="mt-3 rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/20 disabled:opacity-50 transition-colors"
            >
              File Articles of Impeachment
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted">
            {active.stage === "house"
              ? "The lower chamber is voting on articles of impeachment. Passage needs a majority of ALL seats, not just votes cast."
              : isGovernor
                ? "The state legislature is voting on conviction. Removal needs two-thirds of ALL seats, not just votes cast."
                : "The upper chamber is voting on conviction. Removal needs two-thirds of ALL seats, not just votes cast."}{" "}
            Abstentions and seats that never vote count against passage.
          </p>
          {votes && (
            <div className="flex gap-4 text-sm">
              <Tally label="For" value={votes.for} tone="success" />
              <Tally label="Against" value={votes.against} tone="error" />
              <Tally label="Abstain" value={votes.abstain} tone="muted" />
            </div>
          )}
          {active.chamber && (
            <div className="text-xs text-muted">
              <span className="font-semibold text-foreground">
                {active.chamber.needed} of {active.chamber.seats} seats
              </span>{" "}
              needed to {active.stage === "house" ? "impeach" : "convict"}. Currently{" "}
              {votes?.for ?? 0} aye.
            </div>
          )}
          {active.myWhippedFromOriginal && (
            <div>
              <WhippedBadge
                originalVote={active.myWhippedFromOriginal}
                originalLabel={
                  active.myWhippedFromOriginal === "for"
                    ? "AYE"
                    : active.myWhippedFromOriginal === "against"
                      ? "NAY"
                      : active.myWhippedFromOriginal === "abstain"
                        ? "ABSTAIN"
                        : "no prior vote"
                }
                onRevert={async (v) => {
                  if (v === "for") await vote("aye");
                  else if (v === "against") await vote("nay");
                  else if (v === "abstain") await vote("abstain");
                }}
              />
            </div>
          )}
          <div className="flex gap-2">
            {(["aye", "nay", "abstain"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => vote(v)}
                disabled={busy}
                className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 transition-colors"
              >
                {v === "aye" ? "Aye" : v === "nay" ? "Nay" : "Abstain"}
              </button>
            ))}
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-xs text-muted">{message}</p>}
    </section>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "error" | "muted";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "error" ? "text-error" : "text-muted";
  return (
    <div className="text-center">
      <div className={`text-base font-bold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
