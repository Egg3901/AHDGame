"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CorporationLogo } from "../CorporationLogo";
import { GroupOverviewCard } from "../GroupOverviewCard";
import { GroupSupplyForecast } from "./GroupSupplyForecast";
import { GroupParticipation } from "./GroupParticipation";
import { useGroupManagement } from "./useGroupManagement";
import { combineGroupLatest } from "@/lib/corporations/groups/rules/financialHistory";
import type { GroupObjective } from "@/lib/corporations/groups/managementTypes";
interface SheetMember {
  corporationId: string;
  name: string;
  revenueAnchor: number;
  liquidCapitalAnchor: number;
  sectorCount: number;
}
interface Sheet {
  members: SheetMember[];
  totalRevenueAnchor: number;
  totalLiquidCapitalAnchor: number;
  totalSectorCount: number;
}
const button = "rounded border border-border px-3 py-2 text-sm disabled:opacity-50 hover:bg-panel";
const objectives: GroupObjective[] = [
  "balanced",
  "profit",
  "capacity",
  "expansion",
  "regional",
  "stability",
];
export function SubsidiaryGroupPage({ corpId }: { corpId: string }) {
  const t = useTranslations("corporations.group"),
    { formatAmount } = useCurrency();
  const { data, loading, error, busy, save, refresh } = useGroupManagement(corpId);
  const section = useSyncExternalStore(subscribeSection, currentSection, () => "overview");
  const [sheet, setSheet] = useState<Sheet | null>(null),
    [sheetError, setSheetError] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null),
    [name, setName] = useState<string | null>(null),
    [uploading, setUploading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/corporations/" + corpId + "/group", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(t("loadFailed"));
        const payload = await res.json();
        setSheetError("");
        setSheet(payload.group);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSheetError(e.message);
      });
    return () => controller.abort();
  }, [corpId, t]);
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
  const chosen = selected ?? data.members.map((m) => m.id),
    rows = (sheet?.members ?? []).filter((m) => chosen.includes(m.corporationId));
  const completed = combineGroupLatest(
    data.members.filter((m) => chosen.includes(m.id)).map((m) => m.history?.[0])
  );
  const totals = rows.reduce(
    (a, m) => ({
      revenue: a.revenue + m.revenueAnchor,
      cash: a.cash + m.liquidCapitalAnchor,
      sectors: a.sectors + m.sectorCount,
    }),
    { revenue: 0, cash: 0, sectors: 0 }
  );
  function exportCsv() {
    const lines = [
      [t("member"), t("revenue"), t("cash"), t("sectors")],
      ...rows.map((m) => [m.name, m.revenueAnchor, m.liquidCapitalAnchor, m.sectorCount]),
    ];
    const blob = new Blob(
      [
        "\uFEFF" +
          lines
            .map((row) =>
              row
                .map(
                  (v) =>
                    '"' +
                    (typeof v === "string" && /^[=+@\-\t\r]/.test(v)
                      ? String.fromCharCode(39) + v
                      : String(v)
                    ).replace(/"/g, '""') +
                    '"'
                )
                .join(",")
            )
            .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "subsidiary-group.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
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
    <main className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      <nav aria-label={t("breadcrumb")} className="text-sm text-muted">
        <Link href={"/corporation/" + data.rootId}>{t("parentCorporation")}</Link> / {t("title")}
      </nav>
      <header className="flex items-center gap-4">
        <CorporationLogo
          logoUrl={data.settings.logoUrl}
          name={data.settings.name}
          size="h-16 w-16"
        />
        <div>
          <p className="text-xs uppercase text-muted">{t("title")}</p>
          <h1 className="text-2xl font-bold">{data.settings.name}</h1>
          <p className="text-sm text-muted">{t("memberCount", { count: data.members.length })}</p>
        </div>
      </header>
      {(error || sheetError) && (
        <p role="alert" className="text-sm text-red-400">
          {error || sheetError}
        </p>
      )}
      <nav
        aria-label={t("sections")}
        className="flex gap-2 overflow-x-auto border-b border-border pb-3"
      >
        {["overview", "financials", "directions", "supply"].map((key) => (
          <button
            key={key}
            className={button}
            aria-pressed={section === key}
            onClick={() => {
              history.replaceState(null, "", "#" + key);
              window.dispatchEvent(new HashChangeEvent("hashchange"));
            }}
          >
            {t(key)}
          </button>
        ))}
      </nav>
      {section === "overview" && (
        <>
          {data.canManage && (
            <section className="rounded border border-border p-4 space-y-3">
              <h2 className="font-semibold">{t("identity")}</h2>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({ action: "identity", name: name ?? data.settings.name }).then((ok) => {
                    if (ok) setName(null);
                  });
                }}
              >
                <label className="text-sm">
                  {t("groupName")}
                  <input
                    className="ml-2 rounded border border-border bg-panel p-2"
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
                  className="block mt-2 text-xs"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={uploading || busy}
                  onChange={(e) => void uploadLogo(e.target.files?.[0])}
                />
              </label>
            </section>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.members.map((m) => (
              <article className="rounded border border-border p-4 space-y-2" key={m.id}>
                <CorporationLogo logoUrl={m.logoUrl} name={m.name} />
                <h2 className="font-semibold">{m.name}</h2>
                <p className="text-xs text-muted">
                  {m.operator === "npp" ? t("npp") : t("player")}
                </p>
                <Link className="text-sm underline" href={"/corporation/" + m.pathId}>
                  {t("viewCorporation")}
                </Link>
              </article>
            ))}
          </div>
          <GroupOverviewCard corpId={corpId} />
        </>
      )}
      {section === "financials" && (
        <>
          <p className="text-sm text-muted">{t("combinedNote")}</p>
          <div className="flex flex-wrap gap-3">
            {data.members.map((m) => (
              <label className="text-sm flex items-center gap-2" key={m.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...chosen, m.id] : chosen.filter((id) => id !== m.id)
                    )
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className={button} onClick={() => setSelected(data.members.map((m) => m.id))}>
              {t("selectAll")}
            </button>
            <button className={button} onClick={() => setSelected([])}>
              {t("clear")}
            </button>
            <button className={button} disabled={!rows.length} onClick={exportCsv}>
              {t("export")}
            </button>
          </div>
          <section className="space-y-3">
            <h2 className="font-semibold">{t("realized")}</h2>
            <p className="text-xs text-muted">{t("historyNote")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {["member", "turn", "turnRevenue", "turnCosts", "turnIncome"].map((k) => (
                      <th key={k} className="p-3 text-left">
                        {t(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.members
                    .filter((m) => chosen.includes(m.id))
                    .map((m) => {
                      const latest = m.history?.[0];
                      return (
                        <tr key={m.id} className="border-t border-border">
                          <td className="p-3">{m.name}</td>
                          <td>{latest?.turn ?? t("unavailable")}</td>
                          <td>
                            {latest
                              ? formatAmount(latest.revenue)
                              : m.history === null
                                ? t("private")
                                : t("unavailable")}
                          </td>
                          <td>{latest ? formatAmount(latest.costs) : t("unavailable")}</td>
                          <td>{latest ? formatAmount(latest.income) : t("unavailable")}</td>
                        </tr>
                      );
                    })}
                </tbody>
                {completed && (
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="p-3">{t("selectedTotal")}</td>
                      <td>{completed.turn}</td>
                      <td>{formatAmount(completed.revenue)}</td>
                      <td>{formatAmount(completed.costs)}</td>
                      <td>{formatAmount(completed.income)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["member", "revenue", "cash", "sectors"].map((k) => (
                    <th className="p-3 text-left" key={k}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.corporationId} className="border-t border-border">
                    <td className="p-3">{m.name}</td>
                    <td>{formatAmount(m.revenueAnchor)}</td>
                    <td>{formatAmount(m.liquidCapitalAnchor)}</td>
                    <td>{m.sectorCount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="p-3">{t("selectedTotal")}</td>
                  <td>{formatAmount(totals.revenue)}</td>
                  <td>{formatAmount(totals.cash)}</td>
                  <td>{totals.sectors}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {section === "directions" && (
        <>
          <p className="text-sm text-muted">{t("directionNote")}</p>
          {!data.supplyEngineEnabled && (
            <p className="rounded border border-border p-3 text-sm text-muted">
              {t("directionsPending")}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {data.members
              .filter((m) => !m.isRoot && (data.canManage || m.canEdit))
              .map((m) => (
                <section key={m.id} className="rounded border border-border p-4 space-y-3">
                  <h2 className="font-semibold">{m.name}</h2>
                  <p className="text-xs text-muted">
                    {m.operator === "npp" ? t("nppDirection") : t("playerSuggestion")}
                  </p>
                  {data.canManage ? (
                    <form
                      className="space-y-3"
                      key={m.direction?.revision ?? m.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        void save({
                          action: "direction",
                          memberId: m.id,
                          objective: form.get("objective") as GroupObjective,
                          regions: form.getAll("regions").map(String),
                          allowInvestment: form.get("investment") === "on",
                        });
                      }}
                    >
                      <label className="block text-sm">
                        {t("objective")}
                        <select
                          className="block mt-1 rounded bg-panel border border-border p-2 w-full"
                          name="objective"
                          defaultValue={m.direction?.objective ?? "balanced"}
                        >
                          {objectives.map((o) => (
                            <option key={o} value={o}>
                              {t("objectives." + o)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        {t("regions")}
                        <select
                          multiple
                          className="block mt-1 rounded bg-panel border border-border p-2 w-full"
                          name="regions"
                          defaultValue={m.direction?.regions ?? []}
                        >
                          {data.regions?.map((region) => (
                            <option key={region.id} value={region.id}>
                              {region.countryId}: {region.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex gap-2 text-sm">
                        <input
                          name="investment"
                          type="checkbox"
                          defaultChecked={m.direction?.allowInvestment ?? false}
                        />
                        {t("investment")}
                      </label>
                      <button className={button} disabled={busy}>
                        {t("saveDirection")}
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm">
                      {m.direction ? t("objectives." + m.direction.objective) : t("noDirection")}
                    </p>
                  )}
                  {m.direction && (
                    <p className="text-xs text-muted">
                      {m.operator === "npp"
                        ? t("nppEffective", { turn: m.direction.setTurn + 1 })
                        : t("response", { response: m.direction.response })}
                    </p>
                  )}
                  {m.canEdit && m.direction && (
                    <div className="flex gap-2">
                      {(["acknowledged", "declined"] as const).map((response) => (
                        <button
                          className={button}
                          disabled={busy}
                          key={response}
                          onClick={() =>
                            void save(
                              { action: "respond", response, revision: m.direction!.revision },
                              m.id
                            )
                          }
                        >
                          {t(response)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ))}
          </div>
        </>
      )}
      {section === "supply" && (
        <>
          <div className="space-y-3">
            <h2 className="text-xl font-semibold">{t("supplyTitle")}</h2>
            <p className="text-sm text-muted">{t("marketPrice")}</p>
            <div className="flex flex-wrap gap-3">
              {(["independent", "members"] as const).map((policy) => (
                <button
                  className={button}
                  key={policy}
                  disabled={busy || !data.canManage}
                  aria-pressed={data.settings.supplyPolicy === policy}
                  onClick={() => void save({ action: "policy", policy })}
                >
                  {t("policies." + policy)}
                </button>
              ))}
            </div>
          </div>
          {!data.supplyEngineEnabled && (
            <p className="rounded border border-border p-3 text-sm text-muted">
              {t("enginePending")}
            </p>
          )}
          {data.settings.supplyPolicy === "members" && (
            <>
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
