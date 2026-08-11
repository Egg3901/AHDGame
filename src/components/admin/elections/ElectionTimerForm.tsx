"use client";

import { US_STATES } from "@/lib/constants";
import { UK_REGIONS } from "@/lib/constants/uk";
import { JP_REGIONS } from "@/lib/constants/japan";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type {
  ElectionsManageAction,
  ElectionsManageState,
  ElectionTypeFilter,
  CountrySelection,
} from "./electionsAdminTypes";

const JP_REGION_IDS = JP_REGIONS.map((r) => r.id);

/** Election types available per country */
const COUNTRY_ELECTION_TYPES: Record<string, { value: ElectionTypeFilter; label: string }[]> = {
  US: [
    { value: "house", label: "House" },
    { value: "senate", label: "Senate" },
    { value: "governor", label: "Governor" },
    { value: "stateSenate", label: "State Senate" },
    { value: "president", label: "President" },
  ],
  UK: [
    { value: "commons", label: "Commons" },
    { value: "regionalCouncil", label: "Regional Council" },
  ],
  JP: [
    { value: "shugiin", label: "Shūgiin" },
    { value: "sangiin", label: "Sangiin" },
  ],
  DE: [
    { value: "bundestag", label: "Bundestag" },
    { value: "landtag", label: "Landtag" },
    { value: "ministerPresident", label: "Minister-President" },
  ],
  CN: [
    { value: "npcDelegate", label: "NPC Delegate" },
    { value: "peoplesCongress", label: "People's Congress" },
    { value: "governor", label: "Governor" },
  ],
};

/** All unique election types across all countries */
const ALL_ELECTION_TYPES: { value: ElectionTypeFilter; label: string }[] = [
  { value: "house", label: "House" },
  { value: "senate", label: "Senate" },
  { value: "governor", label: "Governor" },
  { value: "stateSenate", label: "State Senate" },
  { value: "president", label: "President" },
  { value: "commons", label: "Commons" },
  { value: "regionalCouncil", label: "Reg. Council" },
  { value: "shugiin", label: "Shūgiin" },
  { value: "sangiin", label: "Sangiin" },
  { value: "bundestag", label: "Bundestag" },
  { value: "landtag", label: "Landtag" },
  { value: "ministerPresident", label: "Minister-President" },
  { value: "npcDelegate", label: "NPC Delegate" },
  { value: "peoplesCongress", label: "People's Congress" },
];

/** Region label per country */
function getRegionLabel(country: CountrySelection): string {
  if (country === "global") return "Region";
  return COUNTRY_CONFIGS[country]?.regionLabel ?? "Region";
}

interface ElectionTimerFormProps {
  timerForm: ElectionsManageState["timerForm"];
  selectedCountry: CountrySelection;
  loading: boolean;
  dispatch: React.Dispatch<ElectionsManageAction>;
  onApply: () => void;
}

