"use client";

import { useReducer } from "react";
import { Button } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { BankCharterType } from "@/lib/db/types/bank";
import type { ConsolePayload, ShowToast } from "../types";
import { charterLabel, mergeState } from "../lib/helpers";

export function CharterIssueForm({
  data,
  canMutate,
  blockReason,
  onChanged,
  showToast,
}: {
  data: ConsolePayload;
  canMutate: boolean;
  blockReason: string | null;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const defaultType =
    data.eligibleTypes[0] ?? data.legalCharterTypes[0] ?? ("retail" as BankCharterType);
  const [{ type, busy }, updateCharterState] = useReducer(
    mergeState<{ type: BankCharterType; busy: boolean }>,
    { type: defaultType, busy: false }
  );

  const issue = async () => {
    updateCharterState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${data.corporation.id}/bank/charter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, currency: data.currency }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        reasons?: string[];
      };
      if (!res.ok) {
        showToast(json.reasons?.join("; ") ?? json.error ?? "Could not issue charter", "error");
        return;
      }
      showToast("Bank charter issued", "success");
      await onChanged();
    } finally {
      updateCharterState({ busy: false });
    }
  };

  const types = data.legalCharterTypes.length > 0 ? data.legalCharterTypes : [];

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Issue bank charter</h2>
        <p className="mt-1 text-sm text-muted">
          Posts {formatBankMoney(data.capitalRequirement, data.currency)} from the corporation
          treasury. Legal types follow this nation&apos;s banking separation law.
        </p>
      </div>
      {data.eligibilityReasons.length > 0 && data.eligibleTypes.length === 0 && (
        <ul className="list-disc pl-5 text-sm text-error space-y-1">
          {data.eligibilityReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {types.length === 0 ? (
        <p className="text-sm text-muted">
          No private bank charters are legal in this jurisdiction.
        </p>
      ) : (
        <label className="block space-y-1 text-xs text-muted">
          Charter type
          <select
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            value={type}
            onChange={(e) => updateCharterState({ type: e.target.value as BankCharterType })}
            disabled={!canMutate}
            aria-label="Charter type"
          >
            {types.map((t) => (
              <option key={t} value={t} disabled={!data.eligibleTypes.includes(t) && canMutate}>
                {charterLabel(t)}
                {!data.eligibleTypes.includes(t) ? " (not eligible)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-muted font-mono">
        Treasury {formatBankMoney(data.corporation.liquidCapital, data.currency)} · currency{" "}
        {data.currency}
      </p>
      {canMutate ? (
        <Button
          type="button"
          onClick={() => void issue()}
          disabled={busy || data.eligibleTypes.length === 0}
        >
          {busy ? "Issuing..." : "Issue charter"}
        </Button>
      ) : (
        <p className="text-sm text-muted">{blockReason}</p>
      )}
    </section>
  );
}
