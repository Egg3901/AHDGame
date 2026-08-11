"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ActionType =
  | "request_endorsement"
  | "private_meeting"
  | "boost_favorability"
  | "reduce_favorability"
  | "boost_influence"
  | "reduce_influence";

interface ActionEntry {
  type: ActionType;
  label: string;
  description: string;
  actionCost: number;
  fundCost: number;
  minRelationship: number | null;
  effectBlurb: string;
  enabled: boolean;
  meetsActions: boolean;
  meetsFunds: boolean;
  meetsRelationship: boolean;
  availabilityNote: string | null;
}

interface CandidacyOption {
  id: string;
  label: string;
  electionLabel: string;
  endorsementLikelihood: "likely_accept" | "likely_decline";
  canRequest: boolean;
}

interface PanelState {
  balance: { current: number; funds: number };
  homeCurrency: string;
  currencySymbol: string;
  relationship: { score: number };
  isRetired: boolean;
  actions: ActionEntry[];
  pickerOptions: {
    candidacies: CandidacyOption[];
  };
}

function relationshipBadge(score: number) {
  if (score > 60)
    return { label: "Ally", className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" };
  if (score > 20) {
    return {
      label: "Friendly",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    };
  }
  if (score > -20)
    return { label: "Cordial", className: "border-zinc-700 bg-zinc-800 text-zinc-300" };
  if (score > -50)
    return { label: "Cool", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" };
  return { label: "Hostile", className: "border-red-500/40 bg-red-500/15 text-red-300" };
}

function endorsementLikelihoodChip(likelihood: CandidacyOption["endorsementLikelihood"]) {
  if (likelihood === "likely_accept") {
    return {
      label: "Likely to Accept",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    };
  }
  return {
    label: "Likely to Decline",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  };
}

export function NppCapitalPanel({ nppId, nppName }: { nppId: string; nppName: string }) {
  const router = useRouter();
  const [state, setState] = useState<PanelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState<ActionType | null>(null);
  const [selectedCandidacyId, setSelectedCandidacyId] = useState<string>("");

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/npps/${nppId}/direct-action`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as PanelState;
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nppId]);

  function openPicker(action: ActionEntry) {
    if (!state || !action.enabled) return;
    setMessage(null);
    if (action.type === "request_endorsement") {
      if (state.pickerOptions.candidacies.length === 0) {
        setMessage({
          tone: "err",
          text: "You have no active candidacies for the NPP to endorse.",
        });
        return;
      }
      setSelectedCandidacyId(state.pickerOptions.candidacies[0].id);
      setPickerOpen("request_endorsement");
      return;
    }
    void commit(action.type);
  }

  function closePicker() {
    setPickerOpen(null);
  }

  async function commit(actionType: ActionType, extra: Record<string, string> = {}) {
    if (!state) return;
    setSubmitting(actionType);
    setMessage(null);
    try {
      const res = await fetch(`/api/npps/${nppId}/direct-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionType, ...extra }),
      });
      const data = (await res.json()) as
        | {
            success: true;
            effect: string;
            relationship: { before: number; after: number; delta: number };
            actions: { current: number; spent: number };
            funds: { current: number; spent: number };
            currencySymbol: string;
            homeCurrency: string;
          }
        | { error: string };
      if (!res.ok || "error" in data) {
        setMessage({
          tone: "err",
          text: "error" in data ? data.error : "Action rejected.",
        });
      } else {
        setMessage({
          tone: "ok",
          text: `${data.effect} (${data.actions.spent} actions, ${data.currencySymbol}${data.funds.spent.toLocaleString("en-US")} spent | relationship ${
            data.relationship.delta >= 0 ? "+" : ""
          }${data.relationship.delta})`,
        });
        setPickerOpen(null);
        router.refresh();
        await refresh();
      }
    } finally {
      setSubmitting(null);
    }
  }

  function confirmEndorsement() {
    if (!selectedCandidacyId || !selectedCandidacy?.canRequest) return;
    void commit("request_endorsement", { candidacyId: selectedCandidacyId });
  }

  if (loading || !state) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
        Loading direct interaction...
      </div>
    );
  }

  const badge = relationshipBadge(state.relationship.score);
  const selectedCandidacy =
    pickerOpen === "request_endorsement"
      ? (state.pickerOptions.candidacies.find((c) => c.id === selectedCandidacyId) ?? null)
      : null;
  const selectedCandidacyChip = selectedCandidacy
    ? endorsementLikelihoodChip(selectedCandidacy.endorsementLikelihood)
    : null;

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Direct interaction | {nppName}
          </h2>
          <div className="mt-2 flex items-center gap-3">
            <div>
              <span className="text-xs text-zinc-500">Relationship</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tabular-nums">
                  {state.relationship.score > 0 ? "+" : ""}
                  {state.relationship.score}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>
            </div>
            <div className="ml-4 border-l border-zinc-800 pl-4">
              <span className="text-xs text-zinc-500">Actions</span>
              <div className="text-2xl font-bold tabular-nums">{state.balance.current}</div>
            </div>
            <div className="ml-4 border-l border-zinc-800 pl-4">
              <span className="text-xs text-zinc-500">Campaign Funds</span>
              <div className="text-2xl font-bold tabular-nums">
                {state.currencySymbol}
                {state.balance.funds.toLocaleString("en-US")}
              </div>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-200">
          No RNG - deterministic
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {state.actions.map((action) => {
          const disabled = !action.enabled || submitting === action.type || state.isRetired;
          const reasons: string[] = [];
          if (!action.meetsActions) {
            reasons.push(`Need ${action.actionCost} actions (have ${state.balance.current})`);
          }
          if (!action.meetsFunds) {
            reasons.push(
              `Need ${state.currencySymbol}${action.fundCost.toLocaleString("en-US")} funds (have ${state.currencySymbol}${state.balance.funds.toLocaleString("en-US")})`
            );
          }
          if (!action.meetsRelationship) {
            reasons.push(
              `Need rel >= ${action.minRelationship} (have ${state.relationship.score})`
            );
          }
          if (state.isRetired) reasons.push("NPP retired");
          return (
            <button
              key={action.type}
              type="button"
              disabled={disabled}
              onClick={() => openPicker(action)}
              className={`rounded-lg border bg-zinc-950/60 p-3 text-left transition-colors hover:border-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-800 ${
                pickerOpen === action.type ? "border-cyan-500/60" : "border-zinc-800"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{action.label}</span>
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-cyan-200">
                  {action.actionCost} Actions
                </span>
              </div>
              <p className="mb-2 text-xs leading-snug text-zinc-400">{action.description}</p>
              {action.fundCost > 0 && (
                <p className="mb-2 text-xs text-emerald-300/90">
                  {state.currencySymbol}
                  {action.fundCost.toLocaleString("en-US")} campaign funds
                </p>
              )}
              <p className="text-xs text-emerald-300/90">{action.effectBlurb}</p>
              {action.availabilityNote && (
                <p className="mt-1 text-xs text-cyan-200/80">{action.availabilityNote}</p>
              )}
              {reasons.length > 0 && (
                <p className="mt-1 text-xs text-amber-300/90">{reasons.join(" | ")}</p>
              )}
            </button>
          );
        })}
      </div>

      {pickerOpen === "request_endorsement" && (
        <div className="space-y-3 rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-cyan-200">
              Choose a candidacy for {nppName} to endorse
            </h3>
            <button
              type="button"
              onClick={closePicker}
              className="text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
          <select
            value={selectedCandidacyId}
            onChange={(e) => setSelectedCandidacyId(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            {state.pickerOptions.candidacies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} - {c.electionLabel}
              </option>
            ))}
          </select>
          {selectedCandidacy && selectedCandidacyChip && (
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span
                className={`rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wider ${selectedCandidacyChip.className}`}
              >
                {selectedCandidacyChip.label}
              </span>
              <span>
                This applies only to this active campaign. You will need to ask again in future
                races.
              </span>
            </div>
          )}
          <button
            type="button"
            disabled={
              submitting === "request_endorsement" ||
              !selectedCandidacyId ||
              !selectedCandidacy?.canRequest
            }
            onClick={confirmEndorsement}
            className="rounded-md border border-cyan-500/60 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting === "request_endorsement"
              ? "Requesting..."
              : "Confirm - request endorsement"}
          </button>
        </div>
      )}

      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <p className="text-xs text-zinc-500">
        These interactions spend your normal action pool and, for boost/reduce stat work, your
        campaign funds.
      </p>
    </div>
  );
}
