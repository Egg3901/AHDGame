import Link from "next/link";
import type { NatMods } from "@/lib/military/doctrineTree";
import { rank } from "@/lib/military/generals";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";
import type { CombatState } from "../useCombatState";

// A posting's conflict is a dynamic id now; its display name is threaded in by the
// conflict board (sub-D). Here the raw id stands in.
const theaterName = (id: string) => id;

const mono = MIL_FONT.mono;

/** Readable force-wide doctrine effects derived from the adopted national doctrine. */
function doctrineLines(nm: NatMods): string[] {
  const out: string[] = [];
  if (nm.cvAll > 1) out.push(`+${Math.round((nm.cvAll - 1) * 100)}% force-wide combat value`);
  for (const k in nm.cvDom) out.push(`+${Math.round((nm.cvDom[k] - 1) * 100)}% ${k} combat value`);
  for (const k in nm.cvTrait) out.push(`+${Math.round((nm.cvTrait[k] - 1) * 100)}% ${k} units`);
  if (nm.joint > 1) out.push(`+${Math.round((nm.joint - 1) * 100)}% joint operations`);
  if (nm.supply) out.push(`+${nm.supply} supply throughput`);
  if (nm.upkeep < 1) out.push(`−${Math.round((1 - nm.upkeep) * 100)}% force upkeep`);
  if (nm.xp > 1) out.push(`+${Math.round((nm.xp - 1) * 100)}% combat experience gain`);
  if (nm.ready) out.push(`+${nm.ready} readiness recovery`);
  if (nm.deep) out.push(`+${Math.round(nm.deep * 100)}% deep-strike disruption`);
  return out;
}

export function DoctrineCommand({ state, natMods }: { state: CombatState; natMods: NatMods }) {
  const lines = doctrineLines(natMods);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div
        style={{
          flex: "1 1 320px",
          minWidth: 300,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 12,
          background: MIL_COLOR.inset,
          padding: 15,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div
            style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
          >
            NATIONAL DOCTRINE · FORCE-WIDE
          </div>
          <Link
            href="/world/conflicts/military"
            style={{ font: `600 9px ${mono}`, color: MIL_COLOR.gold }}
          >
            edit in SecDef Office →
          </Link>
        </div>
        {lines.length === 0 ? (
          <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
            No doctrine modifiers adopted yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {lines.map((l) => (
              <div
                key={l}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 7,
                  fontSize: 12,
                  color: MIL_COLOR.textMuted,
                }}
              >
                <span style={{ color: MIL_COLOR.green }}>▸</span>
                <span>{l}</span>
              </div>
            ))}
          </div>
        )}
        <p
          style={{
            margin: "12px 0 0",
            font: `500 10px ${mono}`,
            color: MIL_COLOR.textFaint,
            lineHeight: 1.5,
          }}
        >
          National doctrine is set by the Secretary of Defense and applies to every unit in combat.
          Field traits are trained per-formation by their commanding general.
        </p>
      </div>

      <div
        style={{
          flex: "1 1 320px",
          minWidth: 300,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 12,
          background: MIL_COLOR.inset,
          padding: 15,
        }}
      >
        <div
          style={{
            font: `600 9px ${mono}`,
            letterSpacing: ".14em",
            color: MIL_COLOR.textFaint,
            marginBottom: 10,
          }}
        >
          COMMAND · FIELD GENERALS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {state.conflictAssignments
            .map((a) => ({ a, g: state.generalsById[a.generalCharacterId] }))
            .filter((x) => x.g)
            .map(({ a, g }) => (
              <div
                key={`${a.theaterId}:${a.generalCharacterId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  border: `1px solid ${MIL_COLOR.borderSoft}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: MIL_FONT.serif,
                      fontSize: 13,
                      fontWeight: 600,
                      color: MIL_COLOR.text,
                    }}
                  >
                    {g!.name}
                  </div>
                  <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                    {theaterName(a.theaterId)}
                    {a.inCharge ? " · IN COMMAND" : ""}
                  </div>
                </div>
                <span style={{ font: `600 9px ${mono}`, color: MIL_COLOR.gold }}>
                  {rank(g!.level)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
