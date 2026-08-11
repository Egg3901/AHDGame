import {
  FULLTREE,
  learnedOf,
  nodeStatus,
  findTreeNode,
  isNatActiveInDoctrine,
  missingTraitPrerequisite,
  type ProfileGeneral,
  type TraitStatus,
} from "@/lib/military/generalsTree";
import { useState } from "react";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";

const mono = MIL_FONT.mono;

const STATUS_DOT: Record<TraitStatus, string> = {
  learned: "#e0b352",
  available: "#86d978",
  locked: "#5a5a68",
  future: "#4a4a58",
};
const STATUS_BADGE: Record<TraitStatus, string> = {
  learned: "LEARNED",
  available: "TRAIN",
  locked: "LOCKED",
  future: "FUTURE",
};

export function TraitTree({
  general,
  adopted,
  selTraitId,
  curEra,
  editable,
  onSelectTrait,
  onTrain,
}: {
  general: ProfileGeneral;
  adopted: Record<string, number>;
  selTraitId: string | null;
  curEra: number;
  editable: boolean;
  onSelectTrait: (id: string | null) => void;
  onTrain: (id: string) => void;
}) {
  const cats = Object.entries(FULLTREE);
  const [catKey, setCatKey] = useState<string>(cats[0][0]);
  const cat = FULLTREE[catKey];
  const learned = learnedOf(general);
  const learnedSet = new Set(learned);
  const sel = selTraitId ? findTreeNode(selTraitId) : null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div
        style={{
          flex: "2 1 420px",
          minWidth: 320,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            border: `1px solid ${MIL_COLOR.border}`,
            borderRadius: 9,
            background: MIL_COLOR.inset,
            padding: "9px 11px",
            font: `500 10px ${mono}`,
            color: MIL_COLOR.textMuted,
            lineHeight: 1.5,
          }}
        >
          You choose which traits to train. Generals start with 4 skill points and gain 1 at each
          promotion through Field Marshal, then 1 per 200 XP past Field Marshal — so specialize
          rather than trying to complete every path.
        </div>
        {/* category nav */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {cats.map(([ck, c]) => {
            const active = ck === catKey;
            const owned = c.paths.reduce(
              (a, p) => a + p.nodes.filter((n) => learnedSet.has(n.id)).length,
              0
            );
            const total = c.paths.reduce((a, p) => a + p.nodes.length, 0);
            return (
              <button
                key={ck}
                onClick={() => {
                  setCatKey(ck);
                  onSelectTrait(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  border: `1px solid ${active ? c.color : MIL_COLOR.border}`,
                  background: active ? `${c.color}18` : MIL_COLOR.inset,
                  color: active ? "#fff" : MIL_COLOR.textMuted,
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontFamily: MIL_FONT.sans,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }} />
                {c.name}
                <span style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                  {owned}/{total}
                </span>
              </button>
            );
          })}
        </div>

        {/* path tracks — ONE scroll container for the whole tree, not one per path,
            so the decade columns stay aligned across paths (matching the Doctrine
            matrix in the SecDef office, which is the same tree in cabinet styling). */}
        <div style={{ overflowX: "auto", paddingBottom: 2 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "max-content" }}>
            {cat.paths.map((path) => (
              <div key={path.id}>
                <div
                  style={{
                    font: `600 9px ${mono}`,
                    letterSpacing: ".1em",
                    color: path.color,
                    marginBottom: 6,
                    // Pinned so the path stays identifiable once scrolled right.
                    position: "sticky",
                    left: 0,
                    width: "fit-content",
                  }}
                >
                  {path.name.toUpperCase()}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {path.nodes.map((node) => {
                    const st = nodeStatus(learned, path, node, curEra);
                    const boosted = isNatActiveInDoctrine(adopted, node.boost);
                    const selected = selTraitId === node.id;
                    return (
                      <button
                        key={node.id}
                        onClick={() => onSelectTrait(node.id)}
                        title={`${node.name} · ${node.dec}s`}
                        style={{
                          minWidth: 108,
                          flexShrink: 0,
                          textAlign: "left",
                          border: `1px solid ${selected ? MIL_COLOR.gold : boosted ? `${MIL_COLOR.gold}88` : st === "learned" ? path.color : MIL_COLOR.borderSoft}`,
                          background: st === "learned" ? `${path.color}14` : MIL_COLOR.inset,
                          borderRadius: 7,
                          padding: "7px 8px",
                          cursor: "pointer",
                          opacity: st === "future" || st === "locked" ? 0.55 : 1,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 4,
                          }}
                        >
                          <span style={{ font: `500 8px ${mono}`, color: MIL_COLOR.textFaint }}>
                            {node.dec}s
                          </span>
                          <span style={{ font: `700 7.5px ${mono}`, color: STATUS_DOT[st] }}>
                            {boosted ? "★ " : ""}
                            {STATUS_BADGE[st]}
                          </span>
                        </div>
                        <div
                          style={{
                            fontFamily: MIL_FONT.sans,
                            fontSize: 11,
                            fontWeight: 600,
                            color: st === "learned" ? "#fff" : MIL_COLOR.text,
                            lineHeight: 1.2,
                            marginTop: 3,
                          }}
                        >
                          {node.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* detail */}
      <div style={{ flex: "1 1 280px", minWidth: 260 }}>
        {sel ? (
          <TraitDetail
            general={general}
            adopted={adopted}
            nodeId={sel.node.id}
            curEra={curEra}
            editable={editable}
            onTrain={onTrain}
          />
        ) : (
          <div
            style={{
              border: `1px solid ${MIL_COLOR.border}`,
              borderRadius: 12,
              background: MIL_COLOR.inset,
              padding: 15,
              font: `500 12px ${mono}`,
              color: MIL_COLOR.textFaint,
            }}
          >
            Select a trait to review its effect and train it.
          </div>
        )}
      </div>
    </div>
  );
}

function TraitDetail({
  general,
  adopted,
  nodeId,
  curEra,
  editable,
  onTrain,
}: {
  general: ProfileGeneral;
  adopted: Record<string, number>;
  nodeId: string;
  curEra: number;
  editable: boolean;
  onTrain: (id: string) => void;
}) {
  const f = findTreeNode(nodeId);
  if (!f) return null;
  const learned = learnedOf(general);
  const st = nodeStatus(learned, f.path, f.node, curEra);
  const boosted = isNatActiveInDoctrine(adopted, f.node.boost);
  // Gate on the node's COST rather than on 1. Every node currently costs a single
  // point, but reading the field keeps the button honest if that ever changes.
  const pts = general.pts || 0;
  const affordable = pts >= f.node.cost;
  const canTrain = st === "available" && affordable && editable;
  const blockedBy = missingTraitPrerequisite(learned, f.path, f.node);

  return (
    <div
      style={{
        border: `1px solid ${f.cat.color}55`,
        borderRadius: 12,
        background: MIL_COLOR.inset,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: 14,
          borderBottom: `1px solid ${MIL_COLOR.borderSoft}`,
          background: `linear-gradient(180deg,${f.cat.color}18,transparent)`,
        }}
      >
        <div style={{ font: `600 9px ${mono}`, letterSpacing: ".1em", color: f.cat.color }}>
          {f.cat.name} · {f.path.name}
        </div>
        <div
          style={{
            fontFamily: MIL_FONT.serif,
            fontSize: 17,
            fontWeight: 700,
            color: MIL_COLOR.textStrong,
            marginTop: 4,
          }}
        >
          {f.node.name}
        </div>
        <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 3 }}>
          {f.node.dec}s · cost {f.node.cost} pt{f.node.cost === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: MIL_COLOR.text }}>{f.node.eff}.</div>
        {boosted && (
          <div style={{ font: `600 10px ${mono}`, color: MIL_COLOR.gold }}>
            ★ Boosted by national doctrine: {f.node.boost}
          </div>
        )}
        {f.node.req && (
          <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.amber }}>
            Requires: {f.node.req}
          </div>
        )}
        {f.node.conflict && (
          <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.red }}>
            Conflicts with {f.node.conflict}
          </div>
        )}

        {st === "learned" ? (
          <div
            style={{
              border: `1px solid ${MIL_COLOR.gold}44`,
              background: `${MIL_COLOR.gold}12`,
              borderRadius: 8,
              padding: "8px",
              textAlign: "center",
              font: `600 12px ${MIL_FONT.sans}`,
              color: MIL_COLOR.gold,
            }}
          >
            ✓ Trait learned
          </div>
        ) : (
          <button
            onClick={() => onTrain(nodeId)}
            disabled={!canTrain}
            style={{
              width: "100%",
              fontFamily: MIL_FONT.sans,
              fontWeight: 700,
              fontSize: 12,
              color: canTrain ? "#171207" : MIL_COLOR.textFaint,
              background: canTrain ? MIL_COLOR.gold : MIL_COLOR.panel,
              border: `1px solid ${canTrain ? MIL_COLOR.gold : MIL_COLOR.border}`,
              borderRadius: 8,
              padding: "9px",
              cursor: canTrain ? "pointer" : "not-allowed",
            }}
          >
            {st === "future"
              ? `Requires ${f.node.dec}s era`
              : st === "locked"
                ? // Name the blocker: "Earlier trait required" left the player
                  // hunting the chain for which one it meant.
                  (blockedBy ?? "Earlier trait required")
                : !affordable
                  ? // Distinguish "none at all" from "not enough": with every node at
                    // one point these are the same state, but the gate above reads
                    // `cost`, so the label has to as well or it would tell a general
                    // holding points that they have none.
                    pts === 0
                    ? "No skill points"
                    : `Need ${f.node.cost} points · you have ${pts}`
                  : `Train · ${f.node.cost} pt${f.node.cost === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
