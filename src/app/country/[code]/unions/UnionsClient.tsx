"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { HeroImage } from "@/components/HeroImage";
import BackButton from "@/components/BackButton";
import { CountryFlag } from "@/components/CountryFlag";
import { EmptyState, Skeleton, Tooltip } from "@/components/ui";
import { UnionEmblem } from "@/components/unions/UnionEmblem";
import { FoundUnionModal } from "@/components/unions/FoundUnionModal";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { countryUrl } from "@/lib/urls";

interface LeaderboardRow {
  unionId: string;
  name: string;
  countryId: string;
  countryName: string;
  sectorType: string;
  sectorLabel: string;
  leaderName: string | null;
  isVacant: boolean;
  /** Real headcount: workers across this union's sectors, weighted by unionization. */
  members: number;
  /** 0-100, how the membership rates the bargain the union is offering. */
  approval: number;
  treasury: number;
  demandedWageLevel: number | null;
  suspended?: boolean;
}

/** Union ban (player suggestion #93): a country whose unions are outlawed by an enacted ban. */
interface BannedCountry {
  countryId: string;
  countryName: string;
}

const HERO_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/IWW_demonstration_NY_1914.jpg/1280px-IWW_demonstration_NY_1914.jpg";

/** Words skipped when deriving a display abbreviation from a union name. */
const ABBREVIATION_STOPWORDS = new Set(["of", "the", "and", "und", "in", "de", "e", "a", "for"]);

/**
 * Display-only abbreviation derived from the union's name initials (e.g.
 * "United Auto Workers" reads UAW). Skips names that are already short or
 * acronym-styled; no data field is invented, this is pure presentation.
 */
function deriveAbbreviation(name: string): string | null {
  if (name.length <= 12 || !name.includes(" ")) return null;
  const words = name
    .split(/[\s-]+/)
    .filter((w) => w.length > 0 && !ABBREVIATION_STOPWORDS.has(w.toLowerCase()));
  if (words.length < 2) return null;
  const initials = words.map((w) => w[0]!.toUpperCase()).join("");
  if (initials.length < 2 || initials.length > 8) return null;
  return initials;
}

/** "1953-default" reads as the era year 1953; non-era presets show nothing. */
function eraYearForPreset(preset: string | null | undefined): string | null {
  const year = preset?.split("-")[0];
  return year && /^\d{4}$/.test(year) ? year : null;
}

/**
 * Country-scoped unions page: the labour roster for one nation, reached from
 * the Nation dropdown's Economy group. Shows each seeded union with its
 * historically named organization, sector, leadership, membership pressure,
 * wage demand, and treasury.
 */
