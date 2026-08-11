"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VetoMessageModal } from "./legislation/VetoMessageModal";
import { QueueBillModal, type EligibleNpp } from "./legislation/QueueBillModal";
import type { LegTypeOpt } from "./OrdersTab";
import { formatRealTimeCountdown } from "@/lib/utils/formatters";

export interface AwaitingAssentBill {
  _id: string;
  title: string;
  summary: string;
  sponsorId?: string | null;
  sponsorSequentialId?: number;
  sponsorName?: string;
  sponsorParty?: string | null;
  votesFor: number;
  votesAgainst: number;
}

export type LegislationActivity =
  | {
      kind: "pending";
      queueId: string;
      title: string;
      targetNppName: string;
      queuedAtTurn: number;
    }
  | {
      kind: "in_flight";
      billId: string;
      title: string;
      status: "active" | "passed" | "veto_override";
      votesFor: number;
      votesAgainst: number;
      votingEndsAt: string | null;
      overrideVotingEndsAt: string | null;
      overrideVotesFor: number;
      overrideVotesAgainst: number;
      sponsorName: string;
      targetNppName: string;
    }
  | null;

interface Props {
  countryId: string;
  stateId: string;
  awaitingAssentBills: AwaitingAssentBill[];
  /**
   * Holder OR authorized party officer of an NPP-held office. Gates all
   * Legislation actions (queue, cancel, sign, veto). Bill assent is delegated to
   * party officers per spec, so there is no separate holder-only gate here.
   */
  viewerCanManage: boolean;
  legislationActivity: LegislationActivity;
  eligibleNpps: EligibleNpp[];
  legislationTypes: LegTypeOpt[];
}

