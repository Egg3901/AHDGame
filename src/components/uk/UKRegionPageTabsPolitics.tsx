"use client";

import Link from "next/link";
import { type UKRegion, getUKCouncilName } from "@/lib/constants/uk";
import { getOrgLabel } from "@/lib/utils/partyOrg";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { PositionLabel } from "@/components/PositionLabel";
import type {
  PartyOrgDisplay,
  SerializedPlayer,
  NPPDisplaySimple,
} from "@/components/state/StatePageTabsTypes";
import type { SerializedMP } from "@/app/uk/region/[regionId]/UKRegionClient";
import { PlayersList } from "@/components/state/politics/PlayersList";
import { NPPsList } from "@/components/state/politics/NPPsList";

interface StateLike {
  _id: string;
  name: string;
  countryId?: string;
  cachedEconomicLean?: number;
  cachedSocialLean?: number;
}

interface UKRegionPageTabsPoliticsProps {
  region: UKRegion;
  state: StateLike | null;
  partyOrg: PartyOrgDisplay[];
  calculatedLeans: { economicLean: number; socialLean: number } | null;
  mps?: SerializedMP[];
  players?: SerializedPlayer[];
  npps?: NPPDisplaySimple[];
}

function MPCard({ mp, isVacant }: { mp: SerializedMP; isVacant: boolean }) {
  const profileLink =
    !isVacant && (mp.characterId || mp.nppId)
      ? mp.isNPP && mp.nppId
        ? `/politicians/npp/${mp.sequentialId ?? mp.nppId}`
        : `/character/${mp.sequentialId ?? mp.characterId}`
      : null;

  const displayName = mp.characterName ?? "Vacant";
  const partyLabel = mp.partyAbbreviation ?? "—";
  const partyColor = mp.partyColor;
  const seatsHeld = mp.seatsHeld ?? 1;

  return (
    <div className="relative flex flex-col items-center overflow-hidden rounded-xl border border-card-border bg-card px-3 pb-4 pt-1 transition-colors card-hover hover:border-primary/30 hover:bg-card-elevated">
      {/* Party-color top accent */}
      {!isVacant && partyColor && (
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: partyColor }} />
      )}

      {/* Avatar with NPP overlay */}
      <div className="relative mt-4">
        <Avatar
          url={mp.avatarUrl}
          name={displayName}
          size="h-16 w-16"
          className={isVacant ? "opacity-50 grayscale" : ""}
        />
        {mp.isNPP && !isVacant && (
          <span className="absolute -bottom-1 -right-1 rounded-full border border-purple-500/60 bg-card px-1 py-px text-[8px] font-bold leading-none text-purple-400">
            NPP
          </span>
        )}
      </div>

      {/* Text */}
      <div className="mt-3 w-full min-w-0 text-center">
        {profileLink ? (
          <Link
            href={profileLink}
            className="line-clamp-2 block text-sm font-semibold leading-tight text-foreground hover:text-primary"
          >
            {displayName}
          </Link>
        ) : (
          <span className="line-clamp-2 block text-sm font-semibold leading-tight text-muted">
            {displayName}
          </span>
        )}
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">MP</p>
        <p className="text-[10px] text-muted/60">
          {seatsHeld} {seatsHeld === 1 ? "seat" : "seats"}
        </p>

        {/* Party badge */}
        <div className="mt-2.5 flex justify-center">
          {isVacant ? (
            <span className="rounded-full border border-card-border bg-card-elevated px-2.5 py-0.5 text-[10px] text-muted">
              —
            </span>
          ) : partyColor ? (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{
                borderColor: partyColor + "60",
                backgroundColor: partyColor + "18",
                color: partyColor,
              }}
            >
              <PartyLogo
                partyId={mp.party ?? "independent"}
                partyColor={partyColor}
                size="h-3 w-3"
                countryId="UK"
              />
              <span className="truncate">{partyLabel}</span>
            </span>
          ) : (
            <span className="rounded-full border border-card-border bg-card-elevated px-2.5 py-0.5 text-[10px] text-muted">
              {partyLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function UKRegionPageTabsPolitics({
  region,
  state,
  partyOrg,
  calculatedLeans,
  mps = [],
  players = [],
  npps = [],
}: UKRegionPageTabsPoliticsProps) {
  const active = partyOrg
    .filter((po) => po.organization > 0)
    .sort((a, b) => b.organization - a.organization);
  const totalOrg = active.reduce((s, po) => s + po.organization, 0);

  // Split officials by office type
  const commonsOfficials = mps.filter((o) => !o.officeType || o.officeType === "commons");
  const rcOfficials = mps.filter((o) => o.officeType === "regionalCouncil");
  const totalRCSeats = rcOfficials.reduce((sum, o) => sum + (o.seatsHeld ?? 0), 0);

  return (
    <div className="space-y-6">
      {commonsOfficials.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Members of Parliament</h2>
            <span className="text-sm text-muted">
              {commonsOfficials.length} MP{commonsOfficials.length !== 1 ? "s" : ""} ·{" "}
              {region.constituencies} constituencies
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
            {commonsOfficials.map((mp) => (
              <MPCard key={mp._id} mp={mp} isVacant={!mp.characterId && !mp.nppId} />
            ))}
          </div>
        </div>
      )}

      {rcOfficials.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">{getUKCouncilName(region.id)}</h2>
            <span className="text-sm text-muted">
              {rcOfficials.length} councillor{rcOfficials.length !== 1 ? "s" : ""} · {totalRCSeats}{" "}
              seats
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
            {rcOfficials.map((mp) => (
              <MPCard key={mp._id} mp={mp} isVacant={!mp.characterId && !mp.nppId} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {(() => {
          // Clamp to ±5 (the −5..+5 scale `calculateStateLean` returns), not ±1,
          // so strong-lean regions match the map tooltip and profile markers
          // instead of being compressed to the slider edge. See
          // StatePageTabsPolitics for the same fix.
          const econ = Math.max(
            -5,
            Math.min(5, calculatedLeans?.economicLean ?? state?.cachedEconomicLean ?? 0)
          );
          const soc = Math.max(
            -5,
            Math.min(5, calculatedLeans?.socialLean ?? state?.cachedSocialLean ?? 0)
          );
          const leanToPercent = (v: number) => ((v + 5) / 10) * 100;
          const econThumbColor = econ < -0.1 ? "#3b82f6" : econ > 0.1 ? "#ef4444" : "#a1a1aa";
          const socThumbColor = soc < -0.1 ? "#2dd4bf" : soc > 0.1 ? "#f59e0b" : "#a1a1aa";
          return (
            <div className="rounded-xl border border-card-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
                Political Lean
              </h2>
              <div className="grid grid-cols-2 gap-5">
                {/* Economic axis */}
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
                      Economic
                    </p>
                    <PositionLabel
                      value={econ}
                      axis="economic"
                      countryId="UK"
                      className="text-xs font-semibold"
                    />
                    <p className="text-[11px] font-mono text-muted">
                      {econ >= 0 ? `+${econ.toFixed(2)}` : econ.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <div
                      className="relative h-1.5 rounded-full overflow-hidden"
                      style={{
                        background:
                          "linear-gradient(to right, #1d4ed8 0%, #3b82f6 30%, #71717a 50%, #ef4444 70%, #b91c1c 100%)",
                      }}
                    >
                      <div
                        className="absolute top-0 h-full w-px bg-white/20"
                        style={{ left: "50%" }}
                      />
                    </div>
                    <div className="relative h-3 -mt-0.5">
                      <div
                        className="absolute h-3 w-3 -top-0.5 rounded-full border-2 border-white shadow-md"
                        style={{
                          left: `${leanToPercent(econ)}%`,
                          transform: "translateX(-50%)",
                          backgroundColor: econThumbColor,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-muted mt-1">
                      <span>Left</span>
                      <span>Right</span>
                    </div>
                  </div>
                </div>

                {/* Social axis */}
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
                      Social
                    </p>
                    <PositionLabel value={soc} axis="social" className="text-xs font-semibold" />
                    <p className="text-[11px] font-mono text-muted">
                      {soc >= 0 ? `+${soc.toFixed(2)}` : soc.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <div
                      className="relative h-1.5 rounded-full overflow-hidden"
                      style={{
                        background:
                          "linear-gradient(to right, #0d9488 0%, #2dd4bf 30%, #71717a 50%, #f59e0b 70%, #d97706 100%)",
                      }}
                    >
                      <div
                        className="absolute top-0 h-full w-px bg-white/20"
                        style={{ left: "50%" }}
                      />
                    </div>
                    <div className="relative h-3 -mt-0.5">
                      <div
                        className="absolute h-3 w-3 -top-0.5 rounded-full border-2 border-white shadow-md"
                        style={{
                          left: `${leanToPercent(soc)}%`,
                          transform: "translateX(-50%)",
                          backgroundColor: socThumbColor,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-muted mt-1">
                      <span>Liberal</span>
                      <span>Trad</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {active.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg
                  className="h-5 w-5 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
                <h2 className="text-lg font-semibold">Party Organization</h2>
              </div>
            </div>
            <p className="text-[11px] text-muted/60 mb-4 leading-relaxed">
              Each party&apos;s slice of the regional Org pool. Spend Political Strength on Build
              Org to grow it; it decays passively each turn.
            </p>
            {(() => {
              const size = 96;
              const sw = 10;
              const r = (size - sw) / 2;
              const cx = size / 2;
              const cy = size / 2;
              const circ = 2 * Math.PI * r;
              const GAP_DEG = active.length > 1 ? 3 : 0;
              const toRad = (d: number) => (d * Math.PI) / 180;
              let cursor = -90;
              const slicePaths = active.map((po) => {
                const sweep = (po.organization / totalOrg) * 360 - GAP_DEG;
                if (sweep <= 0) {
                  cursor += (po.organization / totalOrg) * 360;
                  return null;
                }
                const startDeg = cursor + GAP_DEG / 2;
                const endDeg = startDeg + sweep;
                const x1 = cx + r * Math.cos(toRad(startDeg));
                const y1 = cy + r * Math.sin(toRad(startDeg));
                const x2 = cx + r * Math.cos(toRad(endDeg));
                const y2 = cy + r * Math.sin(toRad(endDeg));
                const large = sweep > 180 ? 1 : 0;
                const d = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`;
                cursor += (po.organization / totalOrg) * 360;
                return { d, color: po.partyColor, name: po.partyName, org: po.organization };
              });

              return (
                <div className="flex gap-5 items-start">
                  <div className="shrink-0">
                    {active.length === 1 ? (
                      <svg
                        width={size}
                        height={size}
                        viewBox={`0 0 ${size} ${size}`}
                        className="-rotate-90"
                      >
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={sw}
                          className="text-card-border"
                        />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill="none"
                          stroke={active[0].partyColor}
                          strokeWidth={sw}
                          strokeDasharray={`${circ} 0`}
                        />
                      </svg>
                    ) : (
                      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill="currentColor"
                          className="text-card-border"
                        />
                        {slicePaths.map((p, i) => p && <path key={i} d={p.d} fill={p.color} />)}
                        <circle
                          cx={cx}
                          cy={cy}
                          r={Math.max(0, r - sw)}
                          fill="currentColor"
                          className="text-card"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 space-y-2.5 min-w-0">
                    {active.map((po) => {
                      const orgLabel = getOrgLabel(po.organization);
                      return (
                        <div key={po._id}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: po.partyColor }}
                              />
                              <span className="text-sm font-medium truncate">{po.partyName}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-sm font-bold tabular-nums ${orgLabel.color}`}>
                                {po.organization.toFixed(1)}%
                              </span>
                              <span className={`text-[10px] font-medium ${orgLabel.color}`}>
                                {orgLabel.label}
                              </span>
                            </div>
                          </div>
                          <div className="relative h-2 overflow-hidden rounded-full bg-card-border">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, Math.max(0, po.organization))}%`,
                                backgroundColor: po.partyColor,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {active.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <p className="text-sm text-muted text-center">
            No party organizations in this region yet. Party data will appear when the UK simulation
            is fully active.
          </p>
        </div>
      )}

      {/* Players and NPPs lists - matching US state page layout */}
      {(players.length > 0 || npps.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          {(() => {
            // Create a State-like object for the list components
            const stateForLists = {
              _id: state?._id ?? region.id,
              name: region.name,
              countryId: "UK" as const,
              population: 0,
              gdp: 0,
              houseDistricts: region.constituencies,
            } as import("@/lib/db/types").State;
            return (
              <>
                <PlayersList state={stateForLists} players={players} partyOrg={partyOrg} />
                <NPPsList state={stateForLists} npps={npps} partyOrg={partyOrg} />
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
