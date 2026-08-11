"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { USAMapPaths, type StateMapData } from "@/components/USAMapPaths";
import { UKMapPaths } from "@/components/UKMapPaths";
import { GermanyMapPaths } from "@/components/GermanyMapPaths";
import { JapanMapPaths } from "@/components/JapanMapPaths";
import { RegionMapPaths } from "@/components/RegionMapPaths";
import { CDN_GEO } from "@/lib/images/cdnUrls";
import { Button } from "@/components/ui";
import { positionBucketHex } from "@/lib/utils/politics";
import {
  getDisplayLean,
  getLeanLabel,
  getSocialLeanLabel,
  formatLeanValue,
} from "@/lib/utils/demographics";
import { LeanSpectrum } from "./LeanSpectrum";
import { listOverrides } from "@/lib/positionEditor/storage";
import { computeDerivedComposition } from "@/lib/positionEditor/derive";
import { allStatesFullToCsv, downloadCsv } from "@/lib/positionEditor/csv";
import type { EraId, EditorStateConfig } from "@/lib/positionEditor/types";

const ERAS: EraId[] = ["1979", "1991", "1999", "2007", "2019", "2023"];

type CountryId = "US" | "UK" | "DE" | "JP" | "IE" | "BR" | "CN";

const COUNTRIES: { value: CountryId; label: string }[] = [
  { value: "US", label: "United States" },
  { value: "UK", label: "United Kingdom" },
  { value: "DE", label: "Germany" },
  { value: "JP", label: "Japan" },
  { value: "IE", label: "Ireland" },
  { value: "BR", label: "Brazil" },
  { value: "CN", label: "China" },
];

interface PresetState {
  stateId: string;
  config: EditorStateConfig;
  lean: { economic: number; social: number; display: number };
}

export function PositionMapView() {
  const [era, setEra] = useState<EraId>("2019");
  const [country, setCountry] = useState<CountryId>("US");
  const [states, setStates] = useState<PresetState[]>([]);
  const [selected, setSelected] = useState<PresetState | null>(null);
  const [axis, setAxis] = useState<"display" | "economic" | "social">("display");

  useEffect(() => {
    fetch(`/api/admin/position-editor/preset?era=${era}&country=${country}`)
      .then((r) => r.json())
      .then((d) => {
        const overrides = new Map(listOverrides(era, country).map((o) => [o.stateId, o]));
        const merged: PresetState[] = (d.states ?? []).map((s: PresetState) => {
          const ov = overrides.get(s.stateId);
          if (!ov) return s;
          const derived = computeDerivedComposition(ov);
          return {
            stateId: s.stateId,
            config: ov,
            lean: {
              economic: derived.stateEconomicLean,
              social: derived.stateSocialLean,
              display: derived.stateDisplayLean,
            },
          };
        });
        setSelected(null);
        setStates(merged);
      });
  }, [era, country]);

  const stateData = useMemo(() => {
    const out: Record<string, StateMapData> = {};
    for (const s of states) {
      const v =
        axis === "display" ? s.lean.display : axis === "economic" ? s.lean.economic : s.lean.social;
      out[s.stateId] = {
        color: positionBucketHex(v, axis === "social" ? "social" : "economic"),
        label: s.stateId,
        tooltip: [
          `${s.stateId}`,
          `Econ ${formatLeanValue(s.lean.economic)}`,
          `Social ${formatLeanValue(s.lean.social)}`,
        ],
      };
    }
    return out;
  }, [states, axis]);

  function renderMap(
    c: CountryId,
    data: Record<string, StateMapData>,
    onClick: (id: string) => void
  ) {
    switch (c) {
      case "US":
        return <USAMapPaths stateData={data} onStateClick={onClick} />;
      case "UK":
        return <UKMapPaths regionData={data} onRegionClick={onClick} />;
      case "DE":
        return <GermanyMapPaths regionData={data} onRegionClick={onClick} />;
      case "JP":
        return <JapanMapPaths regionData={data} onRegionClick={onClick} />;
      case "IE":
        return (
          <RegionMapPaths
            geoUrl={CDN_GEO.ieRegions}
            width={300}
            height={440}
            regionData={data}
            onRegionClick={onClick}
          />
        );
      case "BR":
        return (
          <RegionMapPaths
            geoUrl={CDN_GEO.brRegions}
            width={300}
            height={440}
            regionData={data}
            onRegionClick={onClick}
          />
        );
      case "CN":
        return (
          <RegionMapPaths
            geoUrl={CDN_GEO.cnRegions}
            width={500}
            height={440}
            regionData={data}
            onRegionClick={onClick}
          />
        );
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="flex flex-col gap-3 border-b border-card-border py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl text-foreground">Position Editor</h1>
          <p className="mt-0.5 text-sm text-muted">
            Author Layer-1 demographic positions, turnout, and archetype composition by state.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const fullStates = states.map((s) => ({
              stateId: s.stateId,
              config: s.config,
              derived: computeDerivedComposition(s.config),
            }));
            downloadCsv(
              `positions-full-${era}-${country}.csv`,
              allStatesFullToCsv(era, country, fullStates)
            );
          }}
        >
          ↓ Export all states CSV
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <ToolbarSelect
          label="Era"
          value={era}
          onChange={(v) => setEra(v as EraId)}
          options={ERAS.map((x) => ({ value: x, label: x }))}
        />
        <ToolbarSelect
          label="Country"
          value={country}
          onChange={(v) => setCountry(v as CountryId)}
          options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
        />
        <ToolbarSelect
          label="Color by"
          value={axis}
          onChange={(v) => setAxis(v as typeof axis)}
          options={[
            { value: "display", label: "Display lean" },
            { value: "economic", label: "Economic" },
            { value: "social", label: "Social" },
          ]}
        />
      </div>

      {states.length === 0 ? (
        <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          No Layer-1 model for {country} {era}. (Only 2019 is populated until a preset reseed runs.)
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-card-border bg-card p-2 shadow-card">
            {renderMap(country, stateData, (id) =>
              setSelected(states.find((s) => s.stateId === id) ?? null)
            )}
          </div>
          <div>
            {selected ? (
              <div className="sticky top-4 rounded-xl border border-card-border bg-card p-4 shadow-card">
                <h2 className="font-serif text-lg text-foreground">{selected.stateId}</h2>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Economic</span>
                    <span className="tabular-nums text-foreground">
                      {formatLeanValue(selected.lean.economic)} ·{" "}
                      {getLeanLabel(selected.lean.economic)}
                    </span>
                  </div>
                  <LeanSpectrum value={selected.lean.economic} axis="economic" />
                  <div className="flex justify-between">
                    <span className="text-muted">Social</span>
                    <span className="tabular-nums text-foreground">
                      {formatLeanValue(selected.lean.social)} ·{" "}
                      {getSocialLeanLabel(selected.lean.social)}
                    </span>
                  </div>
                  <LeanSpectrum value={selected.lean.social} axis="social" />
                  <div className="flex justify-between border-t border-card-border pt-2">
                    <span className="text-muted">Display</span>
                    <span className="tabular-nums text-foreground">
                      {formatLeanValue(
                        getDisplayLean(selected.lean.economic, selected.lean.social)
                      )}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/admin/position-editor/${country}/${selected.stateId}?era=${era}`}
                  className="mt-4 block rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  Edit state demographics →
                </Link>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-card-border bg-card/40 px-4 py-8 text-center text-sm text-muted">
                Click a state on the map to inspect its lean.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary/50 focus:border-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
