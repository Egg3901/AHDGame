"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminAppointmentPanel } from "./StatePartyLeadershipPanel";
import { getMessageStyle } from "@/lib/utils/formatters";
import { regionUrl } from "@/lib/urls";
import type { StatePartyData } from "./types";

interface StatePartyAdminTabProps {
  stateParty: StatePartyData;
  onUpdate: () => void;
}

export function StatePartyAdminTab({ stateParty, onUpdate }: StatePartyAdminTabProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  const handleDeleteStateParty = async () => {
    const confirmText = `DELETE ${stateParty.stateId} ${stateParty.partyAbbreviation}`;
    const input = prompt(
      `This will permanently delete the ${stateParty.stateName} ${stateParty.partyName} organization.\n\n` +
        `Type "${confirmText}" to confirm:`
    );

    if (input !== confirmText) {
      setMessage("✗ Delete cancelled - confirmation text did not match");
      return;
    }

    setDeleting(true);
    setMessage("");

    try {
      const res = await fetch(
        `/api/admin/state-party/${stateParty.stateId}/${stateParty.partyId}/delete`,
        { method: "POST" }
      );
      const data = await res.json();

      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        // Redirect to state page after short delay
        setTimeout(() => {
          router.push(regionUrl(stateParty.countryId ?? "US", stateParty.stateId));
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
              These controls allow direct manipulation of the state party. Changes take effect
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
        stateId={stateParty.stateId}
        partyId={stateParty.partyId}
        members={stateParty.members.filter((m) => !m.isNPP)}
        chair={stateParty.chair}
        viceChair={stateParty.viceChair}
        treasurer={stateParty.treasurer}
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
              <div className="font-medium text-sm">Delete State Party Organization</div>
              <div className="text-xs text-muted mt-1">
                Permanently delete the {stateParty.stateName} {stateParty.partyName} organization.
                This removes all leadership positions, treasury, and associated data.
              </div>
            </div>
            <button
              onClick={handleDeleteStateParty}
              disabled={deleting}
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
