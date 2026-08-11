"use client";

import { useState } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";
import { regionApiSubUrl } from "@/lib/urls";

interface LeaderInfo {
  id: string;
  name: string;
}

interface MemberInfo {
  id: string;
  name: string;
  currentOffice: {
    type: string;
    state?: string;
    seatsHeld?: number;
  } | null;
}

interface StatePartyLeadershipManagerProps {
  stateId: string;
  countryId: string;
  partyId: string;
  partyColor: string;
  chair: LeaderInfo | null;
  members: MemberInfo[];
  canManageChair: boolean; // Only national chair can appoint state chair (when vacant)
  onUpdate: () => void;
}

export function StatePartyLeadershipManager({
  stateId,
  countryId,
  partyId,
  partyColor,
  chair,
  members,
  canManageChair,
  onUpdate,
}: StatePartyLeadershipManagerProps) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedChar, setSelectedChar] = useState("");

  // Only show when national chair can appoint a vacant chair position
  if (!canManageChair || chair) return null;

  const appointChair = async () => {
    if (!selectedChar) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(
        `${regionApiSubUrl(countryId, stateId, `party/${partyId}/leadership`)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: "chair", characterId: selectedChar }),
        }
      );
      const data = await res.json();
      setMessage(res.ok ? data.message : `Error: ${data.error}`);
      if (res.ok) {
        setSelectedChar("");
        onUpdate();
      }
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Appoint State Chair</h3>

      {message && (
        <div className={`rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
      )}

      <div className="rounded-lg border border-card-border bg-card p-4">
        <div className="text-sm font-medium mb-2">State Chair</div>
        <div className="space-y-2">
          <select
            value={selectedChar}
            onChange={(e) => setSelectedChar(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            disabled={loading}
          >
            <option value="">Select member...</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <button
            onClick={appointChair}
            disabled={!selectedChar || loading}
            className="w-full rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: partyColor }}
          >
            {loading ? "Appointing..." : "Appoint"}
          </button>
        </div>
      </div>

      {members.length === 0 && (
        <p className="text-sm text-muted">No eligible members in this state party to appoint.</p>
      )}
    </div>
  );
}
