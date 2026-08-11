"use client";

import { useEffect, useState } from "react";
import { STATE_BILL_CATEGORIES, BILL_CATEGORIES } from "@shared/constants/legislation";
import { turnoutTargetLabel } from "@/lib/demographics/turnoutTarget";
import type { TurnoutTargetSection } from "@/lib/demographics/turnoutTargets";
import {
  ADDRESS_EMPHASIS_MIN,
  ADDRESS_EMPHASIS_MAX,
  ADDRESS_ACTION_COST,
  ADDRESS_NPI_COST,
  ADDRESS_APPROVAL_BUMP,
  ADDRESS_APPROVAL_DURATION_TURNS,
  ADDRESS_AGENDA_DURATION_TURNS,
  ADDRESS_DEMOGRAPHIC_DELTA,
  ADDRESS_DEMOGRAPHIC_DURATION_TURNS,
  ADDRESS_TITLE_MIN_LENGTH,
  ADDRESS_TITLE_MAX_LENGTH,
  ADDRESS_BODY_MAX_LENGTH,
} from "@/lib/constants/governorOffice";
import {
  COUNTRY_CONFIGS,
  getNationalAddressName,
  getRegionalAddressName,
  type CountryId,
} from "@/lib/constants/countries";

interface Props {
  open: boolean;
  countryId: string;
  stateId: string;
  /** Current Office AP balance. Drives affordability gating + display. */
  gubernatorialActions: number;
  onClose: () => void;
  onSuccess: () => void;
  /** Defaults to "state". When "national", targets the country leader's office. */
  scope?: "state" | "national";
  /** When true: cost waived, title shows "(Admin)", submit button is red,
   *  POST includes adminOverride flag. Admin must already be verified server-side. */
  adminOverride?: boolean;
}

