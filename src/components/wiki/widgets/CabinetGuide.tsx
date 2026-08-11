"use client";

/**
 * Live, code-backed Cabinet Guide widget (wiki fence: ```cabinet-guide```).
 * Renders one tab per country with cabinet mechanics, reading everything
 * directly from the cabinet constants so the page can never rot:
 *   - positions + succession order (getCabinetPositions)
 *   - per-seat mechanics (getAllCabinetMechanics): metrics, tier settings,
 *     regional targets, emergencies, allocations, advocacy, bond profiles
 *   - building systems: estates portfolios, energy plants, infra projects
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  getAllCabinetMechanics,
  getCabinetPositions,
  type CabinetPositionMechanics,
} from "@/lib/constants/cabinetMechanics";
import { ESTATE_CATALOG, ESTATE_PORTFOLIO_BY_COUNTRY } from "@/lib/constants/cabinetEstates";
import { ENERGY_POSITION_BY_COUNTRY, ENERGY_SOURCES } from "@/lib/constants/cabinetEnergy";
import { INFRA_ARCHETYPES, INFRA_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetInfra";
import type { CountryId } from "@/lib/constants/countries";

// ── Country tabs ─────────────────────────────────────────────────────────────

const COUNTRY_TABS: { id: string; label: string }[] = [
  { id: "US", label: "United States" },
  { id: "UK", label: "United Kingdom" },
  { id: "DE", label: "Germany" },
  { id: "JP", label: "Japan" },
  { id: "CN", label: "China" },
  { id: "IE", label: "Ireland" },
  { id: "NG", label: "Nigeria" },
  { id: "SCO", label: "Scotland (devolved)" },
  { id: "WAL", label: "Wales (devolved)" },
].filter((c) => Object.keys(getAllCabinetMechanics(c.id)).length > 0);

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Player-facing style rule: no em or en dashes in rendered copy. */
function clean(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ": ");
}

const ACRONYMS = new Set(["gdp", "nhs", "npp"]);

/** Fallback humanizer for effect keys not covered by a metric label. */
function humanizeKey(key: string): string {
  const id = key.includes(".") ? key.split(".").pop()! : key;
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Build a metricId → display label map from a country's metric configs. */
function buildLabelMap(mechanics: Record<string, CabinetPositionMechanics>): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of Object.values(mechanics)) {
    for (const cfg of [...m.nationalMetrics, ...m.regionalMetrics]) {
      map.set(cfg.metricId, cfg.label);
    }
  }
  return map;
}

function labelFor(key: string, labels: Map<string, string>): string {
  const id = key.includes(".") ? key.split(".").pop()! : key;
  return labels.get(id) ?? humanizeKey(id);
}

function signed(v: number): string {
  return `${v > 0 ? "+" : ""}${v}`;
}

function effectList(
  effects: Record<string, number>,
  labels: Map<string, string>,
  perTurn: boolean
): string {
  return Object.entries(effects)
    .map(([k, v]) => `${labelFor(k, labels)} ${signed(v)}${perTurn ? "/turn" : ""}`)
    .join(", ");
}

// ── Small presentational pieces ──────────────────────────────────────────────

