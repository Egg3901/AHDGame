import Link from "next/link";

const ROLES: { id: string; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "pm", label: "Prime Minister" },
  { id: "leader", label: "Party Leader" },
  { id: "player", label: "Player" },
  { id: "spectator", label: "Spectator" },
];

/**
 * Admin-only "Viewing as" segmented control — a row of links that set `?as=`.
 * The page reads `?as` and passes the role into the rail; the backend still
 * authorizes every action, so this only changes which module renders.
 */
export function ViewingAsControl({
  active,
  hrefFor,
}: {
  active: string;
  hrefFor: (role: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ref-gold)]">
        Viewing as
      </span>
      {ROLES.map((r) => (
        <Link
          key={r.id}
          href={hrefFor(r.id)}
          aria-current={active === r.id ? "true" : undefined}
          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            active === r.id
              ? "border-primary bg-primary/10 text-primary"
              : "border-card-border text-muted hover:text-foreground"
          }`}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}