export function UnionsClient() {
  const { code } = useParams<{ code: string }>();
  const countryParam = (code ?? "us").toUpperCase();
  const countryId: CountryId =
    countryParam in COUNTRY_CONFIGS ? (countryParam as CountryId) : COUNTRY_CONFIGS.US.id;
  const countryName = COUNTRY_CONFIGS[countryId]?.name ?? countryId;
  const preset = useActivePreset();
  const eraYear = eraYearForPreset(preset);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [bannedCountries, setBannedCountries] = useState<BannedCountry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [foundOpen, setFoundOpen] = useState(false);

  // Also callable on demand (not just on mount/country change) so a newly
  // founded union appears in the list without a full page reload.
  async function loadLeaderboard(signal?: { cancelled: boolean }) {
    setLoading(true);
    setLoadError(null);
    setNotEnabled(false);
    try {
      const res = await fetch(`/api/unions/leaderboard?country=${countryId.toUpperCase()}`);
      const data = await res.json();
      if (signal?.cancelled) return;
      if (!res.ok) {
        if (res.status === 403) {
          setNotEnabled(true);
        } else {
          setLoadError(data.error ?? "Failed to load unions.");
        }
        return;
      }
      setRows(data.unions ?? []);
      setBannedCountries(data.bannedCountries ?? []);
    } catch {
      if (!signal?.cancelled) setLoadError("Network error loading unions.");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    loadLeaderboard(signal);
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId]);

  const stats = useMemo(() => {
    const led = rows.filter((r) => !r.isVacant);
    const totalTreasury = rows.reduce((sum, r) => sum + r.treasury, 0);
    const totalMembers = rows.reduce((sum, r) => sum + r.members, 0);
    const avgApproval = rows.length
      ? rows.reduce((sum, r) => sum + r.approval, 0) / rows.length
      : 0;
    const vacant = rows.filter((r) => r.isVacant).length;
    return { ledCount: led.length, vacant, totalTreasury, totalMembers, avgApproval };
  }, [rows]);

  const isBannedHere = bannedCountries.some((c) => c.countryId === countryId);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
        <div className="relative h-[175px] w-full sm:h-[220px]">
          <HeroImage
            src={HERO_IMAGE_URL}
            alt="Labour union demonstration"
            fill
            className="object-cover"
            style={{ objectPosition: "center 35%" }}
            priority
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
            aria-hidden
          />

          <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
            <div className="flex items-center justify-between gap-2">
              <BackButton iconOnly fallbackLabel="Back" fallbackHref={countryUrl(countryId)} />
              {eraYear && (
                <span className="rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
                  {eraYear} era
                </span>
              )}
            </div>

            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 text-xs italic text-white/70 drop-shadow">
                <CountryFlag country={countryId} size="sm" />
                Organized labour across every industry in {countryName}
              </p>
              <h1
                data-coach="nav-unions"
                className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl"
              >
                {countryName} Unions
              </h1>
            </div>
          </div>
        </div>

        {!notEnabled && (
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            <StatCell label="Unions" value={String(rows.length)} />
            <StatCell label="Led" value={String(stats.ledCount)} />
            <StatCell label="Vacant" value={String(stats.vacant)} />
            <StatCell
              label="Total Membership"
              value={Math.round(stats.totalMembers).toLocaleString("en-US")}
              hint="Real headcount across every union in this country: workers in the sectors each one represents, weighted by unionization."
            />
            <StatCell
              label="Avg Approval"
              value={`${Math.round(stats.avgApproval)}%`}
              hint="How the membership rates the bargain, averaged across every union here. Dues push it down, running services pushes it up."
            />
            <StatCell
              label="Total Funds"
              value={Math.round(stats.totalTreasury).toLocaleString("en-US")}
            />
          </div>
        )}
      </header>

      {/* Union ban (player suggestion #93): banned-state banner. */}
      {isBannedHere && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-error/40 bg-error/10 px-4 py-3"
        >
          <span aria-hidden className="mt-0.5 text-error">
            ⚠
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-error">
              Unions are banned under current law in {countryName}.
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Affected unions are suspended: leadership, treasuries, and membership are frozen, not
              lost, until the ban is repealed by legislation. Union actions are unavailable and
              unionization is declining while the ban holds.
            </p>
          </div>
        </div>
      )}

      {!notEnabled && (
        <p className="text-sm text-muted">
          Every industry in {countryName} already has a union. Vacant unions need organizers to fund
          drives and elect a president. Open a union page to organize or vote.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            All Unions in {countryName}
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-card-border to-transparent" />
          {!notEnabled && !isBannedHere && (
            <button
              type="button"
              onClick={() => setFoundOpen(true)}
              className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              Found a Union
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
          {loading ? (
            // Mirrors the loaded table: header strip + rank/name/leader/number
            // columns. Union count varies by world, so reserve the typical
            // loaded height with min-h, rows inside only approximate.
            <div className="min-h-[520px]">
              <div className="flex items-center gap-4 border-b border-card-border bg-card-elevated px-4 py-3">
                <Skeleton className="h-3 w-4" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="ml-auto h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-card-border px-4 py-3 last:border-0"
                >
                  <Skeleton className="h-3 w-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="hidden h-4 w-24 sm:block" />
                  <Skeleton className="h-4 w-12 shrink-0" />
                  <Skeleton className="h-4 w-16 shrink-0" />
                </div>
              ))}
            </div>
          ) : notEnabled ? (
            <div className="p-6">
              <EmptyState
                title="Unions aren't live in this world yet"
                description="Player-run unions are a higher labour-system tier that hasn't been turned on here. Check back after it's enabled."
              />
            </div>
          ) : loadError ? (
            <div className="p-6">
              <EmptyState title="Couldn't load unions" description={loadError} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No unions seeded yet"
                description="Unions are created when the world is bootstrapped."
              />
            </div>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-card-border bg-card-elevated text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Union</th>
                  <th className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center">
                      President
                      <Tooltip content="The union president. A vacant union has none; fund organize drives on its page, then vote one in." />
                    </span>
                  </th>
                  <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                    <span className="inline-flex items-center">
                      Membership
                      <Tooltip content="Real headcount: workers across this union's sectors, weighted by how unionized each one is." />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <span className="inline-flex items-center">
                      Approval
                      <Tooltip content="How the membership rates the bargain, 0-100%. Dues push it down, running services pushes it up." />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <span className="inline-flex items-center">
                      Funds
                      <Tooltip content="The union's treasury. Dues flow in each turn; services and recruitment drives are paid out of it." />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const abbreviation = deriveAbbreviation(r.name);
                  return (
                    <tr
                      key={r.unionId}
                      className="border-b border-card-border transition-colors last:border-0 hover:bg-card-elevated/60"
                    >
                      <td className="px-4 py-3 text-xs font-semibold tabular-nums text-muted">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <UnionEmblem
                            name={r.name}
                            sectorType={r.sectorType}
                            suspended={r.suspended}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/unions/${r.unionId}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {r.name}
                              </Link>
                              {abbreviation && (
                                <span className="rounded border border-card-border bg-card-elevated px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted">
                                  {abbreviation}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted">{r.sectorLabel}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {r.suspended ? (
                          <span className="text-xs font-medium uppercase tracking-wide text-error">
                            Suspended
                          </span>
                        ) : (
                          (r.leaderName ?? (
                            <span className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                              Vacant
                            </span>
                          ))
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-right font-mono tabular-nums sm:table-cell">
                        {Math.round(r.members).toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono tabular-nums ${
                            r.approval >= 50
                              ? "text-success"
                              : r.approval >= 30
                                ? "text-warning"
                                : "text-error"
                          }`}
                        >
                          {Math.round(r.approval)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {Math.round(r.treasury).toLocaleString("en-US")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <FoundUnionModal
        open={foundOpen}
        onClose={() => setFoundOpen(false)}
        onFounded={loadLeaderboard}
        countryId={countryId}
        countryName={countryName}
      />
    </main>
  );
}

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-max flex-col px-5 py-3">
      <span className="flex items-center text-[10px] font-medium uppercase tracking-widest text-muted">
        {label}
        {hint && <Tooltip content={hint} />}
      </span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  );
}
