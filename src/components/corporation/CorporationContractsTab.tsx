"use client";

import { useCallback, useEffect, useState } from "react";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import {
  effectiveContractStatus,
  type ExtractionContractRow,
  type ExtractionContractStatus,
} from "@/components/extraction/types";
import { CONTRACT_DEFAULT_MISSED_PAYMENTS } from "@/lib/constants/prospecting";
import { DenseSection, SmallButton, TableScroll, Td, Th } from "./dense/DenseKit";
import { apiErrorText } from "@/lib/errors/catalog";

interface CorporationContractsTabProps {
  corpId: string;
  isCeo: boolean;
}

/**
 * Extraction-contract offers + active contracts held by this corporation.
 * CEO can accept/decline offers and see royalty/term detail on active
 * contracts. Rendered only for extraction corps when contractIssuanceEnabled.
 */
export default function CorporationContractsTab({ corpId, isCeo }: CorporationContractsTabProps) {
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const gameTurn = useGameTurnStatus();
  const currentTurn = gameTurn?.currentTurn ?? 0;

  const [contracts, setContracts] = useState<ExtractionContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/extraction?corporationId=${corpId}&status=all`);
      if (res.ok) {
        const data = (await res.json()) as { contracts?: ExtractionContractRow[] };
        setContracts(data.contracts ?? []);
      }
    } catch {
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function respond(id: string, action: "accept" | "decline") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contracts/extraction/${id}/${action}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(apiErrorText(json, `Failed to ${action} the offer.`), "error");
        return;
      }
      showToast(action === "accept" ? "Contract accepted." : "Offer declined.", "success");
      setRefreshKey((k) => k + 1);
    } catch {
      showToast("Network error.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="py-2 text-xs text-muted">Loading contracts…</p>;
  }

  const offers = contracts.filter((c) => effectiveContractStatus(c) === "offered");
  const active = contracts.filter((c) => effectiveContractStatus(c) === "active");
  const past = contracts.filter((c) => {
    const s = effectiveContractStatus(c);
    return s === "declined" || s === "expired" || s === "defaulted";
  });

  if (contracts.length === 0) {
    return (
      <DenseSection title="Extraction contracts">
        <p className="py-2 text-xs text-muted">No extraction contracts yet.</p>
      </DenseSection>
    );
  }

  const resource = (c: ExtractionContractRow) => COMMODITY_LABELS[c.resource] ?? c.resource;
  const royalty = (c: ExtractionContractRow) =>
    c.royaltyRatePerTurn != null ? `${(c.royaltyRatePerTurn * 100).toFixed(2)}%` : "n/a";

  return (
    <div className="space-y-6">
      {offers.length > 0 && (
        <DenseSection title="Pending offers" meta={`${offers.length}`}>
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Resource</Th>
                  <Th>State</Th>
                  <Th align="right">Share</Th>
                  <Th align="right">Signing fee</Th>
                  <Th align="right" title="Share of contracted value paid each turn">
                    Royalty / turn
                  </Th>
                  <Th align="right">Term</Th>
                  <Th align="right">Offer expires</Th>
                  {isCeo && (
                    <Th align="right">
                      <span className="sr-only">Respond</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {offers.map((c) => (
                  <tr key={c._id}>
                    <Td className="text-foreground">{resource(c)}</Td>
                    <Td className="text-muted">{c.stateId}</Td>
                    <Td align="right">{(c.share * 100).toFixed(1)}%</Td>
                    <Td align="right">
                      {c.signingFeeAnchor != null ? formatAmount(c.signingFeeAnchor) : "n/a"}
                    </Td>
                    <Td align="right">{royalty(c)}</Td>
                    <Td align="right">{c.termTurns ? `${c.termTurns} turns` : "Perpetual"}</Td>
                    <Td align="right" className="text-muted">
                      {c.offerExpiresTurn != null
                        ? `${Math.max(0, c.offerExpiresTurn - currentTurn)} turns`
                        : ""}
                    </Td>
                    {isCeo && (
                      <Td align="right" numeric={false}>
                        <span className="inline-flex gap-1.5">
                          <SmallButton
                            tone="primary"
                            onClick={() => void respond(c._id, "accept")}
                            disabled={busyId === c._id}
                          >
                            {busyId === c._id ? "Working…" : "Accept"}
                          </SmallButton>
                          <SmallButton
                            onClick={() => void respond(c._id, "decline")}
                            disabled={busyId === c._id}
                          >
                            Decline
                          </SmallButton>
                        </span>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </DenseSection>
      )}

      {active.length > 0 && (
        <DenseSection title="Active contracts" meta={`${active.length}`}>
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Resource</Th>
                  <Th>State</Th>
                  <Th align="right">Share</Th>
                  <Th align="right">Royalty / turn</Th>
                  <Th align="right">Expires</Th>
                  <Th align="right">Status</Th>
                </tr>
              </thead>
              <tbody>
                {active.map((c) => {
                  const missed = c.missedPayments ?? 0;
                  return (
                    <tr key={c._id}>
                      <Td className="text-foreground">{resource(c)}</Td>
                      <Td className="text-muted">{c.stateId}</Td>
                      <Td align="right">{(c.share * 100).toFixed(1)}%</Td>
                      <Td align="right">{royalty(c)}</Td>
                      <Td align="right" className="text-muted">
                        {c.expiresTurn != null ? `Turn ${c.expiresTurn}` : "Perpetual"}
                      </Td>
                      <Td align="right" numeric={false}>
                        {missed > 0 ? (
                          <span
                            className="text-warning"
                            title={`${missed} of ${CONTRACT_DEFAULT_MISSED_PAYMENTS} missed royalty payments before default`}
                          >
                            {missed} missed payment{missed === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <ContractStatusText status="active" />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </DenseSection>
      )}

      {past.length > 0 && (
        <DenseSection title="History" meta={`${past.length}`}>
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Resource</Th>
                  <Th>State</Th>
                  <Th align="right">Share</Th>
                  <Th align="right">Status</Th>
                </tr>
              </thead>
              <tbody>
                {past.map((c) => (
                  <tr key={c._id}>
                    <Td className="text-foreground">{resource(c)}</Td>
                    <Td className="text-muted">{c.stateId}</Td>
                    <Td align="right">{(c.share * 100).toFixed(1)}%</Td>
                    <Td align="right" numeric={false}>
                      <ContractStatusText status={effectiveContractStatus(c)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </DenseSection>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<ExtractionContractStatus, { label: string; tone: string }> = {
  offered: { label: "Offered", tone: "text-foreground" },
  active: { label: "Active", tone: "text-success" },
  declined: { label: "Declined", tone: "text-muted" },
  expired: { label: "Expired", tone: "text-muted" },
  defaulted: { label: "Defaulted", tone: "text-error" },
};

/** Contract status as plain text, coloured by what it means. */
function ContractStatusText({ status }: { status: ExtractionContractStatus }) {
  const s = STATUS_TEXT[status];
  return <span className={s.tone}>{s.label}</span>;
}
