"use client";

import { MIL_COLOR, MIL_FONT } from "../military/theme";
import {
  rank,
  rankProgress,
  WIN_BONUS_XP,
  LOSS_BONUS_XP,
  POINTS_PER_PROMOTION,
  POST_FM_POINT_CAP,
  POST_FM_XP_PER_POINT,
  TENURE_POINT_TURNS,
  TENURE_POINT_CAP,
} from "@/lib/military/generals";
import {
  STAT_META,
  specProfile,
  learnedOf,
  treeMods,
  findTreeNode,
  isNatActiveInDoctrine,
  type ProfileGeneral,
} from "@/lib/military/generalsTree";
import { THEATER_COMMAND } from "@/lib/military/config";
import { deriveSpec, specLabelOf, SPEC_META } from "@/lib/military/deriveSpec";
import { useCharacterGeneral, type CharacterSubject } from "./useCharacterGeneral";
import { EMPTY_POSTING, type GeneralPosting } from "@/lib/military/generalPosting";
import { TraitTree } from "./components/TraitTree";

const mono = MIL_FONT.mono;
const serif = MIL_FONT.serif;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "traits", label: "Command Doctrine" },
  { id: "assignment", label: "Assignment" },
  { id: "docfit", label: "Doctrine Fit" },
  { id: "politics", label: "Politics" },
  { id: "history", label: "History" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
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
        {title}
      </div>
      {children}
    </div>
  );
}

function shellStyle(): React.CSSProperties {
  return {
    padding: 20,
    fontFamily: MIL_FONT.sans,
    color: MIL_COLOR.text,
    background: "radial-gradient(120% 80% at 50% 0%,#16131a,#0b0b11 60%)",
    borderRadius: 12,
  };
}

function chopFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "GN";
}

