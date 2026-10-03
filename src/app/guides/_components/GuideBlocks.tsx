import type { ReactNode } from "react";

/** Numbered section heading in a long-form guide, and the anchor the contents list links to. */
export function SectionHeader({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-4 text-xl font-bold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

export function SubHeader({ children }: { children: ReactNode }) {
  return <h3 className="font-semibold text-foreground">{children}</h3>;
}

export type CalloutKind = "note" | "warning";

const DEFAULT_LABEL: Record<CalloutKind, string> = {
  note: "Note.",
  warning: "Warning.",
};

/**
 * An aside in a guide, opened by a bold lead-in label. A note is neutral. A
 * warning is only for real risks a player cannot easily undo, such as locks,
 * switching costs and debt limits: its label is amber and it sits on a subtle
 * neutral background.
 */
export function Callout({
  kind = "note",
  label,
  children,
}: {
  kind?: CalloutKind;
  label?: ReactNode;
  children: ReactNode;
}) {
  const warning = kind === "warning";
  return (
    <div
      className={`rounded-lg border border-card-border px-4 py-3 text-sm leading-relaxed text-muted ${
        warning ? "bg-card" : ""
      }`}
    >
      <strong className={`font-semibold ${warning ? "text-warning" : "text-foreground"}`}>
        {label ?? DEFAULT_LABEL[kind]}
      </strong>{" "}
      {children}
    </div>
  );
}

export function FormulaBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-card-border bg-background px-4 py-3 font-mono text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
      {children}
    </pre>
  );
}

/** A signed figure. Green and red mark gains and losses; a two-sided range stays neutral. */
export function Tag({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "positive" | "negative" | "neutral";
}) {
  const colors = {
    positive: "border-success/20 bg-success/10 text-success",
    negative: "border-error/20 bg-error/10 text-error",
    neutral: "border-card-border text-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs font-semibold ${colors[variant]}`}
    >
      {children}
    </span>
  );
}

export function TableOfContents({
  items,
}: {
  items: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
    <nav aria-label="Contents" className="rounded-xl border border-card-border bg-card p-5">
      <p className="mb-3 text-sm font-semibold text-muted">Contents</p>
      <ol className="grid gap-y-1 gap-x-4 text-sm sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="text-primary hover:underline">
              {i + 1}. {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
