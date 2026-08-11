"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TurnControls } from "@/components/TurnControls";
import { TasksWidget } from "@/components/admin/tasks/TasksWidget";
import { AdminRegistrationPanel } from "@/components/admin/players/AdminRegistrationPanel";
import { FeatureGatesPanel } from "@/components/admin/FeatureGatesPanel";
import { ReferralLeaderboardPanel } from "@/components/admin/players/ReferralLeaderboardPanel";
import { KillSwitchBoard } from "@/components/admin/dashboard/KillSwitchBoard";
import { PendingQueuesCard } from "@/components/admin/dashboard/PendingQueuesCard";
import { RecentAdminActionsCard } from "@/components/admin/dashboard/RecentAdminActionsCard";
import type { AdminBadgeCounts } from "@/components/admin/nav/useAdminBadgeCounts";
import type { MainTabId } from "@/components/admin/tabs/AdminTabsConfig";

const QUICK_LINKS = [
  {
    tab: "politics",
    sub: "elections",
    label: "Elections",
    desc: "Manage officials, party elections, and election log.",
    accent: "var(--primary)",
    tag: "Politics",
  },
  {
    tab: "players",
    sub: "users",
    label: "Users",
    desc: "View all users, ban/unban accounts, and manage permissions.",
    accent: "#ef4444",
    tag: "Players",
  },
  {
    tab: "support",
    sub: "suggestions",
    label: "Suggestions",
    desc: "Review player suggestions (forum — separate from legacy feedback).",
    accent: "#a855f7",
    tag: "Support",
  },
  {
    tab: "world",
    sub: "npps",
    label: "NPPs & Content",
    desc: "Manage NPPs, wiki pages, and politician profiles.",
    accent: "#3b82f6",
    tag: "World",
  },
  {
    tab: "players",
    sub: "resources",
    label: "Resources",
    desc: "Grant action points and campaign funds to players.",
    accent: "#22c55e",
    tag: "Players",
  },
  {
    tab: "system",
    sub: "seed",
    label: "System",
    desc: "Seed database, reset game, and destructive operations.",
    accent: "#eab308",
    tag: "System",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="inline-block h-3.5 w-0.5 rounded-full bg-primary flex-shrink-0" />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</h2>
    </div>
  );
}

interface AdminDashboardTabProps {
  counts: AdminBadgeCounts;
  onNavigate: (tab: MainTabId, sub?: string) => void;
}

export function AdminDashboardTab({ counts, onNavigate }: AdminDashboardTabProps) {
  const pathname = usePathname();

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Primary column */}
      <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
        {/* Turn controls - Primary game management */}
        <section>
          <SectionLabel>Turn Controls</SectionLabel>
          <TurnControls />
        </section>

        {/* Every global toggle in one grid (replaces the old scattered panels:
            maintenance, registration controls, test mode, party mechanics,
            regional conditions, public read-only, public viewing). */}
        <section>
          <SectionLabel>Kill switches</SectionLabel>
          <KillSwitchBoard />
        </section>

        {/* Consolidated feature gates (forex, crises, RPG stats, redistricting,
            NPP autonomy level, …). Index funds / NPP economy / line of credit are
            now core systems (always on) and intentionally not gated here. */}
        <section>
          <SectionLabel>Feature gates</SectionLabel>
          <FeatureGatesPanel />
        </section>

        {/* Quick access */}
        <section>
          <SectionLabel>Quick Access</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map(({ tab, sub, label, desc, accent, tag }) => (
              <Link
                key={`${tab}-${sub}`}
                href={`${pathname}?tab=${tab}&sub=${sub}`}
                className="block rounded-lg border border-card-border bg-card p-3 transition-shadow hover:shadow-md sm:p-4"
                style={{ borderLeft: `3px solid ${accent}` }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-[10px] text-muted sm:text-xs">{tag}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted">{desc}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Admin registration */}
        <section>
          <SectionLabel>Admin Registration</SectionLabel>
          <AdminRegistrationPanel />
        </section>

        {/* Referral leaderboard */}
        <section>
          <SectionLabel>Referrals</SectionLabel>
          <ReferralLeaderboardPanel />
        </section>
      </div>

      {/* Right rail: queues, audit, tasks */}
      <div className="flex min-w-0 flex-col gap-4">
        <PendingQueuesCard counts={counts} onNavigate={onNavigate} />
        <RecentAdminActionsCard onNavigate={onNavigate} />
        <TasksWidget />
      </div>
    </div>
  );
}
