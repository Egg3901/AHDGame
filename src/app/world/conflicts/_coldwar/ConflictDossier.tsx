import type { SideTheme } from "./sideTheme";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

export type DossierSide = {
  faction: string;
  flags: string;
  cp: string;
  ctrl: string;
  supplyPct: string;
  eff: string;
  supNote: string;
};

export type Dossier = {
  file: string;
  name: string;
  theater: string;
  started: string;
  sev: string;
  sevColor: string;
  sevBg: string;
  player: DossierSide & { cpNum: number };
  opponent: DossierSide;
  outLabel: string;
  outColor: string;
  outBg: string;
  outBorder: string;
  sliderMax: number;
  onSlide: (v: number) => void;
  inc: () => void;
  dec: () => void;
  reserve: string;
  reserveColor: string;
  projText: string;
  projColor: string;
  escalate: boolean;
  escalateText: string;
  commit: () => void;
  commitLabel: string;
  withdraw: () => void;
  commitColor: string;
  commitBg: string;
  commitBorder: string;
  reinforce: () => void;
  reinforceLabel: string;
  reinforceColor: string;
  reinforceBg: string;
  reinforceBorder: string;
  msg: string | null;
  effects: { text: string; color: string; bg: string; border: string }[];
};

/** Right pane — the selected conflict dossier (player vs opponent, themed by side). */
export function ConflictDossier({ detail: d, theme: t }: { detail: Dossier; theme: SideTheme }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 320,
        border: `1px solid ${t.panelBorder}`,
        background: t.panelBg,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* dossier header */}
      <div
        style={{
          position: "relative",
          padding: "16px 20px",
          background: t.dossierStripe,
          borderBottom: `1px solid ${t.dossierStripeBorder}`,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".16em", color: t.dossierLabelColor }}
        >
          CONFLICT DOSSIER · {d.file}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 5,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: serif,
              fontWeight: 700,
              fontSize: 24,
              color: "#f3f1ea",
            }}
          >
            {d.name}
          </h2>
          <div style={{ display: "flex", gap: 6 }}>
            <span
              style={{
                font: `600 8.5px ${mono}`,
                padding: "3px 8px",
                borderRadius: 5,
                background: d.sevBg,
                color: d.sevColor,
              }}
            >
              {d.sev}
            </span>
            <span
              style={{
                font: `600 8.5px ${mono}`,
                padding: "3px 8px",
                borderRadius: 5,
                background: t.theaterBadgeBg,
                border: `1px solid ${t.theaterBadgeBorder}`,
                color: "#8a8a9a",
              }}
            >
              {d.theater} · {d.started}
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "18px 20px 22px" }}>
        {/* belligerents — player left, opponent right */}
        <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
          <div
            style={{
              flex: 1,
              minWidth: 180,
              border: `1px solid ${t.player.border}`,
              background: t.player.bg,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                font: `600 9px ${mono}`,
                letterSpacing: ".14em",
                color: t.player.text,
                marginBottom: 6,
              }}
            >
              {t.player.label}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17 }}>{d.player.flags}</span>
              <span style={{ font: "600 14px system-ui", color: "#f3f1ea" }}>
                {d.player.faction}
              </span>
            </div>
            <div style={{ font: `700 18px ${mono}`, color: t.player.cp, marginTop: 8 }}>
              {d.player.cp} <span style={{ fontSize: 9, color: "#6b6b7a" }}>CP</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
            }}
          >
            <span
              style={{ fontFamily: serif, fontStyle: "italic", fontSize: 16, color: "#6b6b7a" }}
            >
              vs
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 180,
              border: `1px solid ${t.opponent.border}`,
              background: t.opponent.bg,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                font: `600 9px ${mono}`,
                letterSpacing: ".14em",
                color: t.opponent.text,
                marginBottom: 6,
                textAlign: "right",
              }}
            >
              {t.opponent.label}
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}
            >
              <span style={{ font: "600 14px system-ui", color: "#f3f1ea" }}>
                {d.opponent.faction}
              </span>
              <span style={{ fontSize: 17 }}>{d.opponent.flags}</span>
            </div>
            <div
              style={{
                font: `700 18px ${mono}`,
                color: t.opponent.cp,
                marginTop: 8,
                textAlign: "right",
              }}
            >
              {d.opponent.cp} <span style={{ fontSize: 9, color: "#6b6b7a" }}>CP</span>
            </div>
          </div>
        </div>

        {/* front line */}
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              font: `600 9px ${mono}`,
              marginBottom: 7,
            }}
          >
            <span style={{ color: t.player.text }}>
              ◂ {t.player.short} CONTROL {d.player.ctrl}
            </span>
            <span style={{ color: "#6b6b7a" }}>FRONT LINE</span>
            <span style={{ color: t.opponent.text }}>
              {d.opponent.ctrl} {t.opponent.short} CONTROL ▸
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 20,
              borderRadius: 10,
              overflow: "hidden",
              background: "#0a0a12",
              border: `1px solid ${t.frontTrackBorder}`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                background: t.player.gradient,
                width: d.player.ctrl,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                background: t.opponent.gradient,
                width: d.opponent.ctrl,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -3,
                bottom: -3,
                width: 3,
                background: "#f3f1ea",
                boxShadow: "0 0 6px rgba(0,0,0,.8)",
                left: d.player.ctrl,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
            <span
              style={{
                font: `600 11px ${mono}`,
                padding: "5px 13px",
                borderRadius: 7,
                background: d.outBg,
                border: `1px solid ${d.outBorder}`,
                color: d.outColor,
              }}
            >
              ▸ {d.outLabel}
            </span>
          </div>
        </div>

        {/* supply lines */}
        <div
          style={{
            marginTop: 16,
            border: `1px solid ${t.innerBorder}`,
            background: t.innerBg,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <span style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: "#6b6b7a" }}>
              ⛓ SUPPLY LINES · THEATER MODIFIER
            </span>
            <span style={{ font: `500 8.5px ${mono}`, color: "#6b6b7a" }}>
              scales committed CP → effective combat power
            </span>
          </div>
          <SupplyRow
            label={t.player.short}
            labelColor={t.player.text}
            barColor={t.player.bar}
            trackBorder={t.barTrack}
            pct={d.player.supplyPct}
            eff={d.player.eff}
            effColor={t.player.cp}
          />
          <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", margin: "0 0 11px 52px" }}>
            {d.player.supNote}
          </div>
          <SupplyRow
            label={t.opponent.short}
            labelColor={t.opponent.text}
            barColor={t.opponent.bar}
            trackBorder={t.barTrack}
            pct={d.opponent.supplyPct}
            eff={d.opponent.eff}
            effColor={t.opponent.cp}
          />
          <div style={{ font: `500 9px ${mono}`, color: "#7a7a8c", margin: "0 0 12px 52px" }}>
            {d.opponent.supNote}
          </div>
          <button
            onClick={d.reinforce}
            style={{
              font: `600 9.5px ${mono}`,
              padding: "7px 14px",
              borderRadius: 7,
              cursor: "pointer",
              color: d.reinforceColor,
              background: d.reinforceBg,
              border: `1px solid ${d.reinforceBorder}`,
            }}
          >
            {d.reinforceLabel}
          </button>
        </div>

        {/* deployment control */}
        <div
          style={{
            marginTop: 18,
            border: `1px solid ${t.deployBorder}`,
            background: t.deployBg,
            borderRadius: 12,
            padding: "15px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 13,
            }}
          >
            <span
              style={{ font: `700 11px ${mono}`, letterSpacing: ".13em", color: t.player.text }}
            >
              ⊕ COMMIT COMBAT POWER
            </span>
            <span style={{ font: `600 9.5px ${mono}`, color: "#cfcfda" }}>
              backing {d.player.flags} {d.player.faction}
            </span>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ minWidth: 140 }}>
              <div
                style={{
                  fontFamily: serif,
                  fontWeight: 700,
                  fontSize: 26,
                  color: "#f3f1ea",
                  lineHeight: 1,
                }}
              >
                {d.player.cp} <span style={{ fontSize: 13, color: "#8a8a9a" }}>CP</span>
              </div>
              <div style={{ font: `600 9px ${mono}`, color: t.player.text, marginTop: 3 }}>
                committed to this theater
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={d.dec}
                  style={{ ...stepBtn, border: `1px solid ${t.stepBorder}`, background: t.stepBg }}
                >
                  −
                </button>
                <input
                  type="range"
                  min={0}
                  max={d.sliderMax}
                  step={100}
                  value={d.player.cpNum}
                  onChange={(e) => d.onSlide(+e.target.value)}
                  style={{ flex: 1, accentColor: t.player.bar, cursor: "pointer", height: 6 }}
                />
                <button
                  onClick={d.inc}
                  style={{ ...stepBtn, border: `1px solid ${t.stepBorder}`, background: t.stepBg }}
                >
                  +
                </button>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  font: `500 9px ${mono}`,
                  color: "#7a7a8c",
                  marginTop: 7,
                }}
              >
                <span>0</span>
                <span style={{ color: d.reserveColor }}>reserve {d.reserve} CP</span>
                <span>{d.sliderMax}</span>
              </div>
            </div>
          </div>
          <div
            style={{
              font: `500 10px ${mono}`,
              color: d.projColor,
              marginTop: 12,
              lineHeight: 1.45,
            }}
          >
            ▸ {d.projText}
          </div>
          {d.escalate && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 11px",
                borderRadius: 8,
                background: "rgba(255,120,73,.08)",
                border: "1px solid #44260f",
                font: `600 9.5px ${mono}`,
                color: "#ff7849",
                lineHeight: 1.4,
              }}
            >
              ⚠ {d.escalateText}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={d.commit}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 8,
                cursor: "pointer",
                font: `600 11px ${mono}`,
                color: d.commitColor,
                background: d.commitBg,
                border: `1px solid ${d.commitBorder}`,
              }}
            >
              {d.commitLabel}
            </button>
            <button
              onClick={d.withdraw}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                cursor: "pointer",
                font: `600 11px ${mono}`,
                color: "#8a8a9a",
                background: t.withdrawBg,
                border: `1px solid ${t.withdrawBorder}`,
              }}
            >
              WITHDRAW
            </button>
          </div>
          {d.msg && (
            <div
              style={{
                marginTop: 11,
                padding: "9px 12px",
                borderRadius: 8,
                background: "rgba(134,217,120,.08)",
                border: "1px solid rgba(134,217,120,.3)",
                font: `600 10px ${mono}`,
                color: "#86d978",
              }}
            >
              ✔ {d.msg}
            </div>
          )}
        </div>

        {/* effects */}
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".14em",
              color: "#6b6b7a",
              marginBottom: 9,
            }}
          >
            PROJECTED EFFECTS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {d.effects.map((e, i) => (
              <span
                key={i}
                style={{
                  font: `500 9.5px ${mono}`,
                  padding: "3px 10px",
                  borderRadius: 99,
                  border: `1px solid ${e.border}`,
                  background: e.bg,
                  color: e.color,
                }}
              >
                {e.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const stepBtn = {
  width: 30,
  height: 30,
  borderRadius: 7,
  color: "#e8e8ee",
  font: "600 16px system-ui",
  cursor: "pointer",
  flexShrink: 0,
} as const;

function SupplyRow({
  label,
  labelColor,
  barColor,
  trackBorder,
  pct,
  eff,
  effColor,
}: {
  label: string;
  labelColor: string;
  barColor: string;
  trackBorder: string;
  pct: string;
  eff: string;
  effColor: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
      <span style={{ width: 42, font: `600 9px ${mono}`, color: labelColor }}>{label}</span>
      <div
        style={{
          flex: 1,
          position: "relative",
          height: 9,
          borderRadius: 5,
          background: "#0a0a12",
          border: `1px solid ${trackBorder}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            background: barColor,
            width: pct,
          }}
        />
      </div>
      <span style={{ width: 36, textAlign: "right", font: `600 10px ${mono}`, color: "#cfcfda" }}>
        {pct}
      </span>
      <span style={{ width: 118, textAlign: "right", font: `600 10px ${mono}`, color: effColor }}>
        {eff} eff CP
      </span>
    </div>
  );
}
