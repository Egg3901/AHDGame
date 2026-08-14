"use client";

import { useState } from "react";
import Link from "next/link";
import { getMessageStyle } from "@/lib/utils/formatters";
import { partyApiUrl } from "@/lib/urls";
import { LocalTime } from "@/components/time/LocalTime";
import type { PartyData } from "./types";

interface MembershipModeCardProps {
  party: PartyData;
  countryCode: string;
  onUpdate: () => void;
}

/**
 * Chair-Office card for the optional party-membership approval gate (player
 * suggestion #72). Lets the acting chair switch between "open" (immediate
 * joins) and "approval" (joins file a pending request), and accept/decline the
 * requests that pile up while approval is on. Mirrors the coalition
 * join-request panel. The `/settings` and `/join-requests` routes both
 * re-check chair authority server-side.
 */
export function MembershipModeCard({ party, countryCode, onUpdate }: MembershipModeCardProps) {
  const mode = party.membershipMode ?? "open";
  const pending = party.pendingJoinRequests ?? [];

  const [savingMode, setSavingMode] = useState<"open" | "approval" | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const setMode = async (next: "open" | "approval") => {
    if (next === mode || savingMode) return;
    setSavingMode(next);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(countryCode, party.id)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipMode: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(
          next === "approval"
            ? "✓ New members now require approval to join"
            : "✓ Party is now open to join"
        );
        onUpdate();
      } else {
        setMsg(`✗ ${data.error}`);
      }
    } catch {
      setMsg("✗ Network error");
    } finally {
      setSavingMode(null);
    }
  };

  const resolveRequest = async (characterId: string, action: "accept" | "decline") => {
    if (actioning) return;
    setActioning(characterId);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(countryCode, party.id)}/join-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, characterId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(`✓ ${data.message}`);
        onUpdate();
      } else {
        setMsg(`✗ ${data.error}`);
      }
    } catch {
      setMsg("✗ Network error");
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Party Membership</h2>
        <span className="text-xs text-muted">Control who can join your party</span>
      </div>

      {msg && <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(msg)}`}>{msg}</div>}

      {/* Mode toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-card-border overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setMode("open")}
            disabled={savingMode !== null}
            aria-pressed={mode === "open"}
            className={`px-4 py-1.5 transition-colors disabled:opacity-50 ${
              mode === "open"
                ? "bg-card-border text-foreground"
                : "bg-card text-muted hover:text-foreground"
            }`}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setMode("approval")}
            disabled={savingMode !== null}
            aria-pressed={mode === "approval"}
            className={`px-4 py-1.5 transition-colors disabled:opacity-50 ${
              mode === "approval"
                ? "bg-card-border text-foreground"
                : "bg-card text-muted hover:text-foreground"
            }`}
          >
            Approval Required
          </button>
        </div>
        {savingMode && <span className="text-xs text-muted">Saving…</span>}
      </div>
      <p className="mt-3 text-xs text-muted">
        {mode === "approval"
          ? "New members must be approved by a party leader before they join. Requests appear below."
          : "Anyone eligible can join instantly. Switch to “Approval Required” to review joiners first."}
      </p>

      {/* Pending requests */}
      {(mode === "approval" || pending.length > 0) && (
        <div className="mt-6 border-t border-card-border pt-6">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-3">
            Pending Requests {pending.length > 0 && `(${pending.length})`}
          </h3>
          {pending.length === 0 ? (
            <p className="text-sm text-muted italic">No pending join requests.</p>
          ) : (
            <div className="space-y-2">
              {pending.map((req) => (
                <div
                  key={req.characterId}
                  className="flex items-center justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
                >
                  <div>
                    <Link
                      href={`/character/${req.characterId}`}
                      className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {req.characterName}
                    </Link>
                    <div className="text-xs text-muted mt-0.5">
                      Requested{" "}
                      <LocalTime value={req.requestedAt} options={{ dateStyle: "medium" }} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolveRequest(req.characterId, "accept")}
                      disabled={actioning !== null}
                      className="rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-success/90 transition-colors disabled:opacity-50"
                    >
                      {actioning === req.characterId ? "…" : "Accept"}
                    </button>
                    <button
                      onClick={() => resolveRequest(req.characterId, "decline")}
                      disabled={actioning !== null}
                      className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
