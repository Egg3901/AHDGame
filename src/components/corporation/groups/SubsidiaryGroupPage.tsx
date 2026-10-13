"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Building2, ChartNoAxesCombined, Compass, Network, Pencil } from "lucide-react";
import styles from "./GroupPage.module.css";
import { GroupOverviewDashboard } from "./GroupOverviewDashboard";

import { useTranslations } from "next-intl";

import { CorporationLogo } from "../CorporationLogo";
import { GroupOverviewCard, type GroupOverviewPayload } from "../GroupOverviewCard";
import SupplyAgreementsSection from "../SupplyAgreementsSection";
import { SUPPLY_AGREEMENT_PRICE_BAND } from "@/lib/db/types/supplyAgreement";
import { GroupSupplyForecast } from "./GroupSupplyForecast";
import { GroupParticipation } from "./GroupParticipation";
import { useGroupManagement } from "./useGroupManagement";
import { GroupFinancialComparison } from "./GroupFinancialComparison";
import { GroupDirections } from "./GroupDirections";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-card-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info";
const sectionIcons = [Building2, ChartNoAxesCombined, Compass, Network];
export function SubsidiaryGroupPage({ corpId }: { corpId: string }) {
  const t = useTranslations("corporations.group");
  const { data, loading, error, busy, save, refresh } = useGroupManagement(corpId);
  const section = useSyncExternalStore(subscribeSection, currentSection, () => "overview");
  const [groupPayload, setGroupPayload] = useState<GroupOverviewPayload | null>(null),
    [sheetError, setSheetError] = useState("");
  const [name, setName] = useState<string | null>(null),
    [uploading, setUploading] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [agreementCorpId, setAgreementCorpId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/corporations/" + corpId + "/group", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(t("loadFailed"));
        const payload = await res.json();
        setSheetError("");
        setGroupPayload(payload);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSheetError(e.message);
      });
    return () => controller.abort();
  }, [corpId, t]);
  const sheet = groupPayload?.group ?? null;
  if (loading && !data)
    return (
      <main className="mx-auto max-w-7xl p-6">
        <p role="status">{t("loading")}</p>
      </main>
    );
  if (!data)
    return (
      <main className="mx-auto max-w-7xl p-6 space-y-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p role={error ? "alert" : undefined}>{error || t("noGroup")}</p>
        <Link href={"/corporation/" + corpId}>{t("viewCorporation")}</Link>
      </main>
    );
  const agreementMembers = data.members.filter((m) => m.canEdit);
  const agreementMember =
    agreementMembers.find((m) => m.id === agreementCorpId) ?? agreementMembers[0];
  async function uploadLogo(file: File | undefined) {
    if (!file || !data) return;
    setUploading(true);
    setSheetError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("corporationId", data.rootId);
      form.set("target", "group");
      const res = await fetch("/api/upload/corporation-logo", { method: "POST", body: form }),
        body = await res.json();
      if (!res.ok) throw new Error(body.error || t("saveFailed"));
      await refresh();
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setUploading(false);
    }
  }
  return (
    <main className={`${styles.page} mx-auto max-w-7xl p-4 sm:p-6 space-y-6`}>
      <nav aria-label={t("breadcrumb")} className="text-sm text-muted">
        <Link href={"/corporation/" + data.rootId}>{t("parentCorporation")}</Link> / {t("title")}
      </nav>
      <header className="flex flex-wrap items-center gap-5 rounded-xl border border-card-border bg-card p-5 sm:p-7">
        <CorporationLogo
          logoUrl={data.settings.logoUrl}
          name={data.settings.name}
          size="h-16 w-16"
        />
        <div className="flex-1">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-gold">
            {t("title")}
          </p>
          <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
            {data.settings.name}
          </h1>
          <p className="text-sm text-muted">{t("memberCount", { count: data.members.length })}</p>
        </div>
        {data.canManage && (
          <button
            type="button"
            className={`${button} w-full sm:w-auto`}
            aria-expanded={section === "overview" && editingIdentity}
            aria-controls="group-identity-editor"
            onClick={() => {
              setEditingIdentity(section !== "overview" || !editingIdentity);
              if (section !== "overview") {
                history.replaceState(null, "", "#overview");
                window.dispatchEvent(new HashChangeEvent("hashchange"));
              }
            }}
          >
            <Pencil size={14} aria-hidden="true" />
            {t("editIdentity")}
          </button>
        )}
      </header>
      {(error || sheetError) && (
        <p role="alert" className="text-sm text-red-400">
          {error || sheetError}
        </p>
      )}
      <nav
        aria-label={t("sections")}
        className="flex gap-1 overflow-x-auto border-b border-card-border"
      >
        {["overview", "financials", "directions", "supply"].map((key, index) => (
          <button
            key={key}
            className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-info ${section === key ? "border-primary text-foreground bg-card" : "border-transparent text-muted hover:bg-card hover:text-foreground"}`}
            aria-pressed={section === key}
            onClick={() => {
              history.replaceState(null, "", "#" + key);
              window.dispatchEvent(new HashChangeEvent("hashchange"));
            }}
          >
            {(() => {
              const Icon = sectionIcons[index];
              return <Icon size={16} aria-hidden="true" />;
            })()}
            {t(key)}
          </button>
        ))}
      </nav>
      {section === "overview" && (
        <>
          {data.canManage && editingIdentity && (
            <section
              id="group-identity-editor"
              className="rounded-xl border border-card-border bg-card p-5 space-y-3"
            >
              <h2 className="border-b border-card-border pb-3 text-sm font-semibold">
                {t("identity")}
              </h2>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ action: "identity", name: name ?? data.settings.name }).then((ok) => {
                    if (ok) {
                      setName(null);
                      setEditingIdentity(false);
                    }
                  });
                }}
              >
                <label className="text-sm">
                  {t("groupName")}
                  <input
                    className="mt-2 block w-full rounded-lg border border-card-border bg-background px-3 py-2 sm:min-w-80"
                    value={name ?? data.settings.name}
                    maxLength={60}
                    minLength={2}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
                <button className={button} disabled={busy}>
                  {t("save")}
                </button>
              </form>
              <label className="block text-sm">
                {t("groupLogo")}
                <input
                  className="mt-2 block max-w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-card-elevated file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={uploading || busy}
                  onChange={(e) => void uploadLogo(e.target.files?.[0])}
                />
              </label>
            </section>
          )}
          <GroupOverviewDashboard data={data} sheet={sheet} />
          <details className="rounded-xl border border-card-border bg-card p-5">
            <summary className="cursor-pointer text-sm font-semibold">
              {t("groupTaxStructure")}
            </summary>
            {groupPayload && (
              <GroupOverviewCard corpId={corpId} hideGroupLink payload={groupPayload} />
            )}
          </details>
        </>
      )}
      {/* Keep comparison choices while visiting another Group tab. */}
      <div hidden={section !== "financials"}>
        <GroupFinancialComparison data={data} sheet={sheet} />
      </div>
      {section === "directions" && <GroupDirections data={data} busy={busy} save={save} />}
      {section === "supply" && (
        <>
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">{t("supplyTitle")}</h2>
            <p className="text-sm text-muted">{t("marketPrice")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["independent", "members"] as const).map((policy) => (
                <button
                  className={`flex items-center gap-3 rounded-xl border p-5 text-left font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-info ${data.settings.supplyPolicy === policy ? "border-gold bg-gold/5 text-foreground" : "border-card-border bg-card text-muted enabled:hover:bg-card-elevated"}`}
                  key={policy}
                  disabled={busy || !data.canManage}
                  aria-pressed={data.settings.supplyPolicy === policy}
                  onClick={() => void save({ action: "policy", policy })}
                >
                  <Network
                    size={20}
                    className={data.settings.supplyPolicy === policy ? "text-gold" : "text-muted"}
                    aria-hidden="true"
                  />
                  {t("policies." + policy)}
                </button>
              ))}
            </div>
          </div>
          {!data.supplyEngineEnabled && (
            <p className="rounded-lg border border-info/25 bg-info/5 p-4 text-sm text-muted">
              {t("enginePending")}
            </p>
          )}
          {data.settings.supplyPolicy === "members" && (
            <>
              <section className="rounded-xl border border-card-border bg-card p-5 space-y-3">
                <label className="block text-sm">
                  {t("chainDiscount")}
                  <select
                    className="block mt-2 rounded border border-card-border bg-card p-2"
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
              <h3 className="font-semibold">{t("participation")}</h3>
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
          <p className="text-sm text-muted">{t("supplySafeguards")}</p>
          <GroupSupplyForecast data={data} />
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
        </>
      )}
    </main>
  );
}

function subscribeSection(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
function currentSection() {
  const hash = location.hash.slice(1);
  return ["overview", "financials", "directions", "supply"].includes(hash) ? hash : "overview";
}
