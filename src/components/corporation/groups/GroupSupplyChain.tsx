"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Network } from "lucide-react";
import SupplyAgreementsSection from "../SupplyAgreementsSection";
import { SUPPLY_AGREEMENT_PRICE_BAND } from "@/lib/db/types/supplyAgreement";
import type { GroupSupplyPolicy } from "@/lib/corporations/groups/managementTypes";
import { GroupSupplyConnections } from "./GroupSupplyConnections";
import { GroupSupplyForecast } from "./GroupSupplyForecast";
import { GroupParticipation } from "./GroupParticipation";
import type { GroupManagementView, useGroupManagement } from "./useGroupManagement";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium disabled:opacity-50 enabled:hover:bg-card-elevated focus-visible:outline-2 focus-visible:outline-info";
export function GroupSupplyChain({
  data,
  busy,
  save,
}: {
  data: GroupManagementView;
  busy: boolean;
  save: ReturnType<typeof useGroupManagement>["save"];
}) {
  const t = useTranslations("corporations.group");
  const [agreementCorpId, setAgreementCorpId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ base: GroupSupplyPolicy; value: GroupSupplyPolicy } | null>(
    null
  );
  const policy =
    draft?.base === data.settings.supplyPolicy ? draft.value : data.settings.supplyPolicy;
  const changed = policy !== data.settings.supplyPolicy;
  const agreementMembers = data.members.filter((m) => m.canEdit);
  const agreementMember =
    agreementMembers.find((m) => m.id === agreementCorpId) ?? agreementMembers[0];
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{t("supplyTitle")}</h2>
        <p className="text-sm text-muted">{t("marketPrice")}</p>
        <p className="text-xs text-muted">
          {t("supplyUI.currentPolicy", { policy: t("policies." + data.settings.supplyPolicy) })}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["independent", "members"] as const).map((option) => (
            <button
              className={`flex items-center gap-3 rounded-xl border p-5 text-left font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-info ${policy === option ? "border-gold bg-gold/5 text-foreground" : "border-card-border bg-card text-muted enabled:hover:bg-card-elevated"}`}
              key={option}
              aria-label={t("policies." + option)}
              disabled={busy || !data.canManage}
              aria-pressed={policy === option}
              onClick={() => setDraft({ base: data.settings.supplyPolicy, value: option })}
            >
              <Network
                size={20}
                className={policy === option ? "text-gold" : "text-muted"}
                aria-hidden="true"
              />
              <span>
                <span className="block">{t("policies." + option)}</span>
                <span className="mt-1 block text-xs font-normal text-muted">
                  {t("supplyUI.description." + option)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {changed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gold/25 bg-gold/5 p-4">
          <p className="flex-1 text-sm">{t("supplyUI.previewNote")}</p>
          <button
            className={button}
            disabled={busy || !data.canManage}
            onClick={async () => {
              if (await save({ action: "policy", policy })) setDraft(null);
            }}
          >
            {t("supplyUI.apply", { policy: t("policies." + policy) })}
          </button>
          <button className={button} disabled={busy} onClick={() => setDraft(null)}>
            {t("directionUI.cancel")}
          </button>
        </div>
      )}
      {!data.supplyEngineEnabled && (
        <p className="rounded-lg border border-info/25 bg-info/5 p-4 text-sm text-muted">
          {t("enginePending")}
        </p>
      )}
      {policy === "members" && data.settings.supplyPolicy === "members" && (
        <>
          <section className="rounded-xl border border-card-border bg-card p-5 space-y-3">
            <label className="block text-sm">
              {t("chainDiscount")}
              <select
                className="block mt-2 rounded border border-card-border bg-card p-2"
                aria-label={t("chainDiscount")}
                value={data.settings.supplyDiscount ?? 0}
                disabled={busy || !data.canManage}
                onChange={(e) =>
                  void save({ action: "discount", discount: Number(e.target.value) })
                }
              >
                {[
                  ...new Set([
                    ...Array.from(
                      { length: Math.round((SUPPLY_AGREEMENT_PRICE_BAND * 100) / 5) + 1 },
                      (_, i) => (i * 5) / 100
                    ),
                    data.settings.supplyDiscount ?? 0,
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map((discount) => (
                    <option key={discount} value={discount}>
                      {t("chainDiscountValue", {
                        percent: Number((discount * 100).toFixed(4)),
                        price: Number(((1 - discount) * 100).toFixed(4)),
                      })}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-xs text-muted">{t("chainDiscountNote")}</p>
          </section>
          <div>
            <h3 className="font-semibold">{t("participation")}</h3>
            <p className="mt-1 text-sm text-muted">{t("supplyUI.participationHelp")}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {data.members
              .filter((m) => m.operator === "player")
              .map((m) => (
                <GroupParticipation
                  key={m.id}
                  data={data}
                  member={m}
                  busy={busy}
                  onChange={(enabled) => void save({ action: "participation", enabled }, m.id)}
                />
              ))}
          </div>
        </>
      )}
      <aside className="rounded-lg border border-info/25 bg-info/5 p-4 text-sm">
        <h3 className="font-semibold">{t("supplyUI.guardrails")}</h3>
        <p className="mt-1 text-muted">{t("supplySafeguards")}</p>
      </aside>
      {policy === "members" && data.settings.supplyPolicy !== "members" && (
        <p className="text-sm text-muted">{t("supplyUI.applyFirst")}</p>
      )}
      <GroupSupplyForecast data={data} policy={policy} />
      <GroupSupplyConnections data={data} />
      <p className="text-sm text-muted">{t("supplyUI.noAutomaticPlayerSupply")}</p>
      <section className="rounded-xl border border-card-border bg-card p-5">
        <h3 className="font-semibold">{t("supplyUI.assumptions")}</h3>
        <p className="mt-2 text-sm text-muted">{t("forecastAssumptions")}</p>
        <p className="mt-2 text-xs text-muted">{t("supplyUI.noScenario")}</p>
      </section>
      {data.supplyAgreementsEnabled && (
        <section className="rounded-xl border border-card-border bg-card p-5 space-y-3">
          <h3 className="font-semibold">{t("agreementsTitle")}</h3>
          <p className="text-sm text-muted">
            {t("agreementsNote", { percent: Math.round(SUPPLY_AGREEMENT_PRICE_BAND * 100) })}
          </p>
          {agreementMember ? (
            <>
              <label className="block text-sm">
                {t("agreementsCorporation")}
                <select
                  className="block mt-2 rounded border border-card-border bg-card p-2"
                  value={agreementMember.id}
                  onChange={(e) => setAgreementCorpId(e.target.value)}
                >
                  {agreementMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <SupplyAgreementsSection key={agreementMember.id} corpId={agreementMember.id} />
            </>
          ) : (
            <p className="text-sm text-muted">{t("agreementsCeoOnly")}</p>
          )}
        </section>
      )}
    </div>
  );
}
