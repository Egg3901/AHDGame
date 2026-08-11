"use client";

import { useState, useEffect } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";

interface Candidate {
  id: string;
  characterName: string;
  party: string;
  partyName?: string;
}

interface PresAdminPanelProps {
  electionId: string;
  inPrimary: boolean;
  isEnded: boolean;
  candidates: Candidate[];
  onSuccess: () => void;
}

interface PlaceOptions {
  characters: { id: string; name: string; party: string; homeState: string; inRace: boolean }[];
  npps: { id: string; name: string; party: string; inRace: boolean }[];
  parties: { id: string; name: string }[];
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-500/70">
      {children}
    </p>
  );
}

function AdminBtn({
  onClick,
  disabled,
  variant = "default",
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "sky" | "ghost";
  title?: string;
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    default: "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
    danger: "border-red-500/40  bg-red-500/10  text-red-400  hover:bg-red-500/20",
    sky: "border-sky-500/40  bg-sky-500/15  text-sky-300  hover:bg-sky-500/25",
    ghost: "border-card-border bg-transparent text-muted     hover:bg-white/5",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function PresAdminPanel({
  electionId,
  inPrimary,
  isEnded,
  candidates,
  onSuccess,
}: PresAdminPanelProps) {
  const [busy, setBusy] = useState<string | null>(null); // which action is loading
  const [msgs, setMsgs] = useState<Record<string, string>>({}); // per-section feedback
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeOptions, setPlaceOptions] = useState<PlaceOptions | null>(null);
  const [placeOptionsLoading, setPlaceOptionsLoading] = useState(false);
  const [placeType, setPlaceType] = useState<"character" | "npp">("character");
  const [placeId, setPlaceId] = useState("");
  const [placeParty, setPlaceParty] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const setMsg = (section: string, text: string) =>
    setMsgs((prev) => ({ ...prev, [section]: text }));
  const clearMsg = (section: string) =>
    setMsgs((prev) => {
      const next = { ...prev };
      delete next[section];
      return next;
    });

  const post = async (
    url: string,
    section: string,
    body?: object,
    confirm_msg?: string
  ): Promise<boolean> => {
    if (confirm_msg && !confirm(confirm_msg)) return false;
    setBusy(section);
    clearMsg(section);
    try {
      const res = await fetch(url, {
        method: "POST",
        ...(body
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const data = await res.json();
      setMsg(section, res.ok ? `✓ ${data.message}` : `✗ ${data.error ?? "Error"}`);
      if (res.ok) {
        onSuccess();
        return true;
      }
    } catch {
      setMsg(section, "✗ Network error");
    } finally {
      setBusy(null);
    }
    return false;
  };

  // ── Place-candidate form ───────────────────────────────────────────────────

  const loadPlaceOptions = async (freedParty?: string) => {
    setPlaceOptionsLoading(true);
    clearMsg("candidates");
    try {
      const res = await fetch(`/api/admin/elections/${electionId}/place-candidate-options`);
      const data = await res.json();
      if (res.ok) {
        setPlaceOptions(data);
        const taken = new Set(candidates.map((c) => c.party));
        if (freedParty) {
          setPlaceParty(freedParty);
        } else {
          const first = data.parties?.find((p: { id: string }) => !taken.has(p.id));
          setPlaceParty(first?.id ?? data.parties?.[0]?.id ?? "");
        }
      } else {
        setMsg("candidates", `✗ Failed to load options: ${data.error ?? res.statusText}`);
        setPlaceOpen(false);
      }
    } catch {
      setMsg("candidates", "✗ Network error loading candidate options");
      setPlaceOpen(false);
    } finally {
      setPlaceOptionsLoading(false);
    }
  };

  useEffect(() => {
    if (placeOpen && !placeOptions) loadPlaceOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only reload when panel opens
  }, [placeOpen]);

  const partiesWithCandidate = new Set(candidates.map((c) => c.party));
  const availableChars = placeOptions?.characters.filter((c) => !c.inRace) ?? [];
  const availableNpps = placeOptions?.npps.filter((n) => !n.inRace) ?? [];

  const handleRemoveCandidate = async (candidateId: string, freedParty?: string) => {
    if (!confirm("Remove this candidate? You can place another for their party afterward.")) return;
    setRemovingId(candidateId);
    clearMsg("candidates");
    try {
      const res = await fetch(`/api/admin/elections/${electionId}/remove-candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      const data = await res.json();
      setMsg("candidates", res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) {
        onSuccess();
        setPlaceOpen(true);
        await loadPlaceOptions(freedParty);
      }
    } catch {
      setMsg("candidates", "✗ Network error");
    } finally {
      setRemovingId(null);
    }
  };

  const handlePlaceCandidate = async () => {
    if (!placeId || !placeParty) {
      setMsg("candidates", "✗ Select a candidate and party");
      return;
    }
    const ok = await post(
      `/api/admin/elections/${electionId}/place-candidate`,
      "candidates",
      placeType === "character"
        ? { characterId: placeId, party: placeParty }
        : { nppId: placeId, party: placeParty }
    );
    if (ok) {
      setPlaceId("");
      setPlaceOpen(false);
      loadPlaceOptions();
    }
  };

  // ── Phase description ─────────────────────────────────────────────────────
  const phaseLabel = isEnded ? "Ended" : inPrimary ? "Primary" : "General";
  const phaseDot = isEnded
    ? "bg-card-border"
    : inPrimary
      ? "bg-warning animate-pulse"
      : "bg-success animate-pulse";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 divide-y divide-amber-500/10 text-sm">
      {/* ── Section: Phase Controls ───────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <SectionLabel>Phase Controls</SectionLabel>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${phaseDot}`} />
            {phaseLabel}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Open Primary — always available on non-ended elections */}
          {!isEnded && (
            <AdminBtn
              onClick={() =>
                post(
                  `/api/admin/elections/${electionId}/start-primary`,
                  "phase",
                  undefined,
                  "Re-open the primary? This resets primaryEndTime to NOW + 72h."
                )
              }
              disabled={busy === "phase"}
              title="Set startTime = now, primaryEndTime = now + 72h"
            >
              {busy === "phase" ? "…" : "↩ Open Primary"}
            </AdminBtn>
          )}

          {/* End Primary → General */}
          {!isEnded && (
            <AdminBtn
              onClick={() =>
                post(
                  `/api/admin/elections/${electionId}/start-general`,
                  "phase",
                  undefined,
                  "End the primary now and advance to the general phase? Primary losers will be eliminated."
                )
              }
              disabled={busy === "phase"}
              title="Sets primaryEndTime = now, eliminates primary losers, initialises vote tally"
            >
              {busy === "phase" ? "…" : "▶ End Primary → General"}
            </AdminBtn>
          )}

          {/* Resolve */}
          {!isEnded && (
            <AdminBtn
              onClick={() =>
                post(
                  `/api/admin/elections/${electionId}/resolve`,
                  "phase",
                  undefined,
                  "Resolve the election now? This determines the winner and updates elected officials. Cannot be undone."
                )
              }
              disabled={busy === "phase" || inPrimary}
              title={
                inPrimary
                  ? "End primary first before resolving"
                  : "Mark completed and run resolution"
              }
              variant={inPrimary ? "ghost" : "default"}
            >
              {busy === "phase" ? "…" : "✓ Resolve Election"}
            </AdminBtn>
          )}
        </div>

        {msgs.phase && (
          <p className={`rounded-md px-2.5 py-1.5 text-xs ${getMessageStyle(msgs.phase)}`}>
            {msgs.phase}
          </p>
        )}
      </div>

      {/* ── Section: Candidates ───────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-2.5">
        <SectionLabel>Candidates</SectionLabel>

        {candidates.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs"
              >
                <span className="font-medium text-foreground">{c.characterName}</span>
                <span className="text-muted">{c.partyName ?? c.party}</span>
                {!isEnded && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCandidate(c.id, c.party)}
                    disabled={removingId !== null}
                    className="ml-0.5 rounded px-1 py-0.5 text-[10px] text-error hover:bg-error/20 disabled:opacity-50"
                    title="Remove and optionally replace"
                  >
                    {removingId === c.id ? "…" : "✕"}
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">No candidates placed.</p>
        )}

        {/* Place candidate form */}
        {!isEnded &&
          (placeOpen ? (
            <div className="rounded-lg border border-card-border bg-card p-3 space-y-2.5">
              {placeOptionsLoading ? <p className="text-xs text-muted">Loading options…</p> : null}
              <div
                className="flex flex-wrap gap-2 items-end"
                style={{ opacity: placeOptionsLoading ? 0.4 : 1 }}
              >
                <div>
                  <label className="mb-1 block text-[10px] text-muted uppercase tracking-wide">
                    Type
                  </label>
                  <select
                    value={placeType}
                    onChange={(e) => {
                      setPlaceType(e.target.value as "character" | "npp");
                      setPlaceId("");
                    }}
                    className="rounded border border-card-border bg-background px-2.5 py-1.5 text-xs"
                  >
                    <option value="character">Character</option>
                    <option value="npp">NPP</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-muted uppercase tracking-wide">
                    {placeType === "character" ? "Character" : "NPP"}
                  </label>
                  <select
                    value={placeId}
                    onChange={(e) => setPlaceId(e.target.value)}
                    className="rounded border border-card-border bg-background px-2.5 py-1.5 text-xs min-w-[180px]"
                  >
                    <option value="">Select…</option>
                    {(placeType === "character" ? availableChars : availableNpps).map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name} ({opt.party})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-muted uppercase tracking-wide">
                    Party
                  </label>
                  <select
                    value={placeParty}
                    onChange={(e) => setPlaceParty(e.target.value)}
                    className="rounded border border-card-border bg-background px-2.5 py-1.5 text-xs"
                  >
                    {(placeOptions?.parties ?? []).map((p) => (
                      <option key={p.id} value={p.id} disabled={partiesWithCandidate.has(p.id)}>
                        {p.name}
                        {partiesWithCandidate.has(p.id) ? " ✓" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <AdminBtn
                  onClick={handlePlaceCandidate}
                  disabled={
                    busy === "candidates" || !placeId || partiesWithCandidate.has(placeParty)
                  }
                  title={
                    partiesWithCandidate.has(placeParty)
                      ? "Remove existing candidate first"
                      : undefined
                  }
                >
                  {busy === "candidates" ? "…" : "Place"}
                </AdminBtn>
                <AdminBtn
                  variant="ghost"
                  onClick={() => {
                    setPlaceOpen(false);
                    setPlaceId("");
                  }}
                >
                  Cancel
                </AdminBtn>
              </div>
            </div>
          ) : (
            <AdminBtn onClick={() => setPlaceOpen(true)} disabled={busy !== null}>
              + Place Candidate
            </AdminBtn>
          ))}

        {msgs.candidates && (
          <p className={`rounded-md px-2.5 py-1.5 text-xs ${getMessageStyle(msgs.candidates)}`}>
            {msgs.candidates}
          </p>
        )}
      </div>

      {/* ── Section: Timer / Reset ────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-2.5">
        <SectionLabel>Timers</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <AdminBtn
            variant="sky"
            onClick={() =>
              post(
                `/api/admin/elections/${electionId}/reset-timers`,
                "timers",
                undefined,
                "Reset timers to NOW (72h primary + 48h campaign)? Keeps existing candidates."
              )
            }
            disabled={busy === "timers"}
            title="Resets startTime/primaryEndTime/endTime from NOW. Candidates stay."
          >
            {busy === "timers" ? "…" : "↺ Reset Timers"}
          </AdminBtn>
        </div>
        {msgs.timers && (
          <p className={`rounded-md px-2.5 py-1.5 text-xs ${getMessageStyle(msgs.timers)}`}>
            {msgs.timers}
          </p>
        )}
      </div>

      {/* ── Section: Danger Zone ─────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-2.5">
        <SectionLabel>⚠ Danger Zone</SectionLabel>
        <p className="text-[11px] text-muted">
          Full reinitialize wipes all candidates, vote tallies, and campaign data, then restarts the
          election from NOW with the correct LARP year.
        </p>
        <AdminBtn
          variant="danger"
          onClick={() =>
            post(
              `/api/admin/elections/${electionId}/reinitialize`,
              "danger",
              undefined,
              "FULL REINITIALIZE — this deletes ALL candidates, tallies, and campaigns for this election and resets it to the correct LARP year. This cannot be undone. Proceed?"
            )
          }
          disabled={busy === "danger"}
          title="Deletes candidates + tallies + campaigns. Resets timers and cycle to match current game year."
        >
          {busy === "danger" ? "…" : "🗑 Full Reinitialize"}
        </AdminBtn>
        {msgs.danger && (
          <p className={`rounded-md px-2.5 py-1.5 text-xs ${getMessageStyle(msgs.danger)}`}>
            {msgs.danger}
          </p>
        )}
      </div>
    </div>
  );
}
