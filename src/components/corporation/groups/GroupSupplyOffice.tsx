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
      <h2 className="font-semibold">
        {t(data.supplyEngineEnabled ? "participation" : "activeSupply.officeTitle")}
      </h2>
      <Link
        className="text-sm font-medium text-info hover:underline"
        href={"/corporation/" + data.rootId + "/group#supply"}
      >
        {t("viewGroup")}
      </Link>
      {data.supplyEngineEnabled && (
        <GroupParticipation
          data={data}
          member={member}
          busy={busy}
          office
          onChange={(enabled) => void save({ action: "participation", enabled })}
        />
      )}
      {member.direction && (
        <section className="rounded-xl border border-card-border bg-card p-5 space-y-2">
          <h3 className="font-semibold">{t("playerSuggestion")}</h3>
          <p>{t("objectives." + member.direction.objective)}</p>
          {!!member.direction.regions.length && (
            <p className="text-sm">
              {t("targetRegions", {
                regions: member.direction.regions
                  .map((id) => data.regions.find((r) => r.id === id)?.name ?? id)
                  .join(", "),
              })}
            </p>
          )}
          <p className="text-xs text-muted">{t("directionUI." + member.direction.response)}</p>
          <p className="text-xs text-muted">{t("directionNote")}</p>
          {member.canEdit &&
            ["acknowledged", "declined"].map((response) => (
              <button
                key={response}
                disabled={busy}
                className="rounded border border-card-border px-3 py-2 text-sm disabled:opacity-50"
                onClick={() =>
                  void save({
                    action: "respond",
                    response: response as "acknowledged" | "declined",
                    revision: member.direction!.revision,
                  })
                }
              >
                {t(response)}
              </button>
            ))}
        </section>
      )}
      {!data.supplyEngineEnabled && (
        <p className="text-xs text-muted">
          {t(data.internalSupplyEnabled ? "activeSupply.office" : "activeSupply.unavailable")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