function MechanicBlock({
  kind,
  name,
  description,
  lines,
}: {
  kind: string;
  name: string;
  description: string;
  lines?: { title: string; detail: string }[];
}) {
  return (
    <div className="rounded-md border border-card-border bg-card-elevated/55 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
          {kind}
        </span>
        <h4 className="text-sm font-semibold text-foreground">{clean(name)}</h4>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{clean(description)}</p>
      {lines && lines.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {lines.map((l) => (
            <li key={l.title}>
              <span className="font-medium text-foreground">{clean(l.title)}:</span>{" "}
              {clean(l.detail)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Per-seat card ────────────────────────────────────────────────────────────

function SeatCard({
  countryId,
  position,
  mechanics,
  labels,
}: {
  countryId: string;
  position: { id: string; name: string; description?: string; isHeadOfGovernment?: boolean };
  mechanics: CabinetPositionMechanics | undefined;
  labels: Map<string, string>;
}) {
  const m = mechanics;
  const estatesKey = ESTATE_PORTFOLIO_BY_COUNTRY[countryId as CountryId]?.[position.id];
  const estateArchetypes = estatesKey ? (ESTATE_CATALOG[estatesKey] ?? []) : [];
  const hasEnergy = ENERGY_POSITION_BY_COUNTRY[countryId as CountryId] === position.id;
  const hasInfra = INFRA_POSITION_BY_COUNTRY[countryId as CountryId] === position.id;

  return (
    <section className="rounded-lg border border-card-border bg-card/45 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{clean(position.name)}</h3>
        {m?.department && <span className="text-xs text-muted">{clean(m.department)}</span>}
      </div>

      {position.isHeadOfGovernment && (
        <p className="mt-1 text-xs text-muted">
          Head of government seat: filled through government formation, not cabinet appointment.
        </p>
      )}

      {m ? (
        <>
          {(m.nationalMetrics.length > 0 || m.regionalMetrics.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {m.nationalMetrics.map((cfg) => (
                <span
                  key={`n-${cfg.metricId}`}
                  className="rounded-full border border-card-border bg-card-elevated px-2 py-0.5 text-xs text-foreground"
                >
                  {cfg.label}
                </span>
              ))}
              {m.regionalMetrics
                .filter((cfg) => !m.nationalMetrics.some((n) => n.metricId === cfg.metricId))
                .map((cfg) => (
                  <span
                    key={`r-${cfg.metricId}`}
                    className="rounded-full border border-card-border bg-card-elevated px-2 py-0.5 text-xs text-muted"
                  >
                    {cfg.label} (regional)
                  </span>
                ))}
            </div>
          )}

          {m.singleRegionFocus && (
            <p className="mt-2 text-sm text-muted">
              Territorial seat: the office dashboard focuses on the {m.singleRegionFocus} region
              only.
            </p>
          )}

          {m.comingSoon ? (
            <p className="mt-3 rounded-md border border-card-border bg-card-elevated/55 p-3 text-sm text-muted">
              This seat&apos;s active mechanics are coming soon. It still tracks the metrics above
              and counts as a full cabinet appointment.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {m.tierSetting && (
                <MechanicBlock
                  kind="Tier setting"
                  name={m.tierSetting.name}
                  description={m.tierSetting.description}
                  lines={m.tierSetting.options.map((o) => ({
                    title: o.label + (o.id === m.tierSetting!.defaultTier ? " (default)" : ""),
                    detail:
                      clean(o.description) +
                      (Object.keys(o.effects).length > 0
                        ? ` Effects: ${effectList(o.effects, labels, true)}.`
                        : ""),
                  }))}
                />
              )}
              {m.regionalTarget && (
                <MechanicBlock
                  kind="Regional target"
                  name={m.regionalTarget.name}
                  description={m.regionalTarget.description}
                  lines={[
                    {
                      title: "Target region",
                      detail: effectList(m.regionalTarget.effects, labels, true),
                    },
                    ...(m.regionalTarget.nonTargetEffects
                      ? [
                          {
                            title: "All other regions",
                            detail: effectList(m.regionalTarget.nonTargetEffects, labels, true),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {m.emergency && (
                <MechanicBlock
                  kind="Emergency"
                  name={m.emergency.name}
                  description={m.emergency.description}
                  lines={[
                    {
                      title: "Cost",
                      detail: `${m.emergency.cost} ministerial action, lasts ${m.emergency.duration} turns`,
                    },
                    { title: "Effects", detail: effectList(m.emergency.effects, labels, false) },
                    ...(m.emergency.sideEffects
                      ? [
                          {
                            title: "Side effects",
                            detail: effectList(m.emergency.sideEffects, labels, false),
                          },
                        ]
                      : []),
                    ...(m.emergency.regionMetricThreshold
                      ? [
                          {
                            title: "Requires",
                            detail: `target region ${labelFor(
                              m.emergency.regionMetricThreshold.metric,
                              labels
                            )} above ${m.emergency.regionMetricThreshold.above}`,
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {m.allocation && (
                <MechanicBlock
                  kind="Allocation"
                  name={m.allocation.name}
                  description={m.allocation.description}
                  lines={[{ title: "Pool", detail: m.allocation.poolLabel }]}
                />
              )}
              {m.advocacy && (
                <MechanicBlock
                  kind="Advocacy"
                  name={m.advocacy.name}
                  description={m.advocacy.description}
                  lines={[
                    {
                      title: `While active (${m.advocacy.regionId})`,
                      detail: effectList(m.advocacy.effects, labels, true),
                    },
                  ]}
                />
              )}
              {m.bondProfile && (
                <MechanicBlock
                  kind="Bonds"
                  name={m.bondProfile.name}
                  description={m.bondProfile.description}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          No active office mechanics for this seat yet. It still counts as a full cabinet
          appointment.
        </p>
      )}

      {(estateArchetypes.length > 0 || hasEnergy || hasInfra) && (
        <div className="mt-3 rounded-md border border-card-border bg-card-elevated/55 p-3">
          <h4 className="text-sm font-semibold text-foreground">Can build</h4>
          <ul className="mt-1.5 space-y-1 text-sm text-muted">
            {estateArchetypes.map((a) => (
              <li key={a.id}>
                <span className="font-medium text-foreground">{a.label}:</span>{" "}
                {clean(a.description)}
              </li>
            ))}
            {hasEnergy && (
              <li>
                <span className="font-medium text-foreground">Power plants:</span>{" "}
                {ENERGY_SOURCES.map((s) => s.label).join(", ")}. Each plant shifts the regional
                energy mix, nudging renewable share, grid reliability, and carbon emissions every
                turn.
              </li>
            )}
            {hasInfra && (
              <li>
                <span className="font-medium text-foreground">Infrastructure projects:</span>{" "}
                {INFRA_ARCHETYPES.map((a) => a.label).join(", ")}. Projects take several turns to
                build, then apply standing regional effects.
              </li>
            )}
          </ul>
          <p className="mt-1.5 text-xs text-muted">
            See the <Link href="/wiki/cabinet-projects">Cabinet Projects &amp; Buildings</Link>{" "}
            guide for tiers, funding levels, and budget envelopes.
          </p>
        </div>
      )}
    </section>
  );
}

// ── Widget root ──────────────────────────────────────────────────────────────

export function CabinetGuide() {
  const [country, setCountry] = useState<string>(COUNTRY_TABS[0]?.id ?? "US");

  const mechanics = useMemo(() => getAllCabinetMechanics(country), [country]);
  const positions = useMemo(() => getCabinetPositions(country), [country]);
  const labels = useMemo(() => buildLabelMap(mechanics), [mechanics]);

  return (
    <section className="not-prose my-6 space-y-4">
      <div
        role="tablist"
        aria-label="Cabinet guide country"
        className="flex flex-wrap gap-1 rounded-md border border-card-border bg-card-elevated/60 p-1"
      >
        {COUNTRY_TABS.map((tab) => {
          const active = tab.id === country;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCountry(tab.id)}
              className={`rounded px-3 py-1.5 text-sm font-semibold transition-colors ${
                active ? "bg-primary text-white shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {positions.map((pos) => (
          <SeatCard
            key={pos.id}
            countryId={country}
            position={pos}
            mechanics={mechanics[pos.id]}
            labels={labels}
          />
        ))}
      </div>
    </section>
  );
}
