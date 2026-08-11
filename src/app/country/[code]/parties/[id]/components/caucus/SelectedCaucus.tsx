"use client";

import { useMemo, useState } from "react";
import { DiscordInviteButton } from "@/components/DiscordInviteButton";
import { type WhipEndpointConfig } from "@/components/party/WhipTabs";
import { CaucusChairElectionPanel } from "../CaucusChairElectionPanel";
import type { CaucusListEntry, CaucusDetail, RosterEntry } from "./caucusTypes";
import { apiBase } from "./caucusUtils";
import { OverviewSubtab } from "./OverviewSubtab";
import { RosterSubtab } from "./RosterSubtab";
import { CaucusWhipSubtab } from "./CaucusWhipSubtab";
import { ChairSubtab } from "./ChairSubtab";

export function SelectedCaucus({
  countryCode,
  partyId,
  caucus,
  detail,
  currentTurn,
  roster,
  rosterFilter,
  setRosterFilter,
  isChair,
  viewerCharacterId,
  viewerInParty,
  refreshList,
  refreshDetail,
  refreshRoster,
  setMsg,
  clearSelection,
  eligibleStates,
}: {
  countryCode: string;
  partyId: string;
  caucus: CaucusListEntry;
  detail: CaucusDetail;
  currentTurn: number;
  roster: RosterEntry[] | null;
  rosterFilter: "all" | "players" | "npps";
  setRosterFilter: (v: "all" | "players" | "npps") => void;
  isChair: boolean;
  viewerCharacterId: string | null;
  viewerInParty: boolean;
  refreshList: () => Promise<void>;
  refreshDetail: () => Promise<void>;
  refreshRoster: () => Promise<void>;
  setMsg: (text: string | null) => void;
  clearSelection: () => void;
  eligibleStates: Array<{ id: string; name: string }>;
}) {
  const [subtab, setSubtab] = useState<"overview" | "roster" | "whip" | "elections" | "chair">(
    "overview"
  );
  const viewerIsMember =
    !!viewerCharacterId &&
    !!roster?.some(
      (entry) => entry.memberType === "character" && entry.memberId === viewerCharacterId
    );
  const availableSubtabs = useMemo(
    () =>
      (isChair
        ? ["overview", "roster", "whip", "elections", "chair"]
        : ["overview", "roster", "whip", "elections"]) as Array<
        "overview" | "roster" | "whip" | "elections" | "chair"
      >,
    [isChair]
  );
  const activeSubtab = !isChair && subtab === "chair" ? "overview" : subtab;

  const endpointConfig = useMemo<WhipEndpointConfig>(
    () => ({
      billsUrl: `${apiBase(countryCode, partyId)}/${caucus.slug}/whippable-bills`,
      leadershipUrl: `${apiBase(countryCode, partyId)}/${caucus.slug}/whippable-leadership`,
      whipUrl: `${apiBase(countryCode, partyId)}/${caucus.slug}/whip`,
      stateBillsUrlTemplate: `${apiBase(countryCode, partyId)}/${caucus.slug}/whippable-bills?stateId={stateId}`,
    }),
    [countryCode, partyId, caucus.slug]
  );
  const caucusEligibleStates = useMemo(() => {
    if (eligibleStates.length > 0) return eligibleStates;
    const stateMap = new Map<string, { id: string; name: string }>();
    for (const entry of roster ?? []) {
      if (!stateMap.has(entry.homeState)) {
        stateMap.set(entry.homeState, { id: entry.homeState, name: entry.homeState });
      }
    }
    return Array.from(stateMap.values());
  }, [eligibleStates, roster]);

  async function handleJoin() {
    setMsg(null);
    const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberType: "character" }),
    });
    const data = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !data.success) {
      setMsg(`Error: ${data.error ?? "Failed to join."}`);
    } else {
      setMsg("Success: Joined caucus.");
      await Promise.all([refreshDetail(), refreshRoster(), refreshList()]);
    }
  }

  async function handleLeave() {
    if (!viewerCharacterId) return;
    if (!confirm(`Leave ${caucus.name}?`)) return;
    setMsg(null);
    const res = await fetch(
      `${apiBase(countryCode, partyId)}/${caucus.slug}/members/${viewerCharacterId}`,
      { method: "DELETE" }
    );
    const data = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !data.success) {
      setMsg(`Error: ${data.error ?? "Failed to leave."}`);
    } else {
      setMsg("Success: Left caucus.");
      await Promise.all([refreshDetail(), refreshRoster(), refreshList()]);
    }
  }

  async function handleDisband() {
    if (
      !confirm(
        `Disband ${caucus.name}? All ${caucus.memberCounts.total} memberships will be cleared and the slug becomes reclaimable.`
      )
    ) {
      return;
    }
    setMsg(null);
    const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}`, {
      method: "DELETE",
    });
    const data = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !data.success) {
      setMsg(`Error: ${data.error ?? "Failed to disband."}`);
    } else {
      setMsg("Success: Caucus disbanded.");
      await refreshList();
      clearSelection();
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="overflow-hidden rounded-2xl border bg-card p-5"
        style={{ borderColor: `${caucus.color}40` }}
      >
        <div className="mb-4 h-1 rounded-full" style={{ background: caucus.color }} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{caucus.name}</h2>
            </div>
            {caucus.motto && (
              <p className="mt-0.5 text-xs italic text-muted">&ldquo;{caucus.motto}&rdquo;</p>
            )}
            <div className="mt-2 max-w-prose space-y-1 text-sm text-muted">
              <p>Chair: {caucus.chairName ?? "Vacant"}</p>
              {caucus.description && <p>{caucus.description}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-end gap-3">
            <DiscordInviteButton inviteUrl={caucus.discordInviteUrl} entityName={caucus.name} />
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">Members</div>
                <div className="text-base font-bold tabular-nums">{caucus.memberCounts.total}</div>
                <div className="text-[10px] text-muted">
                  {caucus.memberCounts.players}p | {caucus.memberCounts.npps}n
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">Treasury</div>
                <div className="text-base font-bold tabular-nums">
                  ${caucus.treasury.toLocaleString("en-US")}
                </div>
                <div className="text-[10px] text-muted">Caucus funds</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">Tax</div>
                <div className="text-base font-bold tabular-nums">{caucus.taxRate}%</div>
                <div className="text-[10px] text-muted">Campaign levy</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">Positions</div>
                <div className="text-base font-bold tabular-nums">{detail.positions.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {availableSubtabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSubtab(tab)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeSubtab === tab
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab === "chair"
                  ? "Chair's Office"
                  : tab === "elections"
                    ? "Elections"
                    : tab === "whip"
                      ? "Whip"
                      : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {viewerInParty && !viewerIsMember && !isChair && (
              <button
                type="button"
                onClick={handleJoin}
                className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20"
              >
                Join caucus
              </button>
            )}
            {viewerIsMember && !isChair && (
              <button
                type="button"
                onClick={handleLeave}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/20"
              >
                Leave caucus
              </button>
            )}
            {isChair && (
              <button
                type="button"
                onClick={handleDisband}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
              >
                Disband
              </button>
            )}
          </div>
        </div>
      </div>

      {activeSubtab === "overview" && <OverviewSubtab detail={detail} />}
      {activeSubtab === "roster" && (
        <RosterSubtab
          roster={roster}
          filter={rosterFilter}
          setFilter={setRosterFilter}
          counts={caucus.memberCounts}
        />
      )}
      {activeSubtab === "whip" && (
        <CaucusWhipSubtab
          countryCode={countryCode}
          partyId={partyId}
          partyColor={caucus.color}
          endpointConfig={endpointConfig}
          canUseWhips={isChair}
          eligibleStates={caucusEligibleStates}
        />
      )}
      {activeSubtab === "elections" && (
        <CaucusChairElectionPanel
          countryCode={countryCode}
          partyId={partyId}
          caucusSlug={caucus.slug}
          caucusName={caucus.name}
          caucusColor={caucus.color}
          currentTurn={currentTurn}
        />
      )}
      {activeSubtab === "chair" && (
        <ChairSubtab
          countryCode={countryCode}
          partyId={partyId}
          caucus={caucus}
          detail={detail}
          isChair={isChair}
          refreshDetail={refreshDetail}
          refreshRoster={refreshRoster}
          refreshList={refreshList}
          setMsg={setMsg}
        />
      )}
    </div>
  );
}
