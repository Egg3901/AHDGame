"use client";

import Image from "next/image";
import type { CharacterRecap } from "@/lib/recap/types";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { compact, fmt, money } from "@/lib/recap/format";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { anim, SeasonStrip } from "./charts";

export interface PosterStat {
  label: string;
  value: string;
}

/** The six numbers on the poster, most personal first; empty stats drop out. */
export function posterStats(r: CharacterRecap): PosterStat[] {
  const out: PosterStat[] = [];
  if (r.actions.total > 0) out.push({ label: "Actions", value: fmt(r.actions.total) });
  if (r.elections.entered > 0)
    out.push({
      label: "Races won",
      value: `${fmt(r.elections.won)} of ${fmt(r.elections.entered)}`,
    });
  if ((r.races?.totalVotes ?? 0) > 0)
    out.push({ label: "Votes for you", value: compact(r.races!.totalVotes) });
  if (r.bills.passed > 0) out.push({ label: "Bills passed", value: fmt(r.bills.passed) });
  else if ((r.legislation?.votesCast ?? 0) > 0)
    out.push({ label: "Roll-call votes", value: fmt(r.legislation!.votesCast) });
  if (r.influence.npi?.rank != null)
    out.push({
      label: `Influence, ${r.countryName ?? r.countryId}`,
      value: `No. ${fmt(r.influence.npi.rank)}`,
    });
  const nw = r.netWorth ?? r.campaignFunds;
  if (nw)
    out.push({ label: r.netWorth ? "Net worth" : "Campaign funds", value: money(r, nw.value) });
  if ((r.awards?.length ?? 0) > 0)
    out.push({ label: "Season awards", value: fmt(r.awards!.length) });
  if (r.achievements.count > 0)
    out.push({ label: "Achievements", value: fmt(r.achievements.count) });
  if (r.tenureTurns > 0) out.push({ label: "Turns played", value: fmt(r.tenureTurns) });
  return out.slice(0, 6);
}

/**
 * The end card: everything the season comes to on one screen. Used as the
 * story finale and as the public share page, and mirrored by the server-drawn
 * PNG in `/wrapped/[characterId]/story-image`.
 */
export function WrappedPoster({
  recap,
  accent,
  motion,
}: {
  recap: CharacterRecap;
  accent: string;
  motion: boolean;
}) {
  const season = recap.iteration ? iterationLabel(recap.iteration) : "Season";
  const stats = posterStats(recap);
  return (
    <div className="flex h-full flex-col">
      <p
        className="text-[14px] font-medium text-white/55"
        style={anim(motion, "ahdw-rise", 400, 0)}
      >
        {season} Wrapped
      </p>
      <h2
        className="mt-3 text-balance text-[40px] font-extrabold leading-[0.95] tracking-[-0.045em] text-white"
        style={anim(motion, "ahdw-rise", 500, 80)}
      >
        {recap.name}
      </h2>
      <p className="mt-2 text-[15px] text-white/60" style={anim(motion, "ahdw-rise", 450, 160)}>
        {[recap.party, recap.countryName].filter(Boolean).join(" · ")}
      </p>
      {recap.highestOffice && (
        <p
          className="mt-1 text-[15px] font-semibold"
          style={{ color: accent, ...anim(motion, "ahdw-rise", 450, 220) }}
        >
          {recap.highestOffice}
        </p>
      )}

      {recap.activity && (
        <div className="mt-6" style={anim(motion, "ahdw-fade", 400, 250)}>
          <SeasonStrip
            activity={recap.activity}
            marks={recap.marks}
            accent={accent}
            motion={motion}
            height={64}
            drawMs={900}
          />
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="min-w-0"
            style={anim(motion, "ahdw-rise", 450, 500 + i * 70)}
          >
            <dt className="truncate text-[12px] text-white/50">{s.label}</dt>
            <dd className="truncate text-[24px] font-bold tabular-nums leading-tight tracking-[-0.03em] text-white">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      {recap.persona && (
        <div className="mt-6" style={anim(motion, "ahdw-rise", 450, 950)}>
          <p className="text-[20px] font-bold tracking-[-0.02em]" style={{ color: accent }}>
            {recap.persona.title}
          </p>
          <p className="mt-0.5 text-[14px] leading-snug text-white/60">{recap.persona.reason}</p>
        </div>
      )}

      <div
        className="mt-auto flex items-center gap-2 pt-6"
        style={anim(motion, "ahdw-fade", 400, 1100)}
      >
        <Image
          src={CDN_LOGO_URL}
          unoptimized
          alt=""
          width={22}
          height={22}
          className="shrink-0 object-contain"
        />
        <span className="text-[13px] font-semibold tracking-tight text-white/80">
          A House Divided
        </span>
      </div>
    </div>
  );
}
