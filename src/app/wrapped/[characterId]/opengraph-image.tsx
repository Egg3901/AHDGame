import { ImageResponse } from "next/og";
import { ObjectId } from "mongodb";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { getDb } from "@/lib/mongodb";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import type { CharacterRecap } from "@/lib/recap/types";

// Uses mongodb → must run on the Node runtime (not edge).
export const runtime = "nodejs";
export const alt = "A House Divided — Season Wrapped";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GOLD = "#E8B84B";
const CREAM = "#F5F1E6";

async function loadRecap(characterId: string): Promise<CharacterRecap | null> {
  try {
    if (!ObjectId.isValid(characterId)) return null;
    const db = await getDb();
    const doc = await db
      .collection<RetiredCharacter>("retiredCharacters")
      .findOne(
        { characterId: new ObjectId(characterId), recap: { $exists: true } },
        { sort: { retiredAt: -1 }, projection: { recap: 1 } }
      );
    return doc?.recap ?? null;
  } catch {
    return null; // render the generic card rather than 500 the unfurl
  }
}

export default async function Image({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const recap = await loadRecap(characterId);

  const season = recap?.iteration ? iterationLabel(recap.iteration) : "Season";
  const name = recap?.name ?? "A House Divided";
  const office = recap?.highestOffice ?? "";

  const stats: Array<[string, string]> = [];
  if (recap) {
    if (recap.actions.total > 0)
      stats.push(["ACTIONS", recap.actions.total.toLocaleString("en-US")]);
    if (recap.elections.entered > 0)
      stats.push(["RACES WON", `${recap.elections.won}/${recap.elections.entered}`]);
    if (recap.achievements.count > 0)
      stats.push(["ACHIEVEMENTS", String(recap.achievements.count)]);
  }

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: "linear-gradient(135deg,#0B1E3B 0%,#3A0B1E 55%,#463610 100%)",
        color: CREAM,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{ display: "flex", fontSize: 28, letterSpacing: 10, color: GOLD, fontWeight: 700 }}
      >
        {`A HOUSE DIVIDED  ·  ${season.toUpperCase()}  ·  WRAPPED`}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 900, lineHeight: 1 }}>{name}</div>
        {office ? (
          <div style={{ display: "flex", fontSize: 36, marginTop: 18, color: GOLD }}>{office}</div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>
      <div style={{ display: "flex", gap: 64 }}>
        {stats.map(([label, value]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 52, fontWeight: 900 }}>{value}</div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: 4,
                color: "rgba(245,241,230,0.65)",
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>,
    { ...size }
  );
}
