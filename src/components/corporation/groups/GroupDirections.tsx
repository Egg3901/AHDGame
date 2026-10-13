"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Compass, Pencil } from "lucide-react";
import { CorporationLogo } from "../CorporationLogo";
import type { GroupObjective } from "@/lib/corporations/groups/managementTypes";
import type { GroupManagementView, useGroupManagement } from "./useGroupManagement";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium disabled:opacity-50 enabled:hover:bg-card-elevated focus-visible:outline-2 focus-visible:outline-info";
const objectives: GroupObjective[] = [
  "balanced",
  "profit",
  "capacity",
  "expansion",
  "regional",
  "stability",
];
type Props = {
  data: GroupManagementView;
  busy: boolean;
  save: ReturnType<typeof useGroupManagement>["save"];
};
type Member = GroupManagementView["members"][number];
export function GroupDirections({ data, busy, save }: Props) {
  const t = useTranslations("corporations.group");
  const members = data.members.filter((m) => !m.isRoot && (data.canManage || m.canEdit));
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{t("directionUI.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("directionUI.subtitle")}</p>
      </div>
      <aside className="rounded-lg border border-info/25 bg-info/5 p-4 text-sm">
        <h3 className="font-semibold">{t("directionUI.operatorNote")}</h3>
        <p className="mt-1 text-muted">{t("directionNote")}</p>
      </aside>
      {!data.directionsEnabled && (
        <p className="rounded-lg border border-gold/25 bg-gold/5 p-4 text-sm text-muted">
          {t("directionsPending")}
        </p>
      )}
      {!members.length && <p className="text-sm text-muted">{t("directionUI.empty")}</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {members.map((member) => (
          <DirectionCard
            key={member.id + (member.direction?.revision ?? "")}
            member={member}
            data={data}
            busy={busy}
            save={save}
          />
        ))}
      </div>
      <section className="rounded-xl border border-card-border bg-card p-5">
        <h3 className="font-semibold">{t("directionUI.how")}</h3>
        <div className="mt-4 grid gap-5 md:grid-cols-3">
          {["choose", "guard", "response"].map((step, i) => (
            <div key={step}>
              <span className="text-xs text-gold">0{i + 1}</span>
              <h4 className="mt-1 text-sm font-semibold">{t("directionUI." + step)}</h4>
              <p className="mt-2 text-sm text-muted">{t("directionUI." + step + "Help")}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
function DirectionCard({ member: m, data, busy, save }: Props & { member: Member }) {
  const t = useTranslations("corporations.group");
  const [editing, setEditing] = useState(false);
  const d = m.direction,
    npp = m.operator === "npp";
  const regionNames = new Map(data.regions?.map((r) => [r.id, r.name]));
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start gap-3">
        <CorporationLogo logoUrl={m.logoUrl} name={m.name} size="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {m.tickerSymbol}{" "}
            {m.parentControl
              ? t("directionUI.votingControl", {
                  percent: m.parentControl.votingPercent.toFixed(1),
                })
              : ""}
          </p>
          <h3 className="break-words text-lg font-semibold">{m.name}</h3>
          <span className="text-xs text-muted">
            {npp ? t("nppDirection") : t("playerSuggestion")}
          </span>
        </div>
        <Compass size={18} className="shrink-0 text-gold" aria-hidden="true" />
      </div>
      <div className="border-t border-card-border pt-4">
        <p className="text-xs uppercase tracking-wide text-muted">
          {t(npp ? "directionUI.current" : "directionUI.suggestion")}
        </p>
        <p className="mt-1 font-semibold">
          {d ? t("objectives." + d.objective) : t("noDirection")}
        </p>
        {d && (
          <p className="mt-1 text-sm text-muted">{t("directionUI.descriptions." + d.objective)}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {d?.regions.length ? (
            d.regions.map((id) => (
              <span
                key={id}
                className="max-w-full break-words rounded border border-card-border px-2 py-1 text-xs"
              >
                {regionNames.get(id) ?? id}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted">{t("directionUI.noRegions")}</span>
          )}
        </div>
      </div>
      {d && (
        <div className="space-y-2 rounded-lg bg-background p-3 text-sm" role="status">
          <p className="font-medium">
            {t(npp ? "directionUI.saved" : "directionUI." + d.response)}
          </p>
          <p className="text-xs text-muted">{t("directionUI.setTurn", { turn: d.setTurn })}</p>
          <p className="text-muted">
            {npp
              ? t("nppEffective", { turn: d.setTurn + 1 })
              : t("directionUI." + d.response + "Help")}
          </p>
          {npp && <p>{t(d.allowInvestment ? "investmentAllowed" : "investmentBlocked")}</p>}
          {npp &&
            !d.allowInvestment &&
            ["capacity", "expansion", "regional"].includes(d.objective) && (
              <p className="text-gold">{t("directionUI.growthWarning")}</p>
            )}
        </div>
      )}
      {m.canEdit && d && !npp && (
        <div className="flex flex-wrap gap-2">
          {(["acknowledged", "declined"] as const).map((response) => (
            <button
              className={button}
              key={response}
              disabled={busy || d.response === response}
              onClick={() => void save({ action: "respond", response, revision: d.revision }, m.id)}
            >
              {t(response)}
            </button>
          ))}
        </div>
      )}
      {data.canManage && !editing && (
        <button className={button} disabled={busy} onClick={() => setEditing(true)}>
          <Pencil size={14} aria-hidden="true" />
          {t(npp ? "directionUI.edit" : "directionUI.editSuggestion")}
        </button>
      )}
      {data.canManage && editing && (
        <DirectionEditor
          member={m}
          data={data}
          busy={busy}
          save={save}
          close={() => setEditing(false)}
        />
      )}
    </section>
  );
}
function DirectionEditor({
  member: m,
  data,
  busy,
  save,
  close,
}: Props & { member: Member; close: () => void }) {
  const t = useTranslations("corporations.group"),
    id = useId();
  const [objective, setObjective] = useState<GroupObjective>(m.direction?.objective ?? "balanced");
  const [regions, setRegions] = useState(m.direction?.regions ?? []);
  const [investment, setInvestment] = useState(m.direction?.allowInvestment ?? false);
  const [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const npp = m.operator === "npp";
  const choices = (data.regions ?? []).filter((r) =>
    (r.name + " " + r.countryId).toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  return (
    <form
      className="space-y-4 border-t border-card-border pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (objective === "regional" && !regions.length) {
          setError(t("directionUI.regionRequired"));
          return;
        }
        setError("");
        if (
          await save({
            action: "direction",
            memberId: m.id,
            objective,
            regions,
            allowInvestment: investment,
          })
        )
          close();
        else setError(t("directionUI.failed"));
      }}
    >
      <fieldset className="min-w-0 space-y-4" disabled={busy}>
        <label className="block text-sm">
          {t("objective")}
          <select
            aria-label={t("objective")}
            aria-describedby={id + "-objective"}
            className="mt-1 block w-full rounded border border-card-border bg-background p-2"
            value={objective}
            onChange={(e) => setObjective(e.target.value as GroupObjective)}
          >
            {objectives.map((o) => (
              <option key={o} value={o}>
                {t("objectives." + o)}
              </option>
            ))}
            <optgroup label={t("directionUI.unavailable")}>
              <option disabled value="unavailable-supply">
                {t("directionUI.supplyObjective")}
              </option>
              <option disabled value="unavailable-dividends">
                {t("directionUI.dividendsObjective")}
              </option>
            </optgroup>
          </select>
        </label>
        <p id={id + "-objective"} className="text-sm text-muted">
          {t("directionUI.descriptions." + objective)}
        </p>
        <p className="text-xs text-muted">{t("directionUI.unavailableHelp")}</p>
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">{t("regions")}</legend>
          <p className="text-xs text-muted">{t("directionUI.regionHelp")}</p>
          <input
            type="search"
            aria-label={t("directionUI.search")}
            placeholder={t("directionUI.search")}
            className="w-full rounded border border-card-border bg-background p-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="text-xs text-muted" aria-live="polite">
            {t("directionUI.selected", { count: regions.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            {regions.map((region) => {
              const name = data.regions?.find((r) => r.id === region)?.name ?? region;
              return (
                <button
                  key={region}
                  type="button"
                  className="max-w-full break-words rounded border border-card-border px-2 py-1 text-xs hover:bg-card-elevated"
                  aria-label={t("directionUI.removeRegion", { region: name })}
                  onClick={() => setRegions((prev) => prev.filter((r) => r !== region))}
                >
                  {name} ×
                </button>
              );
            })}
          </div>
          <div className="max-h-48 overflow-y-auto rounded border border-card-border p-2">
            {choices.map((r) => (
              <label key={r.id} className="flex items-start gap-2 p-1 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={regions.includes(r.id)}
                  disabled={!regions.includes(r.id) && regions.length >= 8}
                  onChange={(e) =>
                    setRegions((prev) =>
                      e.target.checked ? [...prev, r.id] : prev.filter((v) => v !== r.id)
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  {r.countryId}: {r.name}
                </span>
              </label>
            ))}
            {!choices.length && <p className="text-sm text-muted">{t("directionUI.noMatches")}</p>}
          </div>
        </fieldset>
        {npp ? (
          <div>
            <label className="flex items-start gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="mt-1"
                checked={investment}
                onChange={(e) => setInvestment(e.target.checked)}
              />
              {t("investment")}
            </label>
            <p className="mt-2 text-xs text-muted">{t("directionUI.investmentHelp")}</p>
          </div>
        ) : (
          <p className="rounded-lg bg-info/5 p-3 text-sm text-muted">
            {t("directionUI.playerHelp")}
          </p>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy}>
          {t(npp ? "saveDirection" : "directionUI.send")}
        </button>
        <button type="button" className={button} disabled={busy} onClick={close}>
          {t("directionUI.cancel")}
        </button>
      </div>
    </form>
  );
}
