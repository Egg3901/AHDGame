import type { ReactNode } from "react";

export function SectionCard({
  title,
  sub,
  icon,
  right,
  className = "",
  children,
}: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-card-border bg-card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
          </div>
        </div>
        {/* The action never squeezes: without shrink-0 a narrow screen compresses
            it and wraps its label mid-phrase ("＋ Create / command"). The title
            block is min-w-0 + truncate precisely so it absorbs the squeeze. */}
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </div>
  );
}
