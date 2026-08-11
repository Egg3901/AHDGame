"use client";

import { getCountryFlagUrlForEra } from "@/lib/constants";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";

export default function PlannedCountryCard({
  id,
  name,
  region,
  featured,
}: {
  id: string;
  name: string;
  region: string;
  featured?: boolean;
}) {
  const preset = useActivePreset();
  const flagUrl = getCountryFlagUrlForEra(id, preset);

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl transition-all ${
        featured
          ? "border border-warning/40 bg-warning/5 ring-1 ring-warning/20"
          : "border border-card-border/50 bg-card/40 opacity-75 grayscale-[0.3]"
      }`}
    >
      {/* Flag Hero — matches CountryCard h-32 */}
      <div
        className={`relative h-32 w-full overflow-hidden bg-card-muted ${featured ? "opacity-80" : "grayscale opacity-60"}`}
      >
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${flagUrl})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-white drop-shadow-md">{name}</h3>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              featured
                ? "bg-warning/20 text-warning border-warning/30"
                : "bg-muted/20 text-muted border-muted/30"
            }`}
          >
            {featured ? "Beta Access" : "Coming Soon"}
          </span>
        </div>
      </div>

      {/* Content — matches CountryCard structure */}
      <div className="flex flex-1 flex-col p-4 gap-3">
        <p className="text-xs font-medium text-muted uppercase tracking-wider">{region}</p>

        <p className="text-sm text-muted line-clamp-2 min-h-[2.5em]">
          {featured
            ? "Planned for beta access. Development in progress."
            : "Development planned. Will feature unique electoral systems and regional politics."}
        </p>

        {/* Empty stats grid placeholder — maintains height parity with CountryCard */}
        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          <div className="rounded-lg bg-card-elevated/50 p-2 border border-card-border/30">
            <p className="text-[10px] text-muted/50 uppercase tracking-wide">Status</p>
            <p className="text-xs font-semibold text-muted/60">
              {featured ? "In Development" : "Planned"}
            </p>
          </div>
          <div className="rounded-lg bg-card-elevated/50 p-2 border border-card-border/30">
            <p className="text-[10px] text-muted/50 uppercase tracking-wide">Region</p>
            <p className="text-xs font-semibold text-muted/60 truncate">{region}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
