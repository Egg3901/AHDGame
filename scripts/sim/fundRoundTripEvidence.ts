/** Pure, read-only acceptance checks for a completed #2120 sandbox run. */
export type FundRow = {
  _id: { toString(): string };
  kind: string;
  status: string;
  quotedNav: number;
  unitSupply: number;
  cashAnchor: number;
  backingRatio?: number;
  holdings: { corporationId: { toString(): string }; shares: number; lastValueAnchor?: number }[];
};
export type FundTx = {
  fundId: { toString(): string };
  kind: string;
  nppId?: { toString(): string };
  units?: number;
  navAnchor?: number;
  amountAnchor: number;
};
export type QueueRow = {
  fundId: { toString(): string };
  nppId?: { toString(): string };
  status: string;
  units: number;
  unitsBurnedAtRequest?: boolean;
  paidAmountAnchor: number;
};
export type PositionRow = {
  fundId: { toString(): string };
  holderKind: string;
  nppId?: { toString(): string };
  units: number;
};
export type OrderRow = {
  placerFundId?: { toString(): string };
  type: string;
  liquidityProvider?: boolean;
  status: string;
  shares: number;
  sharesRemaining: number;
  pricePerShare: number;
  escrowAnchor?: number;
};
export type FacilityRow = { enabled: boolean; bidQuotesPlaced: number; bidDepthAnchor: number };

export type EvidenceInput = {
  requestedCommit: string;
  executedCommit: string | null;
  collectorCommit: string | null;
  requestedRedemptionFlag: boolean | null;
  initialRedemptionFlag: boolean | null;
  finalRedemptionFlag: boolean | null;
  indexFundsMode: string | null;
  equityLiquidityFacilityEnabled: boolean | null;
  indexFundBondLiquidityEnabled: boolean | null;
  funds: FundRow[];
  corporationIds: string[];
  nppIds: string[];
  transactions: FundTx[];
  queue: QueueRow[];
  positions: PositionRow[];
  orders: OrderRow[];
  facility: FacilityRow[];
  bondValueByFund: Record<string, number>;
};

