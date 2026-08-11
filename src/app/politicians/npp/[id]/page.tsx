import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import Link from "next/link";
import { getDb } from "@/lib/mongodb";
import { parseNppId } from "@/lib/utils/profileUrls";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import type { NPP, State, PoliticalParty, Corporation } from "@/lib/db/types";
import { deriveCeoArchetype } from "@/lib/npp/ceoArchetype";
import {
  getOfficeLabel,
  getPartyColor,
  getPartyHex,
  ensureReadableOnDark,
} from "@/lib/utils/politics";
import { PolicyDisplay } from "@/components/PolicyDisplay";
import { regionUrl, partyUrl } from "@/lib/urls";
import { getSiteUrl } from "@/lib/siteMetadata";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { NppForecastCard } from "./NppForecastCard";
import { NppCapitalPanel } from "./NppCapitalPanel";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { NPP_MAX_DONOR_BASE_LEVEL } from "@/lib/npp/actionAi";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const parsed = parseNppId(id);
  if (!parsed) return {};

  const db = await getDb();
  const projection = {
    name: 1,
    party: 1,
    homeState: 1,
    countryId: 1,
    avatarUrl: 1,
    currentOffice: 1,
  } as const;

  let npp: NPP | null = null;
  if (parsed.type === "sequential") {
    npp = await db.collection<NPP>("npps").findOne({ sequentialId: parsed.value }, { projection });
  } else if (ObjectId.isValid(parsed.value)) {
    npp = await db
      .collection<NPP>("npps")
      .findOne({ _id: new ObjectId(parsed.value) }, { projection });
  }
  if (!npp) return {};

  const officeLabel = getOfficeLabel(npp.currentOffice);
  const title = `${npp.name} | A House Divided`;
  const description = `${officeLabel} · ${npp.party} · ${npp.homeState}${npp.countryId ? `, ${npp.countryId}` : ""}. Non-player politician.`;
  const url = `${getSiteUrl()}/politicians/npp/${id}`;
  const image = npp.avatarUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "profile",
      url,
      images: [{ url: image, width: 512, height: 512, alt: npp.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

function StatMeter({
  value,
  max = 100,
  fillClass,
}: {
  value: number;
  max?: number;
  fillClass: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className={`h-full rounded-full ${fillClass} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatMoney(n: number, symbol = "$"): string {
  if (n >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${symbol}${(n / 1_000).toFixed(0)}K`;
  return `${symbol}${n.toLocaleString()}`;
}

async function getNPPData(id: string) {
  const parsed = parseNppId(id);
  if (!parsed) return null;

  const db = await getDb();

  let npp: NPP | null = null;

  if (parsed.type === "sequential") {
    npp = await db.collection<NPP>("npps").findOne({ sequentialId: parsed.value });
  } else {
    if (!ObjectId.isValid(parsed.value)) return null;
    npp = await db.collection<NPP>("npps").findOne({ _id: new ObjectId(parsed.value) });

    if (npp?.sequentialId) {
      redirect(`/politicians/npp/${npp.sequentialId}`);
    }
  }

  if (!npp) return null;

  const homeState = await db
    .collection<State>("states")
    .findOne({ _id: npp.homeState, countryId: npp.countryId });
  let party: PoliticalParty | null = null;
  if (npp.party && npp.party !== "independent") {
    const partySeqId = parseInt(npp.party, 10);
    const nppCountry = npp.countryId ?? "US";
    if (!isNaN(partySeqId)) {
      party = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: partySeqId, countryId: nppCountry });
    }
  }

  // Corporation this NPP currently runs as CEO, if any (parity with politician
  // profiles that surface office). ceoId holds the NPP _id when ceoType === "npp".
  const ledCorp = await db
    .collection<Corporation>("corporations")
    .findOne(
      { ceoType: "npp", ceoId: npp._id, ceoVacant: { $ne: true } },
      { projection: { name: 1, sequentialId: 1, type: 1, ceoHistory: 1 } }
    );
  let ledCorporation: {
    name: string;
    sequentialId?: number;
    type?: string;
    tenureStartTurn?: number;
  } | null = null;
  if (ledCorp) {
    const openTenure = (ledCorp.ceoHistory ?? []).find(
      (t) =>
        t.ceoType === "npp" && t.holderId?.toString() === npp._id.toString() && t.endTurn == null
    );
    ledCorporation = {
      name: ledCorp.name,
      sequentialId: ledCorp.sequentialId,
      type: ledCorp.type,
      tenureStartTurn: openTenure?.startTurn,
    };
  }

  return { npp, homeState, party, ledCorporation };
}

export default async function NppProfilePage({ params }: PageProps) {
  const { id } = await params;
  const [data, viewer] = await Promise.all([getNPPData(id), getAuthUserWithCharacter()]);

  if (!data) notFound();

  const viewerHasCharacter = !!viewer && viewer.hasCharacter && !!viewer.character;

  const { npp, homeState, party, ledCorporation } = data;
  const ceoArchetype = npp.personality ? deriveCeoArchetype(npp.personality) : null;
  const ceoArchetypeLabel = ceoArchetype
    ? {
        aggressive: "Aggressive",
        cautious: "Cautious",
        innovator: "Innovator",
        costCutter: "Cost-cutter",
      }[ceoArchetype]
    : null;
  const partyColor = party?.color ?? null;
  const partyHex = getPartyHex(npp.party, partyColor ?? undefined);
  const partyName = party?.name ?? (npp.party === "independent" ? "Independent" : npp.party);
  const stateName = homeState?.name ?? npp.homeState;
  const officeLabel = getOfficeLabel(npp.currentOffice);
  const favorability = npp.favorability ?? 50;
  const influence = npp.politicalInfluence ?? 0;

  // npp.funds is stored in the NPP's home currency (post-cf-inconsistency-fix
  // Phase 8 for NPPs). Resolve the symbol via the canonical country→currency map
  // so JP NPPs read as ¥, UK/SCO/WAL as £, etc. (no duplicate currency table).
  const funds = npp.funds ?? 0;
  const nppCurrencySymbol = getCurrencyPrefix(npp.countryId ?? "US");
  const donorBaseLevel = npp.donorBaseLevel ?? 0;
  const actionPoints = npp.actionPoints ?? 0;

  const loyalty = npp.personality?.loyalty ?? 0;
  const ambition = npp.personality?.ambition ?? 0;
  const stubbornness = npp.personality?.stubbornness ?? 0;

  const bio = npp.retiredAt
    ? `${npp.name} is a retired Non-Player Politician (NPP) who previously ${officeLabel === "Private Citizen" ? "served in various capacities" : `held the office of ${officeLabel}`}. NPPs are AI-controlled figures that populate the political landscape.`
    : `${npp.name} is a Non-Player Politician (NPP)—an AI-controlled figure that populates the game world. ${officeLabel === "Private Citizen" ? "Currently not holding office" : `Currently serving as ${officeLabel}`}. NPPs run in elections, hold office, and vote on legislation autonomously.`;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-8 overflow-x-hidden">
        {/* Profile header */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="h-1.5 w-full" style={{ backgroundColor: partyHex }} />

          <div className="px-6 py-6 flex flex-col sm:flex-row gap-6 sm:items-start">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-700 to-zinc-900 text-3xl font-bold flex items-center justify-center">
              {npp.avatarUrl ? (
                <Image
                  src={npp.avatarUrl}
                  alt={npp.name}
                  fill
                  className="object-cover"
                  unoptimized={bypassNextImageOptimization(npp.avatarUrl)}
                />
              ) : (
                npp.name.charAt(0).toUpperCase()
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold tracking-tight truncate">{npp.name}</h1>
                <span className="rounded-full border border-slate-500/40 bg-slate-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Non-Player Politician
                </span>
                {npp.retiredAt && (
                  <span className="rounded-full border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Retired
                  </span>
                )}
              </div>

              <p className="text-sm text-zinc-400 mb-3">{officeLabel}</p>

              <div className="flex flex-wrap gap-2 mb-4">
                {npp.party === "independent" ? (
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${getPartyColor(npp.party)}`}
                  >
                    Independent
                  </span>
                ) : party ? (
                  <Link
                    href={partyUrl(party.countryId, party.sequentialId)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-75 ${getPartyColor(npp.party, partyColor ?? undefined)}`}
                    style={
                      partyColor
                        ? {
                            borderColor: `${partyColor}60`,
                            color: ensureReadableOnDark(partyColor),
                            backgroundColor: `${partyColor}18`,
                          }
                        : {}
                    }
                  >
                    {party.name}
                  </Link>
                ) : (
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${getPartyColor(npp.party)}`}
                  >
                    {npp.party.charAt(0).toUpperCase() + npp.party.slice(1)}
                  </span>
                )}

                <Link
                  href={regionUrl(npp.countryId ?? "US", npp.homeState)}
                  className="rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500 transition-colors"
                >
                  {homeState?.name || npp.homeState}
                </Link>
              </div>

              <p className="text-sm text-zinc-400 leading-relaxed italic border-l-2 border-zinc-700 pl-3 max-w-prose">
                {bio}
              </p>
            </div>
          </div>
        </div>

        {/* Cross-pressure forecast (Phase 4 prediction snapshot) */}
        <NppForecastCard nppId={npp._id} />

        {/* Capital actions — only for authenticated players, deterministic spend (Phase 7) */}
        {viewerHasCharacter && !npp.retiredAt && (
          <NppCapitalPanel nppId={npp._id.toString()} nppName={npp.name} />
        )}

        {/* Political Standing + Details */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-4">
              Political Standing
            </h2>

            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Favorability</span>
                  <span className="font-bold tabular-nums">{favorability.toFixed(1)} / 100</span>
                </div>
                <StatMeter
                  value={favorability}
                  max={100}
                  fillClass={
                    favorability >= 60
                      ? "bg-zinc-300"
                      : favorability >= 40
                        ? "bg-zinc-400"
                        : "bg-zinc-600"
                  }
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Political Influence</span>
                  <span className="font-bold tabular-nums">{influence.toFixed(1)} / 100</span>
                </div>
                <StatMeter value={influence} max={100} fillClass="bg-cyan-400" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-4">
              Details
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1.5 pr-2 align-top text-zinc-500 font-medium">Office</td>
                  <td className="py-1.5 text-foreground">{officeLabel}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 align-top text-zinc-500 font-medium">Party</td>
                  <td className="py-1.5 text-foreground">{partyName}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 align-top text-zinc-500 font-medium">State</td>
                  <td className="py-1.5 text-foreground">{stateName}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-2 align-top text-zinc-500 font-medium">Type</td>
                  <td className="py-1.5 text-foreground">Non-Player Politician</td>
                </tr>
                {ledCorporation && (
                  <tr>
                    <td className="py-1.5 pr-2 align-top text-zinc-500 font-medium">CEO of</td>
                    <td className="py-1.5 text-foreground">
                      <Link
                        href={`/corporation/${ledCorporation.sequentialId ?? ""}`}
                        className="text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        {ledCorporation.name}
                      </Link>
                      {ledCorporation.tenureStartTurn != null && (
                        <span className="text-zinc-500">
                          {" "}
                          · since turn {ledCorporation.tenureStartTurn}
                        </span>
                      )}
                    </td>
                  </tr>
                )}
                {ledCorporation && ceoArchetypeLabel && (
                  <tr>
                    <td className="py-1.5 pr-2 align-top text-zinc-500 font-medium">CEO style</td>
                    <td className="py-1.5 text-foreground">{ceoArchetypeLabel}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Economic Data */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-4">
            Economic Data
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                Campaign Funds
              </p>
              <p className="text-xl font-bold tabular-nums text-emerald-400">
                {formatMoney(funds, nppCurrencySymbol ?? "$")}
              </p>
            </div>

            <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                Donor Base Level
              </p>
              <p className="text-xl font-bold tabular-nums">
                {donorBaseLevel} / {NPP_MAX_DONOR_BASE_LEVEL}
              </p>
            </div>

            <div className="rounded-lg bg-zinc-950/40 border border-zinc-800 p-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Action Points
              </p>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xl font-bold tabular-nums">{actionPoints}</span>
                <span className="text-xs text-zinc-500">/ 100</span>
              </div>
              <StatMeter value={actionPoints} max={100} fillClass="bg-amber-400" />
            </div>
          </div>
        </div>

        {/* Personality Traits */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-4">
            Personality Traits
          </h2>
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-zinc-400">Loyalty</span>
                <span className="font-bold tabular-nums">{loyalty} / 100</span>
              </div>
              <StatMeter value={loyalty} max={100} fillClass="bg-blue-400" />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-zinc-400">Ambition</span>
                <span className="font-bold tabular-nums">{ambition} / 100</span>
              </div>
              <StatMeter value={ambition} max={100} fillClass="bg-violet-400" />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-zinc-400">Stubbornness</span>
                <span className="font-bold tabular-nums">{stubbornness} / 100</span>
              </div>
              <StatMeter value={stubbornness} max={100} fillClass="bg-orange-400" />
            </div>
          </div>
        </div>

        {/* Policy Positions */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-4">
            Policy Positions
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg bg-zinc-950/40 p-4">
              <PolicyDisplay label="Economic" axis="economic" value={npp.policies?.economic ?? 0} />
            </div>
            <div className="rounded-lg bg-zinc-950/40 p-4">
              <PolicyDisplay label="Social" axis="social" value={npp.policies?.social ?? 0} />
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-center">
          <p className="text-xs text-zinc-500">AI-controlled politician</p>
        </div>

        <div>
          <Link
            href="/politicians"
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Back to Politicians
          </Link>
        </div>
      </main>
    </div>
  );
}
