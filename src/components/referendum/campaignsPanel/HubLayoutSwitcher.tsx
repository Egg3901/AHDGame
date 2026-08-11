"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type HubLayout = "cards" | "arena" | "briefing";

const LAYOUTS: { id: HubLayout; label: string }[] = [
  { id: "cards", label: "Cards" },
  { id: "arena", label: "Arena" },
  { id: "briefing", label: "Briefing" },
];

/** Cards / Arena / Briefing toggle for the referendums hub; persists in `?layout=`. */
export function HubLayoutSwitcher({ active }: { active: HubLayout }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(layout: HubLayout) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("layout", layout);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-1.5">
      {LAYOUTS.map((l) => {
        const on = l.id === active;
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => go(l.id)}
            className={`rounded-lg border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-card-border bg-card text-muted hover:text-foreground"
            }`}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
