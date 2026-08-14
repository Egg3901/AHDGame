"use client";

import { Suspense, useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { CoalitionLogo } from "@/components/CoalitionLogo";
import { DiscordInviteButton } from "@/components/DiscordInviteButton";
import { LocalTime } from "@/components/time/LocalTime";
import { PartyLogo } from "@/components/PartyLogo";
import { PartyRegimeBadge } from "@/components/parties/PartyRegimeBadge";
import { HeroStatsStrip, Skeleton, TabRowSkeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useGameClock } from "@/contexts/useGameClock";
import { CoalitionPrioritiesPanel } from "@/app/country/[code]/parties/components/CoalitionPrioritiesPanel";
import { parseCountryParam } from "@/lib/db/partyLookup";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { coalitionApiUrl, partiesApiUrl } from "@/lib/urls";
import { PositionLabel } from "@/components/PositionLabel";
import type { CoalitionDetail } from "@/app/country/[code]/parties/coalitionTypes";
import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";

type TabId = "overview" | "parties" | "priorities" | "chair-office" | "admin";

interface UserCharacter {
  id: string;
  name: string;
  party?: string;
  partySequentialId?: number;
  countryId?: string;
  isPartyChair?: boolean;
  isNationalChair?: boolean;
  coalitionId?: string | null;
}

interface UserData {
  id: string;
  username: string;
  isAdmin: boolean;
  hasCharacter: boolean;
  character?: UserCharacter;
}

interface PartyListItem {
  id: string;
  sequentialId: number;
  name: string;
  abbreviation: string;
  color: string;
  logoUrl?: string;
  coalitionId?: string | null;
  countryId: "US" | "UK" | "DE" | "CN";
  chair?: { id: string; name: string } | null;
  regimeStatus?: "ruling" | "approved" | "banned" | null;
}

const getCoalitionMemberKey = (member: { partyId: number; joinedAt: string }, index: number) =>
  `${member.partyId}-${member.joinedAt}-${index}`;

const getCoalitionInviteKey = (invite: { partyId: number; invitedAt: string }, index: number) =>
  `${invite.partyId}-${invite.invitedAt}-${index}`;

const getCoalitionJoinRequestKey = (
  request: { partyId: number; requestedAt: string },
  index: number
) => `${request.partyId}-${request.requestedAt}-${index}`;

const getPartyListItemKey = (party: PartyListItem, index: number) => `${party.id}-${index}`;

// Full-page skeleton mirroring the coalition layout: back link, header card
// with stats strip, tabs, and the overview leadership list.
function CoalitionPageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6 overflow-x-hidden">
        {/* Back link */}
        <Skeleton className="h-4 w-24" />

        {/* Header card */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-6 py-5 flex items-center gap-4 border-b border-card-border">
            <Skeleton className="h-14 w-14 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          {/* Stats strip */}
          <div className="flex items-center overflow-x-auto divide-x divide-card-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex flex-col min-w-[110px] space-y-1.5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <TabRowSkeleton count={3} />

        {/* Leadership list */}
        <div className="rounded-xl border border-card-border bg-card p-6 space-y-3 min-h-[280px]">
          <Skeleton className="h-5 w-44 mb-4" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-lg border border-card-border bg-background p-3"
            >
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function CoalitionDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  return (
    <Suspense fallback={<CoalitionPageSkeleton />}>
      <CoalitionDetailContent params={params} />
    </Suspense>
  );
}

function CoalitionDetailContent({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = use(params);
  const requestedCountry = parseCountryParam(code?.toLowerCase() ?? null);
  const { showToast } = useToast();
  const clock = useGameClock();

  const [user, setUser] = useState<UserData | null>(null);
  const [coalition, setCoalition] = useState<CoalitionDetail | null>(null);
  const [allParties, setAllParties] = useState<PartyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [discordInviteUrl, setDiscordInviteUrl] = useState("");
  const [savingDiscordLink, setSavingDiscordLink] = useState(false);

  // Chair's Office action state
  const [transferTarget, setTransferTarget] = useState<number | "">("");
  const [adminAddTarget, setAdminAddTarget] = useState<number | "">("");
  const [adminChairTarget, setAdminChairTarget] = useState<number | "">("");

  const effectiveCountry =
    (coalition?.countryId
      ? parseCountryParam(coalition.countryId.toLowerCase())
      : null
    )?.toLowerCase() ??
    requestedCountry?.toLowerCase() ??
    "us";

  const fetchUser = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me");
      if (r.ok) {
        const d = await r.json();
        setUser(d.user);
      }
    } catch {}
  }, []);

  const fetchCoalition = useCallback(async () => {
    try {
      const country = requestedCountry?.toLowerCase() ?? "us";
      const r = await fetch(coalitionApiUrl(country, id));
      if (r.ok) {
        const d = await r.json();
        setCoalition(d);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [id, requestedCountry]);

  const fetchAllParties = useCallback(async () => {
    try {
      const r = await fetch(partiesApiUrl(effectiveCountry));
      if (r.ok) {
        const d = await r.json();
        setAllParties(d.parties ?? d ?? []);
      }
    } catch {}
  }, [effectiveCountry]);

  useEffect(() => {
    fetchUser();
    fetchCoalition();
  }, [fetchUser, fetchCoalition]);

  useEffect(() => {
    if (coalition) {
      fetchAllParties();
    }
  }, [coalition, fetchAllParties]);

  useEffect(() => {
    setDiscordInviteUrl(coalition?.discordInviteUrl ?? "");
  }, [coalition?.discordInviteUrl]);

  // Derive user role booleans
  const charId = user?.character?.id ?? null;
  // Derive party sequential ID as a number from the character's party string
  const charPartySeqId = user?.character?.party ? Number(user.character.party) : null;

  const isCoalitionChair = !!(charId && coalition && charId === coalition.chairCharacterId);

  const isMemberPartyChair = !!(
    charPartySeqId &&
    coalition?.members.some((m) => m.partyId === charPartySeqId && m.chairId === charId)
  );

  // National chair = user is chair of their party in the same country as this coalition
  const userPartyInCountry = allParties.find(
    (p) => p.sequentialId === charPartySeqId && p.countryId.toLowerCase() === effectiveCountry
  );
  const isNationalChair = !!(charId && userPartyInCountry?.chair?.id === charId);

  const isInCoalition = !!(
    charPartySeqId && coalition?.members.some((m) => m.partyId === charPartySeqId)
  );

  const hasInvite = !!(
    charPartySeqId && coalition?.pendingInvites.some((inv) => inv.partyId === charPartySeqId)
  );

  const hasJoinRequest = !!(
    charPartySeqId && coalition?.joinRequests.some((req) => req.partyId === charPartySeqId)
  );

  const isAdmin = !!user?.isAdmin;
  const currentDiscordInviteUrl = coalition?.discordInviteUrl?.trim() ?? "";
  const trimmedDiscordInviteUrl = discordInviteUrl.trim();
  const normalizedDiscordInviteUrl = normalizeDiscordInviteUrl(trimmedDiscordInviteUrl);
  const normalizedCurrentDiscordInviteUrl = normalizeDiscordInviteUrl(coalition?.discordInviteUrl);
  const hasDiscordValidationError = !!trimmedDiscordInviteUrl && !normalizedDiscordInviteUrl;
  const hasLegacyInvalidDiscordInvite =
    !!currentDiscordInviteUrl && !normalizedCurrentDiscordInviteUrl;
  const hasDiscordInviteChanged = hasLegacyInvalidDiscordInvite
    ? trimmedDiscordInviteUrl !== currentDiscordInviteUrl
    : (normalizedDiscordInviteUrl ?? "") !== (normalizedCurrentDiscordInviteUrl ?? "");

  // Tabs
  const tabs: { id: TabId; label: string; className?: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "parties", label: `Parties (${coalition?.partyCount ?? 0})` },
    { id: "priorities", label: "Priorities" },
    ...(isCoalitionChair ? [{ id: "chair-office" as TabId, label: "Chair's Office" }] : []),
    ...(isAdmin ? [{ id: "admin" as TabId, label: "Admin", className: "text-red-400" }] : []),
  ];

  // API mutation helper
  const apiPost = useCallback(
    async (url: string, body: object) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.message ?? "Success", "success");
          fetchCoalition();
        } else {
          showToast(data.error ?? "Failed", "error");
        }
      } catch {
        showToast("Network error", "error");
      }
    },
    [showToast, fetchCoalition]
  );

  // Action handlers
  const handleAcceptInvite = () =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/invite/accept`, {
      partySequentialId: charPartySeqId,
    });

  const handleDeclineInvite = () =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/invite/decline`, {
      partySequentialId: charPartySeqId,
    });

  const handleRequestJoin = () => apiPost(`${coalitionApiUrl(effectiveCountry, id)}/join`, {});

  const handleCancelRequest = () =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/join/cancel`, {
      partySequentialId: charPartySeqId,
    });

  const handleLeaveCoalition = () => {
    if (!confirm(`Leave ${coalition?.name}? This cannot be undone.`)) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/leave`, {});
  };

  const handleInviteParty = (partySequentialId: number) =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/invite`, {
      partySequentialId: Number(partySequentialId),
    });

  const handleAcceptJoinRequest = (partySequentialId: number) =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/join/accept`, {
      partySequentialId: Number(partySequentialId),
    });

  const handleDeclineJoinRequest = (partySequentialId: number) =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/join/decline`, {
      partySequentialId: Number(partySequentialId),
    });

  const handleKickMember = (partySequentialId: number, partyName: string) => {
    if (!confirm(`Kick ${partyName} from the coalition?`)) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/kick`, { partySequentialId });
  };

  const handleTransferChair = () => {
    if (!transferTarget) return;
    if (!confirm("Transfer coalition chair to this party's chair?")) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/transfer`, {
      partySequentialId: transferTarget,
    });
    setTransferTarget("");
  };

  const handleInitiateDisband = () => {
    if (!confirm("Initiate a disband vote? All member party chairs will be able to vote.")) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/disband/start`, {});
  };

  const handleDiscordLinkSave = async () => {
    if (!hasDiscordInviteChanged) return;
    if (hasDiscordValidationError) {
      showToast("Discord link must be a valid Discord invite URL", "error");
      return;
    }

    setSavingDiscordLink(true);
    try {
      const res = await fetch(`${coalitionApiUrl(effectiveCountry, id)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordInviteUrl: normalizedDiscordInviteUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(
          normalizedDiscordInviteUrl
            ? "Coalition Discord link updated"
            : "Coalition Discord link cleared",
          "success"
        );
        fetchCoalition();
      } else {
        showToast(data.error ?? "Failed to update Discord link", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setSavingDiscordLink(false);
    }
  };

  const handleDisbandVote = (vote: "yes" | "no") =>
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/disband/vote`, { vote });

  const handleAdminAdd = () => {
    if (!adminAddTarget) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/admin/add`, {
      partySequentialId: adminAddTarget,
    });
    setAdminAddTarget("");
  };

  const handleAdminRemove = (partySequentialId: number, partyName: string) => {
    if (!confirm(`Remove ${partyName} from the coalition?`)) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/admin/remove`, {
      partySequentialId,
    });
  };

  const handleAdminChair = () => {
    if (!adminChairTarget) return;
    apiPost(`${coalitionApiUrl(effectiveCountry, id)}/admin/chair`, {
      partySequentialId: adminChairTarget,
    });
    setAdminChairTarget("");
  };

  // Eligible parties for invite (not already in a coalition)
  const eligibleParties = allParties.filter(
    (p) => !p.coalitionId && !coalition?.members.some((m) => m.partyId === p.sequentialId)
  );

  if (loading) {
    return <CoalitionPageSkeleton />;
  }

  if (!coalition) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold mb-2">Coalition not found</p>
          <p className="text-sm text-muted mb-4">
            This coalition may not exist or may have been disbanded.
          </p>
          <Link
            href={`/country/${effectiveCountry}/parties`}
            className="text-primary hover:underline text-sm"
          >
            Back to Parties
          </Link>
        </div>
      </div>
    );
  }

  // Disband vote time remaining. Turn-first (freezes on pause; matches the
  // server resolver `resolveExpiredDisbandVotes`) with a wall-clock fallback
  // for legacy votes that pre-date `expiresOnTurn`.
  const disbandVote = coalition.disbandVote;
  const disbandTurnsRemaining = disbandVote
    ? typeof disbandVote.expiresOnTurn === "number" && clock.currentTurn != null
      ? Math.max(0, disbandVote.expiresOnTurn - clock.currentTurn)
      : Math.max(
          0,
          Math.round((new Date(disbandVote.expiresAt).getTime() - Date.now()) / 3_600_000)
        )
    : 0;
  const userPartyDisbandVote = disbandVote?.votes.find((v) => v.partyId === charPartySeqId);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-6 py-8 overflow-x-hidden">
        {/* Back link */}
        <Link
          href={`/country/${effectiveCountry}/parties`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          All Parties
        </Link>

        {/* Header card */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden mb-6">
          <div
            className="px-6 py-5 flex items-center justify-between gap-4"
            style={{
              backgroundColor: `${coalition.color}18`,
              borderBottom: `4px solid ${coalition.color}`,
            }}
          >
            <div className="flex items-center gap-4">
              <CoalitionLogo
                coalitionId={coalition.id}
                coalitionColor={coalition.color}
                logoUrl={coalition.logoUrl}
                size="h-14 w-14"
                className="border-4 border-foreground/20 bg-foreground/10"
                countryId={coalition.countryId}
              />
              <div>
                <h1 className="text-2xl font-bold">{coalition.name}</h1>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm font-medium" style={{ color: coalition.color }}>
                    {coalition.abbreviation}
                  </span>
                  <span className="text-xs text-muted bg-background/60 px-2 py-0.5 rounded-full border border-card-border">
                    Coalition
                  </span>
                </div>
              </div>
            </div>

            {/* Contextual action buttons — invite accept/decline in header */}
            <div className="flex items-center gap-3 shrink-0">
              <DiscordInviteButton
                inviteUrl={coalition.discordInviteUrl}
                entityName={coalition.name}
              />
              {hasInvite && isNationalChair && (
                <div className="flex gap-2">
                  <button
                    onClick={handleAcceptInvite}
                    className="rounded-lg bg-success px-3 py-2 text-sm font-medium text-white hover:bg-success/90 transition-colors"
                  >
                    Accept Invite
                  </button>
                  <button
                    onClick={handleDeclineInvite}
                    className="rounded-lg border border-card-border px-3 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Stats strip */}
          <HeroStatsStrip>
            <div className="p-4 flex flex-col min-w-[90px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Parties
              </span>
              <span className="text-lg font-bold text-foreground tabular-nums">
                {coalition.partyCount}
              </span>
            </div>

            <div className="p-4 flex flex-col min-w-[90px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Members
              </span>
              <span className="text-lg font-bold text-foreground tabular-nums">
                {coalition.totalMembers}
              </span>
            </div>

            <div className="p-4 flex flex-col min-w-[110px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Economic
              </span>
              <PositionLabel
                value={coalition.economicPosition}
                axis="economic"
                className="text-sm font-bold"
              />
            </div>

            <div className="p-4 flex flex-col min-w-[110px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Social
              </span>
              <PositionLabel
                value={coalition.socialPosition}
                axis="social"
                className="text-sm font-bold"
              />
            </div>

            <div className="p-4 flex flex-col min-w-[110px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Chair
              </span>
              <span className="text-sm font-semibold text-foreground truncate">
                {coalition.chairName}
              </span>
            </div>

            {/* Join / Cancel Request — right side of stats strip */}
            {isNationalChair && !isInCoalition && !hasJoinRequest && !hasInvite && (
              <div className="ml-auto p-4">
                <button
                  onClick={handleRequestJoin}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: coalition.color }}
                >
                  Request to Join
                </button>
              </div>
            )}
            {hasJoinRequest && (
              <div className="ml-auto p-4">
                <button
                  onClick={handleCancelRequest}
                  className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
                >
                  Cancel Request
                </button>
              </div>
            )}
            {isMemberPartyChair && isInCoalition && (
              <div className="ml-auto p-4">
                <button
                  onClick={handleLeaveCoalition}
                  className="rounded-lg border border-error/40 px-4 py-2 text-sm font-medium text-error hover:bg-error/10 transition-colors"
                >
                  Leave Coalition
                </button>
              </div>
            )}
          </HeroStatsStrip>
        </div>

        {/* Invite acceptance banner */}
        {hasInvite && isNationalChair && (
          <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <div className="text-sm font-semibold text-warning mb-1">
              Your party has been invited to join {coalition.name}
            </div>
            <p className="text-xs text-muted mb-3">
              {`As the ${getPartyRoleLabel(code, "chair")}, you can accept or decline this invitation on behalf of your party.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleAcceptInvite}
                className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 transition-colors"
              >
                Accept Invite
              </button>
              <button
                onClick={handleDeclineInvite}
                className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-card-border mb-6">
          <nav className="-mb-px flex gap-6 overflow-x-auto pb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? tab.id === "admin"
                      ? "border-red-500 text-red-400"
                      : "border-primary text-primary"
                    : (tab.className ??
                      "border-transparent text-muted hover:border-muted hover:text-foreground")
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Disband vote panel */}
            {disbandVote && isMemberPartyChair && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-6">
                <h2 className="text-lg font-semibold text-red-400 mb-1">Active Disband Vote</h2>
                <p className="text-sm text-muted mb-4">
                  {disbandTurnsRemaining > 0
                    ? `Expires in approximately ${disbandTurnsRemaining} turn${disbandTurnsRemaining === 1 ? "" : "s"}`
                    : "Vote is expiring soon"}
                </p>
                <div className="flex gap-8 mb-4">
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">Yes</div>
                    <div className="text-2xl font-bold text-red-400">{disbandVote.yesCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">No</div>
                    <div className="text-2xl font-bold text-success">{disbandVote.noCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">Total</div>
                    <div className="text-2xl font-bold text-foreground">
                      {disbandVote.totalMembers}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDisbandVote("yes")}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      userPartyDisbandVote?.vote === "yes"
                        ? "bg-red-500 text-white"
                        : "border border-red-500/50 text-red-400 hover:bg-red-500/20"
                    }`}
                  >
                    Vote Yes (Disband)
                  </button>
                  <button
                    onClick={() => handleDisbandVote("no")}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      userPartyDisbandVote?.vote === "no"
                        ? "bg-success text-white"
                        : "border border-success/50 text-success hover:bg-success/20"
                    }`}
                  >
                    Vote No (Keep)
                  </button>
                </div>
                {userPartyDisbandVote && (
                  <p className="text-xs text-muted mt-2">
                    Your current vote:{" "}
                    <span
                      className={
                        userPartyDisbandVote.vote === "yes" ? "text-red-400" : "text-success"
                      }
                    >
                      {userPartyDisbandVote.vote === "yes" ? "Yes (Disband)" : "No (Keep)"}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Leadership list */}
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Coalition Leadership</h2>
              <div className="space-y-3">
                {coalition.members
                  .slice()
                  .sort((a, b) => {
                    if (a.isCoalitionChair) return -1;
                    if (b.isCoalitionChair) return 1;
                    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
                  })
                  .map((member, index) => (
                    <div
                      key={getCoalitionMemberKey(member, index)}
                      className="flex items-center gap-4 rounded-lg border border-card-border bg-background p-3"
                    >
                      <PartyLogo
                        partyId={member.partyId.toString()}
                        partyColor={member.color}
                        logoUrl={member.logoUrl}
                        size="h-8 w-8"
                        countryId={coalition.countryId}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{member.name}</span>
                          <span className="text-xs text-muted">({member.abbreviation})</span>
                          {member.isCoalitionChair && (
                            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary border border-primary/20">
                              Coalition Chair
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted mt-0.5">
                          Chair:{" "}
                          {member.chairId ? (
                            <Link
                              href={`/character/${member.chairId}`}
                              className="text-primary hover:underline"
                            >
                              {member.chairName}
                            </Link>
                          ) : (
                            <span className="italic">Vacant</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Parties Tab ── */}
        {activeTab === "parties" && (
          <div className="rounded-xl border border-card-border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4">Member Parties</h2>
            {coalition.members.length === 0 ? (
              <p className="text-sm text-muted italic">No member parties.</p>
            ) : (
              <div className="space-y-3">
                {coalition.members.map((member, index) => (
                  <div
                    key={getCoalitionMemberKey(member, index)}
                    className="flex items-center gap-4 rounded-lg border border-card-border bg-background p-3"
                  >
                    <PartyLogo
                      partyId={member.partyId.toString()}
                      partyColor={member.color}
                      logoUrl={member.logoUrl}
                      size="h-10 w-10"
                      countryId={coalition.countryId}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/country/${effectiveCountry}/parties/${member.partyId}`}
                          className="font-medium text-primary hover:underline text-sm"
                        >
                          {member.name}
                        </Link>
                        <span className="text-xs text-muted">({member.abbreviation})</span>
                        <PartyRegimeBadge regimeStatus={member.regimeStatus} />
                        {member.isCoalitionChair && (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary border border-primary/20">
                            Chair Party
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {member.memberCount} member{member.memberCount !== 1 ? "s" : ""} · Joined{" "}
                        <LocalTime value={member.joinedAt} options={{ dateStyle: "medium" }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Priorities Tab ── */}
        {activeTab === "priorities" && (
          <CoalitionPrioritiesPanel effectiveCountry={effectiveCountry} coalitionId={id} />
        )}

        {/* ── Chair's Office Tab ── */}
        {activeTab === "chair-office" && isCoalitionChair && (
          <div className="space-y-6">
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-1">Coalition Discord</h2>
              <p className="text-sm text-muted mb-4">
                Add a Discord invite link for {coalition.name}. It appears in coalition headers and
                the coalition list.
              </p>
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
                      : coalition.discordInviteUrl
                        ? "Clear Link"
                        : "Save Link"}
                </button>
              </div>
              <p
                className={`mt-3 text-xs ${hasDiscordValidationError ? "text-error" : "text-muted"}`}
              >
                {hasDiscordValidationError
                  ? "Enter a valid Discord invite URL such as https://discord.gg/your-invite or https://discord.com/invite/your-invite."
                  : "Only Discord invite URLs are supported here."}
              </p>
            </div>
            {/* Send Invites */}
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-1">Send Invites</h2>
              <p className="text-sm text-muted mb-4">
                Invite parties not currently in a coalition to join {coalition.name}.
              </p>
              {eligibleParties.length === 0 ? (
                <p className="text-sm text-muted italic">No eligible parties to invite.</p>
              ) : (
                <div className="space-y-2">
                  {eligibleParties.map((party, index) => (
                    <div
                      key={getPartyListItemKey(party, index)}
                      className="flex items-center justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
                    >
                      <div className="flex items-center gap-3">
                        <PartyLogo
                          partyId={party.sequentialId.toString()}
                          partyColor={party.color}
                          logoUrl={party.logoUrl}
                          size="h-6 w-6"
                          countryId={party.countryId}
                        />
                        <span className="text-sm font-medium">{party.name}</span>
                        <span className="text-xs text-muted">({party.abbreviation})</span>
                        <PartyRegimeBadge regimeStatus={party.regimeStatus} />
                      </div>
                      <button
                        onClick={() => handleInviteParty(party.sequentialId)}
                        className="rounded-lg border border-primary/50 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                      >
                        Invite
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending Invites */}
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Pending Invites</h2>
              {coalition.pendingInvites.length === 0 ? (
                <p className="text-sm text-muted italic">No pending invites.</p>
              ) : (
                <div className="space-y-2">
                  {coalition.pendingInvites.map((inv, index) => (
                    <div
                      key={getCoalitionInviteKey(inv, index)}
                      className="flex items-center justify-between rounded-lg border border-card-border bg-background p-3"
                    >
                      <span className="text-sm font-medium">{inv.partyName}</span>
                      <span className="text-xs text-muted">
                        Invited{" "}
                        <LocalTime value={inv.invitedAt} options={{ dateStyle: "medium" }} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Join Requests */}
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Join Requests</h2>
              {coalition.joinRequests.length === 0 ? (
                <p className="text-sm text-muted italic">No pending join requests.</p>
              ) : (
                <div className="space-y-2">
                  {coalition.joinRequests.map((req, index) => (
                    <div
                      key={getCoalitionJoinRequestKey(req, index)}
                      className="flex items-center justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
                    >
                      <div>
                        <span className="text-sm font-medium">{req.partyName}</span>
                        <div className="text-xs text-muted mt-0.5">
                          Requested{" "}
                          <LocalTime value={req.requestedAt} options={{ dateStyle: "medium" }} />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAcceptJoinRequest(req.partyId)}
                          className="rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-success/90 transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleDeclineJoinRequest(req.partyId)}
                          className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Kick Member */}
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Kick Member</h2>
              {coalition.members.filter((m) => m.partyId !== charPartySeqId).length === 0 ? (
                <p className="text-sm text-muted italic">No other members to kick.</p>
              ) : (
                <div className="space-y-2">
                  {coalition.members
                    .filter((m) => m.partyId !== charPartySeqId)
                    .map((member, index) => (
                      <div
                        key={getCoalitionMemberKey(member, index)}
                        className="flex items-center justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
                      >
                        <div className="flex items-center gap-3">
                          <PartyLogo
                            partyId={member.partyId.toString()}
                            partyColor={member.color}
                            logoUrl={member.logoUrl}
                            size="h-6 w-6"
                            countryId={coalition.countryId}
                          />
                          <span className="text-sm font-medium">{member.name}</span>
                        </div>
                        <button
                          onClick={() => handleKickMember(member.partyId, member.name)}
                          className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          Kick
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Transfer Chair */}
            <div className="rounded-xl border border-card-border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4">Transfer Chair</h2>
              <p className="text-sm text-muted mb-4">
                Transfer the Coalition Chair role to another member party.
              </p>
              <div className="flex gap-3">
                <select
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value ? Number(e.target.value) : "")}
                  className="flex-1 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select party…</option>
                  {coalition.members
                    .filter((m) => m.partyId !== charPartySeqId)
                    .map((member, index) => (
                      <option key={getCoalitionMemberKey(member, index)} value={member.partyId}>
                        {member.name}
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleTransferChair}
                  disabled={!transferTarget}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Transfer
                </button>
              </div>
            </div>

            {/* Disband */}
            <div className="rounded-xl border border-red-500/20 bg-card p-6">
              <h2 className="text-lg font-semibold text-red-400 mb-2">Disband Coalition</h2>
              <p className="text-sm text-muted mb-4">
                Initiates a vote among all member party chairs. A majority of &apos;yes&apos; votes
                disbands the coalition.
              </p>
              <button
                onClick={handleInitiateDisband}
                disabled={!!disbandVote}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                {disbandVote ? "Disband Vote Already Active" : "Initiate Disband Vote"}
              </button>
            </div>
          </div>
        )}

        {/* ── Admin Tab ── */}
        {activeTab === "admin" && isAdmin && (
          <div className="space-y-6">
            {/* Add Party */}
            <div className="rounded-xl border border-red-500/30 bg-card p-6">
              <h2 className="text-lg font-semibold text-red-400 mb-4">Add Party</h2>
              <div className="flex gap-3">
                <select
                  value={adminAddTarget}
                  onChange={(e) => setAdminAddTarget(e.target.value ? Number(e.target.value) : "")}
                  className="flex-1 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select eligible party…</option>
                  {eligibleParties.map((party, index) => (
                    <option key={getPartyListItemKey(party, index)} value={party.sequentialId}>
                      {party.name} ({party.abbreviation})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAdminAdd}
                  disabled={!adminAddTarget}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Remove Party */}
            <div className="rounded-xl border border-red-500/30 bg-card p-6">
              <h2 className="text-lg font-semibold text-red-400 mb-4">Remove Party</h2>
              {coalition.members.length === 0 ? (
                <p className="text-sm text-muted italic">No members to remove.</p>
              ) : (
                <div className="space-y-2">
                  {coalition.members.map((member, index) => (
                    <div
                      key={getCoalitionMemberKey(member, index)}
                      className="flex items-center justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
                    >
                      <div className="flex items-center gap-3">
                        <PartyLogo
                          partyId={member.partyId.toString()}
                          partyColor={member.color}
                          logoUrl={member.logoUrl}
                          size="h-6 w-6"
                          countryId={coalition.countryId}
                        />
                        <span className="text-sm font-medium">{member.name}</span>
                      </div>
                      <button
                        onClick={() => handleAdminRemove(member.partyId, member.name)}
                        className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Appoint Chair */}
            <div className="rounded-xl border border-red-500/30 bg-card p-6">
              <h2 className="text-lg font-semibold text-red-400 mb-4">Appoint Chair</h2>
              <p className="text-sm text-muted mb-4">
                Override and appoint any member party as the Coalition Chair.
              </p>
              <div className="flex gap-3">
                <select
                  value={adminChairTarget}
                  onChange={(e) =>
                    setAdminChairTarget(e.target.value ? Number(e.target.value) : "")
                  }
                  className="flex-1 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select member party…</option>
                  {coalition.members.map((member, index) => (
                    <option key={getCoalitionMemberKey(member, index)} value={member.partyId}>
                      {member.name} ({member.abbreviation})
                      {member.isCoalitionChair ? " — current chair" : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAdminChair}
                  disabled={!adminChairTarget}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  Appoint
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
