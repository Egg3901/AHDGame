"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { apiErrorText } from "@/lib/errors/catalog";

interface AgreementRow {
  id: string;
  role: "buyer" | "supplier";
  status: string;
  allocationShareBps: number;
  durationTurns?: number;
  lastEffectiveAnchor?: number;
  lastCoveredSpendAnchor?: number;
  lastOverlap?: number;
  counterparty?: { id: string; name: string; ticker?: string };
}

interface SupplierOption {
  id: string;
  name: string;
  ticker?: string;
  mediaSectorCount: number;
  stateCount: number;
  models: string[];
  editorialStance?: { economic: number; social: number };
}

interface SupplierList {
  buyerMarketingPerTurnAnchor: number;
  liquidCurrencyCode: string | null;
  suppliers: SupplierOption[];
}

/**
 * Coverage advertising is a media product. A media corporation sees the deals
 * buyers have proposed to it and what they earn it. Any other corporation is
 * a buyer: it picks a media corporation from a list, sets labeled terms and
 * sees what the share is worth per turn before sending.
 */
export default function AdvertisingAgreementsPanel({
  corpId,
  ownsMediaSector = false,
}: {
  corpId: string;
  ownsMediaSector?: boolean;
}) {
  const { formatAmount } = useCurrency();
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierList | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [sharePct, setSharePct] = useState("10");
  const [durationTurns, setDurationTurns] = useState("24");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements`);
    if (!response.ok) return;
    const data = (await response.json()) as { agreements?: AgreementRow[] };
    setAgreements(data.agreements ?? []);
  }, [corpId]);

  useEffect(() => {
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    void fetch(`/api/corporations/${corpId}/advertising-agreements`, opts)
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { agreements?: AgreementRow[] };
        setAgreements(data.agreements ?? []);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setNotice("Could not load advertising agreements");
        }
      });
    if (!ownsMediaSector) {
      void fetch(`/api/corporations/${corpId}/advertising-agreements/suppliers`, opts)
        .then(async (response) => {
          if (!response.ok) return;
          const data = (await response.json()) as SupplierList;
          setSuppliers(data);
          setSupplierId((current) => current || data.suppliers[0]?.id || "");
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setNotice("Could not load media corporations");
          }
        });
    }
    return () => controller.abort();
  }, [corpId, ownsMediaSector]);

  const money = (anchor: number) =>
    formatAmount(anchor, suppliers?.liquidCurrencyCode ?? undefined);
  const share = Number(sharePct);
  const turns = Number(durationTurns);
  const shareValid = Number.isFinite(share) && share >= 1 && share <= 100;
  const turnsValid = Number.isInteger(turns) && turns >= 4 && turns <= 192;
  const selected = suppliers?.suppliers.find((option) => option.id === supplierId);
  const perTurn = shareValid ? (suppliers?.buyerMarketingPerTurnAnchor ?? 0) * (share / 100) : 0;

  async function propose(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !shareValid || !turnsValid) return;
    setBusy(true);
    setNotice("");
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierCorpId: selected.id,
        allocationShareBps: Math.round(share * 100),
        durationTurns: turns,
      }),
    });
    const data = await response.json();
    setNotice(response.ok ? "Advertising proposal sent" : apiErrorText(data, "Proposal failed"));
    if (response.ok) await refresh();
    setBusy(false);
  }

  async function update(id: string, action: "accept" | "cancel") {
    setBusy(true);
    setNotice("");
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    setNotice(response.ok ? `Agreement ${action}ed` : apiErrorText(data, `${action} failed`));
    if (response.ok) await refresh();
    setBusy(false);
  }

  const list = (
    <ul
      className="mt-4 space-y-2"
      aria-label={
        ownsMediaSector ? "Advertising deals with your media sectors" : "Advertising agreements"
      }
    >
      {agreements.map((agreement) => (
        <li key={agreement.id} className="rounded-lg border border-card-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {agreement.counterparty?.name ?? agreement.counterparty?.id ?? "Counterparty"}
            </span>
            <Badge color="info">{agreement.role}</Badge>
            <Badge color={agreement.status === "active" ? "success" : "default"}>
              {agreement.status}
            </Badge>
            <span>{agreement.allocationShareBps / 100}% of budget</span>
            {agreement.durationTurns !== undefined && <span>{agreement.durationTurns} turns</span>}
          </div>
          {agreement.lastOverlap !== undefined && (
            <p className="mt-1 text-xs text-muted">
              Last coverage overlap {Math.round(agreement.lastOverlap * 100)}%
              {agreement.role === "supplier"
                ? `; this earns you about ${money(agreement.lastEffectiveAnchor ?? 0)} per turn`
                : `; effective value ${Math.round(agreement.lastEffectiveAnchor ?? 0)}`}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {agreement.status === "pending" && agreement.role === "supplier" && (
              <Button size="sm" onClick={() => void update(agreement.id, "accept")} disabled={busy}>
                Accept
              </Button>
            )}
            {(agreement.status === "active" || agreement.status === "cancelling") && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void update(agreement.id, "cancel")}
                disabled={busy}
              >
                Cancel
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  if (ownsMediaSector) {
    return (
      <Card title="Coverage advertising">
        <p className="text-sm text-muted">
          Other corporations can set aside part of their marketing budget for coverage from your
          media sectors. Proposals appear here; accepting one earns you advertising revenue shown
          per turn.
        </p>
        {notice && (
          <p className="mt-2 text-sm text-muted" role="status">
            {notice}
          </p>
        )}
        {agreements.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No advertising deals yet.</p>
        ) : (
          list
        )}
      </Card>
    );
  }

  const form = (
    <>
      <p className="text-sm text-muted">
        Allocate part of your existing marketing budget to a media corporation. This does not add a
        second expense; delivered coverage changes how well your advertising works.
      </p>
      {notice && (
        <p className="mt-2 text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={(event) => void propose(event)}>
        <div className="sm:col-span-3">
          <label htmlFor="ad-supplier" className="mb-1 block text-sm font-medium">
            Media corporation
          </label>
          <select
            id="ad-supplier"
            className="block w-full rounded-lg border border-card-border bg-card px-3 py-2 text-base"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            disabled={!suppliers || suppliers.suppliers.length === 0}
          >
            {(suppliers?.suppliers ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.ticker ? ` (${option.ticker})` : ""}: {option.mediaSectorCount} media
                sectors in {option.stateCount} states
              </option>
            ))}
          </select>
          {suppliers && suppliers.suppliers.length === 0 && (
            <p className="mt-1 text-sm text-muted">
              No media corporation with an active CEO is available to buy from right now.
            </p>
          )}
          {selected && (
            <p className="mt-1 text-xs text-muted">
              Runs {selected.models.join(", ")}.
              {selected.editorialStance
                ? ` Editorial position: economic ${selected.editorialStance.economic}, social ${selected.editorialStance.social}.`
                : ""}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ad-share" className="mb-1 block text-sm font-medium">
            Share of your marketing budget (%)
          </label>
          <Input
            id="ad-share"
            type="number"
            min="1"
            max="100"
            value={sharePct}
            onChange={(event) => setSharePct(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ad-turns" className="mb-1 block text-sm font-medium">
            Length of agreement (turns)
          </label>
          <Input
            id="ad-turns"
            type="number"
            min="4"
            max="192"
            value={durationTurns}
            onChange={(event) => setDurationTurns(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted">4 to 192 turns. 24 turns is one day.</p>
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            size="sm"
            isLoading={busy}
            disabled={!selected || !shareValid || !turnsValid}
          >
            Propose agreement
          </Button>
        </div>
      </form>
      {shareValid && turnsValid && suppliers && (
        <p className="mt-2 text-sm" aria-label="Agreement preview">
          {share}% of your marketing budget is about {money(perTurn)} per turn, or{" "}
          {money(perTurn * turns)} over {turns} turns, directed to{" "}
          {selected?.name ?? "the media corporation you choose"}. It ends after {turns} turns or
          when either side cancels with 4 turns of notice.
        </p>
      )}
      {list}
    </>
  );

  if (agreements.length === 0) {
    return (
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Buy coverage advertising from a media corporation
          </summary>
          <div className="mt-3">{form}</div>
        </details>
      </Card>
    );
  }
  return <Card title="Coverage advertising">{form}</Card>;
}
