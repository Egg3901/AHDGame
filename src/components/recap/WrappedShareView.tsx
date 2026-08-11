"use client";

import { useState } from "react";
import Link from "next/link";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { CharacterRecap } from "@/lib/recap/types";
import { SeasonRecapStory } from "./SeasonRecapStory";

const GOLD = "#E8B84B";
const CREAM = "#F5F1E6";

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmt(n);
}
function sym(countryId: string): string {
  const code = COUNTRY_CURRENCY_MAP[countryId as CountryId] ?? "USD";
  const m: Record<string, string> = {
    USD: "$",
    GBP: "£",
    EUR: "€",
    JPY: "¥",
    CNY: "¥",
    BRL: "R$",
    RUB: "₽",
    TRY: "₺",
    SEK: "kr",
  };
  return m[code] ?? "$";
}
function tiles(r: CharacterRecap): Array<[string, string]> {
  const t: Array<[string, string]> = [];
  if (r.actions.total > 0) t.push(["Actions", fmt(r.actions.total)]);
  if (r.highestOffice) t.push(["Highest office", r.highestOffice]);
  if (r.elections.entered > 0)
    t.push(["Elections won", `${fmt(r.elections.won)}/${fmt(r.elections.entered)}`]);
  const money = r.netWorth ?? r.campaignFunds;
  if (money) t.push(["Net worth", `${sym(r.countryId)}${compact(money.value)}`]);
  if (r.achievements.count > 0) t.push(["Achievements", fmt(r.achievements.count)]);
  if (r.tenureTurns > 0) t.push(["Turns served", fmt(r.tenureTurns)]);
  return t.slice(0, 6);
}

/**
 * Public landing for a shared recap link (`/wrapped/[characterId]`). Renders a
 * static, screenshot-worthy summary card plus a button to play the full
 * tap-through story and a CTA into the game. No auth required.
 */
export function WrappedShareView({ recap }: { recap: CharacterRecap }) {
  const [playing, setPlaying] = useState(false);
  const season = recap.iteration ? `${recap.iteration.type} ${recap.iteration.number}` : "Season";

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: "#07070b" }}
    >
      <div className="w-full max-w-md">
        <div
          className="relative overflow-hidden rounded-3xl border p-7 text-center shadow-2xl"
          style={{
            background: "linear-gradient(155deg,#120d05,#281f0a 55%,#463610)",
            borderColor: `${GOLD}55`,
            color: CREAM,
          }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.32em]" style={{ color: GOLD }}>
            Official record · {season}
          </p>
          <div className="mx-auto my-3 h-px w-16" style={{ background: `${GOLD}88` }} />
          <h1
            className="text-3xl font-black uppercase leading-tight"
            style={{ letterSpacing: "-0.02em" }}
          >
            {recap.name}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {[recap.party, recap.highestOffice].filter(Boolean).join("  ·  ") || recap.party}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 text-left">
            {tiles(recap).map(([label, value]) => (
              <div
                key={label}
                className="border-t pt-2"
                style={{ borderColor: "rgba(255,255,255,.14)" }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
                  {label}
                </p>
                <p className="mt-0.5 truncate text-lg font-black" style={{ color: CREAM }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-7 text-xs uppercase tracking-[0.28em]" style={{ color: GOLD }}>
            A House Divided · Wrapped
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="rounded-full px-6 py-2.5 text-sm font-bold text-zinc-950 shadow-lg transition-transform hover:scale-[1.04]"
            style={{ background: GOLD }}
          >
            ▶ Play the recap
          </button>
          <Link
            href="/"
            className="rounded-full border border-white/25 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Play A House Divided
          </Link>
        </div>
      </div>

      {playing && <SeasonRecapStory recap={recap} onClose={() => setPlaying(false)} />}
    </div>
  );
}
