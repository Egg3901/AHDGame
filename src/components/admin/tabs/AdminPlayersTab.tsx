"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ResourceGrantManager } from "@/components/ResourceGrantManager";
import { CharacterStateManager } from "@/components/admin/players/CharacterStateManager";
import { PatreonManagementTab } from "@/components/admin/players/PatreonManagementTab";
import { PlayerBannerAdsTab } from "@/components/admin/players/PlayerBannerAdsTab";
import { SubNavLayout } from "./SubNavLayout";

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
const ModeratorsManagementTab = dynamic(
  () =>
    import("@/components/moderator/ModeratorsManagementTab").then((m) => ({
      default: m.ModeratorsManagementTab,
    })),
  { ssr: false }
);
const ModAuditLogTab = dynamic(
  () =>
    import("@/components/moderator/ModAuditLogTab").then((m) => ({
      default: m.ModAuditLogTab,
    })),
  { ssr: false }
);
const IpBansTab = dynamic(
  () => import("@/components/admin/players/IpBansTab").then((m) => ({ default: m.IpBansTab })),
  { ssr: false }
);
const UserApiKeysTab = dynamic(
  () =>
    import("@/components/admin/players/UserApiKeysTab").then((m) => ({
      default: m.UserApiKeysTab,
    })),
  { ssr: false }
);
const ApiAbuseTab = dynamic(
  () => import("@/components/admin/players/ApiAbuseTab").then((m) => ({ default: m.ApiAbuseTab })),
  { ssr: false }
);
const AltDetectionView = dynamic(() => import("@/components/admin/alts/AltDetectionView"), {
  ssr: false,
});
const DossierTab = dynamic(() => import("@/components/admin/players/dossier/DossierTab"), {
  ssr: false,
});
const WatchlistPanel = dynamic(() => import("@/components/admin/watchlist/WatchlistPanel"), {
  ssr: false,
});
const AuditExplorer = dynamic(() => import("@/components/admin/forensics/AuditExplorer"), {
  ssr: false,
});

export type PlayersSubTab =
  | "users"
  | "resources"
  | "achievements"
  | "characters"
  | "patreon"
  | "banner-ads"
  | "activity-log"
  | "suspicious"
  | "alts"
  | "forensics"
  | "dossier"
  | "watchlist"
  | "moderators"
  | "mod-audit-log"
  | "ip-bans"
  | "api-keys"
  | "api-abuse";

interface AdminPlayersTabProps {
  activeSub: PlayersSubTab;
  onSubChange: (sub: PlayersSubTab) => void;
}

export function AdminPlayersTab({ activeSub, onSubChange }: AdminPlayersTabProps) {
  // Dossier deep link (`?user=<id>`) — set by the Users table's Dossier
  // shortcut. Keyed remount so switching subjects resets the dossier state.
  const dossierUser = useSearchParams().get("user");

  return (
    <SubNavLayout tab="players" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        {activeSub === "users" && <UsersTab />}
        {activeSub === "resources" && <ResourceGrantManager />}
        {activeSub === "achievements" && <AchievementsTab />}
        {activeSub === "characters" && <CharacterStateManager />}
        {activeSub === "patreon" && <PatreonManagementTab />}
        {activeSub === "banner-ads" && <PlayerBannerAdsTab />}
        {activeSub === "activity-log" && <ActivityLogTab />}
        {activeSub === "suspicious" && <SuspiciousActivityTab />}
        {activeSub === "alts" && <AltDetectionView context="admin" />}
        {activeSub === "forensics" && <AuditExplorer context="admin" />}
        {activeSub === "dossier" && (
          <DossierTab
            context="admin"
            key={dossierUser ?? "search"}
            initialUserId={dossierUser ?? undefined}
          />
        )}
        {activeSub === "watchlist" && <WatchlistPanel />}
        {activeSub === "moderators" && <ModeratorsManagementTab />}
        {activeSub === "mod-audit-log" && <ModAuditLogTab />}
        {activeSub === "ip-bans" && <IpBansTab />}
        {activeSub === "api-keys" && <UserApiKeysTab />}
        {activeSub === "api-abuse" && <ApiAbuseTab />}
      </div>
    </SubNavLayout>
  );
}
