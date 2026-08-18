"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button, Skeleton } from "@/components/ui";
import { InfoTooltip } from "@/components/InfoTooltip";
import { useToast } from "@/contexts/ToastContext";
import { getPartyHex } from "@/lib/utils/politics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { legislatureUrl, executiveUrl, scotusJusticeOfficeUrl } from "@/lib/urls";
import { SCOTUS_HERO_IMAGE_URL } from "@/lib/scotus/justiceImages";
import { formatDeathChancePercent } from "@/lib/scotus/tenure";
import { ScotusSeatCard, type SeatCardData } from "./components/ScotusSeatCard";
import {
  ScotusNominateModal,
  type NomineeMode,
  type NominateCharacterOption,
  type NominatePartyOption,
} from "./components/ScotusNominateModal";
import { ScotusVoteRow, type ScotusNominationRow } from "./components/ScotusVoteRow";
import { DocketHistoryTab } from "./components/DocketHistoryTab";

interface ScotusResponse {
  seats: SeatCardData[];
  nominations: ScotusNominationRow[];
  isPresident: boolean;
  isSenator: boolean;
  isJustice: boolean;
  mySeatNumber: number | null;
}

interface PartyOption {
  id: string;
  name: string;
  color: string;
}

type TabKey = "bench" | "docket";

/** Hero banner (public-domain U.S. Supreme Court building). Uses next/image
 *  `unoptimized` because the external host is not in next.config remotePatterns;
 *  hides itself on a load error so a broken image never leaves an empty band. */
function ScotusHero() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="relative h-40 w-full sm:h-48">
      <Image
        src={SCOTUS_HERO_IMAGE_URL}
        alt="United States Supreme Court building"
        fill
        priority
        unoptimized
        sizes="100vw"
        className="object-cover object-[center_30%]"
        onError={() => setFailed(true)}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
    </div>
  );
}

/**
 * SCOTUS UI (#3605, spec #3581) — US only. Court composition (bench + ideology
 * leans), the president's nomination flow, the Senate's confirmation flow, and
 * a Docket History tab. Deliberately mirrors `PresidentialCabinetClient`
 * (structure, nominate/vote plumbing) and `CabinetNominateModal`/`CabinetVoteRow`
 * (component shape) since #3605 asks for the same look and feel as cabinet
 * nomination/confirmation, not a new pattern.
 */
