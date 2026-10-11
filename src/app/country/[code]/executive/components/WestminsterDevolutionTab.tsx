"use client";
import { useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DevolutionDesireReadout, stanceMessageKey } from "@/components/uk/DevolutionDesireReadout";
import type { IndependenceDesireDriftPerRegion } from "@/lib/governorOffice/devolution/rules";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
  westminsterStanceCooldownRemaining,
  hasInitialWestminsterChange,
  type WestminsterGovernment,
} from "@/lib/governorOffice/devolution/rules";
import type { DevolutionPolicy, GovernorOfficeState } from "@/lib/db/types/governorOfficeState";
type Region = "WAL" | "SCO" | "NIR";
interface Dashboard {
  regions: IndependenceDesireDriftPerRegion[];
  currentTurn: number;
  actions: number;
  canManage: boolean;
  government?: WestminsterGovernment | null;
  stances: NonNullable<GovernorOfficeState["westminsterStances"]>;
}
export function WestminsterDevolutionTab() {
  const t = useTranslations("nav.devolution");
  const [region, setRegion] = useState<Region>("WAL");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftPolicy, setDraftPolicy] = useState<DevolutionPolicy | null>(null);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/country/uk/executive/devolution", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("loadError"));
        const result: Dashboard = await response.json();
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(t("loadError"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, t]);
  const row = data?.regions.find((item) => item.stateId === region);
  const policy = draftPolicy ?? row?.westminsterPolicy ?? "anti";
  const changeContext = {
    ...data?.stances[region],
    government: data?.government,
    currentTurn: data?.currentTurn ?? 0,
  };
  const remaining = westminsterStanceCooldownRemaining(changeContext);
  const initialChange = hasInitialWestminsterChange(changeContext);
  const canSave =
    !!data?.canManage &&
    !!row &&
    remaining === 0 &&
    data.actions >= DEVOLUTION_POLICY_CHANGE_AP_COST &&
    policy !== row.westminsterPolicy &&
    !saving &&
    !loading;
  function selectRegion(id: Region) {
    setRegion(id);
    setDraftPolicy(null);
    if (data) setError(null);
    setSaved(false);
  }
  function navigateRegion(event: KeyboardEvent<HTMLButtonElement>) {
    const ids: Region[] = ["WAL", "SCO", "NIR"];
    const index = ids.indexOf(region);
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % ids.length
        : event.key === "ArrowLeft"
          ? (index + ids.length - 1) % ids.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? ids.length - 1
              : null;
    if (nextIndex === null || saving) return;
    event.preventDefault();
    const next = ids[nextIndex];
    selectRegion(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#devolution-tab-${next}`)
      ?.focus();
  }
  async function save() {
    if (!canSave) return;
    if (
      !window.confirm(
        t("confirm", {
          region: t(region),
          policy: t(stanceMessageKey(region, policy)),
          cost: DEVOLUTION_POLICY_CHANGE_AP_COST,
        })
      )
    )
      return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/country/uk/executive/devolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId: region, policy }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t("saveError"));
      setSaved(true);
      setDraftPolicy(null);
      setLoading(true);
      setReload((value) => value + 1);
    } catch (error) {
      // A failed or lost write response leaves balances and policy uncertain.
      setData(null);
      setError(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label={t("regions")} className="flex gap-2 overflow-x-auto">
        {(["WAL", "SCO", "NIR"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`devolution-tab-${id}`}
            aria-selected={region === id}
            aria-controls="devolution-region-panel"
            disabled={saving}
            tabIndex={region === id ? 0 : -1}
            onKeyDown={navigateRegion}
            onClick={() => selectRegion(id)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm ${region === id ? "bg-primary text-white" : "bg-card text-muted"}`}
          >
            {t(id)}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="text-sm text-error">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setReload((value) => value + 1);
            }}
            className="underline"
          >
            {t("retry")}
          </button>
        </div>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-500">
          {t("saved")}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-sm text-muted">
          {t("loading")}
        </p>
      ) : (
        <div
          role="tabpanel"
          id="devolution-region-panel"
          aria-labelledby={`devolution-tab-${region}`}
          className="space-y-6"
        >
          {row ? (
            <>
              <DevolutionDesireReadout data={row} />
              <section className="space-y-3 rounded-xl border border-card-border bg-card p-6">
                <h2 className="font-semibold">{t("westminsterStance")}</h2>
                <p className="text-sm text-muted">{t("actions", { value: data?.actions ?? 0 })}</p>
                <p className="text-xs text-muted">
                  {t("cost", {
                    cost: DEVOLUTION_POLICY_CHANGE_AP_COST,
                    turns: DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
                  })}
                </p>
                {data?.canManage ? (
                  <>
                    <label className="sr-only" htmlFor="westminster-policy">
                      {t("westminsterStance")}
                    </label>
                    <select
                      id="westminster-policy"
                      value={policy}
                      disabled={saving}
                      onChange={(event) => setDraftPolicy(event.target.value as DevolutionPolicy)}
                      className="w-full rounded-lg border border-card-border bg-background p-2 text-sm"
                    >
                      {(["anti", "pro", "independence"] as const).map((value) => (
                        <option key={value} value={value}>
                          {t(stanceMessageKey(region, value))}
                        </option>
                      ))}
                    </select>
                    {initialChange && <p className="text-xs text-muted">{t("initialChange")}</p>}
                    {remaining > 0 && (
                      <p className="text-xs text-muted">{t("cooldown", { turns: remaining })}</p>
                    )}
                    <button
                      type="button"
                      disabled={!canSave}
                      onClick={save}
                      className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {t(saving ? "saving" : "save")}
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-muted">{t("readOnly")}</p>
                )}
              </section>
              <Link
                href={`/country/uk/region/${region.toLowerCase()}/office`}
                className="text-sm text-primary hover:underline"
              >
                {t("viewOffice")}
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">{t("missing")}</p>
          )}
        </div>
      )}
    </div>
  );
}