const id = (value: { toString(): string }) => value.toString();
const finiteNonnegative = (value: number) => Number.isFinite(value) && value >= 0;
const near = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** A passing report is evidence about persisted rows, not a simulation trigger. */
export function evaluateFundRoundTrip(input: EvidenceInput) {
  const failures: string[] = [];
  const unavailable: string[] = [];
  const fail = (message: string) => failures.push(message);
  if (
    !/^[0-9a-f]{40}$/.test(input.requestedCommit) ||
    input.executedCommit !== input.requestedCommit ||
    input.collectorCommit !== input.requestedCommit
  )
    fail("source pin or collector SHA mismatch");
  if (
    input.requestedRedemptionFlag !== true ||
    input.initialRedemptionFlag !== true ||
    input.finalRedemptionFlag !== true
  )
    fail("NPP redemption flag not proven enabled for this run");
  if (input.indexFundsMode !== "full") fail("indexFundsMode was not full");
  if (input.equityLiquidityFacilityEnabled !== true)
    fail("equity liquidity facility was not enabled");

  const fundIds = new Set(input.funds.map((fund) => id(fund._id)));
  const corporationIds = new Set(input.corporationIds);
  const nppIds = new Set(input.nppIds);
  const nppSubscriptions = input.transactions.filter(
    (tx) => tx.kind === "subscription" && tx.nppId
  );
  const nppRedemptions = input.transactions.filter((tx) => tx.kind === "redemption" && tx.nppId);
  const nppQueued = input.queue.filter((row) => row.nppId);
  if (!nppSubscriptions.length) fail("no persisted NPP subscription");
  if (!nppRedemptions.length) fail("no persisted NPP redemption payout");
  if (!nppQueued.length) fail("no persisted NPP redemption queue row");
  const subscriptionPairs = new Set(
    nppSubscriptions.map((tx) => `${id(tx.fundId)}:${id(tx.nppId!)}`)
  );
  if (!nppRedemptions.some((tx) => subscriptionPairs.has(`${id(tx.fundId)}:${id(tx.nppId!)}`))) {
    fail("no NPP and fund pair completed both subscription and redemption");
  }
  for (const tx of nppRedemptions) {
    if (
      !finiteNonnegative(tx.amountAnchor) ||
      !Number.isInteger(tx.units) ||
      (tx.units ?? 0) <= 0 ||
      !Number.isFinite(tx.navAnchor) ||
      (tx.navAnchor ?? 0) <= 0 ||
      !near(tx.amountAnchor, tx.units! * tx.navAnchor!)
    ) {
      fail(`NPP payout not NAV matched for fund ${id(tx.fundId)}`);
    }
  }
  for (const row of nppQueued) {
    if (
      row.status !== "paid" ||
      row.units !== 0 ||
      !finiteNonnegative(row.paidAmountAnchor) ||
      row.paidAmountAnchor <= 0
    )
      fail(`NPP queue did not finish for fund ${id(row.fundId)}`);
  }
  for (const tx of nppRedemptions) {
    const key = `${id(tx.fundId)}:${id(tx.nppId!)}`;
    const paidRows = nppQueued.filter(
      (row) => `${id(row.fundId)}:${id(row.nppId!)}` === key && row.status === "paid"
    );
    if (!paidRows.length) fail(`no paid queue row for NPP redemption ${key}`);
  }
  for (const position of input.positions) {
    if (
      !fundIds.has(id(position.fundId)) ||
      !Number.isInteger(position.units) ||
      position.units <= 0 ||
      (position.holderKind === "npp" && (!position.nppId || !nppIds.has(id(position.nppId))))
    ) {
      fail(`orphan or invalid fund position for fund ${id(position.fundId)}`);
    }
  }
  const openEscrow = new Map<string, number>();
  for (const order of input.orders) {
    if (!order.placerFundId || order.type !== "buy" || order.status !== "open") continue;
    const key = id(order.placerFundId);
    openEscrow.set(key, (openEscrow.get(key) ?? 0) + (order.escrowAnchor ?? 0));
  }
  const backing: { fundId: string; ratio: number; cashShare: number; reserveShare: number }[] = [];
  const activeFunds = input.funds.filter((fund) => fund.status === "active");
  if (!activeFunds.length) fail("no active index funds to qualify");
  for (const fund of activeFunds) {
    const key = id(fund._id);
    for (const holding of fund.holdings) {
      if (
        !corporationIds.has(id(holding.corporationId)) ||
        !Number.isInteger(holding.shares) ||
        holding.shares <= 0
      ) {
        fail(`orphan or invalid corporation holding for fund ${key}`);
      }
    }
    const bonds = input.bondValueByFund[key];
    if (!finiteNonnegative(bonds)) {
      fail(`bond book value missing for fund ${key}`);
      continue;
    }
    const holdings = fund.holdings.reduce(
      (sum, row) => sum + (row.lastValueAnchor ?? Number.NaN),
      0
    );
    const escrow = openEscrow.get(key) ?? 0;
    const queuedUnits = input.queue
      .filter((row) => id(row.fundId) === key && row.unitsBurnedAtRequest === true)
      .reduce((sum, row) => sum + row.units, 0);
    const assets = fund.cashAnchor + holdings + bonds + escrow;
    const liability = fund.quotedNav * (fund.unitSupply + queuedUnits);
    const ratio = liability > 0 ? assets / liability : 1;
    // Allocation uses cash + equities + bonds. Open buy escrow backs NAV but
    // has already left deployable cash, so it is not an allocation reserve.
    const allocationBacking = fund.cashAnchor + holdings + bonds;
    const cashShare = allocationBacking > 0 ? fund.cashAnchor / allocationBacking : 0;
    const reserveShare = allocationBacking > 0 ? (fund.cashAnchor + bonds) / allocationBacking : 0;
    backing.push({ fundId: key, ratio, cashShare, reserveShare });
    if (
      !finiteNonnegative(assets) ||
      !finiteNonnegative(liability) ||
      !Number.isFinite(ratio) ||
      ratio < 0.9 ||
      (fund.backingRatio !== undefined && !near(ratio, fund.backingRatio))
    ) {
      fail(`fund backing unhealthy or inconsistent for ${key}`);
    }
    if (fund.kind !== "bond" && reserveShare < 0.25 - 1e-6)
      fail(`fund ${key} reserve below 25 percent`);
    if (input.indexFundBondLiquidityEnabled === true && cashShare < 0.05 - 1e-6) {
      fail(`fund ${key} cash buffer below 5 percent`);
    }
  }
  const placedBids = input.facility.reduce(
    (sum, row) => sum + (row.enabled ? row.bidQuotesPlaced : 0),
    0
  );
  const executableBids = input.orders.filter(
    (order) =>
      order.placerFundId &&
      order.type === "buy" &&
      order.liquidityProvider === true &&
      order.shares > 0 &&
      order.pricePerShare > 0 &&
      (order.status === "filled" || (order.status === "open" && order.sharesRemaining > 0))
  );
  if (placedBids <= 0 || executableBids.length === 0) fail("no persisted executable fund bid");
  const filledBids = executableBids.filter((order) => order.status === "filled").length;
  if (filledBids === 0) fail("no persisted fund bid fill");
  unavailable.push(
    filledBids === 0
      ? "A standing bid is visible, but a sell-flow fill is not proven by these rows."
      : "A fund bid filled, but persisted order rows do not distinguish the sell flow from the turn matcher."
  );
  unavailable.push(
    "No per-turn NPP wallet snapshots or queue-to-transaction ID link: payout credit and exact queue pairing cannot be independently proven."
  );
  return {
    passed: failures.length === 0,
    failures,
    unavailable,
    counts: {
      subscriptions: nppSubscriptions.length,
      nppRedemptions: nppRedemptions.length,
      nppQueueRows: nppQueued.length,
      positions: input.positions.length,
      placedBids,
      executableBids: executableBids.length,
      filledBids,
    },
    backing,
  };
}
