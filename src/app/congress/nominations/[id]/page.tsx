"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { NominationPageErrorBoundary } from "@/components/NominationPageErrorBoundary";
import { NominationDetailSkeleton } from "./components/NominationDetailSkeleton";
import { WhippedBadge } from "@/components/bills/WhippedBadge";
import { useCountdown } from "@/hooks/useCountdown";
import { LocalTime } from "@/components/time/LocalTime";

import type { CountryId } from "@/lib/constants/countries";

interface NominationDetail {
  id: string;
  countryId: CountryId;
  positionName: string;
  nomineeCharacterId: string;
  nomineeSequentialId?: number;
  nomineeCharacterName: string;
  nomineeParty?: string;
  proposedByPresidentName?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  proposedAt: string;
  myVote: "for" | "against" | "abstain" | null;
  myWhippedFrom: string | null;
  isSenator: boolean;
}

function NominationDetailContent() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : undefined;
  const [nom, setNom] = useState<NominationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voting, setVoting] = useState(false);

  const fetchNom = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/congress/cabinet-nominations/${id}`);
      if (!res.ok) {
        setError("Nomination not found.");
        return;
      }
      setNom(await res.json());
    } catch {
      setError("Failed to load nomination.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchNom();
  }, [fetchNom]);

  const countdown = useCountdown(nom?.status === "active" ? (nom.votingEndsAt ?? null) : null);

  if (!id) {
    return <NominationDetailSkeleton />;
  }

  async function handleVote(vote: "for" | "against" | "abstain") {
    setError("");
    setVoting(true);
    try {
      const res = await fetch(`/api/whitehouse/cabinet/nominations/${id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Failed to vote");
        return;
      }
      fetchNom();
    } finally {
      setVoting(false);
    }
  }

  if (loading) {
    return <NominationDetailSkeleton />;
  }

  if (error && !nom) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12 gap-4">
        <p className="text-error text-sm">{error}</p>
        <Link
          href="/congress?chamber=senate&tab=bills"
          className="text-sm text-primary hover:underline"
        >
          ← Back to Senate Bills
        </Link>
      </div>
    );
  }

  if (!nom) return null;

  const vFor = nom.votesFor ?? 0;
  const vAgainst = nom.votesAgainst ?? 0;
  const vAbs = nom.votesAbstain ?? 0;
  const total = vFor + vAgainst + vAbs || 1;
  const pctFor = (vFor / total) * 100;
  const pctAgainst = (vAgainst / total) * 100;
  const pctAbstain = (vAbs / total) * 100;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
        <Link
          href="/congress?chamber=senate&tab=bills"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back to Senate
        </Link>

        <div className="rounded-xl border border-card-border bg-card shadow-panel p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {nom.status === "active" ? (
              <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-400">
                Voting Open
              </span>
            ) : nom.status === "confirmed" ? (
              <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                Confirmed
              </span>
            ) : nom.status === "rejected" ? (
              <span className="rounded-full border border-error/30 bg-error/10 px-3 py-1 text-xs font-semibold text-error">
                Rejected
              </span>
            ) : (
              <span className="rounded-full border border-card-border px-3 py-1 text-xs text-muted capitalize">
                {nom.status}
              </span>
            )}
            <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] text-muted">
              Senate · Cabinet Nomination
            </span>
          </div>

          <h1 className="text-2xl font-bold leading-tight">
            {nom.nomineeCharacterName ?? "Unknown"} → {nom.positionName ?? "Cabinet"}
          </h1>

          <p className="text-sm text-muted leading-relaxed">
            Cabinet nomination · Senate confirmation required. Simple majority within 24 hours.
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted pt-1 border-t border-card-border/40">
            <span>
              Nominated by{" "}
              <span className="font-medium">{nom.proposedByPresidentName ?? "President"}</span>
            </span>
            <span>
              Proposed{" "}
              {nom.proposedAt ? (
                <LocalTime value={nom.proposedAt} options={{ dateStyle: "medium" }} />
              ) : (
                "—"
              )}
            </span>
            {nom.nomineeParty && <span className="capitalize">{nom.nomineeParty}</span>}
          </div>

          {nom.nomineeCharacterId && (
            <Link
              href={`/character/${nom.nomineeSequentialId ?? nom.nomineeCharacterId}`}
              className="inline-block text-sm text-primary hover:underline"
            >
              View nominee profile →
            </Link>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-error/10 border border-error/30 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* Vote bar — same style as bill detail */}
        <div className="rounded-xl border border-card-border bg-card shadow-panel p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold">Senate Vote</h3>
            {nom.votingEndsAt && nom.status === "active" && (
              <span
                className={`text-xs tabular-nums font-mono ${countdown === "Expired" ? "text-error" : "text-yellow-400"}`}
              >
                ⏱ {countdown}
              </span>
            )}
          </div>

          <div className="flex h-3 w-full overflow-hidden rounded-full bg-card-border gap-px">
            <div
              style={{
                width: `${Number.isFinite(pctFor) ? pctFor : 0}%`,
                backgroundColor: "#22c55e",
              }}
              className="transition-all"
            />
            <div
              style={{
                width: `${Number.isFinite(pctAgainst) ? pctAgainst : 0}%`,
                backgroundColor: "#ef4444",
              }}
              className="transition-all"
            />
            <div
              style={{
                width: `${Number.isFinite(pctAbstain) ? pctAbstain : 0}%`,
                backgroundColor: "#6b7280",
              }}
              className="transition-all"
            />
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            <span className="text-success">
              ✓ {vFor} For ({Number.isFinite(pctFor) ? pctFor.toFixed(0) : 0}%)
            </span>
            <span className="text-error">
              ✗ {vAgainst} Against ({Number.isFinite(pctAgainst) ? pctAgainst.toFixed(0) : 0}%)
            </span>
            {vAbs > 0 && <span className="text-muted">– {vAbs} Abstain</span>}
          </div>

          {nom.myVote && (
            <p className="text-xs text-muted">
              Your vote:{" "}
              <span
                className={`font-semibold ${nom.myVote === "for" ? "text-success" : nom.myVote === "against" ? "text-error" : "text-muted"}`}
              >
                {nom.myVote}
              </span>
              {nom.isSenator && <span className="ml-2 text-muted/60">(click below to change)</span>}
            </p>
          )}

          {nom.myWhippedFrom && nom.isSenator && nom.status === "active" && (
            <WhippedBadge
              originalVote={nom.myWhippedFrom}
              onRevert={async (v) => {
                if (v === "unvoted") return;
                await handleVote(v as "for" | "against" | "abstain");
              }}
            />
          )}

          {nom.isSenator && nom.status === "active" && (
            <div className="flex gap-2 pt-1">
              {(["for", "against", "abstain"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => handleVote(v)}
                  disabled={voting}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors capitalize min-h-[44px] touch-manipulation ${
                    nom.myVote === v
                      ? v === "for"
                        ? "border-success/50 bg-success/20 text-success"
                        : v === "against"
                          ? "border-error/50 bg-error/20 text-error"
                          : "border-card-border bg-card-elevated text-muted"
                      : "border-card-border bg-card text-muted hover:text-foreground hover:border-foreground/20 disabled:opacity-50"
                  }`}
                >
                  {v === "for" ? "✓ For" : v === "against" ? "✗ Against" : "– Abstain"}
                </button>
              ))}
            </div>
          )}

          {!nom.isSenator && (
            <p className="text-xs text-muted pt-1">
              Only Senators can vote on cabinet nominations.
            </p>
          )}
        </div>

        <Link
          href={`/country/${nom.countryId.toLowerCase()}/executive/cabinet`}
          className="inline-block text-sm text-primary hover:underline"
        >
          View full Cabinet →
        </Link>
      </main>
    </div>
  );
}

export default function NominationDetailPage() {
  return (
    <NominationPageErrorBoundary>
      <NominationDetailContent />
    </NominationPageErrorBoundary>
  );
}
