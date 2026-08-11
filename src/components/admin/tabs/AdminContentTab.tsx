"use client";

import dynamic from "next/dynamic";
import { SubNavLayout } from "./SubNavLayout";

const WikiManagementTab = dynamic(
  () =>
    import("@/components/admin/wiki/WikiManagementTab").then((m) => ({
      default: m.WikiManagementTab,
    })),
  { ssr: false }
);
const WikiReviewTab = dynamic(
  () => import("@/components/admin/wiki/WikiReviewTab").then((m) => ({ default: m.WikiReviewTab })),
  { ssr: false }
);
const RoadmapManager = dynamic(
  () =>
    import("@/components/admin/content/RoadmapManager").then((m) => ({
      default: m.RoadmapManager,
    })),
  { ssr: false }
);

export type ContentSubTab = "wiki" | "wiki-review" | "roadmap";

interface AdminContentTabProps {
  activeSub: ContentSubTab;
  onSubChange: (sub: ContentSubTab) => void;
}

export function AdminContentTab({ activeSub, onSubChange }: AdminContentTabProps) {
  return (
    <SubNavLayout tab="content" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        {activeSub === "wiki" && <WikiManagementTab isAdmin />}
        {activeSub === "wiki-review" && <WikiReviewTab />}
        {activeSub === "roadmap" && <RoadmapManager />}
      </div>
    </SubNavLayout>
  );
}