export function GeneralProfileClient({
  subject,
  adopted,
  general,
  editable,
  curEra,
  posting = EMPTY_POSTING,
  isCommandingGeneral = false,
}: {
  subject: CharacterSubject;
  adopted: Record<string, number>;
  /** The commissioned general's profile, or null when the character is not a general
   *  (never commissioned, or dismissed — a dismissed veteran's retained record is not
   *  shown as active). */
  general: ProfileGeneral | null;
  editable: boolean;
  curEra: number;
  /** The general's LIVE assignment — real units, command and conflict posting. */
  posting?: GeneralPosting;
  /** True when this character leads a command (holds `commandingGeneralId`) — gates the
   *  "Manage your command" link on the owner's own profile. */
  isCommandingGeneral?: boolean;
}) {
  const { state, dispatch } = useCharacterGeneral(subject, adopted, general);
  const g = state.general;

  // No profile means not a general — commissioning creates the profile, and only the
  // Secretary of Defense can commission, so there is nothing to offer here.
  if (!g) {
    return (
      <div style={shellStyle()}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            background: MIL_COLOR.panel,
            border: `1px solid ${MIL_COLOR.border}`,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              borderBottom: `1px solid ${MIL_COLOR.borderSoft}`,
            }}
          >
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: 10,
                background: `${MIL_COLOR.gold}18`,
                border: `1px solid ${MIL_COLOR.gold}55`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: serif,
                fontSize: 18,
                fontWeight: 700,
                color: MIL_COLOR.gold,
              }}
            >
              {subject.chop ?? chopFor(subject.name)}
            </div>
            <div>
              <div
                style={{
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 22,
                  color: MIL_COLOR.textStrong,
                  lineHeight: 1,
                }}
              >
                {subject.name}
              </div>
              <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 4 }}>
                Field Commander · uncommissioned
              </div>
            </div>
          </div>
          <div style={{ padding: "16px 20px 22px" }}>
            <div style={{ font: `500 12px ${MIL_FONT.mono}`, color: MIL_COLOR.textFaint }}>
              {editable
                ? "You have not been commissioned as a general. The Secretary of Defense commissions generals."
                : `${subject.name} has not been commissioned as a general.`}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const learned = learnedOf(g);
  // Specialisation is not stored — it is the best fit for what this general has
  // trained, and it drifts as they train more. `fit` is the mockup's "Doctrine Fit".
  const derived = deriveSpec(learned);
  const { spec: specId, fit } = derived;
  const prof = specProfile(specId);
  const spec = SPEC_META[specId];
  // unspecialised until they have actually trained into a discipline.
  const specLabel = specLabelOf(derived);
  const fitPct = Math.round(fit * 100);
  const mods = treeMods(learned);
  const prog = rankProgress(g.level, g.xp ?? 0);

  const impact: string[] = [];
  if (mods.cv > 1) impact.push(`+${Math.round((mods.cv - 1) * 100)}% combat value`);
  for (const k in mods.cvTrait) impact.push(`+${Math.round((mods.cvTrait[k] - 1) * 100)}% ${k}`);
  if (mods.cas < 1) impact.push(`−${Math.round((1 - mods.cas) * 100)}% casualties`);
  if (mods.enemy < 1) impact.push(`−${Math.round((1 - mods.enemy) * 100)}% enemy strength`);
  if (mods.supply) impact.push(`+${mods.supply} supply`);
  if (mods.upkeep < 1) impact.push(`−${Math.round((1 - mods.upkeep) * 100)}% upkeep`);
  if (mods.ready) impact.push(`+${mods.ready} readiness/turn`);

  const boostNodes = learned.map((id) => findTreeNode(id)?.node).filter((n) => n && n.boost) as {
    name: string;
    boost: string | null;
  }[];
  const boostActive = boostNodes.filter((n) => isNatActiveInDoctrine(adopted, n.boost));
  const boostMissing = boostNodes.filter((n) => !isNatActiveInDoctrine(adopted, n.boost));

  return (
    <div style={shellStyle()}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: MIL_COLOR.panel,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* hero */}
        <div
          style={{
            padding: "16px 20px",
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${MIL_COLOR.borderSoft}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: 10,
                background: `${spec.accent}22`,
                border: `1px solid ${spec.accent}66`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: serif,
                fontSize: 18,
                fontWeight: 700,
                color: spec.accent,
              }}
            >
              {g.chop}
            </div>
            <div>
              <div
                style={{
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 22,
                  color: MIL_COLOR.textStrong,
                  lineHeight: 1,
                }}
              >
                {g.name}
              </div>
              <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 4 }}>
                {rank(g.level)} · {specLabel} · {fitPct}% fit · {prof.reputation}
              </div>
              {editable && isCommandingGeneral && subject.countryCode && (
                <a
                  href={`/country/${subject.countryCode}/general/commands`}
                  style={{
                    display: "inline-block",
                    marginTop: 8,
                    font: `600 11px ${mono}`,
                    color: MIL_COLOR.gold,
                    textDecoration: "none",
                  }}
                >
                  Manage your command →
                </a>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { l: "Rank", v: rank(g.level), c: MIL_COLOR.text },
              { l: "Branch", v: prof.branch, c: MIL_COLOR.text },
              { l: "Level", v: `Lv ${g.level}`, c: MIL_COLOR.gold },
              {
                l: "Skill pts",
                v: String(g.pts ?? 0),
                c: (g.pts ?? 0) > 0 ? MIL_COLOR.green : MIL_COLOR.textFaint,
              },
            ].map((s) => (
              <div
                key={s.l}
                style={{
                  border: `1px solid ${MIL_COLOR.border}`,
                  background: MIL_COLOR.inset,
                  borderRadius: 9,
                  padding: "7px 12px",
                  minWidth: 70,
                }}
              >
                <div
                  style={{
                    font: `500 8px ${mono}`,
                    letterSpacing: ".1em",
                    color: MIL_COLOR.textFaint,
                  }}
                >
                  {s.l.toUpperCase()}
                </div>
                <div
                  style={{
                    fontFamily: serif,
                    fontSize: 15,
                    fontWeight: 700,
                    marginTop: 2,
                    color: s.c,
                  }}
                >
                  {s.v}
                </div>
              </div>
            ))}
          </div>

          {/* Promotion is otherwise invisible: the strip above shows a rank and a
              level with no way to see how close the next one is, or what moves it.
              Both come straight from the engine — GENLVLXP thresholds and the
              battle-resolution XP award — so nothing here is illustrative. */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                font: `500 10px ${mono}`,
                color: MIL_COLOR.textFaint,
                marginBottom: 5,
              }}
            >
              <span>
                {prog.nextRank ? `PROMOTION · NEXT: ${prog.nextRank.toUpperCase()}` : "PROMOTION"}
              </span>
              <span>
                {prog.nextRank
                  ? `${prog.xpIntoRank} / ${prog.xpForRank} XP`
                  : "Highest rank attained"}
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                overflow: "hidden",
                background: MIL_COLOR.inset,
                border: `1px solid ${MIL_COLOR.border}`,
              }}
              role="progressbar"
              aria-valuenow={Math.round(prog.pct * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress to next rank"
            >
              <div
                style={{
                  width: `${Math.round(prog.pct * 100)}%`,
                  height: "100%",
                  background: MIL_COLOR.gold,
                }}
              />
            </div>
            <div
              style={{
                marginTop: 6,
                font: `500 11px ${mono}`,
                color: MIL_COLOR.textMuted,
                lineHeight: 1.5,
              }}
            >
              {prog.nextRank ? (
                <>
                  Generals earn experience by <strong>fighting battles</strong>. A general is
                  credited for the units they personally led at a front, plus {WIN_BONUS_XP} XP for
                  a victory or {LOSS_BONUS_XP} for a defeat. A <strong>Theater Commander</strong>{" "}
                  also earns {Math.round(THEATER_COMMAND.xpShare * 100)}% of a formation&rsquo;s
                  award for every battle fought in their theater, whether or not they led any units
                  in it. Each promotion grants {POINTS_PER_PROMOTION} skill points to spend in
                  Command Doctrine. A commissioned general also earns a point for every{" "}
                  {TENURE_POINT_TURNS} turns of service in peacetime, up to {TENURE_POINT_CAP} over
                  a career — after that only campaigning develops them further. Every doctrine node
                  costs one point, and no career yields enough to fill the tree: a general has to
                  specialise.
                </>
              ) : (
                <>
                  Field Marshal is the highest rank, but campaigning still develops this general —
                  every {POST_FM_XP_PER_POINT} XP earned past the ceiling grants another skill
                  point, up to {POST_FM_POINT_CAP} of them. Further battles also build the veterancy
                  of the units under their command.
                </>
              )}
            </div>
          </div>
        </div>

        {/* tab nav */}
        <div
          style={{
            display: "flex",
            gap: 2,
            flexWrap: "wrap",
            padding: "6px 20px 0",
            borderBottom: `1px solid ${MIL_COLOR.borderSoft}`,
          }}
        >
          {TABS.map((t) => {
            const active = state.tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => dispatch({ type: "SET_TAB", tab: t.id })}
                style={{
                  border: "none",
                  background: "none",
                  borderBottom: `2px solid ${active ? MIL_COLOR.gold : "transparent"}`,
                  color: active ? "#fff" : MIL_COLOR.textMuted,
                  padding: "8px 12px 12px",
                  fontFamily: MIL_FONT.sans,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "16px 20px 22px" }}>
          {state.tab === "overview" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 340px", minWidth: 300 }}>
                <Section title="COMMANDER ATTRIBUTES">
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {STAT_META.map((m) => {
                      const v = prof.stats[m.key];
                      return (
                        <div key={m.key}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 3,
                            }}
                          >
                            <span style={{ fontSize: 11.5, color: MIL_COLOR.textMuted }}>
                              {m.label}
                            </span>
                            <span
                              style={{
                                font: `600 11px ${mono}`,
                                color: v < 50 ? MIL_COLOR.amber : MIL_COLOR.text,
                              }}
                            >
                              {v}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 5,
                              borderRadius: 3,
                              background: MIL_COLOR.borderSoft,
                              overflow: "hidden",
                            }}
                          >
                            <div style={{ height: "100%", width: `${v}%`, background: m.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              </div>
              <div
                style={{
                  flex: "1 1 300px",
                  minWidth: 280,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <Section title="COMBAT IMPACT · LEARNED TRAITS">
                  {impact.length === 0 ? (
                    <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
                      No traits trained yet — visit Command Doctrine to spend skill points.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {impact.map((i) => (
                        <span
                          key={i}
                          style={{
                            font: `600 9px ${mono}`,
                            color: MIL_COLOR.green,
                            border: `1px solid ${MIL_COLOR.green}44`,
                            background: `${MIL_COLOR.green}14`,
                            borderRadius: 5,
                            padding: "2px 7px",
                          }}
                        >
                          {i}
                        </span>
                      ))}
                    </div>
                  )}
                </Section>
                <Section title="PERSONALITY">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {prof.personality.map((p) => (
                      <span
                        key={p}
                        style={{
                          font: `500 10px ${mono}`,
                          color: MIL_COLOR.textMuted,
                          border: `1px solid ${MIL_COLOR.borderSoft}`,
                          borderRadius: 5,
                          padding: "2px 7px",
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </Section>
              </div>
            </div>
          )}

          {state.tab === "traits" && (
            <>
              {state.error && (
                <div
                  role="alert"
                  style={{
                    font: `500 11px ${mono}`,
                    color: MIL_COLOR.red,
                    marginBottom: 8,
                  }}
                >
                  {state.error}
                </div>
              )}
              <TraitTree
                general={g}
                adopted={adopted}
                selTraitId={state.selTraitId}
                curEra={curEra}
                editable={editable}
                onSelectTrait={(id) => dispatch({ type: "SELECT_TRAIT", id })}
                onTrain={(id) => dispatch({ type: "TRAIN", id })}
              />
            </>
          )}

          {state.tab === "assignment" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <Section
                  title={`ORDER OF BATTLE · ${(posting.formationName ?? "Unassigned").toUpperCase()}`}
                >
                  {posting.unitCount === 0 ? (
                    <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
                      No units under this general&rsquo;s command. The Secretary of Defense assigns
                      units to a general from the Military tab of their office.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {posting.forces.map((f) => (
                          <div
                            key={f.name}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              fontSize: 12,
                              color: MIL_COLOR.text,
                            }}
                          >
                            <span>{f.name}</span>
                            <span style={{ font: `600 11px ${mono}`, color: MIL_COLOR.gold }}>
                              ×{f.count}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
                          font: `500 11px ${mono}`,
                          color: MIL_COLOR.textMuted,
                        }}
                      >
                        {posting.unitCount} unit{posting.unitCount === 1 ? "" : "s"} under command
                      </div>
                    </>
                  )}
                </Section>
              </div>
              <div style={{ flex: "1 1 280px", minWidth: 260 }}>
                <Section title="POSTING">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                        Theater
                      </span>
                      <span style={{ font: `600 11px ${mono}`, color: MIL_COLOR.text }}>
                        {posting.theaterName ?? "Held in reserve"}
                      </span>
                    </div>
                    {posting.theaterName && posting.inCharge && (
                      <div style={{ font: `600 10px ${mono}`, color: MIL_COLOR.gold }}>
                        ★ Theater Commander
                      </div>
                    )}
                  </div>
                </Section>
              </div>
              {/* A FIELD CONDITIONS panel used to sit here showing terrain, weather,
                  supply and air support. The game models none of them, so every value
                  was a constant from SPEC_PROFILE dressed as live state. Removed rather
                  than faked; it returns if and when those are actually simulated. */}
            </div>
          )}

          {state.tab === "docfit" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <Section title="DOCTRINE SYNERGY · ACTIVE">
                  {boostActive.length === 0 ? (
                    <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
                      No trait boosts active. Adopt matching national doctrine in the SecDef Office.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {boostActive.map((n) => (
                        <div
                          key={n.name}
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 7,
                            fontSize: 12,
                            color: MIL_COLOR.text,
                          }}
                        >
                          <span style={{ color: MIL_COLOR.gold }}>★</span>
                          <span>
                            {n.name} — boosted by {n.boost}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
              <div style={{ flex: "1 1 300px", minWidth: 280 }}>
                <Section title="MISSING SYNERGY">
                  {boostMissing.length === 0 ? (
                    <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint }}>
                      All learned trait boosts are active.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {boostMissing.map((n) => (
                        <div
                          key={n.name}
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 7,
                            fontSize: 12,
                            color: MIL_COLOR.textMuted,
                          }}
                        >
                          <span style={{ color: MIL_COLOR.amber }}>○</span>
                          <span>
                            {n.name} — adopt {n.boost} to activate
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
            </div>
          )}

          {state.tab === "politics" && (
            <Section title="POLITICAL ASSESSMENT">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { l: "Loyalty", v: g.loyalty ?? "Reliable", c: MIL_COLOR.green },
                  {
                    l: "Political reliability",
                    v: g.political ?? "Neutral",
                    c: g.political === "Ambitious" ? MIL_COLOR.amber : MIL_COLOR.textMuted,
                  },
                  {
                    l: "Political acumen",
                    v: String(prof.stats.political),
                    c: prof.stats.political < 50 ? MIL_COLOR.amber : MIL_COLOR.text,
                  },
                ].map((r) => (
                  <div
                    key={r.l}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      border: `1px solid ${MIL_COLOR.borderSoft}`,
                      borderRadius: 8,
                      padding: "8px 11px",
                    }}
                  >
                    <span style={{ fontSize: 12, color: MIL_COLOR.textMuted }}>{r.l}</span>
                    <span style={{ font: `600 12px ${mono}`, color: r.c }}>{r.v}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {state.tab === "history" && (
            <Section title="SERVICE RECORD">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  {
                    title: `Commissioned · ${prof.branch}`,
                    outcome: "SERVICE",
                    c: MIL_COLOR.textMuted,
                  },
                  {
                    title: `Specialized in ${specLabel.toLowerCase()}`,
                    outcome: "TRAINED",
                    c: MIL_COLOR.green,
                  },
                  { title: `Promoted to ${rank(g.level)}`, outcome: "PROMOTED", c: MIL_COLOR.gold },
                ].map((h) => (
                  <div
                    key={h.title}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      border: `1px solid ${MIL_COLOR.borderSoft}`,
                      borderRadius: 8,
                      padding: "8px 11px",
                    }}
                  >
                    <span style={{ fontSize: 12, color: MIL_COLOR.text }}>{h.title}</span>
                    <span
                      style={{
                        font: `700 9px ${mono}`,
                        color: h.c,
                        border: `1px solid ${h.c}55`,
                        borderRadius: 5,
                        padding: "2px 7px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
