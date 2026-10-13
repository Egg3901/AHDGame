"use client";
import { useTranslations } from "next-intl";
import type { GroupManagementView } from "./useGroupManagement";
type Member = GroupManagementView["members"][number];
export function GroupParticipation({
  data,
  member,
  busy,
  onChange,
  office = false,
}: {
  data: GroupManagementView;
  member: Member;
  busy: boolean;
  onChange: (enabled: boolean) => void;
  office?: boolean;
}) {
  const t = useTranslations("corporations.group");
  const independent = data.settings.supplyPolicy !== "members";
  if (independent && !office) return null;
  const disabled = busy || !member.canEdit || independent;
  const pending = member.effectiveTurn !== null && member.effectiveTurn > data.currentTurn;
  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <h3 className="font-semibold">{member.name}</h3>
      {independent && <p className="text-sm text-muted">{t("participationUnavailable")}</p>}
      <label className="flex items-center gap-3 text-sm">
        <input
          className="h-4 w-4 accent-primary"
          type="checkbox"
          disabled={disabled}
          checked={member.requested === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {t("receiveSupply")}
      </label>
      <p className="text-xs text-muted">
        {member.receiving === null
          ? t("private")
          : independent
            ? t("preferenceRetained")
            : pending
              ? t("pendingTurn", { turn: member.effectiveTurn ?? 0 })
              : member.receiving
                ? t("participating")
                : t("optedOut")}
      </p>
      <p className="text-xs text-muted">{t("receivingOnly")}</p>
      {!member.canEdit && <p className="text-xs text-muted">{t("ownCeoOnly")}</p>}
    </section>
  );
}
