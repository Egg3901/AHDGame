"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Avatar } from "@/components/Avatar";
import { Badge, Button, Skeleton } from "@/components/ui";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { useToast } from "@/contexts/ToastContext";
import { CabinetVoteRow } from "@/app/whitehouse/cabinet/components/CabinetVoteRow";
import { CabinetNominateModal } from "@/app/whitehouse/cabinet/components/CabinetNominateModal";
import { CABINET_HERO } from "@/app/whitehouse/cabinet/CabinetConstants";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { legislatureUrl } from "@/lib/urls";
import { CabinetAdminTab } from "./CabinetAdminTab";
import { CabinetTabNav, type CabinetTabKey } from "./CabinetTabNav";

interface PositionMember {
  characterId: string;
  sequentialId?: number | null;
  characterName: string;
  party?: string;
  partyName?: string;
  partyColor?: string;
  partyLogoUrl?: string | null;
  avatarUrl?: string | null;
  confirmedAt: string;
  /** Seated directly by the President, without Senate confirmation. */
  acting?: boolean;
  /** Turn the acting appointment lapses. Null on a confirmed holder. */
  actingExpiresOnTurn?: number | null;
}

interface PositionNomination {
  id: string;
  nomineeCharacterId: string;
  nomineeCharacterName: string;
  nomineeParty?: string;
  nomineePartyName?: string;
  nomineePartyColor?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  myVote: "for" | "against" | "abstain" | null;
}

interface Position {
  id: string;
  name: string;
  order: number;
  member: PositionMember | null;
  nomination: PositionNomination | null;
  /** True once this President has used their one acting appointment here. */
  actingChargeSpent?: boolean;
}

interface CabinetResponse {
  positions: Position[];
  isPresident: boolean;
  isSenator: boolean;
  isAdmin: boolean;
  currentTurn?: number;
  /** False in countries that fill their cabinet without confirmation. */
  actingEnabled?: boolean;
  actingTenureTurns?: number;
}

interface Character {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  currentOffice?: Record<string, unknown> | null;
}

function getOrdinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const value = n % 100;
  return `${n}${suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]}`;
}

/**
 * Presidential cabinet: President nominates, the Senate confirms. Country-generic
 * — the same flow serves the US and any other presidential system (e.g. NG).
 * Position seats, the nominee pool, nominations and firing are all scoped by
 * `countryId` through the /api/whitehouse/cabinet routes.
 */
