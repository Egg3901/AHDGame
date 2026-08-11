"use client";

import { useState } from "react";
import GovernmentVotePanel from "@/components/uk/GovernmentVotePanel";
import AppointPMModal from "@/components/uk/AppointPMModal";
import type {
  AppointmentVotePayload,
  NoConfidenceVotePayload,
} from "@/types/parliamentaryGovernment";

interface ParliamentaryGovernmentActionsProps {
  countryCode: string;
  governmentStatus: "pending" | "formed" | null;
  activeAppointmentVotes: AppointmentVotePayload[];
  activeNoConfidenceVote: NoConfidenceVotePayload | null;
  viewerMayAppoint: boolean;
  viewerIsCommonsMp: boolean;
  viewerMayProposeNoConfidence: boolean;
  noConfidenceCooldownTurns: number | null;
  viewerVotes: Record<string, "aye" | "nay">;
  viewerWhippedFrom?: Record<string, string>;
  executiveTitle?: string;
  memberLabel?: string;
  /**
   * Legislature-appointed ceremonial head of state (RU Chairman of the
   * Presidium — headOfStateSelection "legislatureAppointment"). When set and
   * the office is vacant, eligible chairs see a nominate CTA posting to
   * /api/country/[code]/hos/appoint. Vote panels for hos votes arrive through
   * `activeAppointmentVotes` like PM votes (same collection + vote route).
   */
  hosNomination?: {
    title: string;
    viewerMayNominate: boolean;
    vacant: boolean;
  };
  /**
   * Whether the viewer holds a seat in EITHER chamber — head-of-state votes
   * are a joint sitting, so upper-chamber deputies may vote on them (but not
   * on PM votes). Defaults to viewerIsCommonsMp.
   */
  viewerIsJointDeputy?: boolean;
}

/**
 * Client wrapper for interactive parliamentary government formation actions.
 * Handles Appoint PM modal, multiple GovernmentVotePanels, and no-confidence proposal.
 * Used by all parliamentary executive hubs (UK, JP, DE).
 */
