"use client";

import { useEffect, useCallback, useReducer, useState } from "react";
import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Avatar } from "@/components/Avatar";
import { Skeleton, Button } from "@/components/ui";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { useToast } from "@/contexts/ToastContext";
import { useImperialPossessive } from "@/hooks/useImperialPossessive";
import { executiveApiUrl } from "@/lib/urls";
import { formatRealTimeCountdown } from "@/lib/utils/formatters";
import { AppointModal } from "./AppointModal";
import { CabinetAdminTab } from "./CabinetAdminTab";
import { CabinetTabNav, type CabinetTabKey } from "./CabinetTabNav";
import type { ParliamentaryCabinetConfig } from "./parliamentaryCabinetConfig";

interface Position {
  id: string;
  name: string;
  order: number;
  isHeadOfGovernment?: boolean;
  member: {
    // Null for an NPP-held seat (caretaker or NPP-government minister); the
    // seat is filled, but by an NPP rather than a player character.
    characterId: string | null;
    sequentialId?: number | null;
    characterName: string;
    avatarUrl?: string | null;
    borderKey?: string | null;
    tintColor?: string | null;
    party?: string;
    partyName?: string | null;
    partyColor?: string | null;
    partyLogoUrl?: string | null;
    confirmedAt: string;
    isNPP?: boolean;
  } | null;
  cooldownUntil: string | null;
  nomination: unknown;
}

interface CabinetResponse {
  countryId: string;
  positions: Position[];
  isPrimeMinister: boolean;
  isAdmin: boolean;
  isOnePartyState?: boolean;
  governingPartyId: string | null;
  coalitionPartnerIds: string[];
}

interface EligibleCharacter {
  _id: string;
  name: string;
  party?: string;
  partyName?: string;
  avatarUrl?: string;
  constituency: string;
  sequentialId?: number | null;
}

type State = {
  data: CabinetResponse | null;
  loading: boolean;
  selectedPosition: Position | null;
  isAppointModalOpen: boolean;
  eligibleCharacters: EligibleCharacter[];
  charactersLoading: boolean;
  actionLoading: Record<string, boolean>;
  now: number;
};

type Action =
  | { type: "SET_DATA"; payload: CabinetResponse }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "OPEN_APPOINT_MODAL"; payload: Position }
  | { type: "CLOSE_APPOINT_MODAL" }
  | { type: "SET_CHARACTERS"; payload: EligibleCharacter[] }
  | { type: "SET_CHARACTERS_LOADING"; payload: boolean }
  | { type: "SET_ACTION_LOADING"; positionId: string; loading: boolean }
  | { type: "TICK" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_DATA":
      return { ...state, data: action.payload, loading: false };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "OPEN_APPOINT_MODAL":
      return { ...state, selectedPosition: action.payload, isAppointModalOpen: true };
    case "CLOSE_APPOINT_MODAL":
      return {
        ...state,
        selectedPosition: null,
        isAppointModalOpen: false,
        eligibleCharacters: [],
      };
    case "SET_CHARACTERS":
      return { ...state, eligibleCharacters: action.payload, charactersLoading: false };
    case "SET_CHARACTERS_LOADING":
      return { ...state, charactersLoading: action.payload };
    case "SET_ACTION_LOADING":
      return {
        ...state,
        actionLoading: { ...state.actionLoading, [action.positionId]: action.loading },
      };
    case "TICK":
      return { ...state, now: Date.now() };
    default:
      return state;
  }
}

// Cabinet cooldowns are real-clock — the API records expiry as a wall-clock
// timestamp (see src/lib/uk/cabinetApi.ts and parallel DE/JP/CN paths). Display
// routes through formatRealTimeCountdown rather than the game clock.
function formatCooldownRemaining(targetDate: string): string {
  const result = formatRealTimeCountdown(targetDate);
  return result === "Ended" ? "Ready" : result;
}

interface Props {
  config: ParliamentaryCabinetConfig;
}