export default function PresidentialCabinetClient({ countryId }: { countryId: CountryId }) {
  const code = countryId.toLowerCase();
  const countryQuery = `?country=${encodeURIComponent(countryId)}`;
  // US keeps its Congress deep-link; other presidential systems point at their
  // own national legislature (where the confirmation vote is surfaced).
  const senateLink =
    countryId === COUNTRY_CONFIGS.US.id
      ? "/congress?chamber=senate&tab=bills"
      : legislatureUrl(countryId);
  const { showToast } = useToast();
  const [data, setData] = useState<CabinetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nominateModal, setNominateModal] = useState(false);
  // The acting flow reuses the nominee picker, so it shares the selection
  // state and only differs in which endpoint the submit hits.
  const [actingModal, setActingModal] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [selectedCharId, setSelectedCharId] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [nominateError, setNominateError] = useState("");
  const [votingId, setVotingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CabinetTabKey>("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/whitehouse/cabinet${countryQuery}`);
      if (!response.ok) {
        setError("Failed to load cabinet data. Please try again.");
        return;
      }
      setData((await response.json()) as CabinetResponse);
    } catch {
      setError("Network error - could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [countryQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if ((!nominateModal && !actingModal) || !data?.isPresident) return;
    fetch(`/api/whitehouse/cabinet/characters${countryQuery}`)
      .then((response) => (response.ok ? response.json() : { characters: [] }))
      .then((json) => setCharacters((json as { characters?: Character[] }).characters ?? []))
      .catch(() => setCharacters([]));
  }, [nominateModal, actingModal, data?.isPresident, countryQuery]);

  const activeNominations = useMemo(
    () => data?.positions.filter((position) => position.nomination?.status === "active") ?? [],
    [data]
  );

  const filledCount = data?.positions.filter((position) => position.member).length ?? 0;

  async function handleNominate() {
    if (!selectedPositionId || !selectedCharId) {
      setNominateError("Select a position and nominee");
      return;
    }
    setSubmitting(true);
    setNominateError("");
    try {
      const response = await fetch(`/api/whitehouse/cabinet/nominations${countryQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: selectedPositionId,
          nomineeCharacterId: selectedCharId,
        }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        setNominateError(json.error ?? "Failed to submit nomination");
        return;
      }
      showToast(json.message ?? "Nomination submitted", "success");
      setNominateModal(false);
      setSelectedPositionId("");
      setSelectedCharId("");
      await fetchData();
    } catch {
      setNominateError("Network error - please try again");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Install an acting secretary. Distinct from nominating: the seat is filled
   * at once, without a Senate vote, but the caretaker is limited in what they
   * may do and the appointment lapses on its own.
   */
  async function handleAppointActing() {
    if (!selectedPositionId || !selectedCharId) {
      setNominateError("Select a position and an appointee");
      return;
    }
    setSubmitting(true);
    setNominateError("");
    try {
      const response = await fetch(`/api/country/${code}/executive/cabinet/acting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: selectedPositionId,
          characterId: selectedCharId,
        }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        setNominateError(json.error ?? "Failed to appoint an acting secretary");
        return;
      }
      showToast(json.message ?? "Acting secretary appointed", "success");
      setActingModal(false);
      setSelectedPositionId("");
      setSelectedCharId("");
      await fetchData();
    } catch {
      setNominateError("Network error - please try again");
    } finally {
      setSubmitting(false);
    }
  }

  /** Open the appointee picker for a seat, in acting mode. */
  function openActingModal(positionId: string) {
    setSelectedPositionId(positionId);
    setActingModal(true);
    setSelectedCharId("");
    setNominateError("");
  }

  /** Turns left on an acting appointment, or null if it is not acting. */
  function actingTurnsLeft(member: PositionMember): number | null {
    if (!member.acting || member.actingExpiresOnTurn == null) return null;
    const turn = data?.currentTurn;
    if (turn == null) return null;
    return Math.max(0, member.actingExpiresOnTurn - turn);
  }

  /**
   * The appoint-acting control for an unfilled seat. Rendered disabled rather
   * than hidden once the charge is spent, so the one-per-seat rule is visible
   * before a President runs into it.
   */
  function renderActingControl(position: Position) {
    if (!data?.actingEnabled) return null;
    const spent = position.actingChargeSpent === true;
    return (
      <Button variant="secondary" disabled={spent} onClick={() => openActingModal(position.id)}>
        Appoint Acting
      </Button>
    );
  }

  /**
   * Why the appoint control is disabled. Kept separate from the button so it
   * can sit below the button row rather than inside it, and shared by both
   * unfilled-seat branches so the rule reads the same either way.
   */
  function renderActingChargeNote(position: Position) {
    if (!data?.actingEnabled || !data.isPresident || !position.actingChargeSpent) return null;
    return (
      <p className="mt-2 text-xs text-muted">
        You have already used your acting appointment for this office. It can only be filled by
        confirmation now.
      </p>
    );
  }

  async function handleVote(nominationId: string, vote: "for" | "against" | "abstain") {
    setVotingId(nominationId);
    try {
      const response = await fetch(
        `/api/whitehouse/cabinet/nominations/${nominationId}/vote${countryQuery}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote }),
        }
      );
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        showToast(json.error ?? "Failed to record vote", "error");
        return;
      }
      showToast(json.message ?? "Vote recorded", "success");
      await fetchData();
    } catch {
      showToast("Network error - please try again", "error");
    } finally {
      setVotingId(null);
    }
  }

  async function handleFire(positionId: string) {
    if (!confirm("Remove this cabinet member?")) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/whitehouse/cabinet/fire${countryQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        showToast(json.error ?? "Failed to remove cabinet member", "error");
        return;
      }
      showToast(json.message ?? "Cabinet member removed", "success");
      await fetchData();
    } catch {
      showToast("Network error - please try again", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <Skeleton className="h-64 rounded-2xl" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
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

  return (
    <>
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl space-y-6 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={`/country/${code}/executive`}
              className="text-muted transition-colors hover:text-foreground"
            >
              {countryId === COUNTRY_CONFIGS.US.id ? "Back to White House" : "Back to Executive"}
            </Link>
            <span className="text-muted">-</span>
            <Link href={senateLink} className="text-muted transition-colors hover:text-foreground">
              Senate confirmations
            </Link>
          </nav>

          <header className="relative mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
            <div className="relative h-[175px] w-full sm:h-[220px]">
              <HeroImage
                src={CABINET_HERO.image}
                alt={CABINET_HERO.alt}
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
                  {CABINET_HERO.title}
                </h1>
                <p className="mt-1 text-sm text-white/90 drop-shadow sm:text-base">
                  {CABINET_HERO.tagline}
                </p>
              </div>
            </div>
            <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
              <div className="flex min-w-[110px] flex-col px-5 py-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
                  Positions
                </span>
                <span className="text-base font-bold tabular-nums">
                  {filledCount}
                  <span className="text-xs font-normal text-muted">
                    {" "}
                    / {data.positions.length} filled
                  </span>
                </span>
              </div>
              <div className="flex min-w-[140px] flex-col px-5 py-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
                  Pending Votes
                </span>
                <span className="text-base font-bold tabular-nums">{activeNominations.length}</span>
              </div>
            </div>
          </header>

          <CabinetTabNav active={activeTab} showAdmin={data.isAdmin} onChange={setActiveTab} />

          {activeTab === "admin" && data.isAdmin && (
            <CabinetAdminTab
              countryId={countryId}
              seats={data.positions.map((position) => ({
                id: position.id,
                name: position.name,
                memberName: position.member?.characterName ?? null,
                cooldownUntil: null,
              }))}
              onChanged={fetchData}
            />
          )}

          {activeTab === "overview" && (
            <>
              <div className="mb-6 max-w-2xl space-y-2 text-sm text-muted">
                <p>
                  The President nominates principal officers who must be confirmed by the Senate.
                  The Cabinet advises the President on matters of domestic and foreign policy, with
                  each member leading a major executive department.
                </p>
                <p>
                  Cabinet members serve at the pleasure of the President and follow the line of
                  presidential succession after the Vice President. Confirmed members use the shared
                  cabinet office system for cabinet actions, standing orders, emergency powers, and
                  department settings.
                </p>
              </div>

              {data.isPresident && (
                <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        President - nominate a cabinet officer
                      </h2>
                      <p className="text-sm text-muted">
                        Sends a nomination to the Senate for confirmation before the office becomes
                        active.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setNominateModal(true);
                        setSelectedPositionId("");
                        setSelectedCharId("");
                        setNominateError("");
                      }}
                    >
                      Propose Nomination
                    </Button>
                  </div>
                </div>
              )}

              {activeNominations.length > 0 && (
                <section className="rounded-xl border border-warning/30 bg-card p-4 shadow-card">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        {activeNominations.length} nomination
                        {activeNominations.length === 1 ? "" : "s"} awaiting Senate vote
                      </h2>
                      <p className="text-sm text-muted">
                        Senators can vote here or from Congress. Each confirmation uses a 24-hour
                        simple-majority vote.
                      </p>
                    </div>
                    <Link
                      href={senateLink}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-card-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-all duration-150 hover:border-muted/40 hover:bg-card/80"
                    >
                      Open Senate
                    </Link>
                  </div>

                  {data.isSenator && (
                    <div className="mt-4 space-y-3">
                      {activeNominations.map((position) => (
                        <CabinetVoteRow
                          key={position.nomination!.id}
                          positionName={position.name}
                          nomination={position.nomination!}
                          isSenator={data.isSenator}
                          onVote={handleVote}
                          votingId={votingId}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section>
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
                  Principal Officers
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {getCabinetPositions(countryId).map((positionMeta) => {
                    const position =
                      data.positions.find((candidate) => candidate.id === positionMeta.id) ?? null;
                    if (!position) return null;

                    return (
                      <div
                        key={position.id}
                        className="rounded-xl border border-card-border bg-card p-4 shadow-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-foreground">{position.name}</h3>
                            <p className="mt-1 text-xs text-muted">
                              {getOrdinal(position.order)} in line
                            </p>
                          </div>
                          {data.isPresident && position.member && (
                            <Button
                              variant="secondary"
                              onClick={() => handleFire(position.id)}
                              disabled={submitting}
                              className="shrink-0 border-error/30 text-error hover:bg-error/10 hover:text-error"
                            >
                              {submitting ? "..." : "Fire"}
                            </Button>
                          )}
                        </div>

                        {position.member ? (
                          <div className="mt-3 flex items-center gap-3">
                            <Avatar
                              url={position.member.avatarUrl}
                              name={position.member.characterName}
                              size="h-9 w-9"
                              className="shrink-0 rounded-lg"
                            />
                            <div className="min-w-0">
                              <Link
                                href={`/character/${position.member.sequentialId ?? position.member.characterId}`}
                                className="block truncate text-sm font-medium text-primary hover:underline"
                              >
                                {position.member.characterName}
                              </Link>
                              {position.member.partyName && position.member.partyColor && (
                                <div className="mt-1">
                                  <PartyChip
                                    partyName={position.member.partyName}
                                    partyColor={position.member.partyColor}
                                    partyId={position.member.party}
                                    logoUrl={position.member.partyLogoUrl}
                                    countryId={countryId}
                                  />
                                </div>
                              )}
                              {position.member.acting && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge color="warning">Acting</Badge>
                                  {actingTurnsLeft(position.member) !== null && (
                                    <span className="text-xs text-muted">
                                      {actingTurnsLeft(position.member)} turns remaining
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : position.nomination ? (
                          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {position.nomination.nomineeCharacterName}
                                </p>
                                <p className="text-xs text-muted">
                                  {position.nomination.votesFor} for,{" "}
                                  {position.nomination.votesAgainst} against,{" "}
                                  {position.nomination.votesAbstain} abstain
                                </p>
                              </div>
                              <Badge color="warning">Senate Vote</Badge>
                            </div>
                            {data.isPresident && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setSelectedPositionId(position.id);
                                    setNominateModal(true);
                                    setSelectedCharId("");
                                    setNominateError("");
                                  }}
                                >
                                  Replace Nomination
                                </Button>
                                {renderActingControl(position)}
                              </div>
                            )}
                            {renderActingChargeNote(position)}
                          </div>
                        ) : (
                          <div className="mt-3">
                            <p className="text-sm italic text-muted">Vacant</p>
                            {data.isPresident && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setSelectedPositionId(position.id);
                                    setNominateModal(true);
                                    setSelectedCharId("");
                                    setNominateError("");
                                  }}
                                >
                                  Nominate
                                </Button>
                                {renderActingControl(position)}
                              </div>
                            )}
                            {renderActingChargeNote(position)}
                          </div>
                        )}

                        <Link
                          href={`/country/${code}/executive/cabinet/${position.id}/office`}
                          className="mt-3 block text-xs text-primary hover:underline"
                        >
                          Open Office
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <CabinetNominateModal
        open={nominateModal}
        positions={data.positions}
        characters={characters}
        selectedPositionId={selectedPositionId}
        selectedCharId={selectedCharId}
        message={nominateError}
        submitting={submitting}
        onPositionChange={setSelectedPositionId}
        onCharChange={setSelectedCharId}
        onSubmit={handleNominate}
        onCancel={() => {
          setNominateModal(false);
          setSelectedPositionId("");
          setSelectedCharId("");
          setNominateError("");
        }}
      />

      <CabinetNominateModal
        open={actingModal}
        positions={data.positions}
        characters={characters}
        selectedPositionId={selectedPositionId}
        selectedCharId={selectedCharId}
        message={nominateError}
        submitting={submitting}
        onPositionChange={setSelectedPositionId}
        onCharChange={setSelectedCharId}
        onSubmit={handleAppointActing}
        title="Appoint an Acting Secretary"
        description={`An acting secretary takes the seat at once, with no Senate vote. They may run the department day to day but cannot set policy, move personnel, or commit the nation to anything lasting. The appointment ends after ${data.actingTenureTurns ?? 24} turns, and you get only one per office per term.`}
        submitLabel="Appoint"
        nomineeLabel="Appointee"
        pendingNominationLabel=" (confirmation pending)"
        onCancel={() => {
          setActingModal(false);
          setSelectedPositionId("");
          setSelectedCharId("");
          setNominateError("");
        }}
      />
    </>
  );
}
