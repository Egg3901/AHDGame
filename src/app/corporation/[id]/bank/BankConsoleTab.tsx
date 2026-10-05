"use client";

import { useCallback, useEffect, useReducer } from "react";
import { Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import type { ConsolePayload } from "./types";
import { mergeState } from "./lib/helpers";
import { ActiveCharterPanel } from "./sections/ActiveCharterPanel";
import { CapsPanel } from "./sections/CapsPanel";
import { CharterIssueForm } from "./sections/CharterIssueForm";
import { apiErrorText } from "@/lib/errors/catalog";

interface Props {
  corporationId: string;
  isCeo: boolean;
}

interface ConsoleLoadState {
  data: ConsolePayload | null;
  loading: boolean;
  error: string | null;
}

export function BankConsoleTab({ corporationId, isCeo }: Props) {
  const { showToast } = useToast();
  const [{ data, loading, error }, updateLoadState] = useReducer(mergeState<ConsoleLoadState>, {
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    updateLoadState({ loading: true });
    try {
      const res = await fetch(`/api/banking/corporation/${corporationId}`);
      const json = (await res.json().catch(() => ({}))) as ConsolePayload & { error?: string };
      if (!res.ok) {
        updateLoadState({
          error: apiErrorText(json, "Failed to load bank console"),
          data: null,
        });
        return;
      }
      updateLoadState({ error: null, data: json });
    } catch {
      updateLoadState({ error: "Failed to load bank console", data: null });
    } finally {
      updateLoadState({ loading: false });
    }
  }, [corporationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className="py-2 text-xs text-error">
        Bank console unavailable{error ? `: ${error}` : "."}
      </p>
    );
  }

  if (!data.visible) {
    return (
      <p className="py-2 text-xs text-muted">
        No bank console. Own a financial sector to charter a bank, or open a corporation that
        already holds a charter.
      </p>
    );
  }

  const canMutate = data.canMutate && isCeo;
  // Why the actions are off matters to the player. `canMutate` folds two very
  // different reasons together (not CEO / banking frozen), and the panels used
  // to blame the CEO check for both, telling a sitting CEO they were not the
  // CEO during a freeze.
  const blockReason = canMutate
    ? null
    : !isCeo || !data.isCeo
      ? "Only the CEO can issue a charter."
      : "Bank actions are paused while private banking is frozen.";

  return (
    <div className="space-y-6">
      {!data.privateBankingEnabled && (
        <p role="status" className="text-xs text-warning">
          Private banking is frozen. You can view this console, but bank actions are disabled.
        </p>
      )}

      {data.charter ? (
        <>
          <ActiveCharterPanel
            data={data}
            canMutate={canMutate}
            onChanged={load}
            showToast={showToast}
          />
          <CapsPanel data={data} />
          {data.primaryUnderwritingEnabled && (
            <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <div>
                <h3 className="text-sm font-semibold">Funded underwriting receipts</h3>
                <p className="mt-1 text-xs text-muted">
                  Fees are recorded only after the market pays for equity or corporate bond units.
                </p>
              </div>
              {data.underwritingReceipts?.length ? (
                <ul className="divide-y divide-border">
                  {[...data.underwritingReceipts].reverse().map((receipt) => (
                    <li
                      key={receipt.key}
                      className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-xs"
                    >
                      <span>
                        {receipt.issuerName} ·{" "}
                        {receipt.instrumentType === "equity" ? "Shares" : "Corporate bond"} · T
                        {receipt.turn}
                      </span>
                      <span className="tabular-nums">
                        Gross{" "}
                        {formatUnderwritingMoney(receipt.grossPlacedLocal, receipt.currencyCode)}
                        {" · "}fee {formatUnderwritingMoney(receipt.feeLocal, receipt.currencyCode)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">No funded placements yet.</p>
              )}
            </section>
          )}
        </>
      ) : (
        <CharterIssueForm
          data={data}
          canMutate={canMutate}
          blockReason={blockReason}
          onChanged={load}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function formatUnderwritingMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString()}`;
  }
}