export function DeliverAddressModal({
  open,
  countryId,
  stateId,
  gubernatorialActions,
  onClose,
  onSuccess,
  scope = "state",
  adminOverride = false,
}: Props) {
  const isNational = scope === "national";
  const cid = countryId.toUpperCase() as CountryId;
  // Targets are Layer-1 buckets, not voter archetypes, and the bucket set is
  // country- and era-specific (US has race/wealth, everyone else has
  // ethnicity/income/urbanization, with different keys inside each). So the list
  // is served rather than hardcoded — a fixed list would offer buckets a country
  // does not have, and the boost would be charged and land on nobody, which is
  // what archetype targeting already did outside the US.
  const [targetSections, setTargetSections] = useState<TurnoutTargetSection[]>([]);
  const countryConfig = COUNTRY_CONFIGS[cid];
  const countryName = countryConfig?.name ?? countryId;
  const headingBase = isNational ? getNationalAddressName(cid) : getRegionalAddressName(cid);
  const headingLabel = adminOverride ? `${headingBase} (Admin)` : headingBase;
  // Federal bills use the full BILL_CATEGORIES catalog; state bills use the
  // state subset so national addresses don't surface state-only categories.
  // "custom" is a bill-only flavor category; it has no meaning as an address topic.
  const categoryList = (isNational ? BILL_CATEGORIES : STATE_BILL_CATEGORIES).filter(
    (c) => c !== "custom"
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nationalInfluence, setNationalInfluence] = useState<number | null>(null);

  // Fetch the character's NPI balance so the modal can show + gate it.
  useEffect(() => {
    if (!open) return;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setNationalInfluence(data?.user?.character?.nationalInfluence ?? null);
      })
      .catch(() => setNationalInfluence(null));
  }, [open]);

  // Targeting is optional, so a failed fetch degrades to "no targeting offered"
  // rather than blocking the address.
  useEffect(() => {
    if (!open) return;
    fetch(`/api/country/${countryId.toLowerCase()}/turnout-targets`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setTargetSections(data?.sections ?? []))
      .catch(() => setTargetSections([]));
  }, [open, countryId]);

  if (!open) return null;

  function toggleCategory(c: string) {
    setSelectedCategories((cur) =>
      cur.includes(c)
        ? cur.filter((x) => x !== c)
        : cur.length < ADDRESS_EMPHASIS_MAX
          ? [...cur, c]
          : cur
    );
  }

  const titleLen = title.trim().length;
  const titleValid = titleLen >= ADDRESS_TITLE_MIN_LENGTH && titleLen <= ADDRESS_TITLE_MAX_LENGTH;
  const canAffordAp = adminOverride || gubernatorialActions >= ADDRESS_ACTION_COST;
  const canAffordNpi =
    adminOverride || nationalInfluence === null || nationalInfluence >= ADDRESS_NPI_COST;
  const canAfford = canAffordAp && canAffordNpi;
  const canSubmit =
    titleValid &&
    selectedCategories.length >= ADDRESS_EMPHASIS_MIN &&
    body.length <= ADDRESS_BODY_MAX_LENGTH &&
    canAfford &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const endpoint = isNational
      ? `/api/country/${countryId.toLowerCase()}/executive/address`
      : `/api/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/office/address`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        emphasizedCategories: selectedCategories,
        ...(groupId ? { targetDemographicGroupId: groupId } : {}),
        ...(adminOverride ? { adminOverride: true } : {}),
      }),
    });
    if (res.ok) onSuccess();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Failed to deliver.");
      setSubmitting(false);
    }
  }

  // Prefer the served label — it is the country's own copy for that bucket.
  const groupName = groupId
    ? (targetSections.flatMap((s) => s.options).find((o) => o.id === groupId)?.label ??
      turnoutTargetLabel(groupId, cid))
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deliver-address-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-card-border bg-card p-6 shadow-modal max-h-[90vh] overflow-y-auto">
        <h2 id="deliver-address-title" className="text-lg font-semibold mb-1">
          Deliver {headingLabel}
        </h2>
        <p className="text-xs text-muted mb-4">
          {isNational
            ? `Lay out your priorities. Bumps national approval, nudges co-partisan legislators on emphasized categories of federal bills, and (optionally) rallies a demographic group's turnout in every ${countryName} state.`
            : "Lay out your priorities. Bumps your approval, nudges co-partisan legislators on emphasized categories, and (optionally) rallies a demographic group's turnout."}
        </p>

        <label className="block text-xs text-muted mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. A New Chapter for Arizona"
          maxLength={ADDRESS_TITLE_MAX_LENGTH}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-1"
          disabled={submitting}
        />
        <div className="mb-3 flex justify-between text-[11px] text-muted">
          <span>
            {titleLen < ADDRESS_TITLE_MIN_LENGTH
              ? `Minimum ${ADDRESS_TITLE_MIN_LENGTH} characters`
              : "Ready"}
          </span>
          <span>
            {titleLen}/{ADDRESS_TITLE_MAX_LENGTH}
          </span>
        </div>

        <label className="block text-xs text-muted mb-1">Speech (optional)</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="My fellow Arizonans, today we stand at a crossroads…"
          rows={5}
          maxLength={ADDRESS_BODY_MAX_LENGTH}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-1"
          disabled={submitting}
        />
        <div className="mb-3 flex justify-end text-[11px] text-muted">
          <span>
            {body.length}/{ADDRESS_BODY_MAX_LENGTH}
          </span>
        </div>

        <label className="block text-xs text-muted mb-1">
          Emphasis categories ({ADDRESS_EMPHASIS_MIN}-{ADDRESS_EMPHASIS_MAX})
        </label>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-card-border p-2 sm:grid-cols-3">
          {categoryList.map((c) => {
            const checked = selectedCategories.includes(c);
            const reachedCap = !checked && selectedCategories.length >= ADDRESS_EMPHASIS_MAX;
            return (
              <label
                key={c}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-background/40 ${
                  reachedCap ? "opacity-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(c)}
                  disabled={submitting || reachedCap}
                />
                <span className="capitalize">{c}</span>
              </label>
            );
          })}
        </div>

        {/* Hidden entirely when this country has no Layer-1 substrate — an empty
            picker would imply targeting is available when it is not. */}
        {targetSections.length > 0 && (
          <>
            <label className="block text-xs text-muted mb-1">Target demographic (optional)</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
              disabled={submitting}
            >
              <option value="">— No targeting —</option>
              {targetSections.map((section) => (
                <optgroup key={section.dim} label={section.dimLabel}>
                  {section.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </>
        )}

        {/* Effects preview */}
        <div className="mb-3 rounded-lg border border-card-border bg-background/40 px-3 py-2 text-xs">
          <div className="font-semibold text-muted uppercase tracking-wider text-[10px] mb-1">
            Effects
          </div>
          <ul className="space-y-0.5">
            <li>
              <span className="text-foreground">Approval</span>{" "}
              <span className="text-muted">
                +{ADDRESS_APPROVAL_BUMP} {isNational ? "national" : "in this state"} for{" "}
                {ADDRESS_APPROVAL_DURATION_TURNS} turns
              </span>
            </li>
            <li>
              <span className="text-foreground">Agenda bonus</span>{" "}
              <span className="text-muted">
                {selectedCategories.length > 0
                  ? `for ${ADDRESS_AGENDA_DURATION_TURNS} turns on ${selectedCategories.length} ${selectedCategories.length === 1 ? "category" : "categories"} (${isNational ? "federal bills" : "state bills"})`
                  : "— pick at least one category"}
              </span>
            </li>
            <li>
              <span className="text-foreground">Turnout boost</span>{" "}
              <span className="text-muted">
                {groupName
                  ? `+${ADDRESS_DEMOGRAPHIC_DELTA} for ${groupName} ${isNational ? `in every ${countryName} state` : ""} (${ADDRESS_DEMOGRAPHIC_DURATION_TURNS} turns)`
                  : "— optional, pick a demographic"}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-xs text-muted mb-3">
          {adminOverride ? (
            <span className="font-semibold text-error">Cost waived (Admin override)</span>
          ) : (
            <>
              <span>
                Cost: {ADDRESS_ACTION_COST} office AP + {ADDRESS_NPI_COST} NPI
              </span>
              <span className="block mt-0.5">
                Balance: {gubernatorialActions} office AP, {nationalInfluence?.toFixed(0) ?? "?"}{" "}
                NPI
              </span>
              {!canAffordAp && (
                <span className="block mt-1 text-error">
                  Not enough office AP ({gubernatorialActions}/{ADDRESS_ACTION_COST}).
                </span>
              )}
              {!canAffordNpi && (
                <span className="block mt-1 text-error">
                  Not enough national political influence ({nationalInfluence?.toFixed(0) ?? 0}/
                  {ADDRESS_NPI_COST}).
                </span>
              )}
            </>
          )}
        </div>

        {error && <p className="mb-3 text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-background/60"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              adminOverride ? "bg-error hover:bg-error/80" : "bg-primary hover:bg-primary/80"
            }`}
          >
            {submitting ? "Delivering…" : "Deliver"}
          </button>
        </div>
      </div>
    </div>
  );
}