export default function ParliamentaryCabinetClient({ config }: Props) {
  const { countryId, governmentLinkPath, description, hero } = config;
  // Call the hook unconditionally — safe because parliamentary cabinet pages
  // are separate routes (different countryId → remount → stable hook order).
  // Non-imperial countries fall through to the fallback string; the resolved
  // possessive is then passed to hero.titleFor() which ignores it for those
  // countries.
  const imperialPossessive = useImperialPossessive(countryId);
  const heroTitle = hero.titleFor(imperialPossessive);

  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<CabinetTabKey>("overview");
  const [error, setError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reducer, {
    data: null,
    loading: true,
    selectedPosition: null,
    isAppointModalOpen: false,
    eligibleCharacters: [],
    charactersLoading: false,
    actionLoading: {},
    now: Date.now(),
  });

  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: "TICK" }), 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    setError(null);
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet`);
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_DATA", payload: data });
      } else {
        setError("Failed to load cabinet data. Please try again.");
      }
    } catch (error) {
      console.error("Failed to fetch cabinet data:", error);
      setError("Network error - could not reach the server.");
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [countryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchEligibleCharacters = async () => {
    dispatch({ type: "SET_CHARACTERS_LOADING", payload: true });
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/characters`);
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_CHARACTERS", payload: data.characters });
      } else {
        dispatch({ type: "SET_CHARACTERS", payload: [] });
      }
    } catch (error) {
      console.error("Failed to fetch eligible characters:", error);
      dispatch({ type: "SET_CHARACTERS", payload: [] });
    }
  };

  const handleOpenAppointModal = async (position: Position) => {
    dispatch({ type: "OPEN_APPOINT_MODAL", payload: position });
    await fetchEligibleCharacters();
  };

  const handleCloseAppointModal = () => {
    dispatch({ type: "CLOSE_APPOINT_MODAL" });
  };

  const handleAppoint = async (positionId: string, characterId: string) => {
    dispatch({ type: "SET_ACTION_LOADING", positionId, loading: true });
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/appoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId, characterId }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
        handleCloseAppointModal();
        await fetchData();
      } else {
        showToast(data.error || "Failed to appoint minister", "error");
      }
    } catch {
      showToast("An unexpected error occurred", "error");
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", positionId, loading: false });
    }
  };

  const handleFire = async (positionId: string) => {
    const position = state.data?.positions.find((p) => p.id === positionId);
    if (!position?.member) return;
    if (!confirm(`Remove ${position.member.characterName} from ${position.name}?`)) return;

    dispatch({ type: "SET_ACTION_LOADING", positionId, loading: true });
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "success");
        await fetchData();
      } else {
        showToast(data.error || "Failed to remove minister", "error");
      }
    } catch {
      showToast("An unexpected error occurred", "error");
    } finally {
      dispatch({ type: "SET_ACTION_LOADING", positionId, loading: false });
    }
  };

  if (state.loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
          <Skeleton className="h-64 rounded-2xl" />
        </main>
      </div>
    );
  }

  if (error || !state.data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="mb-4 text-muted">{error ?? "Failed to load cabinet data."}</p>
            <Button variant="primary" onClick={fetchData}>
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const filledCount = state.data.positions.filter((p) => p.member).length;

  return (
    <>
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8 overflow-x-hidden">
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={governmentLinkPath}
              className="text-muted hover:text-foreground transition-colors"
            >
              ← Government
            </Link>
          </nav>

          <header className="relative mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
            <div className="relative h-[175px] w-full sm:h-[220px]">
              <HeroImage
                src={hero.src}
                alt={hero.alt}
                fill
                className="object-cover object-center"
                sizes="(max-width: 1024px) 100vw, 1024px"
                priority
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
                aria-hidden
              />
              <div className="absolute inset-0 flex flex-col justify-end px-5 pb-4 sm:px-6 sm:pb-5">
                <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-2xl">
                  {heroTitle}
                </h1>
                <p className="mt-1 text-sm text-white/90 drop-shadow sm:text-base">
                  {hero.tagline}
                </p>
              </div>
            </div>
            <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
              <div className="flex flex-col px-5 py-3 min-w-[110px]">
                <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                  Positions
                </span>
                <span className="text-base font-bold tabular-nums">
                  {filledCount}
                  <span className="text-xs font-normal text-muted">
                    {" "}
                    / {state.data.positions.length} filled
                  </span>
                </span>
              </div>
            </div>
          </header>

          <CabinetTabNav
            active={activeTab}
            showAdmin={state.data.isAdmin}
            onChange={setActiveTab}
          />

          {activeTab === "admin" && state.data.isAdmin && (
            <CabinetAdminTab
              countryId={countryId}
              seats={state.data.positions.map((position) => ({
                id: position.id,
                name: position.name,
                isHeadOfGovernment: position.isHeadOfGovernment,
                memberName: position.member?.characterName ?? null,
                cooldownUntil: position.cooldownUntil,
              }))}
              onChanged={fetchData}
            />
          )}

          {activeTab === "overview" && (
            <>
              <p className="text-sm text-muted mb-6 max-w-2xl">{description}</p>

              <section>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-4">
                  Cabinet Positions
                </h2>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Render the API roster — it is year-resolved (era-gated
                      seats filtered, era names substituted), unlike the static
                      config.positions. */}
                  {state.data!.positions.map((pos) => {
                    const positionData = pos;
                    const member = positionData.member ?? null;
                    const cooldownUntil = positionData.cooldownUntil ?? null;
                    const isOnCooldown = cooldownUntil && new Date(cooldownUntil) > new Date();
                    const isLoading = state.actionLoading[pos.id] ?? false;

                    return (
                      <div
                        key={pos.id}
                        className="rounded-xl border border-card-border bg-card p-4 shadow-card"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-foreground">{pos.name}</h3>
                          {state.data!.isPrimeMinister &&
                            member &&
                            !positionData?.isHeadOfGovernment && (
                              <Button
                                variant="secondary"
                                onClick={() => handleFire(pos.id)}
                                disabled={isLoading}
                                className="shrink-0 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                              >
                                {isLoading ? "..." : "Fire"}
                              </Button>
                            )}
                        </div>

                        {member ? (
                          <div className="mt-2 flex items-center gap-2">
                            <Avatar
                              url={member.avatarUrl}
                              name={member.characterName}
                              size="h-8 w-8"
                              className="rounded-lg shrink-0"
                              borderKey={member.borderKey}
                              tintColor={member.tintColor}
                            />
                            {member.characterId ? (
                              <Link
                                href={`/character/${member.sequentialId ?? member.characterId}`}
                                className="text-sm text-primary hover:underline truncate"
                              >
                                {member.characterName}
                              </Link>
                            ) : (
                              // NPP-held seat — no player profile to link to.
                              <span className="text-sm text-foreground truncate">
                                {member.characterName}
                                <span className="ml-1 text-xs text-muted">(NPP)</span>
                              </span>
                            )}
                            {member.partyName && member.partyColor && (
                              <PartyChip
                                partyName={member.partyName}
                                partyColor={member.partyColor}
                                partyId={member.party}
                                logoUrl={member.partyLogoUrl}
                                countryId={countryId}
                              />
                            )}
                          </div>
                        ) : (
                          <>
                            {isOnCooldown ? (
                              <span className="text-amber-600 text-sm">
                                Cooldown: {formatCooldownRemaining(cooldownUntil!)}
                              </span>
                            ) : (
                              <p className="text-sm text-muted italic">Vacant</p>
                            )}
                            {state.data!.isPrimeMinister &&
                              !isOnCooldown &&
                              positionData &&
                              !positionData.isHeadOfGovernment && (
                                <Button
                                  variant="secondary"
                                  onClick={() => handleOpenAppointModal(positionData)}
                                  disabled={isLoading}
                                  className="mt-2"
                                >
                                  {isLoading ? "..." : "Appoint"}
                                </Button>
                              )}
                          </>
                        )}

                        {/* The head-of-government seat is auto-assigned, not a
                        portfolio ministry — it has no ministerial office page. */}
                        {!positionData?.isHeadOfGovernment && (
                          <Link
                            href={`${governmentLinkPath}/cabinet/${pos.id}/office`}
                            className="mt-2 block text-xs text-primary hover:underline"
                          >
                            View Office →
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {state.selectedPosition && (
        <AppointModal
          isOpen={state.isAppointModalOpen}
          onClose={handleCloseAppointModal}
          position={state.selectedPosition}
          characters={state.eligibleCharacters}
          loading={state.charactersLoading}
          chamberMemberLabel={config.chamberMemberLabel}
          chamberName={config.chamberName}
          isOnePartyState={state.data?.isOnePartyState ?? false}
          onAppoint={handleAppoint}
        />
      )}
    </>
  );
}
