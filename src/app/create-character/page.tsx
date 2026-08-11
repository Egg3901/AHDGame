"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Input, Skeleton } from "@/components/ui";
import { partiesApiUrl } from "@/lib/urls";
import { JP_REGIONS } from "@/lib/constants/japan";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { formatLocalAmountFull } from "@/lib/utils/formatters";
import {
  getWealthBonus,
  WEALTH_LEVELS,
  convertStartingAnchorToLocal,
  resolveStartingCurrency,
  type WealthLevel,
} from "@/lib/constants/characterWealth";
import { nearestParty, type CompassPoint } from "@/lib/registration/alignment";
import type { State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyOption, CountryCreationInfo } from "../register/components/registerTypes";
import { DiscordLinkSection } from "./DiscordLinkSection";
import {
  StatPointAllocator,
  defaultStatBuild,
  pointsRemaining,
} from "@/components/stats/StatPointAllocator";
import { STAT_FREE_POINTS, STAT_MIN } from "@/lib/stats/statsConstants";
import { ChipGroup, FieldCaption, StepPanel } from "./creatorPrimitives";
import { CompassPicker, type CompassParty } from "./CompassPicker";
import { CompassLegend } from "./CompassLegend";
import { HomeStatePicker } from "./HomeStatePicker";
import { PartyPicker } from "./PartyPicker";
import { CandidateFile, type CandidateFileRequirement } from "./CandidateFile";
import { OnePartyStateNotice } from "./OnePartyStateNotice";
import { useImagePick, uploadCharacterImage } from "./useImagePick";
import { EDUCATION_OPTIONS, GENDER_OPTIONS, RACE_OPTIONS } from "./creatorOptions";
import { generateUniqueNPPNameAndGender } from "@/lib/npp/nameGenerator";

const JP_REGION_ID_SET = new Set(JP_REGIONS.map((r) => r.id));

