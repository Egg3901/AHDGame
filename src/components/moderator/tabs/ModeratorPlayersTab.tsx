"use client";

import dynamic from "next/dynamic";
import { CharacterStateManager } from "@/components/admin/players/CharacterStateManager";
import { PatreonManagementTab } from "@/components/admin/players/PatreonManagementTab";
import { SubTabBar } from "@/components/admin/tabs/SubTabBar";
import type { ModPlayersSubTab } from "./ModeratorTabsConfig";

const UsersTab = dynamic(
  () => import("@/components/admin/players/UsersTab").then((m) => ({ default: m.UsersTab })),
  { ssr: false }
);
const AchievementsTab = dynamic(
  () =>
    import("@/components/admin/players/AchievementsTab").then((m) => ({
      default: m.AchievementsTab,
    })),
  { ssr: false }
);
const ActivityLogTab = dynamic(
  () =>
    import("@/components/admin/players/ActivityLogTab").then((m) => ({
      default: m.ActivityLogTab,
    })),
  { ssr: false }
);
const SuspiciousActivityTab = dynamic(
  () =>
    import("@/components/admin/players/SuspiciousActivityTab").then((m) => ({
      default: m.SuspiciousActivityTab,
    })),
  { ssr: false }
);
const ModAuditLogTab = dynamic(
  () =>
    import("@/components/moderator/ModAuditLogTab").then((m) => ({ default: m.ModAuditLogTab })),
  { ssr: false }
);

const SUB_TABS: { id: ModPlayersSubTab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "achievements", label: "Achievements" },
  { id: "characters", label: "Characters" },
  { id: "patreon", label: "Patreon" },
  { id: "activity-log", label: "Activity Log" },
  { id: "suspicious", label: "Suspicious" },
  { id: "audit-log", label: "Audit Log" },
];

interface ModeratorPlayersTabProps {
  activeSub: ModPlayersSubTab;
  onSubChange: (sub: ModPlayersSubTab) => void;
}

export function ModeratorPlayersTab({ activeSub, onSubChange }: ModeratorPlayersTabProps) {
  return (
    <div className="space-y-6">
      <SubTabBar options={SUB_TABS} active={activeSub} onChange={onSubChange} />

      {activeSub === "users" && <UsersTab context="moderator" />}
      {activeSub === "achievements" && <AchievementsTab context="moderator" />}
      {activeSub === "characters" && <CharacterStateManager context="moderator" />}
      {activeSub === "patreon" && <PatreonManagementTab context="moderator" />}
      {activeSub === "activity-log" && <ActivityLogTab context="moderator" />}
      {activeSub === "suspicious" && <SuspiciousActivityTab context="moderator" />}
      {activeSub === "audit-log" && <ModAuditLogTab apiBase="/api/moderator" />}
    </div>
  );
}
