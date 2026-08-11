"use client";

/**
 * Filter bar for the elections list.
 *
 * The office options are derived from the country's own config rather than a
 * hand-written list, so a country gets working filters the moment it seeds
 * races. The previous hardcoded `<option>` block covered 16 race types, which
 * left FR, IT, ES, SE, TR, RU and DD with no office filter at all.
 */

import { MobileSelect } from "@/components/ui";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { listCountryOffices } from "@/lib/elections/officeResolution";
import { ELECTION_STATE_NAMES } from "@/app/elections/electionsHelpers";
import type { ContestFilter, PrimaryFilter, RaceFilter } from "../electionsUrlState";

const CLASS_ROMAN = ["I", "II", "III"];

export interface RaceOption {
  value: RaceFilter;
  label: string;
}

/**
 * Office filter options for a country.
 *
 * A classed upper chamber (only the US Senate today, flagged by
 * `regionElectedClasses`) expands into one option per class, preserving the
 * long-standing `?type=senate&class=N` deep links.
 */
export function buildRaceOptions(countryId: CountryId): RaceOption[] {
  const config = COUNTRY_CONFIGS[countryId];
  const classedUpperKey = config?.legislature?.upperChamber?.regionElectedClasses
    ? config.legislature.upperChamber.key
    : null;

  return listCountryOffices(countryId).flatMap<RaceOption>((office) => {
    if (classedUpperKey && office.key === classedUpperKey) {
      return CLASS_ROMAN.map((roman, i) => ({
        value: `${office.key}-${i + 1}`,
        label: `${office.sectionLabel} Class ${roman}`,
      }));
    }
    return [{ value: office.key, label: office.sectionLabel }];
  });
}

interface ElectionsControlsProps {
  countryId: CountryId;
  regionLabel: string;
  regionLabelPlural: string;
  availableRegions: string[];
  race: RaceFilter;
  region: string;
  competitive: boolean;
  hideUpcoming: boolean;
  primary: PrimaryFilter;
  contest: ContestFilter;
  view: "list" | "map";
  mapAvailable: boolean;
  onRace: (race: RaceFilter) => void;
  onRegion: (region: string) => void;
  onToggleCompetitive: () => void;
  onToggleHideUpcoming: () => void;
  onPrimary: (primary: PrimaryFilter) => void;
  onContest: (contest: ContestFilter) => void;
  onView: (view: "list" | "map") => void;
}

export function ElectionsControls({
  countryId,
  regionLabel,
  regionLabelPlural,
  availableRegions,
  race,
  region,
  competitive,
  hideUpcoming,
  primary,
  contest,
  view,
  mapAvailable,
  onRace,
  onRegion,
  onToggleCompetitive,
  onToggleHideUpcoming,
  onPrimary,
  onContest,
  onView,
}: ElectionsControlsProps) {
  const raceOptions = buildRaceOptions(countryId);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex overflow-hidden rounded-lg border border-card-border">
        {(["list", "map"] as const).map((v) => (
          <button
            key={v}
            onClick={() => (v === "list" || mapAvailable) && onView(v)}
            disabled={!mapAvailable && v === "map"}
            title={!mapAvailable && v === "map" ? "Pick a single office to see the map" : undefined}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              view === v ? "bg-primary text-white" : "bg-card text-muted hover:text-foreground"
            } ${!mapAvailable && v === "map" ? "cursor-not-allowed opacity-40 hover:text-muted" : ""}`}
          >
            {v}
          </button>
        ))}
      </div>

      <MobileSelect
        value={region}
        onChange={onRegion}
        placeholder={`All ${regionLabelPlural}`}
        label={`Select ${regionLabel}`}
        options={[
          { value: "", label: `All ${regionLabelPlural}` },
          ...availableRegions.map((r) => ({ value: r, label: ELECTION_STATE_NAMES[r] ?? r })),
        ]}
      />

      <MobileSelect
        value={race}
        onChange={(value) => onRace(value as RaceFilter)}
        placeholder="All offices"
        label="Select office"
        options={[{ value: "", label: "All offices" }, ...raceOptions]}
      />

      <MobileSelect
        value={primary}
        onChange={(value) => onPrimary(value as PrimaryFilter)}
        placeholder="Any stage"
        label="Primary stage"
        options={[
          { value: "", label: "Any stage" },
          { value: "in", label: "In primary" },
          { value: "out", label: "Not in primary" },
        ]}
      />

      <MobileSelect
        value={contest}
        onChange={(value) => onContest(value as ContestFilter)}
        placeholder="Any field"
        label="Field size"
        options={[
          { value: "", label: "Any field" },
          { value: "uncontested", label: "Uncontested seats" },
          { value: "contested", label: "Contested seats" },
        ]}
      />

      <ToggleButton
        active={competitive}
        onClick={onToggleCompetitive}
        title="Show only races where the top two are within 15 points"
        activeClass="border-warning/60 bg-warning/15 text-warning"
      >
        Close races
      </ToggleButton>

      <ToggleButton
        active={hideUpcoming}
        onClick={onToggleHideUpcoming}
        title="Hide races that have not opened yet"
        activeClass="border-secondary/60 bg-secondary/15 text-secondary"
      >
        Open only
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  activeClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  activeClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active ? activeClass : "border-card-border bg-card text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
