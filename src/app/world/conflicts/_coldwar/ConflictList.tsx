import type { SideTheme } from "./sideTheme";

const mono = "'IBM Plex Mono',monospace";

export type ConflictListItem = {
  id: string;
  name: string;
  theater: string;
  sev: string;
  sevColor: string;
  sevBg: string;
  /** Flags for the side the viewer commands. */
  playerFlags: string;
  opponentFlags: string;
  /** Player front-line control %, e.g. "84%". */
  controlPct: string;
  opponentPct: string;
  outLabel: string;
  outColor: string;
  selected: boolean;
  onClick: () => void;
};

/** Left rail — the active proxy theaters, each with its front-line bar + outcome. */
export function ConflictList({
  count,
  items,
  theme,
}: {
  count: number;
  items: ConflictListItem[];
  theme: SideTheme;
}) {
  return (
    <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          font: `600 10px ${mono}`,
          letterSpacing: ".14em",
          color: theme.listHeaderColor,
          padding: "0 2px",
        }}
      >
        ACTIVE THEATERS · {count}
      </div>
      {items.map((c) => (
        <div
          key={c.id}
          onClick={c.onClick}
          style={{
            cursor: "pointer",
            border: `1px solid ${c.selected ? theme.listSelBorder : theme.listBorder}`,
            background: c.selected ? theme.listSelBg : theme.listBg,
            borderRadius: 11,
            padding: "13px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span style={{ font: "600 13px system-ui", color: "#f3f1ea" }}>{c.name}</span>
            <span
              style={{
                font: `600 8px ${mono}`,
                padding: "2px 7px",
                borderRadius: 4,
                background: c.sevBg,
                color: c.sevColor,
                whiteSpace: "nowrap",
              }}
            >
              {c.sev}
            </span>
          </div>
          <div style={{ font: `500 9px ${mono}`, color: theme.listTheaterColor, marginTop: 3 }}>
            {c.theater}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 13 }}>{c.playerFlags}</span>
            <div
              style={{
                flex: 1,
                position: "relative",
                height: 7,
                borderRadius: 4,
                overflow: "hidden",
                background: "#0a0a12",
                border: `1px solid ${theme.listTrackBorder}`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  background: theme.player.bar,
                  width: c.controlPct,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  background: theme.opponent.bar,
                  width: c.opponentPct,
                }}
              />
            </div>
            <span style={{ fontSize: 13 }}>{c.opponentFlags}</span>
          </div>
          <div style={{ font: `600 8.5px ${mono}`, color: c.outColor, marginTop: 6 }}>
            {c.outLabel}
          </div>
        </div>
      ))}
    </div>
  );
}
