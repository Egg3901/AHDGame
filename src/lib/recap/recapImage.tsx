import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CharacterRecap } from "./types";
import { recapAccent } from "./accent";
import { compact, fmt, money } from "./format";
import { iterationLabel } from "@/lib/wiki/officeIteration";

/**
 * Server-drawn Wrapped images (satori via `next/og`): the 1200x630 link card
 * and the 1080x1920 story image players save and post. Satori supports flexbox
 * and inline SVG only, so this mirrors the poster with absolute sizes rather
 * than reusing the client component.
 */

const MUTED = "rgba(255,255,255,0.58)";

type ImageFont = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" };

/**
 * Geist from `public/fonts`, so the images match the site instead of satori's
 * single-weight default. Missing files fall back to the default font rather
 * than failing the image.
 */
let fontCache: Promise<ImageFont[]> | null = null;

export function recapImageFonts(): Promise<ImageFont[]> {
  fontCache ??= loadFonts();
  return fontCache;
}

async function loadFonts(): Promise<ImageFont[]> {
  const load = async (file: string, weight: 400 | 600): Promise<ImageFont | null> => {
    try {
      const buf = await readFile(path.join(process.cwd(), "public", "fonts", file));
      return {
        name: "Geist",
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        weight,
        style: "normal",
      };
    } catch {
      return null;
    }
  };
  const fonts = await Promise.all([
    load("Geist-Regular.ttf", 400),
    load("Geist-SemiBold.ttf", 600),
  ]);
  return fonts.filter((f): f is ImageFont => f !== null);
}

function stats(r: CharacterRecap): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (r.actions.total > 0) out.push(["Actions", fmt(r.actions.total)]);
  if (r.elections.entered > 0)
    out.push(["Races won", `${fmt(r.elections.won)} of ${fmt(r.elections.entered)}`]);
  if ((r.races?.totalVotes ?? 0) > 0) out.push(["Votes for you", compact(r.races!.totalVotes)]);
  if (r.bills.passed > 0) out.push(["Bills passed", fmt(r.bills.passed)]);
  if (r.influence.npi?.rank != null)
    out.push(["Influence rank", `No. ${fmt(r.influence.npi.rank)}`]);
  const nw = r.netWorth ?? r.campaignFunds;
  if (nw) out.push([r.netWorth ? "Net worth" : "Campaign funds", money(r, nw.value)]);
  if (r.tenureTurns > 0) out.push(["Turns played", fmt(r.tenureTurns)]);
  return out.slice(0, 6);
}

function Strip({
  recap,
  accent,
  width,
  height,
}: {
  recap: CharacterRecap;
  accent: string;
  width: number;
  height: number;
}) {
  const a = recap.activity;
  if (!a || a.bins.length === 0) return null;
  const max = Math.max(1, ...a.bins);
  const bw = width / a.bins.length;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {a.bins.map((v, i) => {
        const h = v > 0 ? Math.max(3, (height * v) / max) : 2;
        return (
          <rect
            key={i}
            x={i * bw + bw * 0.14}
            y={height - h}
            width={bw * 0.72}
            height={h}
            fill={v > 0 ? accent : "rgba(255,255,255,0.18)"}
          />
        );
      })}
    </svg>
  );
}

export function RecapStoryImage({ recap }: { recap: CharacterRecap | null }) {
  if (!recap) return <GenericCard width={1080} height={1920} />;
  const accent = recapAccent(recap.partyColor);
  const season = recap.iteration ? iterationLabel(recap.iteration) : "Season";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "120px 96px 110px",
        background: "#000",
        color: "#fff",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", fontSize: 34, color: MUTED }}>{`${season} Wrapped`}</div>
      <div
        style={{
          display: "flex",
          fontSize: 112,
          fontWeight: 600,
          lineHeight: 0.95,
          letterSpacing: -4,
          marginTop: 40,
        }}
      >
        {recap.name}
      </div>
      <div style={{ display: "flex", fontSize: 36, color: MUTED, marginTop: 28 }}>
        {[recap.party, recap.countryName].filter(Boolean).join(" · ")}
      </div>
      {recap.highestOffice ? (
        <div
          style={{ display: "flex", fontSize: 38, fontWeight: 600, color: accent, marginTop: 12 }}
        >
          {recap.highestOffice}
        </div>
      ) : null}
      <div style={{ display: "flex", marginTop: 72 }}>
        <Strip recap={recap} accent={accent} width={888} height={190} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 72 }}>
        {stats(recap).map(([label, value]) => (
          <div
            key={label}
            style={{ display: "flex", flexDirection: "column", width: "50%", marginBottom: 52 }}
          >
            <div style={{ display: "flex", fontSize: 30, color: MUTED }}>{label}</div>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 600, letterSpacing: -2 }}>
              {value}
            </div>
          </div>
        ))}
      </div>
      {recap.persona ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 600, color: accent }}>
            {recap.persona.title}
          </div>
          <div
            style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 10, lineHeight: 1.3 }}
          >
            {recap.persona.reason}
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", marginTop: "auto", fontSize: 34, fontWeight: 600 }}>
        A House Divided
      </div>
    </div>
  );
}

export function RecapCardImage({ recap }: { recap: CharacterRecap | null }) {
  if (!recap) return <GenericCard width={1200} height={630} />;
  const accent = recapAccent(recap.partyColor);
  const season = recap.iteration ? iterationLabel(recap.iteration) : "Season";
  const s = stats(recap).slice(0, 3);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "64px 72px",
        background: "#000",
        color: "#fff",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: MUTED }}>
        <div style={{ display: "flex" }}>{`${season} Wrapped`}</div>
        <div style={{ display: "flex", color: "#fff", fontWeight: 600 }}>A House Divided</div>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 84,
          fontWeight: 600,
          letterSpacing: -3,
          marginTop: 36,
          lineHeight: 1,
        }}
      >
        {recap.name}
      </div>
      <div style={{ display: "flex", fontSize: 32, color: accent, fontWeight: 600, marginTop: 14 }}>
        {recap.persona?.title ?? recap.highestOffice ?? recap.party}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 56 }}>
          {s.map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 50, fontWeight: 600, letterSpacing: -1 }}>
                {value}
              </div>
              <div style={{ display: "flex", fontSize: 22, color: MUTED }}>{label}</div>
            </div>
          ))}
        </div>
        <Strip recap={recap} accent={accent} width={340} height={110} />
      </div>
    </div>
  );
}

function GenericCard({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        color: "#fff",
        fontSize: 64,
        fontWeight: 600,
      }}
    >
      A House Divided
    </div>
  );
}
