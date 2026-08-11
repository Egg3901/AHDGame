import type { ReactNode } from "react";

type Tone = "muted" | "gov" | "up" | "down" | "warning" | "info" | "success";

const TONES: Record<Tone, string> = {
  muted: "border-card-border bg-card-elevated text-muted",
  gov: "border-[color-mix(in_srgb,var(--gov)_45%,transparent)] bg-[color-mix(in_srgb,var(--gov)_12%,transparent)] text-gov-soft",
  up: "border-success/40 bg-success/10 text-success",
  down: "border-error/40 bg-error/10 text-error",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-info/40 bg-info/10 text-info",
  success: "border-success/40 bg-success/10 text-success",
};

export function Badge({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
