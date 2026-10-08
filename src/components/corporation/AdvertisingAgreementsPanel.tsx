"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Input } from "@/components/ui";
import { DenseSection, InlineStatus, SmallButton, TableScroll, Td, Th } from "./dense/DenseKit";
import type { CurrencyCode } from "@/lib/constants/currencies";
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

const REASON_TEXT: Record<string, string> = {
  allocation_exceeds_budget:
    "Together the agreements would use more than 100% of the buyer's marketing budget.",
  already_closed: "This agreement has already ended.",
  feature_disabled: "Advertising agreements are not enabled in this world.",
  invalid_duration: "Choose a length between 4 and 192 turns.",
  invalid_share: "Choose a share between 1% and 100%.",
  not_counterparty: "Only the media corporation can accept this proposal.",
  not_found: "That agreement no longer exists.",
  not_party: "You are not part of this agreement.",
  not_pending: "This proposal is no longer waiting for an answer.",
  self_contract: "A corporation cannot buy advertising from itself.",
  stale_offer: "This proposal is out of date. Reload the page and check its terms.",
};

/** Server reasons are codes; show a sentence instead of the code. */
function adErrorText(data: unknown, fallback: string): string {
  const code = (data as { error?: unknown } | null)?.error;
  if (typeof code === "string" && REASON_TEXT[code]) return REASON_TEXT[code];
  return apiErrorText(data, fallback);
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Waiting for the media corporation",
  active: "Active",
  cancelling: "Ending after notice",
  cancelled: "Cancelled",
  declined: "Declined",
  expired: "Ended",
};

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
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);

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
          setNotice({ text: "Could not load advertising agreements.", tone: "error" });
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
            setNotice({ text: "Could not load media corporations.", tone: "error" });
          }
        });
    }
    return () => controller.abort();
  }, [corpId, ownsMediaSector]);

  const money = (anchor: number) =>
    formatAmount(anchor, (suppliers?.liquidCurrencyCode ?? undefined) as CurrencyCode | undefined);
  const share = Number(sharePct);
  const turns = Number(durationTurns);
  const shareValid = Number.isFinite(share) && share >= 1 && share <= 100;
  const turnsValid = Number.isInteger(turns) && turns >= 4 && turns <= 192;
  const selected = suppliers?.suppliers.find((option) => option.id === supplierId);
  const budget = suppliers?.buyerMarketingPerTurnAnchor ?? 0;
  const perTurn = shareValid ? budget * (share / 100) : 0;
  const blocker = !selected
    ? "Pick a media corporation first."
    : !shareValid
      ? "Enter a share between 1 and 100 percent."
      : !turnsValid
        ? "Enter a length between 4 and 192 whole turns."
        : budget <= 0
          ? "Your marketing budget is zero, so there is nothing to direct. Raise it in the CEO Office."
          : null;

  async function propose(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || blocker) return;
    setBusy(true);
    setNotice(null);
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
    setNotice(
      response.ok
        ? { text: "Advertising proposal sent", tone: "success" }
        : { text: adErrorText(data, "The proposal did not go through."), tone: "error" }
    );
    if (response.ok) await refresh();
    setBusy(false);
  }

  async function update(id: string, action: "accept" | "cancel") {
    setBusy(true);
    setNotice(null);
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    setNotice(
      response.ok
        ? {
            text: action === "accept" ? "Agreement accepted" : "Agreement canceled",
            tone: "success",
          }
        : { text: adErrorText(data, "That did not go through."), tone: "error" }
    );
    if (response.ok) await refresh();
    setBusy(false);
  }

  const supplierSide = ownsMediaSector;
  const list = (
    <TableScroll>
      <table
        className="w-full text-sm"
        aria-label={
          supplierSide ? "Advertising deals with your media sectors" : "Advertising agreements"
        }
      >
        <thead>
          <tr>
            <Th>{supplierSide ? "Buyer" : "Media corporation"}</Th>
            <Th>Status</Th>
            <Th align="right">Share of budget</Th>
            <Th align="right">Length</Th>
            <Th align="right">Coverage overlap</Th>
            <Th align="right">{supplierSide ? "Earns per turn" : "Budget covered per turn"}</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {agreements.map((agreement) => {
            const earns = agreement.role === "supplier";
            const amount = earns ? agreement.lastEffectiveAnchor : agreement.lastCoveredSpendAnchor;
            return (
              <tr key={agreement.id}>
                <Td numeric={false} wrap>
                  <span className="font-medium">
                    {agreement.counterparty?.name ?? "Unnamed corporation"}
                  </span>
                  <span className="block text-xs text-muted">
                    {earns ? "Buys from you" : "You buy from them"}
                  </span>
                </Td>
                <Td numeric={false}>
                  <Badge color={agreement.status === "active" ? "success" : "default"}>
                    {STATUS_TEXT[agreement.status] ?? agreement.status}
                  </Badge>
                </Td>
                <Td align="right">{agreement.allocationShareBps / 100}%</Td>
                <Td align="right">
                  {agreement.durationTurns !== undefined
                    ? `${agreement.durationTurns} turns`
                    : "n/a"}
                </Td>
                <Td align="right">
                  {agreement.lastOverlap !== undefined
                    ? `${Math.round(agreement.lastOverlap * 100)}%`
                    : "n/a"}
                </Td>
                <Td align="right">{amount !== undefined ? money(amount) : "n/a"}</Td>
                <Td align="right" numeric={false}>
                  <div className="flex justify-end gap-1.5">
                    {agreement.status === "pending" && agreement.role === "supplier" && (
                      <SmallButton
                        tone="primary"
                        onClick={() => void update(agreement.id, "accept")}
                        disabled={busy}
                      >
                        Accept
                      </SmallButton>
                    )}
                    {(agreement.status === "active" || agreement.status === "cancelling") && (
                      <SmallButton
                        tone="danger"
                        onClick={() => void update(agreement.id, "cancel")}
                        disabled={busy || agreement.status === "cancelling"}
                        title={
                          agreement.status === "cancelling"
                            ? "Already ending after the 4 turn notice"
                            : "Ends after 4 turns of notice"
                        }
                      >
                        Cancel
                      </SmallButton>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );

  const status = notice && (
    <InlineStatus message={notice.text} tone={notice.tone} className="py-1" />
  );

  if (supplierSide) {
    return (
      <DenseSection title="Coverage advertising" meta="deals from buyers">
        <p className="py-1 text-sm text-muted">
          Other corporations can direct part of their marketing budget to your media sectors.
          Proposals appear here. Accept one and it pays you advertising revenue each turn.
        </p>
        {status}
        {agreements.length === 0 ? (
          <p className="py-1 text-sm text-muted">
            No deals yet. Buyers propose them from their own Operations tab.
          </p>
        ) : (
          list
        )}
      </DenseSection>
    );
  }

  const noSuppliers = !!suppliers && suppliers.suppliers.length === 0;
  const form = (
    <>
      <p className="py-1 text-sm text-muted">
        Direct part of your existing marketing budget to a media corporation. This is not a second
        expense. Coverage they deliver makes your advertising work better.
      </p>
      {status}
      <form className="grid gap-3 py-2 sm:grid-cols-3" onSubmit={(event) => void propose(event)}>
        <div className="sm:col-span-3">
          <label htmlFor="ad-supplier" className="mb-1 block text-xs text-muted">
            Media corporation
          </label>
          <select
            id="ad-supplier"
            className="block h-9 w-full rounded-md border border-card-border bg-card px-2 text-sm"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            disabled={!suppliers || noSuppliers}
          >
            {!suppliers && <option value="">Loading media corporations</option>}
            {noSuppliers && <option value="">No media corporation to buy from</option>}
            {(suppliers?.suppliers ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.ticker ? ` (${option.ticker})` : ""}: {option.mediaSectorCount} media
                sectors in {option.stateCount} states
              </option>
            ))}
          </select>
          {noSuppliers && (
            <p className="mt-1 text-xs text-muted">
              Only media corporations with an active CEO can sell advertising. None is available
              right now.
            </p>
          )}
          {selected && (
            <p className="mt-1 text-xs text-muted">
              Runs {selected.models.join(", ")}.
              {selected.editorialStance
                ? ` Editorial position: economic ${selected.editorialStance.economic}, social ${selected.editorialStance.social} (each from -5 to +5).`
                : ""}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ad-share" className="mb-1 block text-xs text-muted">
            Share of your marketing budget (%)
          </label>
          <Input
            id="ad-share"
            type="number"
            min="1"
            max="100"
            value={sharePct}
            className="!h-9 !rounded-md !px-2 !py-1 !text-sm"
            onChange={(event) => setSharePct(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ad-turns" className="mb-1 block text-xs text-muted">
            Length of agreement (turns)
          </label>
          <Input
            id="ad-turns"
            type="number"
            min="4"
            max="192"
            value={durationTurns}
            className="!h-9 !rounded-md !px-2 !py-1 !text-sm"
            onChange={(event) => setDurationTurns(event.target.value)}
          />
          <p className="mt-1 text-xs text-muted">4 to 192 turns. 24 turns is one day.</p>
        </div>
        <div className="flex flex-col justify-end gap-1">
          <SmallButton
            type="submit"
            tone="primary"
            disabled={busy || !!blocker}
            title={blocker ?? undefined}
          >
            {busy ? "Sending" : "Propose agreement"}
          </SmallButton>
          {blocker && <span className="text-xs text-muted">{blocker}</span>}
        </div>
      </form>
      {shareValid && turnsValid && suppliers && (
        <p className="pb-2 text-sm" aria-label="Agreement preview">
          {share}% of your marketing budget is about {money(perTurn)} per turn, or{" "}
          {money(perTurn * turns)} over {turns} turns, directed to{" "}
          {selected?.name ?? "the media corporation you choose"}. It ends after {turns} turns, or
          earlier if either side cancels with 4 turns of notice.
        </p>
      )}
      {agreements.length > 0 && list}
    </>
  );

  if (agreements.length === 0) {
    return (
      <section className="min-w-0 border-b border-card-border pb-1.5">
        <details>
          <summary className="cursor-pointer py-1.5 text-sm font-semibold text-foreground">
            Buy coverage advertising from a media corporation
          </summary>
          <div className="pt-1">{form}</div>
        </details>
      </section>
    );
  }
  return (
    <DenseSection title="Coverage advertising" meta="your deals with media corporations">
      {form}
    </DenseSection>
  );
}
