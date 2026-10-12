"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useGroupManagement } from "./useGroupManagement";
import { GroupParticipation } from "./GroupParticipation";
export function GroupSupplyOffice({ corpId }: { corpId: string }) {
  const t = useTranslations("corporations.group"),
    { data, error, busy, save } = useGroupManagement(corpId);
  if (!data)
    return error ? (
      <p role="alert" className="text-sm text-red-400">
        {error}
      </p>
    ) : null;
  const member = data.members.find((m) => m.id === corpId || m.pathId === corpId);
  if (!member || member.operator === "npp") return null;
  return (
    <div id="ceo-group-supply" className="space-y-3">
      <h2 className="font-semibold">{t("participation")}</h2>
      <Link className="text-sm underline" href={"/corporation/" + data.rootId + "/group#supply"}>
        {t("viewGroup")}
      </Link>
      <GroupParticipation
        data={data}
        member={member}
        busy={busy}
        office
        onChange={(enabled) => void save({ action: "participation", enabled })}
      />
      {!data.supplyEngineEnabled && <p className="text-xs text-muted">{t("enginePending")}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
