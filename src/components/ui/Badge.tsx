"use client";

// ─── Badge ────────────────────────────────────────────────────────────────────
// Inline chip for status, role, party, chamber, and count indicators.
// Never hard-code hex — all colors come from semantic CSS custom properties or
// inline rgba pairs derived from the design system's 10%/30% tint convention.

export type BadgeColor =
  "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info";

export type BadgeVariant =
  | "subtle" // colored bg/border, colored text (default)
  | "solid" // filled background, white text
  | "outline" // transparent bg, colored border + text
  | "tag"; // mono font, square corners — for bill IDs

interface BadgeProps {
  children: React.ReactNode;
  color?: BadgeColor;
  variant?: BadgeVariant;
  dot?: boolean; // small colored dot prefix
  live?: boolean; // pulsing dot (overrides dot)
  className?: string;
}

// Color → [bg rgba, border rgba, text class]
const colorMap: Record<BadgeColor, { bg: string; border: string; text: string; solid: string }> = {
  default: {
    bg: "rgba(107,107,122,0.15)",
    border: "rgba(107,107,122,0.35)",
    text: "text-muted",
    solid: "bg-muted",
  },
  primary: {
    bg: "rgba(220,38,38,0.12)",
    border: "rgba(220,38,38,0.40)",
    text: "text-red-300",
    solid: "bg-primary",
  },
  secondary: {
    bg: "rgba(29,78,216,0.12)",
    border: "rgba(29,78,216,0.40)",
    text: "text-blue-300",
    solid: "bg-secondary",
  },
  success: {
    bg: "rgba(34,197,94,0.10)",
    border: "rgba(34,197,94,0.35)",
    text: "text-green-400",
    solid: "bg-success",
  },
  warning: {
    bg: "rgba(234,179,8,0.12)",
    border: "rgba(234,179,8,0.40)",
    text: "text-yellow-400",
    solid: "bg-warning",
  },
  error: {
    bg: "rgba(239,68,68,0.10)",
    border: "rgba(239,68,68,0.35)",
    text: "text-red-400",
    solid: "bg-error",
  },
  info: {
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.35)",
    text: "text-blue-400",
    solid: "bg-info",
  },
};

const dotColorMap: Record<BadgeColor, string> = {
  default: "bg-muted",
  primary: "bg-primary",
  secondary: "bg-secondary",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
};

export function Badge({
  children,
  color = "default",
  variant = "subtle",
  dot = false,
  live = false,
  className = "",
}: BadgeProps) {
  const c = colorMap[color];

  const base = "inline-flex items-center gap-1.5 font-semibold leading-none whitespace-nowrap";

  let containerStyle: React.CSSProperties = {};
  let containerClass = "";

  if (variant === "solid") {
    containerClass = `${c.solid} text-white border border-transparent rounded-full px-2.5 py-1 text-[11px]`;
  } else if (variant === "tag") {
    containerStyle = { background: c.bg, borderColor: c.border };
    containerClass = `${c.text} border rounded px-1.5 py-0.5 text-[10px] font-mono tracking-wide`;
  } else if (variant === "outline") {
    containerStyle = { borderColor: c.border };
    containerClass = `bg-transparent ${c.text} border rounded-full px-2.5 py-1 text-[11px]`;
  } else {
    // subtle (default)
    containerStyle = { background: c.bg, borderColor: c.border };
    containerClass = `${c.text} border rounded-full px-2.5 py-1 text-[11px]`;
  }

  return (
    <span className={`${base} ${containerClass} ${className}`.trim()} style={containerStyle}>
      {live ? (
        <LiveDot color={color} />
      ) : dot ? (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColorMap[color]}`} />
      ) : null}
      {children}
    </span>
  );
}

// ─── LiveDot ──────────────────────────────────────────────────────────────────
// Pulsing indicator for active/in-progress states.

interface LiveDotProps {
  color?: BadgeColor;
}

export function LiveDot({ color = "primary" }: LiveDotProps) {
  return (
    <span className="relative inline-flex h-[7px] w-[7px] shrink-0">
      <span
        className={`absolute inset-0 rounded-full animate-ping opacity-70 ${dotColorMap[color]}`}
        style={{ animationDuration: "1.8s" }}
      />
      <span className={`relative rounded-full h-full w-full ${dotColorMap[color]}`} />
    </span>
  );
}

// ─── BadgeCount ───────────────────────────────────────────────────────────────
// Compact numeric count chip — sits inline next to labels.

interface BadgeCountProps {
  count: number | string;
  color?: BadgeColor;
  className?: string;
}

export function BadgeCount({ count, color = "primary", className = "" }: BadgeCountProps) {
  const c = colorMap[color];

  if (color === "primary") {
    return (
      <span
        className={`inline-flex items-center justify-content-center min-w-[18px] h-[18px] rounded-full px-1.5 text-[10px] font-bold tabular-nums text-white bg-primary ${className}`}
      >
        {count}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-content-center min-w-[18px] h-[18px] rounded-full px-1.5 text-[10px] font-bold tabular-nums border ${c.text} ${className}`}
      style={{ background: c.bg, borderColor: c.border }}
    >
      {count}
    </span>
  );
}

// ─── TallyBadge ───────────────────────────────────────────────────────────────
// Split yea/nay/abstain chip for vote tallies.

interface TallyBadgeProps {
  yea: number;
  nay: number;
  abstain?: number;
  className?: string;
}

export function TallyBadge({ yea, nay, abstain, className = "" }: TallyBadgeProps) {
  return (
    <span
      className={`inline-flex items-center border border-card-border rounded-full overflow-hidden font-mono text-[10px] font-bold ${className}`}
    >
      <span className="px-2 py-0.5 bg-success/15 text-green-400">Y {yea}</span>
      <span className="px-2 py-0.5 bg-error/15 text-red-400">N {nay}</span>
      {abstain !== undefined && (
        <span className="px-2 py-0.5 bg-muted/15 text-muted">A {abstain}</span>
      )}
    </span>
  );
}
