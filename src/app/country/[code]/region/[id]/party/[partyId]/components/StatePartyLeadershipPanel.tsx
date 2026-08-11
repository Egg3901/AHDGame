"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { CampaignerPicker } from "@/components/party/CampaignerPicker";
import { StatePartyLeadershipManager } from "@/components/StatePartyLeadershipManager";
import { DEFAULT_LEGACY_COUNTRY_ID } from "@/lib/constants/countries";
import { regionPartyApiUrl } from "@/lib/urls";
import { getMessageStyle } from "@/lib/utils/formatters";
import { partyUrl } from "@/lib/urls";
import type { StatePartyData, UserData, LeaderInfo, Position } from "./types";
import { APPOINT_LABELS } from "./helpers";

// ─── Admin Appointment Panel ──────────────────────────────────────────────────

function AdminAppointmentPanel({
  stateId,
  partyId,
  members,
  chair,
  viceChair,
  treasurer,
  onUpdate,
}: {
  stateId: string;
  partyId: string;
  members: { id: string; name: string }[];
  chair: LeaderInfo | null;
  viceChair: LeaderInfo | null;
  treasurer: LeaderInfo | null;
  onUpdate: () => void;
}) {
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
        `Appoint ${targetName} as ${APPOINT_LABELS[position]}? Active elections for this position will be cancelled.`
      )
    )
      return;
    setLoading(position);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/state-party/${stateId}/${partyId}/appoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position, characterId }),
      });
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
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 uppercase tracking-wide">
          Admin
        </span>
        <span className="text-sm font-semibold">Direct Appointment</span>
      </div>
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
            <span className="text-xs text-muted w-20 shrink-0">{APPOINT_LABELS[position]}:</span>
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
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-40"
            >
              {loading === position ? "…" : "Appoint"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── StatePartyLeadershipPanel ────────────────────────────────────────────────

interface StatePartyLeadershipPanelProps {
  stateParty: StatePartyData;
  user: UserData | null;
  canManageLead: boolean;
  /** Whether the viewer can assign the state campaigner (state chair OR national chair OR admin). */
  canAssignCampaigner: boolean;
  onUpdate: () => void;
  hideAdminPanel?: boolean; // Hide admin panel (it's shown in Admin tab instead)
}

export function StatePartyLeadershipPanel({
  stateParty,
  user,
  canManageLead,
  canAssignCampaigner,
  onUpdate,
  hideAdminPanel = false,
}: StatePartyLeadershipPanelProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">State Party Leadership</h2>
        <Link
          href={partyUrl(stateParty.countryId ?? DEFAULT_LEGACY_COUNTRY_ID, stateParty.partyId)}
          className="text-xs text-primary hover:underline"
        >
          {stateParty.partyName} National →
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ["chair", "State Chair"],
            ["viceChair", "Vice Chair"],
            ["treasurer", "Treasurer"],
          ] as [keyof StatePartyData, string][]
        ).map(([field, label]) => {
          const leader = stateParty[field] as LeaderInfo | null;
          return (
            <div key={field} className="rounded-lg border border-card-border bg-background p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
                {label}
              </div>
              <div className="flex items-center gap-3 min-h-[3rem]">
                {leader ? (
                  <>
                    <Avatar
                      url={leader.avatarUrl}
                      name={leader.name}
                      size="h-12 w-12"
                      className="ring-2 ring-card-border"
                    />
                    <Link
                      href={`/character/${leader.sequentialId ?? leader.id}`}
                      className="min-w-0 text-sm font-semibold text-primary hover:underline"
                    >
                      {leader.name}
                    </Link>
                  </>
                ) : (
                  <>
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-muted bg-muted/10"
                      aria-hidden
                    >
                      <span className="text-muted text-sm">—</span>
                    </div>
                    <span className="text-muted italic text-sm">Vacant</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* State Campaigner — single slot, in-state members only */}
      <div className="rounded-lg border border-card-border bg-background p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            Campaigner
          </div>
          <span
            className="rounded-full border border-card-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted"
            title="Chair-assigned. Spends state PS to Build Org on the state party's behalf."
          >
            Spend on behalf
          </span>
        </div>
        <CampaignerPicker
          mode="single"
          current={stateParty.campaigner ? [stateParty.campaigner] : []}
          members={stateParty.members.map((m) => ({
            id: m.id,
            name: m.name,
            homeState: m.homeState,
            isNPP: m.isNPP,
          }))}
          filterStateId={stateParty.stateId}
          partyColor={stateParty.partyColor}
          canAssign={canAssignCampaigner}
          onSave={async (ids) => {
            const res = await fetch(
              `${regionPartyApiUrl(stateParty.countryId, stateParty.stateId, stateParty.partyId)}/campaigners`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ campaignerId: ids[0] ?? null }),
              }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Save failed");
            onUpdate();
          }}
        />
        <p className="text-[11px] text-muted">
          Picker filtered to party members with a home state in {stateParty.stateId}. Campaigners
          spend PS to Build Org; NPP Management, Move, and Recruitment stay chair / vice-chair /
          admin.
        </p>
      </div>

      {/* Management (Admin Appointment or Leadership Manager) */}
      {!hideAdminPanel && user?.isAdmin ? (
        <AdminAppointmentPanel
          stateId={stateParty.stateId}
          partyId={stateParty.partyId}
          members={stateParty.members.filter((m) => !m.isNPP)}
          chair={stateParty.chair}
          viceChair={stateParty.viceChair}
          treasurer={stateParty.treasurer}
          onUpdate={onUpdate}
        />
      ) : (
        canManageLead && (
          <StatePartyLeadershipManager
            stateId={stateParty.stateId}
            countryId={stateParty.countryId}
            partyId={stateParty.partyId}
            partyColor={stateParty.partyColor}
            chair={stateParty.chair}
            members={stateParty.members.filter((m) => !m.isNPP)}
            canManageChair={
              stateParty.nationalChairId !== null &&
              user?.character?.id === stateParty.nationalChairId
            }
            onUpdate={onUpdate}
          />
        )
      )}
    </div>
  );
}

// ─── Exported Admin Panel (for Admin tab) ─────────────────────────────────────

export { AdminAppointmentPanel };
