"use client";
import { useEffect, useRef, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
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
  const { formatAmount } = useCurrency();
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [error, setError] = useState("");
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
  const native = (amount: number) => formatAmount(amount, view.currency);

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
      <div className="rounded-lg border border-border p-3 space-y-3">
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

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <label className="flex items-center gap-2 text-body-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setConsent(false);
          }}
        />
        Finance this build with a bank term loan
      </label>
      {enabled && (
        <>
          {error && (
            <p className="text-error text-body-sm" role="alert">
              {error}
            </p>
          )}
          {!error && lenders.length === 0 && (
            <p className="text-body-sm">No eligible same-currency lender is available.</p>
          )}
          <label className="block text-body-sm">
            Lender
            <select
              className="block w-full"
              value={bankId}
              onChange={(e) => {
                setBankId(e.target.value);
                setConsent(false);
              }}
            >
              {lenders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}: {item.ratePercent.toFixed(2)}% per year
                  {item.approvalRequired ? " (approval required)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-body-sm">
            Principal ({view.currency})
            <input
              className="block w-full"
              type="number"
              min={1}
              max={limit}
              value={principalDraft === "" ? Math.floor(limit) : principalDraft}
              onChange={(e) => {
                setPrincipalDraft(e.target.value);
                setConsent(false);
              }}
            />
          </label>
          <label className="block text-body-sm">
            Term (turns)
            <input
              className="block w-full"
              type="number"
              min={4}
              max={120}
              value={termTurns}
              onChange={(e) => {
                setTermTurns(Number(e.target.value));
                setConsent(false);
              }}
            />
          </label>
          <p className="text-body-sm">
            Principal limit {native(limit)}. Origination fee {native(loan.originationFee)} is
            withheld from proceeds. Your cash contribution is {native(contribution)}.
          </p>
          <label className="flex items-start gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I pledge this sector to the lender until principal is repaid. Cancellation refunds and
            sale proceeds repay secured principal first; default can lead to foreclosure.
          </label>
          {!affordable && (
            <p className="text-error text-body-sm">
              Available cash does not cover your contribution.
            </p>
          )}
          {lender?.approvalRequired && (
            <p className="text-body-sm">
              The build starts after the lender approves and delivers funding.
            </p>
          )}
        </>
      )}
    </div>
  );
}
