"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
  totalVotingPower as computeTotalVotingPower,
  shareholderVotingPower,
} from "@/lib/corporations/superShares";
import OwnershipOverview from "./shares/OwnershipOverview";
import OwnershipHistoryPanel from "./shares/OwnershipHistoryPanel";
import SignInPrompt from "./shares/SignInPrompt";
import SharePurchaseModal from "./shares/SharePurchaseModal";
import ShareIssuanceModal from "./shares/ShareIssuanceModal";
import { CorporationVoteCard } from "./votes/CorporationVoteCard";
import { fetchJson } from "@/lib/observability/fetchJson";
import { DenseSection, Segmented } from "./dense/DenseKit";

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
    isInvestmentBank?: boolean;
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
  // `?trade=1` (the masthead's Trade button) opens the ticket on arrival.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tradeRequested = searchParams.get("trade") === "1";
  const purchaseOpen = showPurchaseModal || tradeRequested;
  const closePurchase = () => {
    setShowPurchaseModal(false);
    if (tradeRequested) {
      const p = new URLSearchParams(searchParams.toString());
      p.delete("trade");
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }
  };
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

  const totalVotingPower = computeTotalVotingPower(corporation);
  const myEntry = myCharacterId
    ? corporation.shareholders.find((sh) => sh.characterId === myCharacterId)
    : undefined;
  const myVotingPower = shareholderVotingPower(corporation, {
    shares: trading.myShares ?? 0,
    superShares: myEntry?.superShares,
  });

  return (
    <div className="space-y-6">
      {toast && (
        <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />
      )}

      {/* ─── Trade / Issue modals (shared across sub-tabs) ───────────────── */}
      {purchaseOpen && myCharacterId && (
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
          onClose={closePurchase}
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

      <OwnershipOverview corporation={corporation} />

      <Segmented
        ariaLabel="Shares view"
        options={[
          { value: "market", label: "Market" },
          { value: "history", label: "History" },
        ]}
        value={activeSubTab}
        onChange={setActiveSubTab}
      />

      {activeSubTab === "market" && (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
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

            {openVotes.length > 0 && (
              <DenseSection title="Shareholder votes" meta={`${openVotes.length} open`}>
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
              </DenseSection>
            )}

            {/* Other players' open orders, filled from the row */}
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
          </div>

          <aside className="min-w-0 space-y-6">
            {myCharacterId && (
              <MyHoldingsPanel
                myShares={trading.myShares}
                myShareValue={trading.myShareValue}
                myOwnershipPct={trading.myOwnershipPct}
                myCashOnHand={myCashOnHand}
                myEscrowedTotal={myEscrowedTotal}
              />
            )}
            {isCeo && <ShareStructurePanel corporation={corporation} trading={trading} />}
            {!myCharacterId && <SignInPrompt />}
          </aside>
        </div>
      )}

      {activeSubTab === "history" && (
        <div className="space-y-6">
          <OwnershipHistoryPanel corpId={corpId} corporation={corporation} />
          <ShareHistoryPanel corpId={corpId} />
        </div>
      )}
    </div>
  );
}