interface GameCreationInfo {
  gameDate: string;
  startDate: string;
  flavorText: string;
  /** In-game date the flavour text is written in: the world's opening turn. */
  flavorDate: string;
  preset: string;
  countries: CountryCreationInfo[];
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Upload budget for the optional portrait/header, in ms. */
const IMAGE_UPLOAD_BUDGET_MS = 15_000;

/**
 * Resolves when `work` settles or `ms` elapses, whichever comes first. Rejections
 * are swallowed. Used for best-effort steps that must never block navigation:
 * without a bound, one hung request leaves the player on a spinning button.
 */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work
      .catch(() => {})
      .then(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/** Region wording differs by country — the UK and Japan have no "states". */
function regionNounFor(countryId: string): string {
  return countryId === "uk" || countryId === "jp" ? "region" : "state";
}

export default function CreateCharacterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [states, setStates] = useState<State[]>([]);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [creationInfo, setCreationInfo] = useState<GameCreationInfo | null>(null);
  const [countryOptions, setCountryOptions] = useState<CountryCreationInfo[] | undefined>(
    undefined
  );
  const [statePlayerCounts, setStatePlayerCounts] = useState<Record<string, number>>({});

  // Discord linked state from auth/me
  const [discordLinked, setDiscordLinked] = useState(false);
  const [discordData, setDiscordData] = useState<{
    discordId?: string;
    discordUsername?: string;
    discordAvatar?: string;
  }>({});

  const [country, setCountry] = useState<string>("");

  // Optional portrait / header. Held locally and uploaded once the character
  // exists, since both upload routes write onto an existing character doc.
  const portrait = useImagePick(2 * 1024 * 1024);
  const header = useImagePick(4 * 1024 * 1024);

  // RPG stat allocation: opens with every stat on the floor, 21 points to spend.
  const [stats, setStats] = useState(defaultStatBuild());

  // Steps 4 and 5 both open on a legal default (dead centre of the compass,
  // Independent). They used to be badged complete before the player had looked
  // at them, which let someone sail past the party step into a character who
  // cannot stand for most offices. Neither counts as answered until touched.
  const [compassTouched, setCompassTouched] = useState(false);
  const [partyTouched, setPartyTouched] = useState(false);
  // Gated behind the RPG-stats feature flag (from /api/auth/me).
  const [rpgStatsEnabled, setRpgStatsEnabled] = useState(false);

  const [formData, setFormData] = useState({
    characterName: "",
    homeState: "",
    party: "independent",
    policyPositions: {
      economic: 0,
      social: 0,
    },
    demographics: {
      race: "",
      gender: "",
      education: "",
      wealth: "",
    },
  });

  const filteredStates = useMemo(
    () =>
      country
        ? states.filter((s) => {
            const c = country.toLowerCase();
            if ((s.countryId ?? "US").toLowerCase() === c) return true;
            return c === "jp" && !s.countryId && JP_REGION_ID_SET.has(s._id);
          })
        : [],
    [country, states]
  );

  const majorParties = useMemo(() => parties.filter((p) => p.isDefault), [parties]);
  const communityParties = useMemo(() => parties.filter((p) => !p.isDefault), [parties]);

  // Scroll to error when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  // Auth check: require login, redirect if non-admin already has character
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          router.replace("/login?returnUrl=" + encodeURIComponent("/create-character"));
          return;
        }
        const data = await res.json();
        if (!data.user) {
          router.replace("/login?returnUrl=" + encodeURIComponent("/create-character"));
          return;
        }
        // A non-admin who already has an active character does not belong on the
        // creation screen — send them into the app. (Admins retain multi-character
        // support and may create additional characters here.) This also prevents
        // anyone getting stuck here from a stale character-gate hint cookie.
        if (data.user.hasCharacter && !data.user.isAdmin) {
          // Straight to /profile, avoiding the /dashboard redirect stub during a
          // client-side navigation (see the note on the post-create push below).
          router.replace("/profile");
          return;
        }
        setRpgStatsEnabled(data.user.rpgStatsEnabled === true);
        // Capture Discord linking state
        if (data.user.discordId) {
          setDiscordLinked(true);
          setDiscordData({
            discordId: data.user.discordId,
            discordUsername: data.user.discordUsername,
            discordAvatar: data.user.discordAvatar,
          });
        }
        setAuthChecked(true);
      } catch {
        router.replace("/login?returnUrl=" + encodeURIComponent("/create-character"));
      }
    };
    checkAuth();
  }, [router]);

  // Fetch states and full creation info (countries + game date + flavor text)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statesRes, countriesRes, stateCountsRes] = await Promise.all([
          fetch("/api/game/states?playableHome=1"),
          fetch("/api/game/countries"),
          fetch("/api/game/state-player-counts"),
        ]);
        if (statesRes.ok) setStates(await statesRes.json());
        if (stateCountsRes.ok) {
          const countsData = await stateCountsRes.json();
          setStatePlayerCounts(countsData.counts ?? {});
        }
        if (countriesRes.ok) {
          const data = await countriesRes.json();
          setCreationInfo({
            gameDate: data.gameDate,
            startDate: data.startDate,
            flavorText: data.flavorText,
            flavorDate: data.flavorDate ?? data.startDate,
            preset: data.preset,
            countries: data.countries ?? [],
          });
          setCountryOptions(data.countries ?? []);
        } else {
          setCountryOptions([]);
          setCreationInfo(null);
        }
      } catch (err) {
        console.error("Failed to fetch initial data:", err);
      }
    };
    fetchData();
  }, []);

  // If server drops a country from the enabled list, clear a stale selection (empty region list).
  useEffect(() => {
    if (countryOptions === undefined || !country) return;
    if (countryOptions.some((o) => o.id === country)) return;
    setCountry("");
    setPartyTouched(false);
    setFormData((prev) => ({ ...prev, homeState: "", party: "independent" }));
  }, [countryOptions, country]);

  // Fetch parties when country changes
  useEffect(() => {
    if (!country) {
      setParties([]);
      return;
    }
    let cancelled = false;
    const fetchParties = async () => {
      try {
        const res = await fetch(partiesApiUrl(country));
        if (res.ok) {
          const data = await res.json();
          // Guard against out-of-order responses when the country selection
          // changes again before this request resolves.
          if (!cancelled) setParties(data.parties ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch parties:", err);
      }
    };
    fetchParties();
    return () => {
      cancelled = true;
    };
  }, [country]);

  const handleCountrySelect = (c: string) => {
    setCountry(c);
    // Party resets to Independent with the country, so the deliberate-choice
    // flag has to reset with it.
    setPartyTouched(false);
    setFormData((prev) => ({ ...prev, homeState: "", party: "independent" }));
  };

  /**
   * Randomize picks the country first, then draws the name from that
   * country's NPP pool — the same pools the game names every NPP from. The
   * randomizer used to carry its own thirty US first names and thirty US
   * surnames, so rolling Japan or Turkey handed you an American name.
   */
  const handleRandomize = useCallback(() => {
    if (!countryOptions || countryOptions.length === 0) return;
    const randomCountry = pick(countryOptions);
    const cId = randomCountry.id;

    // The generated gender is carried into demographics so the name and the
    // character it describes agree.
    const generated =
      generateUniqueNPPNameAndGender([], 100, cId) ?? generateUniqueNPPNameAndGender([], 100);
    const randomName = generated?.name ?? "";

    // Pick a random state from that country
    const cStates = states.filter((s) => {
      const uc = cId.toLowerCase();
      if ((s.countryId ?? "US").toLowerCase() === uc) return true;
      return uc === "jp" && !s.countryId && JP_REGION_ID_SET.has(s._id);
    });
    const randomState = cStates.length > 0 ? pick(cStates)._id : "";

    // Pick a random party from default parties (fallback to independent)
    const defaultParties = parties.filter((p) => p.isDefault);
    const randomParty = defaultParties.length > 0 ? pick(defaultParties).id : "independent";

    // Pick random policy positions
    const randomEconomic = Math.floor(Math.random() * 11) - 5;
    const randomSocial = Math.floor(Math.random() * 11) - 5;

    setCountry(cId);
    // Randomize answers both open-default steps on the player's behalf.
    setCompassTouched(true);
    setPartyTouched(true);
    setFormData({
      characterName: randomName,
      homeState: randomState,
      party: randomParty,
      policyPositions: {
        economic: randomEconomic,
        social: randomSocial,
      },
      demographics: {
        race: pick(RACE_OPTIONS).value,
        gender: generated?.gender ?? pick(GENDER_OPTIONS).value,
        education: pick(EDUCATION_OPTIONS).value,
        wealth: pick(WEALTH_LEVELS).value,
      },
    });
  }, [countryOptions, states, parties]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (!formData.characterName || formData.characterName.length < 2) {
      setError("Please enter a character name");
      setIsLoading(false);
      return;
    }

    if (!country) {
      setError("Please select a country to play in");
      setIsLoading(false);
      return;
    }

    if (!formData.homeState) {
      setError(`Please select a home ${regionNounFor(country)}`);
      setIsLoading(false);
      return;
    }

    if (
      !formData.demographics.race ||
      !formData.demographics.gender ||
      !formData.demographics.education ||
      !formData.demographics.wealth
    ) {
      setError("Please select all background options for your character");
      setIsLoading(false);
      return;
    }

    if (rpgStatsEnabled && pointsRemaining(stats) !== 0) {
      setError("Please allocate all of your stat points before continuing");
      setIsLoading(false);
      return;
    }

    // Only creation itself can fail the submit. Once the POST succeeds the
    // character exists, and reporting a failure — or spinning forever — for a
    // character the player already owns is worse than a cold nav.
    try {
      const characterRes = await fetch("/api/auth/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.characterName,
          homeState: formData.homeState,
          // Country selection happens earlier in the flow; pass it explicitly so
          // the server can scope the state lookup against cross-country
          // state-ID collisions (e.g. CN HB / DE HB).
          countryId: country.toUpperCase(),
          party: formData.party,
          policies: formData.policyPositions,
          demographics: formData.demographics,
          ...(rpgStatsEnabled ? { stats } : {}),
        }),
      });

      if (!characterRes.ok) {
        const data = await characterRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create character");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsLoading(false);
      return;
    }

    // Images are optional extras: the character already exists, so a failed or
    // slow upload must not fail creation. The player can set them later on their
    // profile page.
    await settleWithin(
      Promise.all([
        portrait.file ? uploadCharacterImage("/api/upload/avatar", portrait.file) : null,
        header.file ? uploadCharacterImage("/api/upload/profile-header", header.file) : null,
      ]),
      IMAGE_UPLOAD_BUDGET_MS
    );

    // Hard nav instead of router.refresh() + router.push(). A full document load
    // re-fetches every server component and re-reads the new auth cookie state,
    // which a soft nav after refresh() cannot do reliably (the push races the
    // cache invalidation and gets dropped, leaving the button spinning forever).
    window.location.assign("/profile");
  };

  // ── Derived view state ─────────────────────────────────────────────────────

  const position: CompassPoint = {
    economic: formData.policyPositions.economic,
    social: formData.policyPositions.social,
  };
  const regionNoun = regionNounFor(country);
  const selectedCountry = countryOptions?.find((o) => o.id === country) ?? null;
  const selectedState = filteredStates.find((s) => s._id === formData.homeState) ?? null;

  const electorate: CompassPoint | null =
    selectedState?.cachedEconomicLean != null && selectedState.cachedSocialLean != null
      ? { economic: selectedState.cachedEconomicLean, social: selectedState.cachedSocialLean }
      : null;

  const compassParties: CompassParty[] = useMemo(
    () =>
      parties.flatMap((p) =>
        p.economicPosition == null || p.socialPosition == null
          ? []
          : [
              {
                id: p.id,
                name: p.name,
                abbreviation: p.abbreviation,
                color: p.color,
                economic: p.economicPosition,
                social: p.socialPosition,
              },
            ]
      ),
    [parties]
  );

  const isOnePartyState = selectedCountry?.governmentType === "onePartyState";
  const rulingParty = parties.find((p) => p.regimeStatus === "ruling") ?? null;

  const closest = nearestParty(position, compassParties);
  const selectedParty = parties.find((p) => p.id === formData.party) ?? null;
  const selectedPartyPoint: CompassPoint | null =
    selectedParty?.economicPosition != null && selectedParty.socialPosition != null
      ? { economic: selectedParty.economicPosition, social: selectedParty.socialPosition }
      : null;

  const { currencyCode } = resolveStartingCurrency(country);
  // Same function the API route applies, so preview == grant.
  const worldPreset = creationInfo?.preset;
  const wealthOptions = WEALTH_LEVELS.map(({ value, label }) => ({
    value,
    label,
    note: formatLocalAmountFull(
      convertStartingAnchorToLocal(getWealthBonus(value, worldPreset), country),
      currencyCode
    ),
  }));

  const startingCapital = formData.demographics.wealth
    ? formatLocalAmountFull(
        convertStartingAnchorToLocal(
          getWealthBonus(formData.demographics.wealth as WealthLevel, worldPreset),
          country
        ),
        currencyCode
      )
    : null;

  const backgroundComplete = Boolean(
    formData.demographics.race &&
    formData.demographics.gender &&
    formData.demographics.education &&
    formData.demographics.wealth
  );

  const statPointsLeft = pointsRemaining(stats);
  const requirements: CandidateFileRequirement[] = [
    { key: "country", label: "Choose a country", met: Boolean(country) },
    { key: "name", label: "Name your politician", met: formData.characterName.trim().length >= 2 },
    { key: "background", label: "Complete the background", met: backgroundComplete },
    { key: "region", label: `Choose a home ${regionNoun}`, met: Boolean(formData.homeState) },
    // Independent is the opening value, so without this the player can file a
    // character who cannot stand for most offices without ever having seen the
    // party step. Picking Independent on purpose satisfies it.
    {
      key: "party",
      label: "Pick a party, or choose Independent on purpose",
      met: partyTouched,
    },
    ...(rpgStatsEnabled
      ? [
          {
            key: "stats",
            label: `Allocate ${statPointsLeft} remaining stat point${
              statPointsLeft === 1 ? "" : "s"
            }`,
            met: statPointsLeft === 0,
          },
        ]
      : []),
  ];

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const countriesLoading = countryOptions === undefined;

  return (
    <div className="min-h-screen bg-background">
      {/* Dateline. Deliberately not a hero: this is a form, so the era belongs
          in the record rather than on a banner. */}
      <header className="border-b border-card-border bg-card-muted">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-heading font-semibold tracking-tight">New candidate</h1>
            {creationInfo ? (
              <p className="font-mono text-body-xs uppercase tracking-[0.14em] text-muted">
                {creationInfo.gameDate}
                <span className="mx-2 text-card-border">|</span>
                world began {creationInfo.startDate}
              </p>
            ) : (
              <Skeleton className="h-3 w-56" />
            )}
          </div>
          {/* The flavour text is the world's opening scene, written in the
              present tense of turn 1. Once the world has run on it is years out
              of date, so it is labelled with the date it describes rather than
              presented as the current situation. */}
          {creationInfo ? (
            creationInfo.flavorText && (
              <div className="mt-1.5 max-w-3xl">
                <p className="font-mono text-body-xs uppercase tracking-[0.14em] text-muted/70">
                  How it started &mdash; {creationInfo.flavorDate}
                </p>
                <p className="mt-1 text-body-sm leading-relaxed text-muted">
                  {creationInfo.flavorText}
                </p>
              </div>
            )
          ) : (
            <Skeleton className="mt-2 h-3 w-full max-w-2xl" />
          )}
        </div>
      </header>

      <form onSubmit={handleSubmit}>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          {/* ── Working column ──────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4">
            {error && (
              <div
                ref={errorRef}
                role="alert"
                className="rounded border border-error/30 bg-error/10 px-3 py-2 text-body-sm text-error"
              >
                {error}
              </div>
            )}

            <StepPanel
              step={1}
              title="Country"
              subtitle="Sets your offices, parties, currency, and electoral rules."
              complete={Boolean(country)}
            >
              {countriesLoading ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : countryOptions.length === 0 ? (
                <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-warning">
                  No countries are open to new characters right now. Please try again later or
                  contact support.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {countryOptions.map((option) => {
                      const selected = country === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleCountrySelect(option.id)}
                          aria-pressed={selected}
                          className={`flex items-center gap-3 rounded border px-3 py-2 text-left transition-colors ${
                            selected
                              ? "border-primary bg-primary/10"
                              : "border-card-border bg-card-muted hover:border-primary/40"
                          }`}
                        >
                          <span className="relative h-7 w-10 shrink-0 overflow-hidden rounded-sm">
                            <Image
                              src={option.flagUrl}
                              alt=""
                              fill
                              sizes="40px"
                              className="object-cover"
                              unoptimized={bypassNextImageOptimization(option.flagUrl)}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body font-semibold">
                              {option.name}
                            </span>
                            <span className="block truncate text-body-xs text-muted">
                              {option.desc}
                            </span>
                          </span>
                          <span
                            className="shrink-0 font-mono text-body-xs text-muted"
                            title={`${option.playerCount} registered players`}
                          >
                            {option.playerCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {isOnePartyState && selectedCountry && (
                    <div className="mt-2">
                      <OnePartyStateNotice
                        countryName={selectedCountry.name}
                        rulingPartyName={rulingParty?.name ?? null}
                      />
                    </div>
                  )}
                </>
              )}
            </StepPanel>

            <StepPanel
              step={2}
              title="The politician"
              subtitle="Voter groups weigh these when they decide whether you are one of them."
              complete={formData.characterName.trim().length >= 2 && backgroundComplete}
              disabled={!country}
            >
              <div className="space-y-4">
                <div>
                  <FieldCaption required>Name</FieldCaption>
                  <div className="flex gap-2">
                    <Input
                      id="characterName"
                      type="text"
                      value={formData.characterName}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, characterName: e.target.value }))
                      }
                      className="min-w-0 flex-1 bg-background"
                      placeholder="e.g. Eleanor Vance"
                    />
                    <button
                      type="button"
                      onClick={handleRandomize}
                      className="shrink-0 rounded border border-dashed border-card-border px-3 text-body-sm text-muted transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      Randomize all
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ChipGroup
                    label="Gender"
                    required
                    value={formData.demographics.gender}
                    options={GENDER_OPTIONS.map((o) => ({ ...o }))}
                    onChange={(gender) =>
                      setFormData((prev) => ({
                        ...prev,
                        demographics: { ...prev.demographics, gender },
                      }))
                    }
                  />
                  <ChipGroup
                    label="Race"
                    required
                    value={formData.demographics.race}
                    options={RACE_OPTIONS.map((o) => ({ ...o }))}
                    onChange={(race) =>
                      setFormData((prev) => ({
                        ...prev,
                        demographics: { ...prev.demographics, race },
                      }))
                    }
                  />
                  <ChipGroup
                    label="Education"
                    required
                    value={formData.demographics.education}
                    options={EDUCATION_OPTIONS.map((o) => ({ ...o }))}
                    onChange={(education) =>
                      setFormData((prev) => ({
                        ...prev,
                        demographics: { ...prev.demographics, education },
                      }))
                    }
                  />
                  <ChipGroup
                    label="Wealth"
                    required
                    hint="Starting capital"
                    value={formData.demographics.wealth}
                    options={wealthOptions}
                    onChange={(wealth) =>
                      setFormData((prev) => ({
                        ...prev,
                        demographics: { ...prev.demographics, wealth },
                      }))
                    }
                  />
                </div>
              </div>
            </StepPanel>

            <StepPanel
              step={3}
              title={`Home ${regionNoun}`}
              subtitle="Your first constituency. Its electorate decides your early races."
              complete={Boolean(formData.homeState)}
              disabled={!country}
            >
              {filteredStates.length === 0 ? (
                <p className="rounded border border-dashed border-card-border px-3 py-6 text-center text-body-sm text-muted">
                  {!country
                    ? "Choose a country first."
                    : states.length === 0
                      ? `Loading ${regionNoun}s…`
                      : `No ${regionNoun}s are available for this country yet.`}
                </p>
              ) : (
                <HomeStatePicker
                  states={filteredStates}
                  value={formData.homeState}
                  onChange={(homeState) => setFormData((prev) => ({ ...prev, homeState }))}
                  playerCounts={statePlayerCounts}
                  position={position}
                  regionNoun={regionNoun}
                />
              )}
            </StepPanel>

            <StepPanel
              step={4}
              title="Where you stand"
              subtitle="Drag your pin. Distance to a platform is what primaries and general elections actually measure."
              complete={compassTouched}
              disabled={!country}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
                <CompassPicker
                  value={position}
                  onChange={(next) => {
                    setCompassTouched(true);
                    setFormData((prev) => ({ ...prev, policyPositions: { ...next } }));
                  }}
                  parties={compassParties}
                  electorate={
                    electorate && selectedState
                      ? { ...electorate, label: `${selectedState.name} electorate` }
                      : null
                  }
                  selectedPartyId={formData.party}
                  highlightPartyId={closest?.party.id}
                  pinColor={selectedParty?.color}
                />

                <div className="space-y-3">
                  <AxisStepper
                    label="Economic"
                    leftLabel="Left"
                    rightLabel="Right"
                    value={position.economic}
                    onChange={(economic) => {
                      setCompassTouched(true);
                      setFormData((prev) => ({
                        ...prev,
                        policyPositions: { ...prev.policyPositions, economic },
                      }));
                    }}
                  />
                  <AxisStepper
                    label="Social"
                    leftLabel="Liberal"
                    rightLabel="Traditional"
                    value={position.social}
                    onChange={(social) => {
                      setCompassTouched(true);
                      setFormData((prev) => ({
                        ...prev,
                        policyPositions: { ...prev.policyPositions, social },
                      }));
                    }}
                  />

                  <CompassLegend
                    position={position}
                    parties={compassParties}
                    electorate={
                      electorate && selectedState
                        ? { ...electorate, label: `${selectedState.name} electorate` }
                        : null
                    }
                    regionNoun={regionNoun}
                  />
                </div>
              </div>
            </StepPanel>

            <StepPanel
              step={5}
              title="Party"
              subtitle="A party gives you ballot access, a primary, and a machine. Independent is a real choice, not a default, so pick one deliberately."
              complete={partyTouched}
              disabled={!country}
            >
              {parties.length === 0 ? (
                <p className="rounded border border-dashed border-card-border px-3 py-6 text-center text-body-sm text-muted">
                  {country ? "Loading parties…" : "Choose a country first."}
                </p>
              ) : (
                <PartyPicker
                  countryId={country}
                  value={formData.party}
                  onChange={(party) => {
                    setPartyTouched(true);
                    setFormData((prev) => ({ ...prev, party }));
                  }}
                  majorParties={majorParties}
                  communityParties={communityParties}
                  position={position}
                  isOnePartyState={isOnePartyState}
                />
              )}
            </StepPanel>

            {/*
              The tutorial choice used to live here as a two-button row. It now
              runs as a full-screen two-question flow on first load after
              creation (see TutorialWelcome), where there is room to explain the
              options and where players actually read them.
            */}

            {rpgStatsEnabled && (
              <StepPanel
                step={6}
                title="Stats"
                subtitle={`Every stat starts at ${STAT_MIN}. Spend ${STAT_FREE_POINTS} points on top of that. These shift as you play.`}
                complete={statPointsLeft === 0}
              >
                <StatPointAllocator value={stats} onChange={setStats} />
              </StepPanel>
            )}

            <DiscordLinkSection
              initialLinked={discordLinked}
              discordId={discordData.discordId}
              discordUsername={discordData.discordUsername}
              discordAvatar={discordData.discordAvatar}
            />
          </div>

          {/* ── The file ────────────────────────────────────────────────── */}
          {/* Offset clears the app's 61px sticky navbar. */}
          <aside className="min-w-0 lg:sticky lg:top-[4.5rem]">
            <CandidateFile
              name={formData.characterName.trim()}
              countryName={selectedCountry?.name ?? null}
              countryFlagUrl={selectedCountry?.flagUrl ?? null}
              regionName={selectedState?.name ?? null}
              electorate={electorate}
              partyName={formData.party === "independent" ? null : (selectedParty?.name ?? null)}
              partyAbbreviation={
                formData.party === "independent" ? null : (selectedParty?.abbreviation ?? null)
              }
              partyColor={formData.party === "independent" ? null : (selectedParty?.color ?? null)}
              partyId={formData.party === "independent" ? null : (selectedParty?.id ?? null)}
              partyCountryId={country ? (country.toUpperCase() as CountryId) : null}
              partyPoint={selectedPartyPoint}
              position={position}
              demographics={formData.demographics}
              startingCapital={startingCapital}
              requirements={requirements}
              isSubmitting={isLoading}
              portrait={portrait}
              header={header}
            />

            <p className="mt-2 px-1 text-body-xs text-muted">
              New here?{" "}
              <Link
                href="https://wiki.ahousedividedgame.com/getting-started"
                target="_blank"
                className="text-primary hover:underline"
              >
                Read the new player guide
              </Link>
            </p>
          </aside>
        </div>
      </form>

      <footer className="border-t border-card-border bg-card-muted">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <p className="text-body-xs text-muted">A House Divided &mdash; Political Simulation</p>
          <Link href="/dashboard" className="text-body-xs text-muted hover:text-foreground">
            Back to dashboard
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * −5..+5 axis control. Keeps a precise, screen-reader-friendly path to every
 * value that a drag-only compass pin cannot offer on its own.
 */
function AxisStepper({
  label,
  leftLabel,
  rightLabel,
  value,
  onChange,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-body-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        <span className="font-mono text-body-sm tabular-nums">
          {value > 0 ? `+${value}` : value}
        </span>
      </div>
      {/* The `policy-slider` rule styles the thumb only, so the track is drawn
          behind the transparent input. */}
      <div className="relative py-1.5">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-px ${i === 5 ? "bg-muted" : "bg-card-border"}`}
              aria-hidden
            />
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-track"
        />
        <input
          type="range"
          min={-5}
          max={5}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          aria-label={`${label} position`}
          className="policy-slider relative h-4 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <div className="flex justify-between text-body-xs text-muted">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
