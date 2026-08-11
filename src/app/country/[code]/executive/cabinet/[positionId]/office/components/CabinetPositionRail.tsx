"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolveCabinetRoster } from "@/lib/cabinet/rosterEra";
import {
  getCabinetPositions,
  getCabinetPositionGroup,
  getCabinetMechanics,
  type CabinetGroup,
} from "@/lib/constants/cabinetMechanics";
import { seatIconName } from "../cabinetTabs";

const GROUP_ORDER: CabinetGroup[] = [
  "Centre",
  "Economy",
  "Security & Foreign",
  "Society",
  "Domestic",
  "Nations",
];

const ICON_PATH: Record<string, string> = {
  shield: "M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z",
  globe:
    "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
  coin: "M12 8c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2m0-8V7m0 1v8M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  scale: "M12 3v18M5 7l7-4 7 4M5 7l-2 6a4 4 0 008 0L9 7m10 0l-2 6a4 4 0 008 0l-2-6",
  users: "M17 20h5v-2a3 3 0 00-5.4-1.8M9 12a3 3 0 100-6 3 3 0 000 6zm6 8H3v-2a6 6 0 0112 0v2z",
  bolt: "M13 10V3L4 14h7v7l9-11h-7z",
  leaf: "M3 21v-4a4 4 0 014-4h.5M21 21v-9a4 4 0 00-4-4h-.5M12 3v18",
  road: "M3 12l2-2 7-7 7 7 2 2M5 10v10h14V10",
  briefcase: "M3 7h18M3 7l2-3h14l2 3M5 7v13a1 1 0 001 1h12a1 1 0 001-1V7",
};

function SeatIcon({ name, className = "h-3.5 w-3.5" }: { name: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
        d={ICON_PATH[name] || ICON_PATH.briefcase}
      />
    </svg>
  );
}

export function CabinetPositionRail({
  countryCode,
  countryId,
  activePositionId,
  liveYear = null,
}: {
  countryCode: string;
  countryId: string;
  activePositionId: string;
  /** Live in-game year for era gating (null = show the full roster). */
  liveYear?: number | null;
}) {
  const router = useRouter();
  const positions = resolveCabinetRoster(getCabinetPositions(countryId), liveYear);
  const href = (id: string) => `/country/${countryCode}/executive/cabinet/${id}/office`;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    seats: positions.filter((p) => getCabinetPositionGroup(countryId, p.id) === group),
  })).filter((g) => g.seats.length > 0);

  return (
    <aside className="lg:w-60 lg:shrink-0">
      {/* mobile */}
      <select
        value={activePositionId}
        onChange={(e) => router.push(href(e.target.value))}
        className="mb-3 w-full rounded-lg border border-card-border bg-card px-3 py-2 text-[13px] font-medium text-foreground outline-none focus:border-[var(--gov)] lg:hidden"
        aria-label="Switch cabinet seat"
      >
        {grouped.map(({ group, seats }) => (
          <optgroup key={group} label={group}>
            {seats.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* desktop */}
      <div className="hidden rounded-xl border border-card-border bg-card p-2 lg:block">
        <div className="dossier-label px-2 py-2 text-muted">Cabinet · {positions.length} seats</div>
        <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
          {grouped.map(({ group, seats }) => (
            <div key={group}>
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                {group}
              </div>
              <div className="space-y-0.5">
                {seats.map((p) => {
                  const active = p.id === activePositionId;
                  const mechanics = getCabinetMechanics(countryId, p.id);
                  const icon = mechanics ? seatIconName(p.id, mechanics) : "briefcase";
                  return (
                    <Link
                      key={p.id}
                      href={href(p.id)}
                      aria-current={active ? "page" : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                        active
                          ? "bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] font-semibold text-gov-soft"
                          : "text-muted hover:bg-card-muted hover:text-foreground"
                      }`}
                    >
                      <span className={active ? "text-gov-soft" : "text-muted/60"}>
                        <SeatIcon name={icon} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