export function ElectionTimerForm({
  timerForm,
  selectedCountry,
  loading,
  dispatch,
  onApply,
}: ElectionTimerFormProps) {
  const isGlobal = selectedCountry === "global";
  const electionTypes = isGlobal
    ? ALL_ELECTION_TYPES
    : (COUNTRY_ELECTION_TYPES[selectedCountry] ?? []);

  // Computed total
  const primary = typeof timerForm.primaryHours === "number" ? timerForm.primaryHours : 0;
  const general = typeof timerForm.generalHours === "number" ? timerForm.generalHours : 0;
  const total = primary + general;
  const gameYears = total > 0 ? (total / 48).toFixed(1).replace(/\.0$/, "") : "0";

  // Show class filter only when relevant type is selected
  const showSenateClass = timerForm.electionType === "senate";
  const showChamberClass = timerForm.electionType === "sangiin";

  const selectClass = "rounded-lg border border-card-border bg-background px-3 py-2 text-sm";
  const inputClass =
    "w-14 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-center tabular-nums";

  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-card p-3">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-primary">
          Modify Timers
        </h3>
        <span className="rounded bg-primary/15 px-2 py-0.5 text-[9px] text-primary">
          {isGlobal ? "Applies to all countries" : `${COUNTRY_CONFIGS[selectedCountry]?.name} only`}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {/* Action */}
        <div>
          <label className="mb-1 block text-[9px] uppercase text-muted">Action</label>
          <select
            value={timerForm.action}
            onChange={(e) =>
              dispatch({
                type: "SET_TIMER_ACTION",
                value: e.target.value as "set" | "add" | "subtract",
              })
            }
            className={selectClass}
          >
            <option value="set">Set</option>
            <option value="add">Add</option>
            <option value="subtract">Subtract</option>
          </select>
        </div>

        {/* Election Type */}
        <div>
          <label className="mb-1 block text-[9px] uppercase text-muted">Type</label>
          <select
            value={timerForm.electionType}
            onChange={(e) =>
              dispatch({
                type: "SET_TIMER_ELECTION_TYPE",
                value: e.target.value as ElectionTypeFilter,
              })
            }
            className={selectClass}
          >
            <option value="">All Types</option>
            {electionTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* State/Region — only for per-country views */}
        {!isGlobal && (
          <div>
            <label className="mb-1 block text-[9px] uppercase text-muted">
              {getRegionLabel(selectedCountry)}
            </label>
            <select
              value={timerForm.state}
              onChange={(e) => dispatch({ type: "SET_TIMER_STATE", value: e.target.value })}
              className={selectClass}
            >
              <option value="">All</option>
              {selectedCountry === "US" &&
                US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              {selectedCountry === "UK" &&
                UK_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              {selectedCountry === "JP" &&
                JP_REGION_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              {selectedCountry === "DE" &&
                deRegions.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              {selectedCountry === "CN" &&
                cnRegions.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Senate Class — only when Senate selected */}
        {showSenateClass && (
          <div>
            <label className="mb-1 block text-[9px] uppercase text-muted">Senate Class</label>
            <select
              value={timerForm.senateClass}
              onChange={(e) =>
                dispatch({
                  type: "SET_TIMER_SENATE_CLASS",
                  value: e.target.value as "" | "1" | "2" | "3",
                })
              }
              className={selectClass}
            >
              <option value="">All</option>
              <option value="1">Class 1</option>
              <option value="2">Class 2</option>
              <option value="3">Class 3</option>
            </select>
          </div>
        )}

        {/* Chamber Class — only when Sangiin selected */}
        {showChamberClass && (
          <div>
            <label className="mb-1 block text-[9px] uppercase text-muted">Chamber Class</label>
            <select
              value={timerForm.chamberClass}
              onChange={(e) =>
                dispatch({
                  type: "SET_TIMER_CHAMBER_CLASS",
                  value: e.target.value as "" | "1" | "2",
                })
              }
              className={selectClass}
            >
              <option value="">All</option>
              <option value="1">Class 1</option>
              <option value="2">Class 2</option>
            </select>
          </div>
        )}

        {/* Separator */}
        <div className="mx-1 hidden h-7 border-l border-card-border md:block" />

        {/* Primary Hours */}
        <div className="text-center">
          <label className="mb-1 block text-[9px] uppercase text-muted">Primary</label>
          <input
            type="number"
            min="0"
            value={timerForm.primaryHours}
            onChange={(e) =>
              dispatch({
                type: "SET_TIMER_PRIMARY_HOURS",
                value: e.target.value ? parseInt(e.target.value) : "",
              })
            }
            placeholder="48"
            className={inputClass}
          />
        </div>

        <span className="pb-2 text-muted">+</span>

        {/* General Hours */}
        <div className="text-center">
          <label className="mb-1 block text-[9px] uppercase text-muted">General</label>
          <input
            type="number"
            min="0"
            value={timerForm.generalHours}
            onChange={(e) =>
              dispatch({
                type: "SET_TIMER_GENERAL_HOURS",
                value: e.target.value ? parseInt(e.target.value) : "",
              })
            }
            placeholder="48"
            className={inputClass}
          />
        </div>

        <span className="pb-2 text-muted">=</span>

        {/* Total display */}
        <div className="pb-1 text-center">
          <div className="text-sm font-semibold tabular-nums text-primary">{total}h</div>
          <div className="text-[9px] text-muted">({gameYears}y)</div>
        </div>

        {/* Apply */}
        <button
          onClick={onApply}
          disabled={loading}
          className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
