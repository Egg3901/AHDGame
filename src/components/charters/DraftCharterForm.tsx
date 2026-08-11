"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { PlatformSliders, type PlatformValue } from "./PlatformSliders";
import { FounderPicker } from "./FounderPicker";
import { FoundingCohortPicker, defaultCohort } from "./FoundingCohortPicker";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import type { CountryId } from "@/lib/constants/countries";
import type { FoundingCohortPick } from "@/lib/db/types";

const EMPTY_PLATFORM: PlatformValue = {
  economic: 0,
  social: 0,
};

const EMPTY_SLOT: FounderSlot = { characterId: "", name: "" };

/**
 * Phase 6 D6 minimal MVP draft form. Replaces the legacy single-shot
 * CreatePartyModal — players name + abbreviate the party, set the 4-axis
 * platform, and pick 3 founders by character name (typeahead). Submission
 * posts to `/api/country/[code]/parties` (Phase 6 redirect target) and the
 * response routes the caller to `/charters/[id]` for the signing flow.
 *
 * Founder identity is `characterId` so multi-character users (admin
 * testing, multi-persona play) can fill multiple slots through different
 * characters.
 */
interface DraftCharterFormProps {
  countryCode: string;
  /**
   * The current player's active character. Slot 0 pre-fills with this
   * character (the API requires the proposer's character to be one of
   * the founders, so making them type their own name is busywork).
   * Locked — they can't clear themselves out of the charter.
   *
   * `homeState` is required for the F4 founding-cohort picker — it
   * anchors the adjacency dropdown for NPP placement.
   */
  proposer: {
    characterId: string;
    characterName: string;
    homeState: string;
  };
  /**
   * Display-name map for the country's states/regions. Server-fetched and
   * passed in by `NewCharterPage` so the FoundingCohortPicker can render
   * human-readable dropdown labels without a client-side fetch.
   */
  stateNames: Readonly<Record<string, string>>;
}

interface FounderSlot {
  characterId: string;
  name: string;
}

export function DraftCharterForm({ countryCode, proposer, stateNames }: DraftCharterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [platform, setPlatform] = useState<PlatformValue>(EMPTY_PLATFORM);
  const [founders, setFounders] = useState<[FounderSlot, FounderSlot, FounderSlot]>([
    { characterId: proposer.characterId, name: proposer.characterName },
    EMPTY_SLOT,
    EMPTY_SLOT,
  ]);
  const [cohort, setCohort] = useState<[FoundingCohortPick, FoundingCohortPick]>(
    defaultCohort(proposer.homeState, EMPTY_PLATFORM.economic, EMPTY_PLATFORM.social)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlatformChange = (axis: keyof PlatformValue, val: number) => {
    setPlatform((p) => ({ ...p, [axis]: val }));
  };

  const setFounderAt = (index: 0 | 1 | 2, slot: FounderSlot) => {
    setFounders((prev) => {
      const next = [...prev] as [FounderSlot, FounderSlot, FounderSlot];
      next[index] = slot;
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const founderCharacterIds = founders.map((f) => f.characterId);
    if (founderCharacterIds.some((id) => !id)) {
      setError("Pick all three founders before submitting.");
      return;
    }
    const unique = new Set(founderCharacterIds);
    if (unique.size !== 3) {
      setError("Founders must be 3 distinct characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/country/${countryCode.toLowerCase()}/parties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          abbreviation,
          platform,
          foundersCharacterIds: founderCharacterIds,
          foundingCohort: cohort,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; redirectTo?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to create charter draft");
        setSubmitting(false);
        return;
      }
      router.push(data.redirectTo ?? "/charters");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  // Each picker excludes the characterIds already chosen in the OTHER slots
  // so a single character can't be picked into two slots.
  const excludeFor = (slotIndex: 0 | 1 | 2) =>
    founders
      .map((f, i) => (i !== slotIndex && f.characterId ? f.characterId : null))
      .filter((id): id is string => id !== null);

  // Co-founders must live in the proposer's home state or an adjacent state
  // (server-enforced as `founder-not-adjacent`); the picker greys out
  // characters outside this set. Null when the proposer has no homeState
  // (legacy data) — the server skips enforcement in that case too.
  const allowedFounderStates = proposer.homeState
    ? [
        proposer.homeState,
        ...adjacentStates(countryCode.toUpperCase() as CountryId, proposer.homeState),
      ]
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <div>
          <Label htmlFor="charter-name">Party Name</Label>
          <Input
            id="charter-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={3}
            maxLength={50}
            required
            placeholder="e.g. Working Families Party"
          />
        </div>
        <div>
          <Label htmlFor="charter-abbr">Abbreviation</Label>
          <Input
            id="charter-abbr"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value.toUpperCase())}
            minLength={2}
            maxLength={5}
            pattern="[A-Za-z0-9]+"
            required
            placeholder="WFP"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Platform</h3>
        <p className="mb-4 text-xs text-muted">
          Set the founding platform on each axis. Each value runs from -60 to +60. After the party
          is ratified, you can only move an axis by 10 at a time.
        </p>
        <PlatformSliders value={platform} onChange={handlePlatformChange} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Founding Cohort</h3>
        <FoundingCohortPicker
          countryId={countryCode.toUpperCase() as CountryId}
          chairHomeState={proposer.homeState}
          stateNames={stateNames}
          platformEconomic={platform.economic}
          platformSocial={platform.social}
          value={cohort}
          onChange={setCohort}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Founders (3 required)</h3>
        <p className="text-xs text-muted">
          You&apos;re locked in as <strong>Founder 1</strong> with your active character. Search by
          character name to invite the other two co-founders. They must live in your home state or a
          state next to it. Leadership starts empty: the chair, vice chair, and treasurer are
          decided by the party&apos;s first leadership elections. All three founders must sign
          before the party goes live.
        </p>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Founder 1</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
              <span className="font-medium">{founders[0].name}</span>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">you</span>
            </div>
          </div>
        </div>
        {([1, 2] as const).map((index) => (
          <div key={index}>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
              Founder {index + 1}
            </div>
            <FounderPicker
              countryId={countryCode}
              value={founders[index].characterId}
              displayName={founders[index].name}
              excludeCharacterIds={excludeFor(index)}
              allowedHomeStates={allowedFounderStates}
              placeholder={`Search founder by character name…`}
              onSelect={({ characterId, characterName }) =>
                setFounderAt(index, { characterId, name: characterName })
              }
              onClear={() => setFounderAt(index, EMPTY_SLOT)}
            />
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Submitting…" : "Create charter draft"}
      </Button>
    </form>
  );
}
