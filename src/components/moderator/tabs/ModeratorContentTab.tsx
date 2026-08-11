"use client";

import dynamic from "next/dynamic";
import { ModNewsTab } from "@/components/moderator/ModNewsTab";
import { SubTabBar } from "@/components/admin/tabs/SubTabBar";
import { WikiReviewTab } from "@/components/admin/wiki/WikiReviewTab";
import type { ModContentSubTab } from "./ModeratorTabsConfig";

const PlayerAdsModTab = dynamic(
  () =>
    import("@/components/moderator/PlayerAdsModTab").then((m) => ({
      default: m.PlayerAdsModTab,
    })),
  { ssr: false }
);

const WikiManagementTab = dynamic(
  () =>
    import("@/components/admin/wiki/WikiManagementTab").then((m) => ({
      default: m.WikiManagementTab,
    })),
  { ssr: false }
);

const SupporterRequestsTab = dynamic(
  () =>
    import("@/components/moderator/SupporterRequestsTab").then((m) => ({
      default: m.SupporterRequestsTab,
    })),
  { ssr: false }
);

const MailReportsTab = dynamic(
  () =>
    import("@/components/admin/content/MailReportsTab").then((m) => ({
      default: m.MailReportsTab,
    })),
  { ssr: false }
);

const CONTENT_SUB_TABS: { id: ModContentSubTab; label: string }[] = [
  { id: "news", label: "News Posts" },
  { id: "banner-ads", label: "Banner Ads" },
  { id: "wiki", label: "Wiki Pages" },
  { id: "wiki-review", label: "Wiki Review" },
  { id: "supporter-requests", label: "Supporter Requests" },
  { id: "mail-reports", label: "Mail Reports" },
];

interface ModeratorContentTabProps {
  activeSub: ModContentSubTab;
  onSubChange: (sub: ModContentSubTab) => void;
}

export function ModeratorContentTab({ activeSub, onSubChange }: ModeratorContentTabProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Content Moderation</h2>
        <p className="mt-1 text-sm text-muted">
          Review player-authored news posts and banner ads, manage wiki pages, review wiki
          submissions, and investigate reported player mail. System wire posts and wiki seed/access
          controls remain admin-only.
        </p>
      </div>

      <SubTabBar options={CONTENT_SUB_TABS} active={activeSub} onChange={onSubChange} />

      {activeSub === "news" && <ModNewsTab />}
      {activeSub === "banner-ads" && <PlayerAdsModTab />}
      {activeSub === "wiki" && <WikiManagementTab isAdmin={false} />}
      {activeSub === "wiki-review" && <WikiReviewTab />}
      {activeSub === "supporter-requests" && <SupporterRequestsTab />}
      {activeSub === "mail-reports" && (
        <MailReportsTab backHref="/moderator?tab=content&sub=mail-reports" />
      )}
    </div>
  );
}
