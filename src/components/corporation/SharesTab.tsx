"use client";

import { useState, useEffect } from "react";
import { Toast } from "@/components/ui";
import type { ToastVariant } from "@/components/ui/Toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { useShareOrders, useShareTrading } from "./shares/hooks";
import type { CorporationDetail } from "./CorporationPageTypes";
import MarketOverviewPanel from "./shares/MarketOverviewPanel";
import MyHoldingsPanel from "./shares/MyHoldingsPanel";
import OpenOrdersPanel from "./shares/OpenOrdersPanel";
import PrivateSalePanel from "./shares/PrivateSalePanel";
import ShareStructurePanel from "./shares/ShareStructurePanel";
import ShareHistoryPanel from "./shares/ShareHistoryPanel";
import SignInPrompt from "./shares/SignInPrompt";
import SharePurchaseModal from "./shares/SharePurchaseModal";
import ShareIssuanceModal from "./shares/ShareIssuanceModal";
import { CorporationVoteCard } from "./votes/CorporationVoteCard";
import { fetchJson } from "@/lib/observability/fetchJson";

type SharesSubTab = "market" | "history";

// ─── Shares Tab Component ─────────────────────────────────────────────────────

interface SharesTabProps {
  corporation: CorporationDetail;
  myCharacterId: string | null;
  myCashOnHand: number;
  myCurrencyBalances?: Partial<Record<string, number>>;
  myHomeCurrency?: string;
  autoConvertEnabled?: boolean;
  onAutoConvertChange?: (enabled: boolean) => void;
  isCeo: boolean;
  myCorporation?: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
  corpId: string;
  onRefresh: () => void;
}