export default function SupremeCourtClient({ countryId }: { countryId: CountryId }) {
  const code = countryId.toLowerCase();
  const isUS = countryId === COUNTRY_CONFIGS.US.id;
  const countryQuery = `?country=${encodeURIComponent(countryId)}`;
  const senateLink =
    countryId === COUNTRY_CONFIGS.US.id
      ? "/congress?chamber=senate&tab=bills"
      : legislatureUrl(countryId);
  const { showToast } = useToast();

  const [data, setData] = useState<ScotusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("bench");

  const [parties, setParties] = useState<PartyOption[]>([]);

  const [nominateModal, setNominateModal] = useState(false);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(null);
  const [mode, setMode] = useState<NomineeMode>("character");
  const [characters, setCharacters] = useState<NominateCharacterOption[]>([]);
  const [selectedCharId, setSelectedCharId] = useState("");
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [nominateError, setNominateError] = useState("");
  const [votingId, setVotingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/whitehouse/scotus${countryQuery}`);
      if (!response.ok) {
        setError("Failed to load Supreme Court data. Please try again.");
        return;
      }
      setData((await response.json()) as ScotusResponse);
    } catch {
      setError("Network error - could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [countryQuery]);

  useEffect(() => {
    if (!isUS) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [fetchData, isUS]);

  useEffect(() => {
    if (!isUS) return;
    fetch(`/api/country/${code}/parties`)
      .then((res) => (res.ok ? res.json() : { parties: [] }))
      .then((json: { parties?: { id: string; name: string; color: string }[] }) => {
        setParties(
          (json.parties ?? [])
            .filter((p) => p.id !== "independent")
            .map((p) => ({ id: p.id, name: p.name, color: p.color }))
        );
      })
      .catch(() => setParties([]));
  }, [code, isUS]);

  useEffect(() => {
    if (!nominateModal || !data?.isPresident) return;
    fetch(`/api/whitehouse/cabinet/characters${countryQuery}`)
      .then((res) => (res.ok ? res.json() : { characters: [] }))
      .then((json: { characters?: NominateCharacterOption[] }) =>
        setCharacters(json.characters ?? [])
      )
      .catch(() => setCharacters([]));
  }, [nominateModal, data?.isPresident, countryQuery]);

  const partyMap = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const partyOptions: NominatePartyOption[] = useMemo(
    () => parties.map((p) => ({ id: p.id, name: p.name })),
    [parties]
  );

  function resolveParty(partyId: string | null): { name: string | null; color: string | null } {
    if (!partyId) return { name: null, color: null };
    const known = partyMap.get(partyId);
    return { name: known?.name ?? partyId, color: getPartyHex(partyId, known?.color) };
  }

  const vacantSeats = useMemo(() => data?.seats.filter((s) => s.vacant) ?? [], [data]);
  const nominationBySeat = useMemo(
    () => new Map((data?.nominations ?? []).map((n) => [n.seatNumber, n])),
    [data]
  );
  const seatedCount = data?.seats.filter((s) => !s.vacant).length ?? 0;

  function openNominateModal(seatNumber?: number) {
    setSelectedSeatNumber(seatNumber ?? null);
    setMode("character");
    setSelectedCharId("");
    setSelectedPartyId("");
    setNominateError("");
    setNominateModal(true);
  }

  async function handleNominate() {
    if (!selectedSeatNumber) {
      setNominateError("Select a seat");
      return;
    }
    if (mode === "character" && !selectedCharId) {
      setNominateError("Select a nominee");
      return;
    }
    if (mode === "npp" && !selectedPartyId) {
      setNominateError("Select a party");
      return;
    }
    setSubmitting(true);
    setNominateError("");
    try {
      const response = await fetch("/api/whitehouse/scotus/nominate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatNumber: selectedSeatNumber,
          ...(mode === "character"
            ? { nomineeCharacterId: selectedCharId }
            : { nppLegalScholarParty: selectedPartyId }),
        }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        setNominateError(json.error ?? "Failed to submit nomination");
        return;
      }
      showToast(json.message ?? "Nomination submitted", "success");
      setNominateModal(false);
      await fetchData();
    } catch {
      setNominateError("Network error - please try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(nominationId: string, vote: "for" | "against" | "abstain") {
    setVotingId(nominationId);
    try {
      const response = await fetch(`/api/whitehouse/scotus/nominations/${nominationId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
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

  if (!isUS) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <h1 className="text-lg font-semibold text-foreground">Supreme Court</h1>
            <p className="mt-2 text-sm text-muted">
              The Supreme Court is currently modeled for the United States only.
            </p>
            <Link
              href={executiveUrl(countryId)}
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              Back to {COUNTRY_CONFIGS[countryId]?.executiveTitle ?? "Executive"}
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <Skeleton className="h-40 rounded-2xl" />
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="mb-4 text-muted">{error ?? "Failed to load Supreme Court data."}</p>
            <Button variant="primary" onClick={fetchData}>
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const activeNominations = data.nominations;

  return (
    <>
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl space-y-6 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/whitehouse" className="text-muted transition-colors hover:text-foreground">
              Back to White House
            </Link>
            <span className="text-muted">-</span>
            <Link href={senateLink} className="text-muted transition-colors hover:text-foreground">
              Senate confirmations
            </Link>
            {data.isJustice && (
              <>
                <span className="text-muted">-</span>
                <Link
                  href={scotusJusticeOfficeUrl(countryId)}
                  className="text-primary transition-colors hover:underline"
                >
                  My Justice Office
                </Link>
              </>
            )}
          </nav>

          <header className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
            <ScotusHero />
            <div className="p-6">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">Supreme Court</h1>
                <InfoTooltip
                  width={300}
                  trigger={
                    <span
                      aria-label="How the Supreme Court works"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-card-border bg-card-elevated text-xs font-semibold text-muted transition-colors hover:text-foreground"
                    >
                      ?
                    </span>
                  }
                >
                  <div className="space-y-2 text-left text-sm">
                    <p className="font-semibold text-foreground">How the Court works</p>
                    <ul className="list-disc space-y-1 pl-4 text-muted">
                      <li>
                        The President nominates a justice, a player or a generated candidate, and
                        the Senate confirms by majority vote.
                      </li>
                      <li>
                        Historical justices leave on their real dates. Divergent justices have a{" "}
                        {formatDeathChancePercent()} death chance each turn after about two years,
                        which opens the seat.
                      </li>
                      <li>
                        The court&apos;s ideological balance decides whether landmark historical
                        cases play out as they really did or diverge into alternate outcomes.
                      </li>
                      <li>
                        A diverged ruling changes real policy, national and state metrics, and
                        regional political lean.
                      </li>
                    </ul>
                  </div>
                </InfoTooltip>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                Nine seats. Historical justices follow real departure dates. Divergent justices have
                a {formatDeathChancePercent()} death chance each turn after their first two years.
                The President nominates; the Senate confirms by simple majority.
              </p>
              <div className="mt-4 flex items-center gap-6 border-t border-card-border pt-4">
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
                    Seated
                  </span>
                  <p className="text-base font-bold tabular-nums">
                    {seatedCount}
                    <span className="text-xs font-normal text-muted"> / 9</span>
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
                    Pending Votes
                  </span>
                  <p className="text-base font-bold tabular-nums">{activeNominations.length}</p>
                </div>
              </div>
            </div>
          </header>

          <nav
            className="flex overflow-x-auto border-b border-card-border"
            aria-label="Supreme Court sections"
          >
            <button
              onClick={() => setActiveTab("bench")}
              className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${
                activeTab === "bench"
                  ? "border-b-2 border-primary font-medium text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
              aria-current={activeTab === "bench" ? "page" : undefined}
            >
              Bench
            </button>
            <button
              onClick={() => setActiveTab("docket")}
              className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${
                activeTab === "docket"
                  ? "border-b-2 border-primary font-medium text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
              aria-current={activeTab === "docket" ? "page" : undefined}
            >
              Docket History
            </button>
          </nav>

          {activeTab === "bench" && (
            <>
              {data.isPresident && vacantSeats.length > 0 && (
                <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        President - nominate a Justice
                      </h2>
                      <p className="text-sm text-muted">
                        Sends a nomination to the Senate for confirmation before the seat is filled.
                      </p>
                    </div>
                    <Button variant="primary" onClick={() => openNominateModal()}>
                      Nominate a Justice
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
                      {activeNominations.map((nomination) => (
                        <ScotusVoteRow
                          key={nomination.id}
                          nomination={nomination}
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
                  The Bench
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.seats.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
                      The Court has not been seeded for this game yet.
                    </div>
                  ) : (
                    data.seats.map((seat) => {
                      const { name, color } = resolveParty(seat.justiceParty);
                      const pendingForSeat = nominationBySeat.get(seat.seatNumber);
                      return (
                        <div key={seat.seatNumber}>
                          <ScotusSeatCard
                            seat={seat}
                            partyName={name}
                            partyColor={color}
                            canNominate={data.isPresident && !pendingForSeat}
                            onNominate={() => openNominateModal(seat.seatNumber)}
                          />
                          {pendingForSeat && (
                            <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                              <p className="truncate text-xs font-medium text-foreground">
                                {pendingForSeat.nomineeName} - Senate vote pending
                              </p>
                              {data.isPresident && (
                                <button
                                  onClick={() => openNominateModal(seat.seatNumber)}
                                  className="mt-1 text-xs text-primary hover:underline"
                                >
                                  Replace nomination
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </>
          )}

          {activeTab === "docket" && <DocketHistoryTab countryCode={code} />}
        </main>
      </div>

      <ScotusNominateModal
        open={nominateModal}
        vacantSeats={vacantSeats.map((s) => ({
          seatNumber: s.seatNumber,
          hasPendingNomination: nominationBySeat.has(s.seatNumber),
        }))}
        characters={characters}
        parties={partyOptions}
        selectedSeatNumber={selectedSeatNumber}
        mode={mode}
        selectedCharId={selectedCharId}
        selectedPartyId={selectedPartyId}
        message={nominateError}
        submitting={submitting}
        onSeatChange={setSelectedSeatNumber}
        onModeChange={setMode}
        onCharChange={setSelectedCharId}
        onPartyChange={setSelectedPartyId}
        onSubmit={handleNominate}
        onCancel={() => setNominateModal(false)}
      />
    </>
  );
}
