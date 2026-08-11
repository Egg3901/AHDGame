"use client";

import { useCallback, useEffect } from "react";
import { Slider } from "@/components/ui";
import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";
import type {
  CaucusListEntry,
  CaucusDetail,
  RosterEntry,
  RecruitableNppResponse,
} from "./caucusTypes";
import { apiBase, relationshipBadge, recruitStatusTone, formatHoursMinutes } from "./caucusUtils";
import { useChairSubtabState } from "./useChairSubtabState";

export function ChairSubtab({
  countryCode,
  partyId,
  caucus,
  detail,
  isChair,
  refreshDetail,
  refreshRoster,
  refreshList,
  setMsg,
}: {
  countryCode: string;
  partyId: string;
  caucus: CaucusListEntry;
  detail: CaucusDetail;
  isChair: boolean;
  refreshDetail: () => Promise<void>;
  refreshRoster: () => Promise<void>;
  refreshList: () => Promise<void>;
  setMsg: (text: string | null) => void;
}) {
  const { state, dispatch } = useChairSubtabState(caucus);
  const {
    taxRate,
    name,
    description,
    color,
    motto,
    discordInviteUrl,
    savingMeta,
    newTopic,
    newStance,
    newNote,
    newWeight,
    addingPosition,
    memberOptions,
    loadingMembers,
    selectedMemberId,
    recruitableNpps,
    loadingRecruitableNpps,
    selectedRecruitNppId,
    caucusRecruitCooldownUntil,
    recruitingNpp,
    memberSendAmount,
    nationalTransferAmount,
    sendingFunds,
    transferringFunds,
  } = state;

  const trimmedDiscordInviteUrl = discordInviteUrl.trim();
  const normalizedDiscordInviteUrl = normalizeDiscordInviteUrl(trimmedDiscordInviteUrl);
  const hasDiscordValidationError = !!trimmedDiscordInviteUrl && !normalizedDiscordInviteUrl;

  const loadPlayerMembers = useCallback(async () => {
    dispatch({ type: "SET_LOADING_MEMBERS", value: true });
    try {
      const res = await fetch(
        `${apiBase(countryCode, partyId)}/${caucus.slug}/roster?filter=players`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { items: RosterEntry[] };
      dispatch({
        type: "SET_MEMBERS",
        options: data.items.map((entry) => ({
          id: entry.memberId,
          name: entry.name,
          homeState: entry.homeState,
        })),
      });
    } finally {
      dispatch({ type: "SET_LOADING_MEMBERS", value: false });
    }
  }, [countryCode, partyId, caucus.slug, dispatch]);

  const loadRecruitableNpps = useCallback(async () => {
    dispatch({ type: "SET_LOADING_RECRUITABLES", value: true });
    try {
      const res = await fetch(
        `${apiBase(countryCode, partyId)}/${caucus.slug}/members?memberType=npp`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as RecruitableNppResponse;
      dispatch({
        type: "SET_RECRUITABLES",
        options: data.items,
        cooldownUntil: data.cooldownUntil,
      });
    } finally {
      dispatch({ type: "SET_LOADING_RECRUITABLES", value: false });
    }
  }, [countryCode, partyId, caucus.slug, dispatch]);

  useEffect(() => {
    dispatch({ type: "RESET_META", caucus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    caucus.taxRate,
    caucus.name,
    caucus.description,
    caucus.color,
    caucus.motto,
    caucus.discordInviteUrl,
  ]);

  useEffect(() => {
    if (!isChair) {
      dispatch({ type: "SET_LOADING_MEMBERS", value: false });
      dispatch({ type: "SET_LOADING_RECRUITABLES", value: false });
      dispatch({ type: "SET_RECRUITABLES", options: [], cooldownUntil: null });
      return;
    }
    void loadPlayerMembers();
    void loadRecruitableNpps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChair, loadPlayerMembers, loadRecruitableNpps]);

  if (!isChair) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-5 text-center text-sm text-muted">
        Only the Caucus Chair can edit settings here. View positions, the roster, and caucus details
        via the other sub-tabs.
      </div>
    );
  }

  async function saveMeta() {
    if (hasDiscordValidationError) {
      setMsg("Error: Discord link must be a valid Discord invite URL.");
      return;
    }
    dispatch({ type: "SET_SAVING_META", value: true });
    setMsg(null);
    try {
      const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          color,
          motto: motto || undefined,
          discordInviteUrl: normalizedDiscordInviteUrl,
          taxRate,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setMsg(`Error: ${data.error ?? "Failed to save."}`);
      } else {
        setMsg("Success: Caucus updated.");
        await Promise.all([refreshDetail(), refreshList()]);
      }
    } finally {
      dispatch({ type: "SET_SAVING_META", value: false });
    }
  }

  async function addPosition() {
    if (!newTopic.trim() || !newStance.trim()) return;
    dispatch({ type: "SET_ADDING_POSITION", value: true });
    setMsg(null);
    try {
      const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: newTopic.trim(),
          stance: newStance.trim(),
          note: newNote.trim() || undefined,
          weight: newWeight,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setMsg(`Error: ${data.error ?? "Failed to add position."}`);
      } else {
        setMsg("Success: Position added.");
        dispatch({ type: "CLEAR_NEW_POSITION" });
        await refreshDetail();
      }
    } finally {
      dispatch({ type: "SET_ADDING_POSITION", value: false });
    }
  }

  async function deletePosition(positionId: string) {
    if (!confirm("Remove this position?")) return;
    setMsg(null);
    const res = await fetch(
      `${apiBase(countryCode, partyId)}/${caucus.slug}/positions/${positionId}`,
      { method: "DELETE" }
    );
    const data = (await res.json()) as { success?: boolean; error?: string };
    if (!res.ok || !data.success) {
      setMsg(`Error: ${data.error ?? "Failed to delete."}`);
    } else {
      setMsg("Success: Position removed.");
      await refreshDetail();
    }
  }

  async function recruitNppToCaucus() {
    if (!selectedRecruitNppId) return;
    dispatch({ type: "SET_RECRUITING_NPP", value: true });
    setMsg(null);
    try {
      const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberType: "npp", memberId: selectedRecruitNppId }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setMsg(`Error: ${data.error ?? "Failed to recruit NPP."}`);
      } else {
        const selectedNpp = recruitableNpps.find((option) => option.id === selectedRecruitNppId);
        setMsg(`Success: ${selectedNpp?.name ?? "NPP"} joined the caucus.`);
        await Promise.all([refreshDetail(), refreshList(), refreshRoster(), loadRecruitableNpps()]);
      }
    } finally {
      dispatch({ type: "SET_RECRUITING_NPP", value: false });
    }
  }

  async function sendFundsToMember() {
    const amount = Number(memberSendAmount);
    if (!selectedMemberId || !Number.isFinite(amount) || amount < 1000) return;
    dispatch({ type: "SET_SENDING_FUNDS", value: true });
    setMsg(null);
    try {
      const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: selectedMemberId, amount }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setMsg(`Error: ${data.error ?? "Failed to send caucus funds."}`);
      } else {
        const selectedMember = memberOptions.find((option) => option.id === selectedMemberId);
        setMsg(
          `Success: Sent $${amount.toLocaleString("en-US")} to ${selectedMember?.name ?? "member"}.`
        );
        dispatch({ type: "CLEAR_MEMBER_SEND" });
        await Promise.all([refreshDetail(), refreshList()]);
      }
    } finally {
      dispatch({ type: "SET_SENDING_FUNDS", value: false });
    }
  }

  async function transferFundsToNationalParty() {
    const amount = Number(nationalTransferAmount);
    if (!Number.isFinite(amount) || amount < 1000) return;
    dispatch({ type: "SET_TRANSFERRING_FUNDS", value: true });
    setMsg(null);
    try {
      const res = await fetch(`${apiBase(countryCode, partyId)}/${caucus.slug}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(`Error: ${data.error ?? "Failed to transfer caucus funds."}`);
      } else {
        setMsg("Success: Transferred caucus funds to the National Party.");
        dispatch({ type: "CLEAR_NATIONAL_TRANSFER" });
        await Promise.all([refreshDetail(), refreshList()]);
      }
    } finally {
      dispatch({ type: "SET_TRANSFERRING_FUNDS", value: false });
    }
  }

  const selectedRecruitNpp =
    recruitableNpps.find((option) => option.id === selectedRecruitNppId) ?? null;
  const selectedRelationshipBadge = relationshipBadge(selectedRecruitNpp?.relationshipScore ?? 0);
  const recruitmentStatusChip = caucusRecruitCooldownUntil
    ? {
        label: `${formatHoursMinutes(caucusRecruitCooldownUntil) ?? "Cooldown"} cooldown`,
        className: "border-error/40 bg-error/15 text-error",
      }
    : {
        label: "Recruitment Available",
        className: "border-success/40 bg-success/15 text-success",
      };

  return (
    <div className="space-y-4">
      {/* Settings */}
      <div className="space-y-3 rounded-lg border border-card-border bg-card p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Caucus settings
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] uppercase tracking-widest text-muted">
            Name
            <input
              value={name}
              onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
              className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <label className="text-[11px] uppercase tracking-widest text-muted">
            Color
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => dispatch({ type: "SET_COLOR", value: e.target.value })}
                className="h-9 w-12 rounded border border-card-border bg-background"
              />
              <span className="font-mono text-xs normal-case tracking-normal">{color}</span>
            </div>
          </label>
        </div>
        <label className="block text-[11px] uppercase tracking-widest text-muted">
          Motto (optional)
          <input
            value={motto}
            onChange={(e) => dispatch({ type: "SET_MOTTO", value: e.target.value })}
            className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
            maxLength={120}
          />
        </label>
        <label className="block text-[11px] uppercase tracking-widest text-muted">
          Discord Invite
          <input
            type="url"
            value={discordInviteUrl}
            onChange={(e) => dispatch({ type: "SET_DISCORD_INVITE_URL", value: e.target.value })}
            placeholder="https://discord.gg/your-invite"
            aria-invalid={hasDiscordValidationError}
            className={`mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm normal-case tracking-normal ${
              hasDiscordValidationError ? "border-error/60" : "border-card-border"
            }`}
          />
        </label>
        <label className="block text-[11px] uppercase tracking-widest text-muted">
          Description
          <textarea
            value={description}
            onChange={(e) => dispatch({ type: "SET_DESCRIPTION", value: e.target.value })}
            className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
            rows={2}
            maxLength={500}
          />
        </label>
        <label className="block text-[11px] uppercase tracking-widest text-muted">
          Caucus Tax | {taxRate}% (capped at 5%)
          <div className="mt-3 w-full sm:w-1/2">
            <Slider
              min={0}
              max={5}
              step={0.5}
              value={taxRate}
              onChange={(e) =>
                dispatch({ type: "SET_TAX_RATE", value: parseFloat(e.target.value) })
              }
              className="w-full"
              aria-label="Edit caucus tax"
            />
          </div>
        </label>
        <p className={`text-[11px] ${hasDiscordValidationError ? "text-error" : "text-muted"}`}>
          {hasDiscordValidationError
            ? "Enter a valid Discord invite URL such as https://discord.gg/your-invite or https://discord.com/invite/your-invite."
            : "This invite appears in the caucus header for party members."}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveMeta}
            disabled={savingMeta || hasDiscordValidationError}
            className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
          >
            {savingMeta ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      {/* Recruit NPP */}
      <div className="space-y-3 rounded-lg border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Recruit NPP to Caucus
            </h3>
            <p className="mt-2 text-sm text-muted">
              Caucus recruitment is gated by the Chair&apos;s relationship with that NPP.
              Relationship must be at least 60, and the caucus goes on a 12-hour cooldown after a
              successful NPP recruitment.
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${recruitmentStatusChip.className}`}
          >
            {recruitmentStatusChip.label}
          </span>
        </div>

        <label className="block text-[11px] uppercase tracking-widest text-muted">
          NPP
          <select
            value={selectedRecruitNppId}
            onChange={(e) => dispatch({ type: "SET_SELECTED_RECRUIT_NPP", id: e.target.value })}
            disabled={loadingRecruitableNpps || recruitableNpps.length === 0}
            className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal disabled:opacity-50"
          >
            {recruitableNpps.length === 0 ? (
              <option value="">
                {loadingRecruitableNpps
                  ? "Loading NPPs..."
                  : "No same-party NPPs currently qualify"}
              </option>
            ) : (
              recruitableNpps.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.homeState})
                </option>
              ))
            )}
          </select>
        </label>

        {selectedRecruitNpp && (
          <div className="rounded-lg border border-card-border bg-background/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{selectedRecruitNpp.name}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {selectedRecruitNpp.homeState}
                  {selectedRecruitNpp.currentOfficeLabel
                    ? ` | ${selectedRecruitNpp.currentOfficeLabel}`
                    : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${selectedRelationshipBadge.className}`}
                >
                  {selectedRelationshipBadge.label} {selectedRecruitNpp.relationshipScore}
                </span>
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${recruitStatusTone(selectedRecruitNpp.status)}`}
                >
                  {selectedRecruitNpp.statusLabel}
                </span>
              </div>
            </div>
            {selectedRecruitNpp.cooldownUntil && (
              <p className="mt-3 text-[11px] text-muted">
                Cooldown remaining: {formatHoursMinutes(selectedRecruitNpp.cooldownUntil)}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={recruitNppToCaucus}
            disabled={
              recruitingNpp ||
              !selectedRecruitNpp ||
              !selectedRecruitNpp.eligible ||
              !selectedRecruitNppId
            }
            className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
          >
            {recruitingNpp ? "Recruiting..." : "Recruit NPP"}
          </button>
        </div>
      </div>

      {/* Fund transfers */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-card-border bg-card p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Send to Caucus Member
          </h3>
          <p className="text-sm text-muted">
            Move caucus funds directly to an active player member&apos;s campaign account.
          </p>
          <label className="block text-[11px] uppercase tracking-widest text-muted">
            Member
            <select
              value={selectedMemberId}
              onChange={(e) => dispatch({ type: "SET_SELECTED_MEMBER", id: e.target.value })}
              disabled={loadingMembers || memberOptions.length === 0}
              className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal disabled:opacity-50"
            >
              {memberOptions.length === 0 ? (
                <option value="">
                  {loadingMembers ? "Loading members..." : "No player members available"}
                </option>
              ) : (
                memberOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.homeState})
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block text-[11px] uppercase tracking-widest text-muted">
            Amount
            <input
              type="number"
              min={1000}
              step={1000}
              value={memberSendAmount}
              onChange={(e) => dispatch({ type: "SET_MEMBER_SEND_AMOUNT", value: e.target.value })}
              placeholder="1000"
              className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <div className="text-[11px] text-muted">
            Available: ${caucus.treasury.toLocaleString("en-US")} · Minimum: $1,000
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={sendFundsToMember}
              disabled={
                sendingFunds ||
                memberOptions.length === 0 ||
                !selectedMemberId ||
                Number(memberSendAmount) < 1000
              }
              className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
            >
              {sendingFunds ? "Sending..." : "Send funds"}
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-card-border bg-card p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Transfer to National Party
          </h3>
          <p className="text-sm text-muted">
            Return caucus treasury funds to the parent National Party treasury.
          </p>
          <label className="block text-[11px] uppercase tracking-widest text-muted">
            Amount
            <input
              type="number"
              min={1000}
              step={1000}
              value={nationalTransferAmount}
              onChange={(e) =>
                dispatch({ type: "SET_NATIONAL_TRANSFER_AMOUNT", value: e.target.value })
              }
              placeholder="1000"
              className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <div className="text-[11px] text-muted">
            Available: ${caucus.treasury.toLocaleString("en-US")} · Minimum: $1,000
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={transferFundsToNationalParty}
              disabled={transferringFunds || Number(nationalTransferAmount) < 1000}
              className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
            >
              {transferringFunds ? "Transferring..." : "Transfer funds"}
            </button>
          </div>
        </div>
      </div>

      {/* Policy positions */}
      <div className="space-y-3 rounded-lg border border-card-border bg-card p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Key policy positions
        </h3>
        {detail.positions.length === 0 ? (
          <p className="text-sm italic text-muted">
            No positions yet - add the caucus&apos;s stated stances below.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.positions.map((position) => (
              <li
                key={position.id}
                className="flex items-start gap-3 rounded border border-card-border bg-background/50 p-3"
              >
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    position.weight === "core"
                      ? "border-red-500/40 bg-red-500/10 text-red-300"
                      : "border-card-border text-muted"
                  }`}
                >
                  {position.weight}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">
                    {position.topic} <span className="text-muted">to</span>{" "}
                    <span className="text-primary">{position.stance}</span>
                  </div>
                  {position.note && <p className="text-[11px] text-muted">{position.note}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => deletePosition(position.id)}
                  className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-md border border-dashed border-card-border bg-background/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Add new position
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={newTopic}
              onChange={(e) => dispatch({ type: "SET_NEW_TOPIC", value: e.target.value })}
              placeholder="Topic (e.g. Tax policy)"
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm"
              maxLength={80}
            />
            <input
              value={newStance}
              onChange={(e) => dispatch({ type: "SET_NEW_STANCE", value: e.target.value })}
              placeholder="Stance (e.g. Cut and flatten)"
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm"
              maxLength={80}
            />
          </div>
          <input
            value={newNote}
            onChange={(e) => dispatch({ type: "SET_NEW_NOTE", value: e.target.value })}
            placeholder="Optional one-line elaboration"
            className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm"
            maxLength={280}
          />
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(["secondary", "core"] as const).map((weight) => (
                <button
                  key={weight}
                  type="button"
                  onClick={() => dispatch({ type: "SET_NEW_WEIGHT", value: weight })}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                    newWeight === weight
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-card-border text-muted hover:text-foreground"
                  }`}
                >
                  {weight}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={addPosition}
              disabled={!newTopic.trim() || !newStance.trim() || addingPosition}
              className="ml-auto rounded-md border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
            >
              {addingPosition ? "Adding..." : "Add position"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
