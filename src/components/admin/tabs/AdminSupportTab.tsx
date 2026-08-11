"use client";

import dynamic from "next/dynamic";
import { SubNavLayout } from "./SubNavLayout";

const FeedbackTab = dynamic(
  () => import("@/components/admin/feedback/FeedbackTab").then((m) => ({ default: m.FeedbackTab })),
  { ssr: false }
);
const LogsTab = dynamic(
  () => import("@/components/admin/system/LogsTab").then((m) => ({ default: m.LogsTab })),
  { ssr: false }
);
const DebugTab = dynamic(
  () => import("@/components/admin/system/DebugTab").then((m) => ({ default: m.DebugTab })),
  { ssr: false }
);
const MigrationsTab = dynamic(
  () =>
    import("@/components/admin/system/MigrationsTab").then((m) => ({ default: m.MigrationsTab })),
  { ssr: false }
);
const MailReportsTab = dynamic(
  () =>
    import("@/components/admin/content/MailReportsTab").then((m) => ({
      default: m.MailReportsTab,
    })),
  { ssr: false }
);
const SuggestionsTab = dynamic(
  () =>
    import("@/components/admin/suggestions/SuggestionsTab").then((m) => ({
      default: m.SuggestionsTab,
    })),
  { ssr: false }
);

export type SupportSubTab =
  "suggestions" | "feedback" | "logs" | "debug" | "migrations" | "mail-reports";

interface AdminSupportTabProps {
  activeSub: SupportSubTab;
  onSubChange: (sub: SupportSubTab) => void;
  initialFeedbackIssue?: number;
  initialSuggestionIssue?: number;
}

export function AdminSupportTab({
  activeSub,
  onSubChange,
  initialFeedbackIssue,
  initialSuggestionIssue,
}: AdminSupportTabProps) {
  return (
    <SubNavLayout tab="support" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        {activeSub === "suggestions" && (
          <SuggestionsTab initialIssueNumber={initialSuggestionIssue} />
        )}
        {activeSub === "feedback" && <FeedbackTab initialIssueNumber={initialFeedbackIssue} />}
        {activeSub === "logs" && <LogsTab />}
        {activeSub === "debug" && <DebugTab />}
        {activeSub === "migrations" && <MigrationsTab />}
        {activeSub === "mail-reports" && (
          <MailReportsTab backHref="/admin?tab=support&sub=mail-reports" />
        )}
      </div>
    </SubNavLayout>
  );
}
