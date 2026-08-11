import { BLOC, nationActions, type BlocId, type BlocSide, type Nation } from "./blocs";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

function benefitsFor(bloc: BlocId): { k: string; v: string }[] {
  if (bloc === "west")
    return [
      { k: "⚔ MIL", v: "NATO arms, basing, nuclear umbrella" },
      { k: "⚖ POL", v: "UN voting bloc, recognition" },
      { k: "$ ECON", v: "IMF loans, EEC trade, tech" },
    ];
  if (bloc === "east")
    return [
      { k: "⚔ MIL", v: "Soviet arms at cost, advisors" },
      { k: "⚖ POL", v: "UNSC veto cover, backing" },
      { k: "$ ECON", v: "Comecon trade, cheap energy" },
    ];
  return [
    { k: "⚔ MIL", v: "Both blocs court with arms deals" },
    { k: "⚖ POL", v: "Swing vote — leverage at the UN" },
    { k: "$ ECON", v: "Aid from East and West both" },
  ];
}

/**
 * The selected-nation detail overlay shown on the Bloc Overview alignment map —
 * alignment bar, bloc benefits, and the petition/influence/withdraw actions
 * (acknowledgement-only in Phase 1). Rendered as an absolute child of the map.
 */
export function NationDetailPanel({
  detail,
  side,
  msg,
  onClose,
  onAction,
}: {
  detail: Nation;
  side: BlocSide;
  msg: string | null;
  onClose: () => void;
  onAction: (kind: string, nation: string) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 14,
        bottom: 14,
        width: 330,
        zIndex: 7,
        background: "rgba(20,20,28,.97)",
        backdropFilter: "blur(8px)",
        border: "1px solid #34344a",
        borderRadius: 12,
        boxShadow: "0 14px 40px rgba(0,0,0,.7)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 15px 10px" }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>{detail.flag}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: serif,
              fontWeight: 700,
              fontSize: 18,
              color: "#f3f1ea",
              lineHeight: 1.05,
            }}
          >
            {detail.name}
          </div>
          <div style={{ font: `500 9.5px ${mono}`, color: "#8a8a9a", marginTop: 2 }}>
            {detail.status}
          </div>
        </div>
        <span
          style={{
            font: `600 9px ${mono}`,
            padding: "3px 9px",
            borderRadius: 6,
            color: BLOC[detail.bloc].color,
            background: BLOC[detail.bloc].bg,
            border: `1px solid ${BLOC[detail.bloc].border}`,
          }}
        >
          {BLOC[detail.bloc].label}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: 2,
            width: 22,
            height: 22,
            borderRadius: 6,
            border: "1px solid #2a2a3d",
            background: "#1d1d2a",
            color: "#8a8a9a",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: "0 15px 6px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: `600 8.5px ${mono}`,
            color: "#6b6b7a",
            marginBottom: 5,
          }}
        >
          <span style={{ color: "#7ba3ec" }}>◂ WEST</span>
          <span>
            ALIGNMENT{" "}
            {detail.lean < 50
              ? "W" + (50 - detail.lean)
              : detail.lean > 50
                ? "E" + (detail.lean - 50)
                : "0"}
          </span>
          <span style={{ color: "#ef8a8a" }}>EAST ▸</span>
        </div>
        <div
          style={{
            position: "relative",
            height: 14,
            borderRadius: 7,
            background: "linear-gradient(90deg,#1d4ed8,#23232f 44% 56%,#dc2626)",
            border: "1px solid #2a2a3d",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -2,
              bottom: -2,
              width: 3,
              background: "#f3f1ea",
              boxShadow: "0 0 6px rgba(0,0,0,.7)",
              left: `${detail.lean}%`,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: `500 9px ${mono}`,
            color: "#7a7a8c",
            marginTop: 5,
          }}
        >
          <span>trend {detail.trend}</span>
          <span style={{ color: "#d9bd6b" }}>
            {detail.bloc === "swing"
              ? "defection at ±60"
              : detail.bloc === "west"
                ? "NATO member"
                : detail.bloc === "east"
                  ? "Warsaw Pact"
                  : "uncommitted"}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "8px 15px 12px" }}>
        {benefitsFor(detail.bloc).map((b) => (
          <div
            key={b.k}
            style={{
              flex: 1,
              border: "1px solid #2a2a3d",
              background: "#16161f",
              borderRadius: 8,
              padding: "7px 8px",
            }}
          >
            <div style={{ font: `700 8px ${mono}`, color: "#8a8a9a", letterSpacing: ".05em" }}>
              {b.k}
            </div>
            <div
              style={{
                font: "500 10px system-ui",
                color: "#cfcfda",
                lineHeight: 1.25,
                marginTop: 3,
              }}
            >
              {b.v}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 7, padding: "0 15px 14px", flexWrap: "wrap" }}>
        {nationActions(side, detail).map((a) => (
          <button
            key={a.label}
            onClick={() => onAction(a.kind, detail.name)}
            style={{
              flex: 1,
              minWidth: 120,
              padding: "9px 0",
              borderRadius: 8,
              cursor: "pointer",
              font: `600 10.5px ${mono}`,
              color: a.color,
              background: a.bg,
              border: `1px solid ${a.border}`,
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {msg && (
        <div
          style={{
            margin: "0 15px 14px",
            padding: "9px 11px",
            borderRadius: 8,
            background: "rgba(134,217,120,.08)",
            border: "1px solid rgba(134,217,120,.3)",
            font: `500 10px ${mono}`,
            color: "#86d978",
            lineHeight: 1.4,
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