export function ParliamentaryGovernmentActions({
  countryCode,
  governmentStatus,
  activeAppointmentVotes,
  activeNoConfidenceVote,
  viewerMayAppoint,
  viewerIsCommonsMp,
  viewerMayProposeNoConfidence,
  noConfidenceCooldownTurns,
  viewerVotes,
  viewerWhippedFrom,
  executiveTitle = "Prime Minister",
  memberLabel = "MP",
  hosNomination,
  viewerIsJointDeputy,
}: ParliamentaryGovernmentActionsProps) {
  const [appointModalOpen, setAppointModalOpen] = useState(false);
  const [hosModalOpen, setHosModalOpen] = useState(false);
  const [noConfirmOpen, setNoConfirmOpen] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const handleSuccess = () => {
    setAppointModalOpen(false);
    window.location.reload();
  };

  async function handleProposeNoConfidence() {
    setProposing(true);
    setNoConfirmOpen(false);
    setProposeError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/pm/no-confidence`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setProposeError(data.error ?? "Failed to propose no-confidence motion.");
      } else {
        window.location.reload();
      }
    } catch {
      setProposeError("Network error. Please try again.");
    } finally {
      setProposing(false);
    }
  }

  return (
    <>
      {/* Appoint PM button when government is pending and viewer is eligible */}
      {governmentStatus === "pending" && viewerMayAppoint && (
        <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Government pending formation</p>
            <p className="text-xs text-muted">
              As party or coalition chair, you may nominate a {executiveTitle}.
            </p>
          </div>
          <button
            onClick={() => setAppointModalOpen(true)}
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Appoint {executiveTitle}
          </button>
        </div>
      )}

      {/* Head-of-state nomination when the ceremonial office is vacant (RU
          Chairman of the Presidium — legislatureAppointment countries). */}
      {hosNomination?.vacant && hosNomination.viewerMayNominate && (
        <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              The office of {hosNomination.title} is vacant
            </p>
            <p className="text-xs text-muted">
              As party or coalition chair, you may nominate a {hosNomination.title} for election by
              the legislature.
            </p>
          </div>
          <button
            onClick={() => setHosModalOpen(true)}
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Nominate {hosNomination.title}
          </button>
        </div>
      )}

      {/* No-confidence button when government is formed and viewer is an MP */}
      {governmentStatus === "formed" && viewerIsCommonsMp && !activeNoConfidenceVote && (
        <div className="flex items-center justify-between rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Propose a no-confidence motion</p>
            <p className="text-xs text-muted">
              {noConfidenceCooldownTurns && noConfidenceCooldownTurns > 0
                ? `Cooldown: ${noConfidenceCooldownTurns} turn${noConfidenceCooldownTurns === 1 ? "" : "s"} remaining`
                : `As an elected ${memberLabel} you may challenge the sitting ${executiveTitle}.`}
            </p>
            {proposeError && <p className="text-xs text-destructive mt-1">{proposeError}</p>}
          </div>
          {noConfidenceCooldownTurns && noConfidenceCooldownTurns > 0 ? (
            <button
              disabled
              title={`No-confidence cooldown: ${noConfidenceCooldownTurns} turn${noConfidenceCooldownTurns === 1 ? "" : "s"} remaining`}
              className="shrink-0 rounded-lg border border-warning/20 bg-warning/5 px-4 py-2 text-sm font-semibold text-warning/40 cursor-not-allowed opacity-50"
            >
              Propose No-Confidence
            </button>
          ) : noConfirmOpen ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-warning">Are you sure?</span>
              <button
                onClick={handleProposeNoConfidence}
                disabled={proposing || !viewerMayProposeNoConfidence}
                className="rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-black hover:bg-warning/90 disabled:opacity-50 transition-colors"
              >
                {proposing ? "Proposing…" : "Confirm"}
              </button>
              <button
                onClick={() => setNoConfirmOpen(false)}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNoConfirmOpen(true)}
              disabled={!viewerMayProposeNoConfidence}
              className="shrink-0 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning hover:bg-warning/20 disabled:opacity-50 transition-colors"
            >
              Propose No-Confidence
            </button>
          )}
        </div>
      )}

      {/* Active appointment vote panels (multiple). Head-of-state votes are a
          joint sitting — either chamber's deputies may vote. */}
      {activeAppointmentVotes.map((vote) => (
        <GovernmentVotePanel
          key={vote._id}
          vote={vote}
          countryCode={countryCode}
          canVote={
            vote.office === "headOfState"
              ? (viewerIsJointDeputy ?? viewerIsCommonsMp)
              : viewerIsCommonsMp
          }
          viewerVote={viewerVotes[vote._id] ?? null}
          myWhippedFrom={viewerWhippedFrom?.[vote._id] ?? null}
          onVoteCast={() => window.location.reload()}
        />
      ))}

      {/* Active no-confidence vote panel (single) */}
      {activeNoConfidenceVote && (
        <GovernmentVotePanel
          vote={activeNoConfidenceVote}
          countryCode={countryCode}
          canVote={viewerIsCommonsMp}
          viewerVote={viewerVotes[activeNoConfidenceVote._id] ?? null}
          myWhippedFrom={viewerWhippedFrom?.[activeNoConfidenceVote._id] ?? null}
          onVoteCast={() => window.location.reload()}
        />
      )}

      <AppointPMModal
        countryCode={countryCode}
        open={appointModalOpen}
        onClose={() => setAppointModalOpen(false)}
        onSuccess={handleSuccess}
      />

      {hosNomination && (
        <AppointPMModal
          countryCode={countryCode}
          open={hosModalOpen}
          onClose={() => setHosModalOpen(false)}
          onSuccess={() => {
            setHosModalOpen(false);
            window.location.reload();
          }}
          executiveTitle={hosNomination.title}
          endpointPath="hos/appoint"
        />
      )}
    </>
  );
}