export function LegislationTab({
  countryId,
  stateId,
  awaitingAssentBills,
  viewerCanManage,
  legislationActivity,
  eligibleNpps,
}: Props) {
  const router = useRouter();
  const [vetoModalBillId, setVetoModalBillId] = useState<string | null>(null);
  const [signingBillId, setSigningBillId] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [cancellingQueue, setCancellingQueue] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  async function cancelQueueClick() {
    if (legislationActivity?.kind !== "pending" || !viewerCanManage) return;
    setCancellingQueue(true);
    setQueueError(null);
    const res = await fetch(
      `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/legislation/queue/${legislationActivity.queueId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setQueueError(data?.error ?? "Cancel failed.");
    } else {
      router.refresh();
    }
    setCancellingQueue(false);
  }

  async function sign(billId: string) {
    if (!viewerCanManage) return;
    setSigningBillId(billId);
    setSignError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/legislature/bills/${billId}/governor-action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "signed" }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSignError(data?.error ?? "Sign failed.");
      } else {
        router.refresh();
      }
    } finally {
      setSigningBillId(null);
    }
  }

  const modalBill = awaitingAssentBills.find((b) => b._id === vetoModalBillId);
  const slotOccupied = legislationActivity !== null;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Your queued bill</h2>
          {!slotOccupied && (
            <button
              onClick={() => setQueueModalOpen(true)}
              disabled={!viewerCanManage}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
              title={
                !viewerCanManage
                  ? "Office-holder only."
                  : eligibleNpps.length === 0
                    ? "No eligible NPPs in your party."
                    : ""
              }
            >
              + Queue a bill
            </button>
          )}
        </div>
        {queueError && <p className="text-sm text-error mb-2">{queueError}</p>}
        {legislationActivity ? (
          <ActivityRow
            activity={legislationActivity}
            countryId={countryId}
            stateId={stateId}
            viewerCanManage={viewerCanManage}
            cancellingQueue={cancellingQueue}
            onCancel={cancelQueueClick}
          />
        ) : (
          <p className="text-sm text-muted">No bill queued.</p>
        )}
      </section>

      <QueueBillModal
        open={queueModalOpen}
        countryId={countryId}
        stateId={stateId}
        eligibleNpps={eligibleNpps}
        onClose={() => setQueueModalOpen(false)}
        onSuccess={() => {
          setQueueModalOpen(false);
          router.refresh();
        }}
      />

      <section className="rounded-xl border border-card-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Awaiting your assent</h2>
        {signError && <p className="mb-3 text-sm text-error">{signError}</p>}
        {awaitingAssentBills.length === 0 ? (
          <p className="text-sm text-muted">No bills are currently awaiting your assent.</p>
        ) : (
          <ul className="space-y-3">
            {awaitingAssentBills.map((b) => (
              <li key={b._id} className="rounded-lg border border-card-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium truncate">{b.title}</h3>
                    <p className="text-xs text-muted mt-0.5">
                      Sponsored by{" "}
                      {b.sponsorId ? (
                        <Link
                          href={`/character/${b.sponsorSequentialId ?? b.sponsorId}`}
                          className="font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {b.sponsorName ?? "—"}
                        </Link>
                      ) : (
                        (b.sponsorName ?? "—")
                      )}
                      {b.sponsorParty ? ` (${b.sponsorParty})` : ""} · Passed {b.votesFor}-
                      {b.votesAgainst}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => sign(b._id)}
                      disabled={!viewerCanManage || signingBillId === b._id}
                      className="rounded-lg bg-success px-3 py-1.5 text-sm font-medium text-white hover:bg-success/80 disabled:opacity-50"
                    >
                      {signingBillId === b._id ? "Signing…" : "Sign"}
                    </button>
                    <button
                      onClick={() => setVetoModalBillId(b._id)}
                      disabled={!viewerCanManage}
                      className="rounded-lg border border-error/40 px-3 py-1.5 text-sm font-medium text-error hover:bg-error/10 disabled:opacity-50"
                    >
                      Veto…
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VetoMessageModal
        open={modalBill !== undefined}
        billTitle={modalBill?.title ?? ""}
        endpointUrl={`/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/legislature/bills/${modalBill?._id ?? ""}/governor-action`}
        onClose={() => setVetoModalBillId(null)}
        onSuccess={() => {
          setVetoModalBillId(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function ActivityRow({
  activity,
  countryId,
  stateId,
  viewerCanManage,
  cancellingQueue,
  onCancel,
}: {
  activity: NonNullable<LegislationActivity>;
  countryId: string;
  stateId: string;
  viewerCanManage: boolean;
  cancellingQueue: boolean;
  onCancel: () => void;
}) {
  const billHref =
    activity.kind === "in_flight"
      ? `/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/legislature/bills/${activity.billId}`
      : null;

  return (
    <div className="rounded-lg border border-card-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {billHref ? (
            <Link href={billHref} className="font-medium hover:underline">
              {activity.title}
            </Link>
          ) : (
            <div className="font-medium">{activity.title}</div>
          )}
          <p className="text-xs text-muted mt-1">
            → {activity.targetNppName}
            {activity.kind === "pending"
              ? ` introduces next turn (queued T+${activity.queuedAtTurn})`
              : " · in flight"}
          </p>
        </div>
        <StatusPill activity={activity} />
      </div>
      {activity.kind === "pending" && (
        <button
          onClick={onCancel}
          disabled={!viewerCanManage || cancellingQueue}
          className="mt-2 text-xs text-error hover:underline disabled:opacity-50"
        >
          {cancellingQueue ? "Cancelling…" : "Cancel & refund"}
        </button>
      )}
    </div>
  );
}

function StatusPill({ activity }: { activity: NonNullable<LegislationActivity> }) {
  if (activity.kind === "pending") {
    return (
      <span className="shrink-0 rounded-full bg-card-border/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Queued
      </span>
    );
  }
  if (activity.status === "active") {
    return (
      <div className="shrink-0 text-right">
        <span className="rounded-full bg-info/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info">
          Voting
        </span>
        <div className="mt-1 text-[11px] tabular-nums text-muted">
          {activity.votesFor}-{activity.votesAgainst}
          {activity.votingEndsAt && ` · ${formatVotingRemaining(activity.votingEndsAt)}`}
        </div>
      </div>
    );
  }
  if (activity.status === "passed") {
    return (
      <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
        Awaiting assent
      </span>
    );
  }
  // veto_override
  return (
    <div className="shrink-0 text-right">
      <span className="rounded-full bg-error/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-error">
        Override voting
      </span>
      <div className="mt-1 text-[11px] tabular-nums text-muted">
        {activity.overrideVotesFor}-{activity.overrideVotesAgainst}
        {activity.overrideVotingEndsAt &&
          ` · ${formatVotingRemaining(activity.overrideVotingEndsAt)}`}
      </div>
    </div>
  );
}

// Bill voting windows are real-clock — votingEndsAt is set via
// `new Date() + duration` (see proposeStateBill / proposeNationalBill) and
// the server-side vote-accept check (isVotingDeadlinePassed) uses
// `new Date()`. Display matches by routing through formatRealTimeCountdown.
function formatVotingRemaining(iso: string): string {
  const result = formatRealTimeCountdown(iso);
  if (result === "Ended") return "ending now";
  return `ends in ${result}`;
}
