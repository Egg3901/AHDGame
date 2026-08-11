"use client";

import { useReducer, useCallback } from "react";
import { Input } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";

interface ContributionsSectionProps {
  campaign: CampaignData;
  /** Logged-in user's available campaign funds in stored home/local currency. */
  myCampaignFunds: number | null;
  myCampaignFundsCurrency: CurrencyCode | null;
  /** Refetch the campaign after a successful contribution. */
  onContribute: () => void;
  /** Refetch /me so the campaign-funds badge in the navbar updates. */
  onUserRefresh?: () => void;
}

type SourceKey = "personal" | "treasury";

interface FormState {
  personalAmount: string;
  treasuryAmount: string;
  submitting: SourceKey | null;
  msg: string;
  msgKind: "ok" | "err" | "";
}

type FormAction =
  | { type: "SET_AMOUNT"; source: SourceKey; value: string }
  | { type: "SET_SUBMITTING"; source: SourceKey | null }
  | { type: "RESET"; source: SourceKey }
  | { type: "MSG"; kind: "ok" | "err"; text: string };

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_AMOUNT":
      return action.source === "personal"
        ? { ...state, personalAmount: action.value }
        : { ...state, treasuryAmount: action.value };
    case "SET_SUBMITTING":
      return { ...state, submitting: action.source };
    case "RESET":
      return action.source === "personal"
        ? { ...state, personalAmount: "" }
        : { ...state, treasuryAmount: "" };
    case "MSG":
      return { ...state, msg: action.text, msgKind: action.kind };
    default:
      return state;
  }
}

const ROLE_LABEL = {
  chair: "Chair",
  viceChair: "Vice Chair",
  treasurer: "Treasurer",
} as const;

export function ContributionsSection({
  campaign,
  myCampaignFunds,
  myCampaignFundsCurrency,
  onContribute,
  onUserRefresh,
}: ContributionsSectionProps) {
  const { formatAmount, formatFull, toInternal } = useCurrency();
  const { showToast } = useToast();
  const [state, dispatch] = useReducer(reducer, {
    personalAmount: "",
    treasuryAmount: "",
    submitting: null,
    msg: "",
    msgKind: "",
  });

  const isOwner = campaign.accessLevel === "owner";
  const treasuryAccess = campaign.partyTreasuryAccess;

  const submit = useCallback(
    async (source: SourceKey, amountInput: string, partyId?: number) => {
      const display = parseMoneyAmountInput(amountInput);
      if (!Number.isFinite(display) || display <= 0) {
        dispatch({ type: "MSG", kind: "err", text: "Enter a valid amount" });
        return;
      }
      const amount = Math.round(toInternal(display));
      if (amount < 1000) {
        dispatch({
          type: "MSG",
          kind: "err",
          text: `Minimum contribution is ${formatFull(1000)}`,
        });
        return;
      }
      dispatch({ type: "SET_SUBMITTING", source });
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}/donate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            partyId !== undefined ? { amount, partyId: String(partyId) } : { amount }
          ),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          dispatch({ type: "MSG", kind: "err", text: data.error ?? "Contribution failed" });
          showToast(data.error ?? "Contribution failed", "error");
          return;
        }
        dispatch({ type: "RESET", source });
        dispatch({
          type: "MSG",
          kind: "ok",
          text:
            source === "personal"
              ? `Contributed ${formatAmount(amount)} from your campaign funds`
              : `Contributed ${formatAmount(amount)} from ${treasuryAccess?.partyName ?? "the party"} treasury`,
        });
        showToast("Contribution sent", "success");
        onContribute();
        onUserRefresh?.();
      } catch {
        dispatch({ type: "MSG", kind: "err", text: "Network error" });
        showToast("Network error", "error");
      } finally {
        dispatch({ type: "SET_SUBMITTING", source: null });
      }
    },
    [
      campaign.id,
      formatAmount,
      formatFull,
      onContribute,
      onUserRefresh,
      showToast,
      toInternal,
      treasuryAccess?.partyName,
    ]
  );

  if (!isOwner && !treasuryAccess) return null;

  return (
    <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {isOwner && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="text-base font-semibold mb-1">Contribute Personal Campaign Funds</h3>
          <p className="text-xs text-muted mb-3">
            Move money from your personal campaign account into this campaign.
          </p>
          <div className="text-xs text-muted mb-3">
            Available:{" "}
            <span className="font-mono tabular-nums text-foreground">
              {myCampaignFunds != null && myCampaignFundsCurrency
                ? formatCurrencyFaceAmount(myCampaignFunds, myCampaignFundsCurrency)
                : "—"}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="Amount"
              value={state.personalAmount}
              onChange={(e) =>
                dispatch({ type: "SET_AMOUNT", source: "personal", value: e.target.value })
              }
              className="flex-1"
              disabled={state.submitting === "personal"}
            />
            <button
              type="button"
              onClick={() => submit("personal", state.personalAmount)}
              disabled={state.submitting === "personal" || !state.personalAmount}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {state.submitting === "personal" ? "Sending…" : "Contribute"}
            </button>
          </div>
        </div>
      )}

      {treasuryAccess && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold">
              Contribute from {treasuryAccess.partyName} Treasury
            </h3>
            <span className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-info">
              You: {ROLE_LABEL[treasuryAccess.role]}
            </span>
          </div>
          <p className="text-xs text-muted mb-3">Authorize a treasury transfer to this campaign.</p>
          <div className="text-xs text-muted mb-3">
            Treasury:{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatCurrencyFaceAmount(treasuryAccess.treasury, treasuryAccess.currencyCode)}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="Amount"
              value={state.treasuryAmount}
              onChange={(e) =>
                dispatch({ type: "SET_AMOUNT", source: "treasury", value: e.target.value })
              }
              className="flex-1"
              disabled={state.submitting === "treasury"}
            />
            <button
              type="button"
              onClick={() => submit("treasury", state.treasuryAmount, treasuryAccess.partyId)}
              disabled={state.submitting === "treasury" || !state.treasuryAmount}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {state.submitting === "treasury" ? "Sending…" : "Contribute"}
            </button>
          </div>
        </div>
      )}

      {state.msg && (
        <div
          className={`sm:col-span-2 text-xs px-3 py-2 rounded-lg border ${
            state.msgKind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          {state.msg}
        </div>
      )}
    </div>
  );
}
