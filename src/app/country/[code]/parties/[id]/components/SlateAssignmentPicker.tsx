"use client";

/**
 * The panel a chair opens to put a player or an NPP onto a race's slate.
 *
 * Split out of SlateTab so the tab stays within the architecture audit's file
 * size limit; the two are otherwise unchanged.
 */
import { useMemo, useState } from "react";
import { formatSlateCapNote, type SlateAssignmentUsage } from "@/lib/slateAssignmentCap";
import { getStateMap } from "./slate/stateMapData";
import { formatSlateLabel } from "./slateFormatting";
import type { PartyMember as PartyRosterMember } from "./types";

export function AssignmentPicker({
  countryCode,
  countryId,
  partyId,
  electionId,
  state,
  partyMembers,
  assignment,
  assignedCandidateIds,
  onDone,
}: {
  countryCode: string;
  countryId: string;
  partyId: string;
  electionId: string;
  state: string;
  partyMembers: PartyRosterMember[];
  /**
   * Absent only when the slate payload predates the cap, which a rolling
   * deploy can still serve to a freshly loaded tab. Assigning stays open in
   * that window and the route enforces the cap regardless.
   */
  assignment?: SlateAssignmentUsage;
  assignedCandidateIds: string[];
  onDone: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const assignedCandidateIdSet = useMemo(
    () => new Set(assignedCandidateIds),
    [assignedCandidateIds]
  );
  const sameStateNpps = useMemo(
    () => partyMembers.filter((member) => member.isNPP && member.homeState === state),
    [partyMembers, state]
  );
  const sameStatePlayers = useMemo(
    () => partyMembers.filter((member) => !member.isNPP && member.homeState === state),
    [partyMembers, state]
  );
  const eligiblePlayers = useMemo(
    () =>
      sameStatePlayers
        .filter((member) => !assignedCandidateIdSet.has(member.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [assignedCandidateIdSet, sameStatePlayers]
  );
  const eligibleNpps = useMemo(
    () =>
      sameStateNpps
        .filter((member) => !assignedCandidateIdSet.has(member.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [assignedCandidateIdSet, sameStateNpps]
  );
  const regionLabel = getStateMap(countryId)?.[state]?.name ?? state.replace(/^.+_/, "");
  const playersEmptyLabel =
    sameStatePlayers.length > 0
      ? `All same-party players based in ${regionLabel} are already slated to a race in this region. Withdraw an existing assignment to free one up.`
      : `No same-party players live in ${regionLabel}. Only candidates whose home is ${regionLabel} can be slated to this race.`;
  const nppsEmptyLabel =
    sameStateNpps.length > 0
      ? `All same-party NPPs based in ${regionLabel} are already slated to a race in this region. Withdraw an existing assignment to free one up.`
      : `No same-party NPPs live in ${regionLabel}. Only candidates whose home is ${regionLabel} can be slated to this race.`;

  const isFull = assignment ? assignment.remaining <= 0 : false;

  async function assign(candidateType: "character" | "npp", candidateId: string) {
    if (isFull) return;
    const pending = `${candidateType}:${candidateId}`;
    setPendingKey(pending);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/parties/${partyId}/slate/${electionId}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateType,
            candidateId,
            invitationNote: note.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Assignment failed (${res.status})`);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="rounded-lg border border-card-border bg-background p-3 space-y-2">
      {error && <p className="text-xs text-error">{error}</p>}
      <textarea
        rows={2}
        placeholder="Optional note shown on the slate row"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded-md border border-card-border bg-card px-2 py-1 text-xs"
      />
      {assignment && (
        <p className={`text-[11px] ${isFull ? "text-amber-300" : "text-muted"}`}>
          {formatSlateCapNote(assignment)}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <CandidateAssignmentList
          title="Players"
          emptyLabel={playersEmptyLabel}
          pendingKey={pendingKey}
          rows={eligiblePlayers.map((member) => ({
            key: `character:${member.id}`,
            id: member.id,
            type: "character" as const,
            name: member.name,
            officeLabel: member.currentOffice?.type ?? null,
          }))}
          onAssign={assign}
          disabled={isFull}
        />
        <CandidateAssignmentList
          title="NPPs"
          emptyLabel={nppsEmptyLabel}
          pendingKey={pendingKey}
          rows={eligibleNpps.map((member) => ({
            key: `npp:${member.id}`,
            id: member.id,
            type: "npp" as const,
            name: member.name,
            officeLabel: member.currentOffice?.type ?? null,
          }))}
          onAssign={assign}
          disabled={isFull}
        />
      </div>
    </div>
  );
}

function CandidateAssignmentList({
  title,
  emptyLabel,
  rows,
  pendingKey,
  onAssign,
  disabled = false,
}: {
  title: string;
  emptyLabel: string;
  rows: Array<{
    key: string;
    id: string;
    type: "character" | "npp";
    name: string;
    officeLabel: string | null;
  }>;
  pendingKey: string | null;
  onAssign: (candidateType: "character" | "npp", candidateId: string) => Promise<void>;
  /** True when the race already holds every candidate it may. */
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-2">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{emptyLabel}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto divide-y divide-card-border/40">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-xs">{row.name}</div>
                {row.officeLabel && (
                  <div className="text-[10px] text-muted">{formatSlateLabel(row.officeLabel)}</div>
                )}
              </div>
              <button
                type="button"
                disabled={disabled || pendingKey === row.key}
                onClick={() => void onAssign(row.type, row.id)}
                className="rounded-md border border-card-border bg-background px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
              >
                {pendingKey === row.key ? "..." : "Assign"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
