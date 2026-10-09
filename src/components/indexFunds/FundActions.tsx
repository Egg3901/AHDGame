"use client";

import { useState } from "react";
import { useDialogA11y } from "@/components/ui";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FundTradePanel } from "./FundTradePanel";

export type FundCorporationAccount = {
  id: string;
  name: string;
  liquidCapital: number;
  currencyCode: CurrencyCode | null;
  units: number;
};
type Props = React.ComponentProps<typeof FundTradePanel> & {
  corporations?: FundCorporationAccount[];
};

export function FundActions({ corporations = [], ...props }: Props) {
  const [mode, setMode] = useState<"subscribe" | "redeem" | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 border-y border-card-border py-3">
      <button
        type="button"
        onClick={() => setMode("subscribe")}
        disabled={props.status !== "active"}
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Buy fund units
      </button>
      <button
        type="button"
        onClick={() => setMode("redeem")}
        disabled={
          props.status === "delisted" ||
          (props.myUnits <= 0 && !corporations.some((c) => c.units > 0))
        }
        className="rounded-lg border border-card-border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        Redeem units
      </button>
      <span className="text-sm text-muted">
        Your position: {props.myUnits.toLocaleString("en-US")} units
      </span>
      {mode && (
        <FundTradeDialog
          {...props}
          corporations={corporations}
          defaultMode={mode}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}

function FundTradeDialog({
  corporations = [],
  onClose,
  ...props
}: Props & { onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const { dialogProps, titleId } = useDialogA11y(() => {
    if (!pending) onClose();
  });
  const [account, setAccount] = useState(() =>
    props.defaultMode === "redeem" && props.myUnits <= 0
      ? (corporations.find((c) => c.units > 0)?.id ?? "")
      : ""
  );
  const corporation = corporations.find((c) => c.id === account);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div
        {...dialogProps}
        aria-labelledby={titleId}
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-card-border bg-background p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            Trade fund units
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close fund trade"
            className="px-3 py-2"
          >
            Close
          </button>
        </div>
        {corporations.length > 0 && (
          <label className="mb-4 block text-sm">
            Investment account
            <select
              aria-label="Investment account"
              disabled={pending}
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-card-border bg-card px-3 py-2"
            >
              <option value="">Personal cash</option>
              {corporations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (corporation)
                </option>
              ))}
            </select>
          </label>
        )}
        <FundTradePanel
          key={account}
          {...props}
          corporation={corporation}
          myUnits={corporation?.units ?? props.myUnits}
          myLegacyUnits={corporation ? 0 : props.myLegacyUnits}
          onPendingChange={setPending}
          onSuccess={() => {
            props.onSuccess();
            onClose();
          }}
        />
      </div>
    </div>
  );
}
