/**
 * The amber "classification" header bar shared across situation-room pages
 * (e.g. "◆ EYES ONLY · GLOBAL SITUATION BOARD" / "TURN 1 · WK 01 JAN 1979").
 */
export function ClassificationStrip({
  left,
  right,
  leftColor = "#a9863a",
  rightColor = "#6f6a52",
  bg = "repeating-linear-gradient(45deg,#1a1610,#1a1610 10px,#16130d 10px,#16130d 20px)",
  border = "#2a2416",
}: {
  left: string;
  right: string;
  leftColor?: string;
  rightColor?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 20px",
        background: bg,
        borderBottom: `1px solid ${border}`,
      }}
    >
      <span
        style={{
          font: "600 10px 'IBM Plex Mono',monospace",
          letterSpacing: ".2em",
          color: leftColor,
        }}
      >
        {left}
      </span>
      <span
        style={{
          font: "500 10px 'IBM Plex Mono',monospace",
          letterSpacing: ".15em",
          color: rightColor,
        }}
      >
        {right}
      </span>
    </div>
  );
}
