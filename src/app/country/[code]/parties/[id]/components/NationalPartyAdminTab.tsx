"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getMessageStyle } from "@/lib/utils/formatters";
import { getPositionLabels } from "./helpers";
import type { PartyData, Position } from "./types";

interface NationalPartyAdminTabProps {
  party: PartyData;
  onUpdate: () => void;
}

function AdminAppointmentPanel({
  partyId,
  countryId,
  members,
  chair,
  viceChair,
  treasurer,
  onUpdate,
}: {
  partyId: string;
  countryId: string;
  members: { id: string; name: string }[];
  chair: { id: string; name: string } | null;
  viceChair: { id: string; name: string } | null;
  treasurer: { id: string; name: string } | null;
  onUpdate: () => void;
}) {
  const positionLabels = getPositionLabels(countryId);
  const [selections, setSelections] = useState<Record<Position, string>>({
    chair: chair?.id ?? "",
    viceChair: viceChair?.id ?? "",
    treasurer: treasurer?.id ?? "",
  });
  const [loading, setLoading] = useState<Position | null>(null);
  const [message, setMessage] = useState("");

  const appoint = async (position: Position) => {
    const characterId = selections[position] || null;
    const targetName = characterId
      ? (members.find((m) => m.id === characterId)?.name ?? "Unknown")
      : "(Vacant)";
    if (
      !confirm(
        `Appoint ${targetName} as ${positionLabels[position]}? Active elections for this position will be cancelled.`
      )
    )
      return;
    setLoading(position);
    setMessage("");
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/parties/${partyId}/appoint`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position, characterId }),
        }
      );
      const data = await res.json();
      setMessage(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) onUpdate();
    } catch {
      setMessage("✗ Network error");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
      <h3 className="font-semibold">Leadership Appointment</h3>
      <p className="text-xs text-muted/70">
        Directly appoint or vacate any leadership position. Active elections for the affected
        position will be cancelled automatically.
      </p>
      {message && (
        <div className={`rounded-lg p-2.5 text-xs ${getMessageStyle(message)}`}>{message}</div>
      )}
      <div className="space-y-2">
        {(["chair", "viceChair", "treasurer"] as Position[]).map((position) => (
          <div key={position} className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted w-24 shrink-0">{positionLabels[position]}:</span>
            <select
              value={selections[position]}
              onChange={(e) => setSelections((prev) => ({ ...prev, [position]: e.target.value }))}
              className="flex-1 min-w-40 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">(Vacant)</option>
              {[...members]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <button
              onClick={() => appoint(position)}
              disabled={loading !== null}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              {loading === position ? "…" : "Appoint"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NationalPartyAdminTab({ party, onUpdate }: NationalPartyAdminTabProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  const handleDeleteParty = async () => {
    if (party.isDefault) {
      setMessage("✗ Cannot delete a default (major) party");
      return;
    }

    const confirmText = `DELETE ${party.abbreviation}`;
    const input = prompt(
      `This will permanently delete the ${party.name} party and ALL associated state party organizations.\n\n` +
        `Any NPPs belonging to this party will be retired, removed from any held seats, and withdrawn from active elections.\n\n` +
        `Type "${confirmText}" to confirm:`
    );

    if (input !== confirmText) {
      setMessage("✗ Delete cancelled - confirmation text did not match");
      return;
    }

    setDeleting(true);
    setMessage("");

    try {
      const res = await fetch(`/api/admin/parties/${party.id}/delete?country=${party.countryId}`, {
        method: "POST",
      });
      const data = await res.json();

      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        // Redirect to parties list after short delay
        setTimeout(() => {
          router.push("/parties");
        }, 1500);
      } else {
        setMessage(`✗ ${data.error}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin Warning Banner */}
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <div className="flex items-start gap-3">
          <svg
            className="h-5 w-5 text-red-500 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <h3 className="font-semibold text-red-400">Admin Controls</h3>
            <p className="text-sm text-red-300/80 mt-1">
              These controls allow direct manipulation of the national party. Changes take effect
              immediately.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
      )}

      {/* Leadership Appointment */}
      <AdminAppointmentPanel
        partyId={party.id}
        countryId={party.countryId}
        members={party.members.filter((m) => !m.isNPP)}
        chair={party.chair}
        viceChair={party.viceChair}
        treasurer={party.treasurer}
        onUpdate={onUpdate}
      />

      {/* Danger Zone */}
      <div className="rounded-xl border border-red-500/50 bg-red-500/5 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          <h3 className="font-semibold text-red-400">Danger Zone</h3>
        </div>

        <div className="rounded-lg border border-red-500/30 bg-background p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-sm">Delete Party</div>
              <div className="text-xs text-muted mt-1">
                Permanently delete the {party.name} party and ALL associated state party
                organizations. This action cannot be undone.
                {party.isDefault && (
                  <span className="text-red-400 font-medium">
                    {" "}
                    (Default parties cannot be deleted)
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleDeleteParty}
              disabled={deleting || party.isDefault}
              className="shrink-0 rounded-lg border border-red-500 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
