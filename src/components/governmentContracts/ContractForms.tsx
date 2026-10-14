"use client";
import { CONTRACT_OFFER_EXPIRY_TURNS } from "@/lib/constants/prospecting";
import { GRADE_PRICE_SCALE } from "@/lib/military/defenceLotEconomics";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ContractType, TenderView } from "@/lib/governmentContracts/types";
import { apiErrorText } from "@/lib/errors/catalog";
export interface ContractAccess {
  currentTurn: number;
  defenceAnchorPrice?: number | null;
  maximumGrade?: number;
  uncommittedAppropriation?: number | null;
  defence: boolean;
  nationalExtraction: boolean;
  regionalExtraction: boolean;
  extractionEnabled: boolean;
  window: { endTurn: number };
  states: { stateId: string; resources: string[] }[];
  corporations: {
    _id: string;
    name: string;
    countryId: string;
    type: string;
    sectors: { _id: string; stateId: string; type: string; strategyId: string }[];
  }[];
}
export const inputClass =
  "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm";
export const buttonClass =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
export async function contractPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiErrorText(data, "The contract action could not be completed."));
  return data;
}
export function PublishTenderForm({
  countryId,
  access,
  initialType,
  onDone,
}: {
  countryId: string;
  access: ContractAccess;
  initialType?: ContractType;
  onDone: (type?: ContractType) => void;
}) {
  const t = useTranslations("corporations.governmentContracts");
  const [type, setType] = useState<ContractType>(
    initialType === "defence" && access.defence
      ? "defence"
      : initialType === "extraction" &&
          access.extractionEnabled &&
          (access.nationalExtraction || access.regionalExtraction)
        ? "extraction"
        : access.defence
          ? "defence"
          : "extraction"
  );
  const [grade, setGrade] = useState(0);
  const defenceWindowAvailable = access.currentTurn + 2 <= access.window.endTurn + 1;
  const [stateId, setStateId] = useState(access.states[0]?.stateId ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const resources = access.states.find((s) => s.stateId === stateId)?.resources ?? [];
  if (
    !access.defence &&
    !(access.extractionEnabled && (access.nationalExtraction || access.regionalExtraction))
  )
    return (
      <p role="alert" className="text-sm text-muted">
        {t("notAuthorized")}
      </p>
    );
  return (
    <form
      className="space-y-4 rounded-xl border border-card-border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(e.currentTarget);
        const n = (key: string) => Number(form.get(key));
        try {
          await contractPost(`/api/country/${countryId}/government-contracts`, {
            title: form.get("title"),
            description: form.get("description"),
            closesTurn: n("closesTurn"),
            awardDeadlineTurn: n("awardDeadlineTurn"),
            terms:
              type === "defence"
                ? {
                    type,
                    component: form.get("component"),
                    lots: n("lots"),
                    grade: n("grade"),
                    maximumPricePerLot: n("maximumPricePerLot"),
                  }
                : {
                    type,
                    stateId,
                    resource: form.get("resource"),
                    share: n("share") / 100,
                    termTurns: n("termTurns"),
                    royaltyRatePerTurn: n("royalty") / 100,
                    minimumSigningFeeAnchor: n("minimumSigningFeeAnchor"),
                  },
          });
          onDone(type);
        } catch (e) {
          setError(e instanceof Error ? e.message : t("actionFailed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">{t("publish")}</h2>
      <p className="text-sm text-muted">{t("publishExplanation")}</p>
      <label className="block text-sm">
        {t("type")}
        <select
          className={inputClass}
          value={type}
          onChange={(e) => setType(e.target.value as ContractType)}
        >
          {access.defence && <option value="defence">{t("types.defence")}</option>}
          {(access.nationalExtraction || access.regionalExtraction) && access.extractionEnabled && (
            <option value="extraction">{t("types.extraction")}</option>
          )}
        </select>
      </label>
      <label className="block text-sm">
        {t("titleLabel")}
        <input required name="title" minLength={5} maxLength={120} className={inputClass} />
      </label>
      <label className="block text-sm">
        {t("descriptionLabel")}
        <textarea
          required
          name="description"
          minLength={10}
          maxLength={2000}
          className={inputClass}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          {t("closesTurn")}
          <input
            required
            type="number"
            name="closesTurn"
            min={access.currentTurn + 1}
            max={access.currentTurn + CONTRACT_OFFER_EXPIRY_TURNS - 1}
            key={type}
            defaultValue={
              type === "defence"
                ? Math.min(access.currentTurn + 2, access.window.endTurn)
                : access.currentTurn + 2
            }
            className={inputClass}
          />
        </label>
        <label className="text-sm">
          {t("awardDeadline")}
          <input
            required
            type="number"
            key={type}
            name="awardDeadlineTurn"
            min={access.currentTurn + 2}
            max={
              type === "defence"
                ? Math.min(
                    access.window.endTurn + 1,
                    access.currentTurn + CONTRACT_OFFER_EXPIRY_TURNS
                  )
                : access.currentTurn + CONTRACT_OFFER_EXPIRY_TURNS
            }
            defaultValue={
              type === "defence"
                ? Math.min(access.currentTurn + 4, access.window.endTurn + 1)
                : access.currentTurn + 4
            }
            className={inputClass}
          />
        </label>
      </div>
      {type === "defence" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            {t("component")}
            <select name="component" className={inputClass}>
              {["ground", "naval", "air", "rocket", "space", "marine"].map((d) => (
                <option key={d} value={d}>
                  {t(`domains.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("grade")}
            <select
              name="grade"
              className={inputClass}
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((g) => (
                <option key={g} value={g} disabled={g > (access.maximumGrade ?? 3)}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("lots")}
            <input
              required
              type="number"
              name="lots"
              min={1}
              max={1000000}
              defaultValue={1}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            {t("maximumPrice")}
            <input
              required
              type="number"
              key={grade}
              name="maximumPricePerLot"
              defaultValue={
                access.defenceAnchorPrice
                  ? Math.round(
                      access.defenceAnchorPrice * GRADE_PRICE_SCALE[grade as 0 | 1 | 2 | 3]
                    )
                  : undefined
              }
              min={1}
              step={1}
              className={inputClass}
            />
          </label>
          <p className="text-sm text-muted sm:col-span-2">{t("defenceReservation")}</p>
          {access.uncommittedAppropriation != null && (
            <p className="text-sm text-muted sm:col-span-2">
              {t("fundingReference", { amount: access.uncommittedAppropriation })}
            </p>
          )}
          {!defenceWindowAvailable && (
            <p role="status" className="text-sm text-warning sm:col-span-2">
              {t("windowTooLate", { turn: access.window.endTurn + 1 })}
            </p>
          )}
        </fieldset>
      ) : (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            {t("state")}
            <select
              required
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              className={inputClass}
            >
              {access.states.map((s) => (
                <option key={s.stateId}>{s.stateId}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("resource")}
            <select required key={stateId} name="resource" className={inputClass}>
              {resources.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("share")}
            <input
              required
              type="number"
              name="share"
              min={1}
              max={75}
              step={0.01}
              defaultValue={10}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            {t("term")}
            <input
              required
              type="number"
              name="termTurns"
              min={24}
              max={480}
              defaultValue={48}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            {t("royalty")}
            <input
              required
              type="number"
              name="royalty"
              min={0}
              max={2}
              step={0.01}
              defaultValue={1}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            {t("minimumFee")}
            <input
              required
              type="number"
              name="minimumSigningFeeAnchor"
              min={0}
              step={1}
              defaultValue={0}
              className={inputClass}
            />
          </label>
          <p className="text-sm text-muted sm:col-span-2">{t("extractionReservation")}</p>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <button
        className={buttonClass}
        disabled={busy || (type === "defence" && !defenceWindowAvailable)}
      >
        {t("publish")}
      </button>
    </form>
  );
}
export function BidForm({
  countryId,
  tender,
  access,
  onDone,
}: {
  countryId: string;
  tender: TenderView;
  access: ContractAccess;
  onDone: () => void;
}) {
  const t = useTranslations("corporations.governmentContracts");
  const eligible = access.corporations.filter((c) =>
    tender.terms.type === "defence"
      ? c.countryId === tender.countryId && c.sectors.some((s) => s.type === "defense")
      : c.type === "extraction" &&
        c.sectors.some(
          (s) => s.stateId === (tender.terms.type === "extraction" ? tender.terms.stateId : "")
        )
  );
  const [corporationId, setCorporationId] = useState(eligible[0]?._id ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const corp = eligible.find((c) => c._id === corporationId);
  const prior = tender.bids.find((b) => b.corporationId === corporationId);
  if (!eligible.length) return <p className="text-sm text-muted">{t("noEligibleCorporation")}</p>;
  async function submit(form: FormData, withdraw = false) {
    setBusy(true);
    setError("");
    try {
      await contractPost(`/api/country/${countryId}/government-contracts/${tender._id}/bids`, {
        corporationId,
        amount: withdraw ? (prior?.amount ?? 0) : Number(form.get("amount")),
        sectorId: withdraw ? prior?.sectorId : form.get("sectorId") || undefined,
        expectedRevision: prior?.revision ?? 0,
        withdraw,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-3 rounded-lg border border-card-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
    >
      <h3 className="font-semibold">{t("yourBid")}</h3>
      <p className="text-sm text-muted">{t("bindingBid")}</p>
      <label className="block text-sm">
        {t("corporation")}
        <select
          className={inputClass}
          value={corporationId}
          onChange={(e) => setCorporationId(e.target.value)}
        >
          {eligible.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {tender.terms.type === "defence" && (
        <label className="block text-sm">
          {t("plant")}
          <select
            required
            key={corporationId}
            name="sectorId"
            className={inputClass}
            defaultValue={prior?.sectorId}
          >
            {corp?.sectors
              .filter((s) => s.type === "defense")
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {s.stateId} / {s.strategyId}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="block text-sm">
        {tender.terms.type === "defence" ? t("pricePerLot") : t("signingFee")}
        <input
          required
          key={corporationId}
          type="number"
          name="amount"
          min={tender.terms.type === "defence" ? 1 : tender.terms.minimumSigningFeeAnchor}
          max={tender.terms.type === "defence" ? tender.terms.maximumPricePerLot : undefined}
          step={1}
          defaultValue={prior?.amount}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className={buttonClass}>
          {prior && !prior.withdrawn ? t("reviseBid") : t("submitBid")}
        </button>
        {prior && !prior.withdrawn && (
          <button
            type="button"
            disabled={busy}
            className="text-sm text-error"
            onClick={() => void submit(new FormData(), true)}
          >
            {t("withdrawBid")}
          </button>
        )}
      </div>
    </form>
  );
}