export default function SharesTab({
  corporation,
  myCharacterId,
  myCashOnHand,
  myCurrencyBalances,
  myHomeCurrency,
  autoConvertEnabled,
  onAutoConvertChange,
  isCeo,
  myCorporation,
  corpId,
  onRefresh,
}: SharesTabProps) {
  // ─── Sub-tab + modal visibility ───────────────────────────────────────────────
  const [activeSubTab, setActiveSubTab] = useState<SharesSubTab>("market");
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showIssuanceModal, setShowIssuanceModal] = useState(false);
  const [openVotes, setOpenVotes] = useState<{ _id: string; type: string }[]>([]);

  useEffect(() => {
    const id = corporation.sequentialId ?? corporation._id;
    fetchJson<unknown>(`/api/corporations/${id}/votes?status=open`, {
      feature: "corp-open-votes",
    })
      .then((data) => {
        if (Array.isArray(data)) setOpenVotes(data as { _id: string; type: string }[]);
      })
      .catch(() => {});
  }, [corporation._id, corporation.sequentialId]);

  // ─── Toast notifications ──────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const setActionError = (msg: string) => {
    if (msg) setToast({ message: msg, variant: "error" });
    else setToast(null);
  };
  const setActionSuccess = (msg: string) => {
    if (msg) setToast({ message: msg, variant: "success" });
    else setToast(null);
  };

  // ─── Data fetching ────────────────────────────────────────────────────────────
  const { myOrders, marketOrders, fillAmounts, setFillAmounts, refreshOrders } =
    useShareOrders(corpId);

  // ─── Trading logic ────────────────────────────────────────────────────────────
  const trading = useShareTrading({
    corporation,
    myCharacterId,
    myCashOnHand,
    isCeo,
    corpId,
    onRefresh,
    setToast,
    refreshOrders,
    marketOrders,
    myCorporation,
  });

  // ─── Derived values ───────────────────────────────────────────────────────────
  // escrowAmount is stored in the target corp's liquidCurrencyCode (Option B).
  // All orders on this tab share the same target (this corp) so we can sum in
  // local and then normalize to ₳ once for the wallet-aware display.
  const { toInternalFrom } = useCurrency();
  const corpCurrencyCode = corporation.liquidCurrencyCode as CurrencyCode | undefined;
  const myEscrowedLocal = myOrders
    .filter((o) => o.type === "buy")
    .reduce((sum, o) => sum + o.escrowAmount, 0);
  const myEscrowedTotal = corpCurrencyCode
    ? toInternalFrom(myEscrowedLocal, corpCurrencyCode)
    : myEscrowedLocal;

  function handleTradeSuccess() {
    onRefresh();
    void refreshOrders();
  }

  // Vote weights for dual-class (supershare) corps: founder supershares count
  // superShareMultiplier votes each; everything else is one share one vote.
  const superMultiplier = corporation.superShareMultiplier ?? 1;
  const totalVotingPower =
    (corporation.totalShares ?? 0) +
    (superMultiplier > 1
      ? corporation.shareholders.reduce(
          (sum, sh) => sum + Math.min(sh.superShares ?? 0, sh.shares) * (superMultiplier - 1),
          0
        )
      : 0);
  const myEntry = myCharacterId
    ? corporation.shareholders.find((sh) => sh.characterId === myCharacterId)
    : undefined;
  const myVotingPower =
    (trading.myShares ?? 0) +
    (superMultiplier > 1 && myEntry
      ? Math.min(myEntry.superShares ?? 0, myEntry.shares) * (superMultiplier - 1)
      : 0);

  return (
    <div className="space-y-6">
      {toast && (
        <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />
      )}

      {/* ─── Trade / Issue modals (shared across sub-tabs) ───────────────── */}
      {showPurchaseModal && myCharacterId && (
        <SharePurchaseModal
          corporation={corporation}
          corpId={corpId}
          myCharacterId={myCharacterId}
          myCashOnHand={myCashOnHand}
          myCurrencyBalances={myCurrencyBalances}
          myHomeCurrency={myHomeCurrency}
          autoConvertEnabled={autoConvertEnabled}
          onAutoConvertChange={onAutoConvertChange}
          myShares={trading.myShares}
          myCorporation={myCorporation ?? null}
          myOrders={myOrders}
          marketOrders={marketOrders}
          isCeo={isCeo}
          onClose={() => setShowPurchaseModal(false)}
          onSuccess={handleTradeSuccess}
        />
      )}

      {showIssuanceModal && isCeo && (
        <ShareIssuanceModal
          corporation={corporation}
          corpId={corpId}
          myCashOnHand={myCashOnHand}
          myCurrencyBalances={myCurrencyBalances}
          issuanceOnCooldown={trading.issuanceOnCooldown}
          issuanceCooldownRemaining={trading.issuanceCooldownRemaining}
          onClose={() => setShowIssuanceModal(false)}
          onSuccess={handleTradeSuccess}
        />
      )}

      {/* ─── Sub-tab bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 w-fit border border-card-border">
        {[
          { key: "market" as const, label: "Market Overview" },
          { key: "history" as const, label: "Share History" },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveSubTab(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeSubTab === key
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSubTab === "market" && (
        <>
          {/* ─── Market overview + chart + shareholders ─────────────────── */}
          <MarketOverviewPanel
            corporation={corporation}
            myCharacterId={myCharacterId}
            corpId={corpId}
            onTrade={myCharacterId ? () => setShowPurchaseModal(true) : undefined}
            onIssue={isCeo ? () => setShowIssuanceModal(true) : undefined}
            onRefresh={onRefresh}
            setActionError={setActionError}
            setActionSuccess={setActionSuccess}
          />

          {/* ─── Holdings + quick sell ──────────────────────────────────── */}
          {myCharacterId && (
            <MyHoldingsPanel
              myShares={trading.myShares}
              myShareValue={trading.myShareValue}
              myOwnershipPct={trading.myOwnershipPct}
              myCashOnHand={myCashOnHand}
              myEscrowedTotal={myEscrowedTotal}
            />
          )}

          {/* ─── Orderbook (other players' open orders to fill) ─────────── */}
          {marketOrders.length > 0 && (
            <OpenOrdersPanel
              marketOrders={marketOrders}
              myCharacterId={myCharacterId}
              corpCurrencyCode={corpCurrencyCode}
              myCorporation={myCorporation ?? null}
              fillAmounts={fillAmounts}
              setFillAmounts={setFillAmounts}
              fillAskAsCorp={trading.fillAskAsCorp}
              setFillAskAsCorp={trading.setFillAskAsCorp}
              loading={trading.loading}
              handleFillOrder={trading.handleFillOrder}
              handleCancelOrder={trading.handleCancelOrder}
            />
          )}

          {/* ─── Private sale listings ──────────────────────────────────── */}
          {myCharacterId && (
            <PrivateSalePanel
              corporation={corporation}
              myCharacterId={myCharacterId}
              corpId={corpId}
              myShares={trading.myShares}
              isCeo={isCeo}
              onToast={(message, variant) => setToast({ message, variant })}
            />
          )}

          {/* ─── CEO: share structure (splits / consolidations) ─────────── */}
          {isCeo && <ShareStructurePanel corporation={corporation} trading={trading} />}

          {/* ─── Open shareholder votes ──────────────────────────────────── */}
          {openVotes.map((v) => (
            <CorporationVoteCard
              key={v._id}
              corporationId={String(corporation.sequentialId ?? corporation._id)}
              voteId={v._id}
              isCeo={isCeo}
              viewerCharacterId={myCharacterId ?? undefined}
              viewerShares={trading.myShares ?? 0}
              totalShares={corporation.totalShares ?? 0}
              viewerVotingPower={myVotingPower}
              totalVotingPower={totalVotingPower}
              currentTurn={corporation.currentTurn}
              onResolved={() => setOpenVotes((prev) => prev.filter((x) => x._id !== v._id))}
            />
          ))}

          {!myCharacterId && <SignInPrompt />}
        </>
      )}

      {activeSubTab === "history" && <ShareHistoryPanel corpId={corpId} />}
    </div>
  );
}
