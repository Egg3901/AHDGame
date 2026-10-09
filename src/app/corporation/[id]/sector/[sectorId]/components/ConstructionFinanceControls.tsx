"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { quoteLoanOrigination } from "@/lib/banking/rules/loanFees";
import type {
  ConstructionFinanceChoice,
  ConstructionFinanceView,
} from "@/lib/banking/rules/constructionRequest";
import { apiErrorText } from "@/lib/errors/catalog";

type Lender = { id: string; name: string; ratePercent: number; approvalRequired: boolean };
export default function ConstructionFinanceControls({
  view,
  totalAnchor,
  constructionAnchor,
  cashAnchor,
  onChange,
  onWithdraw,
  busy = false,
}: {
  onWithdraw?: (claimId: string) => void;
  busy?: boolean;
  view: ConstructionFinanceView;
  totalAnchor: number;
  constructionAnchor: number;
  cashAnchor: number;
  onChange: (choice: ConstructionFinanceChoice | null) => void;
}) {
  const t = useTranslations("corporations.sectorInvestment");
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [bankId, setBankId] = useState("");
  const [principalDraft, setPrincipalDraft] = useState("");
  const [termTurns, setTermTurns] = useState(48);
  const [consent, setConsent] = useState(false);
  const requestId = useRef<string | null>(null);
  const costLocal = totalAnchor * view.localPerAnchor;
  const limit = constructionAnchor * view.localPerAnchor * 0.75;
  const principal = principalDraft === "" ? Math.floor(limit) : Number(principalDraft);
  const loan = quoteLoanOrigination(principal, view.currency);
  const contribution = costLocal - loan.proceeds;
  const lender = lenders.find((candidate) => candidate.id === bankId);
  const affordable = contribution >= 0 && contribution <= cashAnchor * view.localPerAnchor;
  const valid =
    !!lender &&
    consent &&
    Number.isFinite(principal) &&
    principal > 0 &&
    principal <= limit &&
    Number.isSafeInteger(termTurns) &&
    termTurns >= 4 &&
    termTurns <= 120 &&
    affordable;
  const native = (amount: number) => formatCurrencyFaceAmount(amount, view.currency);

  useEffect(() => {
    if (view.pendingRequest) return;
    const controller = new AbortController();
    fetch(`/api/corporations/${view.corporationId}/construction-finance`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.enabled)
          throw new Error(apiErrorText(data, "Construction lender quotes are unavailable"));
        return data;
      })
      .then((data: { currency: string; lenders: Lender[] }) => {
        if (data.currency !== view.currency)
          throw new Error("The corporation's currency changed. Refresh the sector.");
        if (!controller.signal.aborted) {
          setLenders(data.lenders);
          setBankId(data.lenders[0]?.id ?? "");
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : "Lender quotes unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [view.corporationId, view.currency, view.pendingRequest]);
  useEffect(() => {
    if (!enabled || view.pendingRequest) {
      onChange(null);
      return;
    }
    // A reviewed form gets a stable retry identity until its economic quote changes.
    requestId.current = crypto.randomUUID();
    onChange({
      affordable,
      request:
        valid && lender
          ? {
              bankId: lender.id,
              requestId: requestId.current,
              principal,
              termTurns,
              maximumCostLocal: costLocal,
              maximumRatePercent: lender.ratePercent,
              pledgeConsent: true,
            }
          : null,
    });
  }, [
    enabled,
    valid,
    affordable,
    bankId,
    lender,
    principal,
    termTurns,
    costLocal,
    onChange,
    view.pendingRequest,
  ]);

  const pendingRequest = view.pendingRequest;
  if (pendingRequest)
    return (
      <div className="rounded-lg border border-card-border p-4 space-y-3">
        <p className="text-body-sm">
          {pendingRequest.status === "awaiting_approval"
            ? "Construction is awaiting lender approval. No cash has moved and no capacity is queued."
            : "Construction funding is settling. Further capacity changes are paused until it completes."}
        </p>
        {pendingRequest.status === "awaiting_approval" && onWithdraw && (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-border px-3 py-2 text-body-sm disabled:opacity-50"
            onClick={() => onWithdraw(pendingRequest.claimId)}
          >
            Withdraw construction request
          </button>
        )}
      </div>
    );

  const inputClass =
    "mt-1.5 block h-11 w-full min-w-0 rounded-lg border border-card-border bg-background px-3 text-body-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  return (
    <fieldset
      disabled={busy}
      className="min-w-0 rounded-lg border border-card-border p-4 space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="text-body-sm font-semibold text-foreground">{t("paymentTitle")}</h3>
        <p className="text-body-xs text-muted">
          {t("cashBalance", { amount: native(cashAnchor * view.localPerAnchor) })}
        </p>
      </div>
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-body-sm ${enabled ? "border-primary/40 bg-primary/5" : "border-card-border bg-background/40"}`}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setConsent(false);
          }}
        />
        <span>
          <span className="block font-medium text-foreground">{t("financeToggle")}</span>
          <span className="mt-1 block text-body-xs text-muted">{t("financeHelp")}</span>
        </span>
      </label>
      {!enabled ? (
        <div className="flex flex-wrap justify-between gap-2 text-body-sm">
          <span className="text-muted">{t("cashPayment")}</span>
          <span className="font-semibold tabular-nums text-foreground">{native(costLocal)}</span>
        </div>
      ) : (
        <>
          {error && (
            <p className="text-error text-body-sm" role="alert">
              {error}
            </p>
          )}
          {!error && loading && (
            <p className="text-body-sm text-muted" role="status">
              {t("lendersLoading")}
            </p>
          )}
          {!error && !loading && lenders.length === 0 && (
            <p className="text-body-sm text-warning">{t("noLenders")}</p>
          )}
          <label className="block text-body-sm font-medium text-foreground">
            {t("lenderLabel")}
            <span className="relative block">
              <select
                className={`${inputClass} appearance-none pr-9`}
                value={bankId}
                disabled={loading || lenders.length === 0}
                onChange={(e) => {
                  setBankId(e.target.value);
                  setConsent(false);
                }}
              >
                {lenders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t("lenderOption", { name: item.name, rate: item.ratePercent.toFixed(2) })}
                    {item.approvalRequired ? ` (${t("approvalRequired")})` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted"
                aria-hidden
              />
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block min-w-0 text-body-sm font-medium text-foreground">
              {t("principalLabel", { currency: view.currency })}
              <input
                className={inputClass}
                type="number"
                min={1}
                max={limit}
                value={principalDraft === "" ? Math.floor(limit) : principalDraft}
                onChange={(e) => {
                  setPrincipalDraft(e.target.value);
                  setConsent(false);
                }}
              />
              <span className="mt-1.5 block text-body-xs font-normal text-muted">
                {t("principalLimit", { amount: native(limit) })}
              </span>
            </label>
            <label className="block min-w-0 text-body-sm font-medium text-foreground">
              {t("termLabel")}
              <input
                className={inputClass}
                type="number"
                min={4}
                max={120}
                value={termTurns}
                onChange={(e) => {
                  setTermTurns(Number(e.target.value));
                  setConsent(false);
                }}
              />
              <span className="mt-1.5 block text-body-xs font-normal text-muted">
                {t("termHelp")}
              </span>
            </label>
          </div>
          <dl className="space-y-2 rounded-lg bg-background/60 p-3 text-body-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("loanPrincipal")}</dt>
              <dd className="text-right tabular-nums text-foreground">{native(loan.principal)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("loanFee")}</dt>
              <dd className="text-right tabular-nums text-foreground">
                {native(loan.originationFee)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t("loanProceeds")}</dt>
              <dd className="text-right tabular-nums text-foreground">{native(loan.proceeds)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-card-border pt-2 font-semibold">
              <dt>{t("cashContribution")}</dt>
              <dd
                className={`text-right tabular-nums ${affordable ? "text-foreground" : "text-error"}`}
              >
                {native(contribution)}
              </dd>
            </div>
          </dl>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-card-border p-3 text-body-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              <span className="block font-medium text-foreground">{t("loanPledge")}</span>
              <span className="mt-1 block text-body-xs text-muted">{t("loanPledgeHelp")}</span>
            </span>
          </label>
          {!affordable && (
            <p className="text-error text-body-sm" role="alert">
              {t("contributionShortfall")}
            </p>
          )}
          {lender?.approvalRequired && (
            <p className="text-body-sm text-warning">{t("loanStartsAfterApproval")}</p>
          )}
        </>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-card-border pt-3 text-body-sm">
        <span className="text-muted">{t("cashRemaining")}</span>
        <span
          className={`font-semibold tabular-nums ${(enabled ? affordable : costLocal <= cashAnchor * view.localPerAnchor) ? "text-foreground" : "text-error"}`}
        >
          {native(cashAnchor * view.localPerAnchor - (enabled ? contribution : costLocal))}
        </span>
      </div>
    </fieldset>
  );
}
