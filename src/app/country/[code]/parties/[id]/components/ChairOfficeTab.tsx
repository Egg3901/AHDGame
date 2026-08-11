"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PartyLogo } from "@/components/PartyLogo";
import { PartyRegimeBadge } from "@/components/parties/PartyRegimeBadge";
import { getMessageStyle } from "@/lib/utils/formatters";
import { partyApiUrl } from "@/lib/urls";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import type { PartyData, PartyMember } from "./types";
import { UPLOAD_IMAGE_HINTS } from "@/lib/constants/uploadImageHints";
import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";
import { PARTY_PURGE_ENABLED, PURGE_COOLDOWN_TURNS } from "@/lib/constants/partyActions";
import { PriorityRegionCard } from "./PriorityRegionCard";
import { PartyCampaignersCard } from "./PartyCampaignersCard";
import { MembershipModeCard } from "./MembershipModeCard";
import { BulkStateOrgControl } from "./BulkStateOrgControl";

interface ChairOfficeTabProps {
  party: PartyData;
  countryId: string;
  characterId: string;
  onUpdate: () => void;
}

export function ChairOfficeTab({ party, countryId, characterId, onUpdate }: ChairOfficeTabProps) {
  const [color, setColor] = useState(party.color);
  const [discordInviteUrl, setDiscordInviteUrl] = useState(party.discordInviteUrl ?? "");
  const [savingColor, setSavingColor] = useState(false);
  const [savingDiscordLink, setSavingDiscordLink] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [msg, setMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState("");

  useEffect(() => {
    setColor(party.color);
    setDiscordInviteUrl(party.discordInviteUrl ?? "");
  }, [party.color, party.discordInviteUrl]);

  const currentDiscordInviteUrl = party.discordInviteUrl?.trim() ?? "";
  const trimmedDiscordInviteUrl = discordInviteUrl.trim();
  const normalizedDiscordInviteUrl = normalizeDiscordInviteUrl(trimmedDiscordInviteUrl);
  const normalizedCurrentDiscordInviteUrl = normalizeDiscordInviteUrl(party.discordInviteUrl);
  const hasDiscordValidationError = !!trimmedDiscordInviteUrl && !normalizedDiscordInviteUrl;
  const hasLegacyInvalidDiscordInvite =
    !!currentDiscordInviteUrl && !normalizedCurrentDiscordInviteUrl;
  const hasDiscordInviteChanged = hasLegacyInvalidDiscordInvite
    ? trimmedDiscordInviteUrl !== currentDiscordInviteUrl
    : (normalizedDiscordInviteUrl ?? "") !== (normalizedCurrentDiscordInviteUrl ?? "");

  const purgeCooldownActive =
    party.lastPurgeAtTurn !== undefined &&
    party.currentTurn !== undefined &&
    party.currentTurn - party.lastPurgeAtTurn < PURGE_COOLDOWN_TURNS;

  const purgeTurnsRemaining =
    purgeCooldownActive && party.lastPurgeAtTurn !== undefined && party.currentTurn !== undefined
      ? PURGE_COOLDOWN_TURNS - (party.currentTurn - party.lastPurgeAtTurn)
      : 0;

  const purgeableMembers: PartyMember[] = useMemo(() => {
    const committeeIdSet = new Set(party.committeeIds);
    return party.members.filter(
      (m) =>
        !m.isNPP &&
        m.id !== party.chair?.id &&
        m.id !== party.viceChair?.id &&
        m.id !== party.treasurer?.id &&
        !committeeIdSet.has(m.id) &&
        m.id !== characterId
    );
  }, [
    party.members,
    party.chair,
    party.viceChair,
    party.treasurer,
    party.committeeIds,
    characterId,
  ]);

  const selectedMember = purgeableMembers.find((m) => m.id === selectedMemberId);
  const influenceCost = selectedMember ? Math.floor((selectedMember.partyInfluence ?? 0) / 2) : 0;

  const handleColorSave = async () => {
    if (color === party.color) return;

    setSavingColor(true);
    setMsg("");

    try {
      const res = await fetch(`${partyApiUrl(countryId, party.id)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });

      const data = await res.json();
      if (res.ok) {
        setMsg("✓ Color updated successfully");
        onUpdate();
      } else {
        setMsg(`✗ ${data.error}`);
      }
    } catch {
      setMsg("✗ Network error");
    } finally {
      setSavingColor(false);
    }
  };

  const handleDiscordLinkSave = async () => {
    if (!hasDiscordInviteChanged) return;
    if (hasDiscordValidationError) {
      setMsg("✗ Discord link must be a valid Discord invite URL");
      return;
    }

    setSavingDiscordLink(true);
    setMsg("");

    try {
      const res = await fetch(`${partyApiUrl(countryId, party.id)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordInviteUrl: normalizedDiscordInviteUrl }),
      });

      const data = await res.json();
      if (res.ok) {
        setMsg(
          normalizedDiscordInviteUrl
            ? "✓ Discord link updated successfully"
            : "✓ Discord link cleared"
        );
        onUpdate();
      } else {
        setMsg(`✗ ${data.error}`);
      }
    } catch {
      setMsg("✗ Network error");
    } finally {
      setSavingDiscordLink(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      setMsg("✗ Only JPEG, PNG, WebP, GIF, and SVG images are allowed.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setMsg("✗ File must be under 2 MB.");
      return;
    }

    setUploadingLogo(true);
    setMsg("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("partyId", party.id);
      formData.append("country", countryId.toLowerCase());

      const res = await fetch("/api/upload/party-logo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setMsg("✓ Logo uploaded successfully");
        onUpdate();
      } else {
        setMsg(`✗ ${data.error}`);
      }
    } catch {
      setMsg("✗ Network error");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handlePurge = async () => {
    if (!selectedMemberId || purging) return;
    setPurging(true);
    setPurgeMsg("");
    try {
      const res = await fetch(`${partyApiUrl(countryId, party.id)}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: selectedMemberId }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowPurgeModal(false);
        setSelectedMemberId("");
        setPurgeMsg("");
        setMsg("✓ Member expelled successfully");
        onUpdate();
      } else {
        setPurgeMsg(`✗ ${data.error}`);
        // Cooldown became active between page load and submit — refresh so button reflects it
        if (res.status === 429) onUpdate();
      }
    } catch {
      setPurgeMsg("✗ Network error");
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Chair Office</h2>
          <p className="text-sm text-muted mb-6">
            {`As ${getPartyRoleLabel(countryId, "chair")}, you can customize your party's appearance. Changes will be reflected across the site.`}
          </p>

          {msg && (
            <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(msg)}`}>{msg}</div>
          )}

          {/* Party Logo */}
          <div className="space-y-4 mb-8">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">
              Party Logo
            </h3>
            <div className="flex items-center gap-6">
              <div className="shrink-0">
                <PartyLogo
                  partyId={party.id}
                  partyColor={party.color}
                  logoUrl={party.logoUrl}
                  countryId={party.countryId}
                  size="h-16 w-16"
                  className="border-4 border-foreground/20 bg-foreground/10 rounded-full"
                />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm text-muted">
                  Upload a logo for your party. {UPLOAD_IMAGE_HINTS.partyLogo.short}. Supports JPEG,
                  PNG, WebP, GIF, and SVG formats.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                  className="hidden"
                  id="logo-upload"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {uploadingLogo ? "Uploading..." : party.logoUrl ? "Change Logo" : "Upload Logo"}
                </button>
              </div>
            </div>
          </div>

          {/* Party Color */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">
              Party Color
            </h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-card-border bg-transparent"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                      setColor(val);
                    }
                  }}
                  placeholder="#FF5733"
                  className="w-24 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                onClick={handleColorSave}
                disabled={savingColor || color === party.color || !/^#[0-9A-Fa-f]{6}$/.test(color)}
                className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {savingColor ? "Saving..." : "Save Color"}
              </button>
            </div>
            <p className="text-xs text-muted">
              Enter a valid hex color code (e.g., #FF5733). This color will be used in party chips,
              charts, and throughout the site.
            </p>
          </div>

          {/* Discord Link */}
          <div className="mt-8 space-y-4 border-t border-card-border pt-6">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">
              Party Discord
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="url"
                value={discordInviteUrl}
                onChange={(e) => setDiscordInviteUrl(e.target.value)}
                placeholder="https://discord.gg/your-invite"
                aria-invalid={hasDiscordValidationError}
                className={`flex-1 rounded-lg border bg-card px-3 py-2 text-sm ${
                  hasDiscordValidationError ? "border-error/60" : "border-card-border"
                }`}
              />
              <button
                onClick={handleDiscordLinkSave}
                disabled={
                  savingDiscordLink || !hasDiscordInviteChanged || hasDiscordValidationError
                }
                className="rounded-lg border border-secondary/40 bg-secondary/10 px-4 py-2 text-sm font-medium text-secondary hover:bg-secondary/20 disabled:opacity-50"
              >
                {savingDiscordLink
                  ? "Saving..."
                  : trimmedDiscordInviteUrl
                    ? "Save Link"
                    : party.discordInviteUrl
                      ? "Clear Link"
                      : "Save Link"}
              </button>
            </div>
            <p className={`text-xs ${hasDiscordValidationError ? "text-error" : "text-muted"}`}>
              {hasDiscordValidationError
                ? "Enter a valid Discord invite URL such as https://discord.gg/your-invite or https://discord.com/invite/your-invite."
                : "Add your party's Discord invite link here. This is shown on the national parties page and only supports Discord invite URLs."}
            </p>
          </div>

          {/* Preview */}
          <div className="mt-8 pt-6 border-t border-card-border">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
              Preview
            </h3>
            <div className="flex items-center gap-4 p-4 rounded-lg bg-background border border-card-border">
              <PartyLogo
                partyId={party.id}
                partyColor={color}
                logoUrl={party.logoUrl}
                countryId={party.countryId}
                size="h-10 w-10"
                className="rounded-full"
              />
              <div className="flex items-center gap-2">
                <span className="font-semibold">{party.name}</span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${color}20`, color: color }}
                >
                  {party.abbreviation}
                </span>
                <PartyRegimeBadge regimeStatus={party.regimeStatus} />
              </div>
            </div>
          </div>

          {/* Purge Member */}
          {PARTY_PURGE_ENABLED && (
            <div className="mt-8 pt-6 border-t border-card-border">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">
                Purge Member
              </h3>
              <p className="text-xs text-muted mb-4">
                Expel a member from the party. Costs you 25 infamy and half of their party
                influence. 6-turn cooldown per expulsion.
              </p>
              <button
                onClick={() => {
                  setSelectedMemberId("");
                  setPurgeMsg("");
                  setShowPurgeModal(true);
                }}
                disabled={purgeCooldownActive || purgeableMembers.length === 0}
                className="rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-sm font-medium text-error hover:bg-error/20 disabled:opacity-50"
              >
                {purgeCooldownActive
                  ? `Purge Member (${purgeTurnsRemaining} turn${purgeTurnsRemaining === 1 ? "" : "s"})`
                  : "Purge Member"}
              </button>
              {purgeableMembers.length === 0 && !purgeCooldownActive && (
                <p className="mt-2 text-xs text-muted">No purgeable members.</p>
              )}
            </div>
          )}
        </div>

        <PartyCampaignersCard party={party} countryCode={countryId} onUpdate={onUpdate} />

        <MembershipModeCard party={party} countryCode={countryId} onUpdate={onUpdate} />

        <BulkStateOrgControl countryCode={countryId} partyId={party.id} onApplied={onUpdate} />

        <PriorityRegionCard party={party} countryCode={countryId} />
      </div>

      {/* Purge Modal */}
      {PARTY_PURGE_ENABLED && showPurgeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPurgeModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-1">Purge Party Member</h2>
            <p className="text-sm text-muted mb-5">
              Choose a member to expel. This action cannot be undone and imposes a 6-turn cooldown.
            </p>

            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
              Select Member
            </label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
            >
              <option value="">— Choose a member —</option>
              {purgeableMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({(m.partyInfluence ?? 0).toFixed(1)} influence)
                </option>
              ))}
            </select>

            {selectedMember && (
              <div className="mb-4 rounded-lg border border-error/30 bg-error/5 p-3 text-sm">
                <p className="font-medium text-error mb-1">Cost to you</p>
                <ul className="text-xs text-muted space-y-0.5">
                  <li>+25 infamy</li>
                  <li>
                    {influenceCost > 0
                      ? `−${influenceCost} party influence`
                      : "No influence cost (target has none)"}
                  </li>
                </ul>
              </div>
            )}

            {purgeMsg && (
              <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(purgeMsg)}`}>
                {purgeMsg}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowPurgeModal(false)}
                disabled={purging}
                className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card-elevated disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePurge}
                disabled={!selectedMemberId || purging}
                className="rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-sm font-medium text-error hover:bg-error/20 disabled:opacity-50"
              >
                {purging
                  ? "Expelling..."
                  : selectedMember
                    ? `Purge ${selectedMember.name}`
                    : "Purge Member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
