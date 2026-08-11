"use client";

import { US_STATES } from "@/lib/constants";
import { UK_REGIONS } from "@/lib/constants/uk";
import { JP_REGIONS } from "@/lib/constants/japan";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import type {
  ElectionsManageAction,
  ElectionTypeFilter,
  CountryFilter,
} from "./electionsAdminTypes";

const UK_REGION_IDS = UK_REGIONS.map((r) => r.id);
const JP_REGION_IDS = JP_REGIONS.map((r) => r.id);
const IE_REGION_IDS = ieRegions.map((r) => r._id);

interface ElectionFilterBarProps {
  filterCountry: CountryFilter;
  filterType: ElectionTypeFilter;
  filterState: string;
  loading: boolean;
  dispatch: React.Dispatch<ElectionsManageAction>;
  onRefresh: () => void;
}

export function ElectionFilterBar({
  filterCountry,
  filterType,
  filterState,
  loading,
  dispatch,
  onRefresh,
}: ElectionFilterBarProps) {
  const registered = useRegisteredCountries();
  return (
    <div className="mb-4 flex items-center gap-3 flex-wrap">
      <span className="text-sm text-muted">Filter:</span>
      <select
        value={filterCountry}
        onChange={(e) =>
          dispatch({ type: "SET_FILTER_COUNTRY", value: e.target.value as CountryFilter })
        }
        className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
      >
        <option value="">All Countries</option>
        {registered.map((id) => (
          <option key={id} value={id}>
            {COUNTRY_CONFIGS[id].name} Only
          </option>
        ))}
      </select>
      <select
        value={filterType}
        onChange={(e) =>
          dispatch({ type: "SET_FILTER_TYPE", value: e.target.value as ElectionTypeFilter })
        }
        className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
      >
        <option value="">All Types</option>
        <option value="senate">Senate Only</option>
        <option value="house">House Only</option>
        <option value="commons">Commons Only</option>
        <option value="governor">Governor Only</option>
        <option value="stateSenate">State Senate Only</option>
        <option value="president">President Only</option>
        <option value="shugiin">Shūgiin Only</option>
        <option value="sangiin">Sangiin Only</option>
        <option value="bundestag">Bundestag Only</option>
        <option value="landtag">Landtag Only</option>
        <option value="ministerPresident">Minister-President Only</option>
        <option value="regionalCouncil">Regional Council Only</option>
        <option value="npcDelegate">NPC Delegate Only</option>
        <option value="peoplesCongress">People&apos;s Congress Only</option>
        <option value="dail">Dáil Éireann Only</option>
        <option value="seanad">Seanad Éireann Only</option>
        <option value="uachtaran">Uachtarán na hÉireann Only</option>
        <option value="localCouncil">IE Local Council Only</option>
      </select>
      <select
        value={filterState}
        onChange={(e) => dispatch({ type: "SET_FILTER_STATE", value: e.target.value })}
        className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
      >
        <option value="">All States/Regions</option>
        <optgroup label="US">
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </optgroup>
        <optgroup label="UK">
          {UK_REGION_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
        <optgroup label="JP">
          {JP_REGION_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
        <optgroup label="IE">
          {IE_REGION_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="rounded-lg border border-card-border px-3 py-2 text-sm hover:bg-background"
      >
        Refresh
      </button>
    </div>
  );
}
