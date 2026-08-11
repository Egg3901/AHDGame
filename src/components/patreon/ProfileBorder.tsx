import type { ProfileBorderKey } from "@/lib/db/types";
import { PATREON_HIGHLIGHT_COLORS } from "@/lib/db/types";

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderAnimatedBorderLayer(
  borderKey: ProfileBorderKey,
  tint: string
): React.ReactNode | null {
  switch (borderKey) {
    case "comet":
    case "pulse":
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-32%] animate-spin [animation-duration:5.5s]"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg, transparent 290deg, ${hexToRgba(tint, 0.12)} 316deg, ${hexToRgba(tint, 0.95)} 344deg, #ffffff 355deg, transparent 360deg)`,
              filter: "blur(8px)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: `0 0 18px ${hexToRgba(tint, 0.35)}, inset 0 0 0 1px ${hexToRgba(tint, 0.3)}`,
            }}
          />
        </>
      );
    case "signal-beacon":
    case "spotlight":
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-18%] animate-spin [animation-duration:7s]"
            style={{
              background: `repeating-conic-gradient(from 0deg, transparent 0deg 26deg, ${hexToRgba(tint, 0.92)} 26deg 34deg, transparent 34deg 78deg, ${hexToRgba(tint, 0.45)} 78deg 84deg, transparent 84deg 120deg)`,
              filter: "blur(2px)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[6%] animate-pulse"
            style={{
              border: `1px solid ${hexToRgba(tint, 0.45)}`,
              boxShadow: `0 0 14px ${hexToRgba(tint, 0.25)}`,
            }}
          />
        </>
      );
    case "aurora":
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-18%] animate-spin [animation-duration:10s]"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg 36deg, ${hexToRgba(tint, 0.88)} 64deg 108deg, rgba(103,232,249,0.82) 132deg 182deg, rgba(196,181,253,0.8) 208deg 258deg, ${hexToRgba(tint, 0.18)} 286deg 322deg, transparent 344deg 360deg)`,
              filter: "blur(6px) saturate(1.15)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[5%] animate-pulse"
            style={{
              border: `1px solid ${hexToRgba(tint, 0.28)}`,
              boxShadow: `0 0 16px ${hexToRgba(tint, 0.2)}`,
            }}
          />
        </>
      );
    case "prism":
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-35%] animate-spin [animation-duration:8s]"
          style={{
            background:
              "radial-gradient(circle at 50% 8%, rgba(249,115,22,0.95) 0%, rgba(249,115,22,0.22) 12%, transparent 18%), radial-gradient(circle at 84% 34%, rgba(250,204,21,0.95) 0%, rgba(250,204,21,0.2) 12%, transparent 18%), radial-gradient(circle at 86% 72%, rgba(74,222,128,0.95) 0%, rgba(74,222,128,0.2) 12%, transparent 18%), radial-gradient(circle at 52% 92%, rgba(56,189,248,0.95) 0%, rgba(56,189,248,0.2) 12%, transparent 18%), radial-gradient(circle at 16% 70%, rgba(167,139,250,0.95) 0%, rgba(167,139,250,0.2) 12%, transparent 18%), radial-gradient(circle at 18% 30%, rgba(244,114,182,0.95) 0%, rgba(244,114,182,0.2) 12%, transparent 18%)",
            filter: "blur(10px)",
          }}
        />
      );
    case "ember-crown":
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-22%] animate-spin [animation-duration:6.5s]"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(255,237,213,0.08), rgba(251,146,60,0.95), rgba(251,191,36,0.75), rgba(127,29,29,0.08), rgba(255,237,213,0.08))",
              filter: "blur(7px)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-10%] animate-spin [animation-duration:11s] [animation-direction:reverse]"
            style={{
              background:
                "radial-gradient(circle at 50% 6%, rgba(255,251,235,0.95) 0%, rgba(255,251,235,0.2) 10%, transparent 16%), radial-gradient(circle at 84% 42%, rgba(251,146,60,0.9) 0%, rgba(251,146,60,0.18) 8%, transparent 14%), radial-gradient(circle at 16% 62%, rgba(251,191,36,0.9) 0%, rgba(251,191,36,0.16) 9%, transparent 15%)",
              filter: "blur(3px)",
            }}
          />
        </>
      );
    case "ion-storm":
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-18%] animate-spin [animation-duration:4.8s]"
            style={{
              background:
                "repeating-conic-gradient(from 0deg, rgba(255,255,255,0) 0deg 22deg, rgba(56,189,248,0.95) 22deg 28deg, rgba(99,102,241,0.2) 28deg 42deg, rgba(255,255,255,0) 42deg 70deg, rgba(165,180,252,0.92) 70deg 76deg, rgba(255,255,255,0) 76deg 120deg)",
              filter: "blur(3px)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[1px] animate-pulse"
            style={{
              boxShadow: "0 0 22px rgba(59,130,246,0.22), inset 0 0 0 1px rgba(191,219,254,0.24)",
            }}
          />
        </>
      );
    case "starlight":
      return (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[-24%] animate-spin [animation-duration:12s]"
            style={{
              background:
                "radial-gradient(circle at 50% 4%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.3) 4%, transparent 9%), radial-gradient(circle at 88% 40%, rgba(255,244,214,0.95) 0%, rgba(255,244,214,0.25) 4%, transparent 10%), radial-gradient(circle at 72% 86%, rgba(191,219,254,0.95) 0%, rgba(191,219,254,0.22) 4%, transparent 10%), radial-gradient(circle at 16% 72%, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.22) 4%, transparent 10%), radial-gradient(circle at 10% 24%, rgba(255,244,214,0.92) 0%, rgba(255,244,214,0.22) 4%, transparent 10%)",
              filter: "blur(1px)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[2px]"
            style={{
              boxShadow: "0 0 18px rgba(255,255,255,0.1), inset 0 0 0 1px rgba(255,255,255,0.16)",
            }}
          />
        </>
      );
    default:
      return null;
  }
}

export function ProfileBorder({
  borderKey,
  tintColor,
  children,
  className = "",
  innerClassName = "",
  size = "default",
}: {
  borderKey?: ProfileBorderKey | null;
  tintColor?: string | null;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  /** "sm" reduces padding, rounding, and shadow for inline avatar contexts */
  size?: "default" | "sm";
}) {
  if (!borderKey) return <>{children}</>;

  const tint = tintColor ?? PATREON_HIGHLIGHT_COLORS.default;
  const outerStyle: React.CSSProperties = {};
  const isPictureFrame = [
    "picture-frame",
    "gallery-frame",
    "silver-frame",
    "obsidian-frame",
  ].includes(borderKey);
  const isAnimatedBorder = [
    "comet",
    "signal-beacon",
    "aurora",
    "prism",
    "ember-crown",
    "ion-storm",
    "starlight",
    "pulse",
    "spotlight",
  ].includes(borderKey);
  const sm = size === "sm";
  const outerClassName = `inline-flex ${sm ? "shadow-sm" : "shadow-lg"} ${
    isPictureFrame
      ? sm
        ? "rounded-xl p-[3px]"
        : "rounded-[1.75rem] p-[10px]"
      : sm
        ? "rounded-lg p-[2px]"
        : "rounded-[1.45rem] p-[9px]"
  } ${isAnimatedBorder ? "relative overflow-hidden" : ""} ${className}`;
  const innerRadius = sm ? (isPictureFrame ? "rounded-lg" : "rounded-md") : "rounded-[1.2rem]";
  const innerFrameClassName = isPictureFrame
    ? `${innerRadius} overflow-hidden ${innerClassName}`
    : `${innerRadius} bg-card ${innerClassName}`;

  switch (borderKey) {
    case "default-tint":
    case "party-sync":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.55)}, ${tint}, ${hexToRgba(tint, 0.8)})`;
      break;
    case "soft-glow":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.35)}, ${hexToRgba(tint, 0.9)})`;
      outerStyle.boxShadow = `0 0 18px ${hexToRgba(tint, 0.45)}`;
      break;
    case "double-ring":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.9)}, ${hexToRgba(tint, 0.5)})`;
      outerStyle.boxShadow = `0 0 0 2px ${hexToRgba(tint, 0.25)}, 0 0 0 5px ${hexToRgba(tint, 0.12)}`;
      break;
    case "etched-band":
      outerStyle.background = `repeating-linear-gradient(135deg, ${hexToRgba(tint, 0.9)} 0px, ${hexToRgba(tint, 0.9)} 6px, ${hexToRgba(tint, 0.55)} 6px, ${hexToRgba(tint, 0.55)} 12px)`;
      break;
    case "comet":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.55)}, ${hexToRgba(tint, 0.2)})`;
      outerStyle.boxShadow = `0 0 18px ${hexToRgba(tint, 0.18)}`;
      break;
    case "signal-beacon":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.2)}, ${hexToRgba(tint, 0.82)}, ${hexToRgba(tint, 0.26)})`;
      outerStyle.boxShadow = `0 0 20px ${hexToRgba(tint, 0.22)}`;
      break;
    case "aurora":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.5)}, rgba(103,232,249,0.32), rgba(196,181,253,0.35))`;
      outerStyle.boxShadow = `0 0 20px ${hexToRgba(tint, 0.18)}`;
      break;
    case "prism":
      outerStyle.background = "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.92))";
      outerStyle.boxShadow = "0 0 22px rgba(56,189,248,0.22)";
      break;
    case "ember-crown":
      outerStyle.background =
        "linear-gradient(135deg, rgba(120,53,15,0.95), rgba(251,146,60,0.65), rgba(146,64,14,0.95))";
      outerStyle.boxShadow = "0 0 22px rgba(251,146,60,0.2)";
      break;
    case "ion-storm":
      outerStyle.background =
        "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(37,99,235,0.65), rgba(49,46,129,0.95))";
      outerStyle.boxShadow = "0 0 22px rgba(96,165,250,0.18)";
      break;
    case "starlight":
      outerStyle.background =
        "linear-gradient(135deg, rgba(24,24,27,0.98), rgba(82,82,91,0.92), rgba(24,24,27,0.98))";
      outerStyle.boxShadow = "0 0 18px rgba(255,255,255,0.08)";
      break;
    case "pulse":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.5)}, ${hexToRgba(tint, 0.9)})`;
      outerStyle.boxShadow = `0 0 18px ${hexToRgba(tint, 0.24)}`;
      break;
    case "spotlight":
      outerStyle.background = `linear-gradient(135deg, ${hexToRgba(tint, 0.22)}, ${hexToRgba(tint, 0.88)}, ${hexToRgba(tint, 0.26)})`;
      outerStyle.boxShadow = `0 0 16px ${hexToRgba(tint, 0.18)}`;
      break;
    case "picture-frame":
      outerStyle.background =
        "linear-gradient(135deg, #5b3210, #a86b37 16%, #e7c48d 28%, #8d5628 44%, #603612 58%, #c99558 74%, #f3d3a2 86%, #6a3c16)";
      outerStyle.boxShadow =
        "inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 0 0 3px rgba(84,48,18,0.35), 0 10px 22px rgba(0,0,0,0.34)";
      break;
    case "gallery-frame":
      outerStyle.background =
        "linear-gradient(135deg, #a16207, #f8e7b8 20%, #b45309 38%, #fef3c7 52%, #92400e 72%, #f5d08f 86%, #7c2d12)";
      outerStyle.boxShadow =
        "inset 0 0 0 1px rgba(255,255,255,0.24), inset 0 0 0 4px rgba(120,53,15,0.26), 0 12px 24px rgba(0,0,0,0.28)";
      break;
    case "silver-frame":
      outerStyle.background =
        "linear-gradient(135deg, #475569, #f8fafc 18%, #94a3b8 34%, #ffffff 50%, #64748b 66%, #cbd5e1 82%, #334155)";
      outerStyle.boxShadow =
        "inset 0 0 0 1px rgba(255,255,255,0.36), inset 0 0 0 4px rgba(71,85,105,0.18), 0 10px 22px rgba(15,23,42,0.28)";
      break;
    case "obsidian-frame":
      outerStyle.background =
        "linear-gradient(135deg, #020617, #334155 18%, #0f172a 36%, #64748b 52%, #111827 70%, #1e293b 84%, #020617)";
      outerStyle.boxShadow =
        "inset 0 0 0 1px rgba(226,232,240,0.14), inset 0 0 0 4px rgba(2,6,23,0.45), 0 12px 24px rgba(0,0,0,0.42)";
      break;
    case "gold-gradient":
      outerStyle.background = "linear-gradient(135deg, #fcd34d, #fde68a, #f59e0b)";
      break;
    case "silver-etched":
      outerStyle.background = "linear-gradient(135deg, #d1d5db, #f8fafc, #9ca3af)";
      break;
    case "platinum-shine":
      outerStyle.background = "linear-gradient(135deg, #e5e7eb, #cbd5e1, #a1a1aa)";
      break;
    case "crimson-gold":
      outerStyle.background = "linear-gradient(135deg, #991b1b, #fbbf24, #b91c1c)";
      break;
    case "midnight-purple":
      outerStyle.background = "linear-gradient(135deg, #312e81, #7c3aed, #db2777)";
      break;
    case "emerald-wave":
      outerStyle.background = "linear-gradient(135deg, #10b981, #6ee7b7, #047857)";
      break;
    case "cosmic-nebula":
      outerStyle.background = "linear-gradient(135deg, #0ea5e9, #6366f1, #ec4899)";
      break;
  }

  return (
    <div className={outerClassName} style={outerStyle}>
      {renderAnimatedBorderLayer(borderKey, tint)}
      <div className={`${innerFrameClassName} ${isAnimatedBorder ? "relative z-10" : ""}`}>
        {children}
      </div>
    </div>
  );
}
