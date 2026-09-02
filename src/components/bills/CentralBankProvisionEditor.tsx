"use client";

/**
 * Opt-in editor for the `central_bank_independence` bill provision, on economy
 * bills only (see `CENTRAL_BANK_INDEPENDENCE_BILL_CATEGORIES`).
 *
 * `grant` hands rate-setting to the bank and seats its policy committee;
 * `revoke` returns it to the head of government and the finance seat. The
 * provision stands on its own, so a bill may carry nothing else — the parent
 * modal counts it toward `MAX_PROVISIONS` and toward the national-influence
 * ladder either way.
 */
export type CentralBankIndependenceAction = "grant" | "revoke";

export function CentralBankProvisionEditor({
  include,
  onIncludeChange,
  action,
  onActionChange,
}: {
  include: boolean;
  onIncludeChange: (next: boolean) => void;
  action: CentralBankIndependenceAction;
  onActionChange: (next: CentralBankIndependenceAction) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-amber-500/35 bg-amber-500/5 p-3 space-y-3">
      <p className="text-xs font-medium text-muted">Central bank (optional)</p>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => onIncludeChange(e.target.checked)}
          className="rounded"
        />
        Change who sets the policy rate
      </label>
      <div className="flex items-center gap-3 text-xs text-muted">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name="cb-independence-action"
            checked={action === "grant"}
            disabled={!include}
            onChange={() => onActionChange("grant")}
          />
          Grant the bank independence
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name="cb-independence-action"
            checked={action === "revoke"}
            disabled={!include}
            onChange={() => onActionChange("revoke")}
          />
          Return rate-setting to the government
        </label>
      </div>
      <p className="text-[11px] italic text-muted/60">
        {!include
          ? "No central-bank provision will be included in this bill."
          : action === "grant"
            ? "On enactment the bank sets its own rate through its policy committee."
            : "On enactment the head of government and the finance minister set the rate."}
      </p>
    </div>
  );
}
