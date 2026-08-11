import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import {
  accumulateMoneyGraphRows,
  createAccumulator,
  maskMoneyGraphName,
  MONEY_GRAPH_MAX_NODES,
  buildMoneyGraphFilter,
} from "./moneyGraph";

function makeTxRow(overrides: Partial<FinancialTxLogEntry>): FinancialTxLogEntry {
  return {
    _id: new ObjectId(),
    type: "wire_transfer_out",
    turn: 10,
    createdAt: new Date(),
    expiresAt: new Date(),
    subjectType: "character",
    subjectName: "Subject",
    amount: -100,
    currencyCode: "USD",
    flagged: false,
    ...overrides,
  } as FinancialTxLogEntry;
}

describe("accumulateMoneyGraphRows", () => {
  it("builds an A->B->A cycle from two opposing transfers", () => {
    const alice = new ObjectId();
    const bob = new ObjectId();

    const rows: FinancialTxLogEntry[] = [
      // Alice sends 1000 to Bob (debit on Alice's row).
      makeTxRow({
        subjectId: alice,
        subjectName: "Alice",
        amount: -1000,
        counterpartyType: "character",
        counterpartyId: bob,
        counterpartyName: "Bob",
      }),
      // Bob sends 500 back to Alice.
      makeTxRow({
        subjectId: bob,
        subjectName: "Bob",
        amount: -500,
        counterpartyType: "character",
        counterpartyId: alice,
        counterpartyName: "Alice",
      }),
    ];

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true });

    const nodeIds = [...acc.nodes.keys()].sort();
    expect(nodeIds).toEqual([alice.toHexString(), bob.toHexString()].sort());
    expect(acc.nodes.get(alice.toHexString())?.name).toBe("Alice");
    expect(acc.nodes.get(bob.toHexString())?.name).toBe("Bob");

    const edges = [...acc.edges.values()];
    expect(edges).toHaveLength(2);

    const aliceToBob = edges.find(
      (e) => e.from === alice.toHexString() && e.to === bob.toHexString()
    );
    const bobToAlice = edges.find(
      (e) => e.from === bob.toHexString() && e.to === alice.toHexString()
    );
    expect(aliceToBob).toMatchObject({ totalAmount: 1000, txCount: 1, currencyCode: "USD" });
    expect(bobToAlice).toMatchObject({ totalAmount: 500, txCount: 1, currencyCode: "USD" });

    // Both endpoints should have been added to the BFS frontier.
    expect([...acc.frontier.keys()].sort()).toEqual(
      [alice.toHexString(), bob.toHexString()].sort()
    );
  });

  it("aggregates a fan-in from three distinct senders into one recipient", () => {
    const recipient = new ObjectId();
    const senders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const amounts = [300, 400, 250];

    const rows: FinancialTxLogEntry[] = senders.map((sender, i) =>
      makeTxRow({
        subjectId: recipient,
        subjectName: "Recipient",
        amount: amounts[i], // positive = recipient received from sender
        counterpartyType: "character",
        counterpartyId: sender,
        counterpartyName: `Sender${i}`,
      })
    );

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true });

    expect(acc.nodes.size).toBe(4); // recipient + 3 senders
    const edges = [...acc.edges.values()];
    expect(edges).toHaveLength(3);
    for (let i = 0; i < senders.length; i++) {
      const edge = edges.find((e) => e.from === senders[i].toHexString());
      expect(edge).toMatchObject({
        to: recipient.toHexString(),
        totalAmount: amounts[i],
        txCount: 1,
      });
    }
  });

  it("aggregates repeated transfers between the same pair by summing amount and count", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const rows: FinancialTxLogEntry[] = [
      makeTxRow({
        subjectId: a,
        subjectName: "A",
        amount: -100,
        counterpartyType: "character",
        counterpartyId: b,
        counterpartyName: "B",
      }),
      makeTxRow({
        subjectId: a,
        subjectName: "A",
        amount: -250,
        counterpartyType: "character",
        counterpartyId: b,
        counterpartyName: "B",
      }),
    ];

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true });

    const edges = [...acc.edges.values()];
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ totalAmount: 350, txCount: 2 });
  });

  it("keeps multi-currency flow between the same pair as separate edges", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const rows: FinancialTxLogEntry[] = [
      makeTxRow({
        subjectId: a,
        amount: -100,
        currencyCode: "USD",
        counterpartyType: "character",
        counterpartyId: b,
      }),
      makeTxRow({
        subjectId: a,
        amount: -100,
        currencyCode: "EUR",
        counterpartyType: "character",
        counterpartyId: b,
      }),
    ];

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true });

    expect(acc.edges.size).toBe(2);
    const currencies = [...acc.edges.values()].map((e) => e.currencyCode).sort();
    expect(currencies).toEqual(["EUR", "USD"]);
  });

  it("drops admin_transfer rows for non-admin callers but keeps them for admins", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const row = makeTxRow({
      type: "admin_transfer",
      subjectId: a,
      amount: -1000,
      counterpartyType: "character",
      counterpartyId: b,
    });

    const modAcc = createAccumulator();
    accumulateMoneyGraphRows(modAcc, [row], { isAdmin: false });
    expect(modAcc.edges.size).toBe(0);
    expect(modAcc.nodes.size).toBe(0);

    const adminAcc = createAccumulator();
    accumulateMoneyGraphRows(adminAcc, [row], { isAdmin: true });
    expect(adminAcc.edges.size).toBe(1);
  });

  it("filters rows below minAmount", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const rows: FinancialTxLogEntry[] = [
      makeTxRow({ subjectId: a, amount: -50, counterpartyType: "character", counterpartyId: b }),
      makeTxRow({ subjectId: a, amount: -5000, counterpartyType: "character", counterpartyId: b }),
    ];

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true, minAmount: 1000 });

    expect(acc.edges.size).toBe(1);
    expect([...acc.edges.values()][0].totalAmount).toBe(5000);
  });

  it("skips self-transfers and rows with no counterparty", () => {
    const a = new ObjectId();
    const rows: FinancialTxLogEntry[] = [
      makeTxRow({ subjectId: a, amount: -10, counterpartyType: "character", counterpartyId: a }),
      makeTxRow({ subjectId: a, amount: 500 }), // no counterpartyType at all
    ];

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true });

    expect(acc.nodes.size).toBe(0);
    expect(acc.edges.size).toBe(0);
  });

  it("collapses government counterparties into a synthetic gov: node and never expands them", () => {
    const corp = new ObjectId();
    const row = makeTxRow({
      subjectType: "corporation",
      subjectId: corp,
      subjectName: "Acme Corp",
      amount: -1_000_000,
      type: "corp_tax_paid",
      counterpartyType: "government",
      counterpartyName: "US Treasury",
    });

    const acc = createAccumulator();
    accumulateMoneyGraphRows(acc, [row], { isAdmin: true });

    const govNode = [...acc.nodes.values()].find((n) => n.type === "government");
    expect(govNode?.id).toBe("gov:US Treasury");
    // Government nodes are never added to the expandable BFS frontier.
    expect(acc.frontier.has("gov:US Treasury")).toBe(false);
    expect(acc.frontier.has(corp.toHexString())).toBe(true);
  });

  it("stops adding new nodes once the node cap is hit and flags nodeCapHit", () => {
    const acc = createAccumulator();
    // Fill the accumulator to exactly the cap with distinct single-node edges
    // sharing one recipient, then push one more distinct sender past the cap.
    const recipient = new ObjectId();
    const rows: FinancialTxLogEntry[] = [];
    // recipient (1) + senders (MAX-1) = exactly MONEY_GRAPH_MAX_NODES nodes.
    for (let i = 0; i < MONEY_GRAPH_MAX_NODES - 1; i++) {
      const sender = new ObjectId();
      rows.push(
        makeTxRow({
          subjectId: recipient,
          amount: 10,
          counterpartyType: "character",
          counterpartyId: sender,
        })
      );
    }
    accumulateMoneyGraphRows(acc, rows, { isAdmin: true });
    expect(acc.nodes.size).toBe(MONEY_GRAPH_MAX_NODES);
    expect(acc.nodeCapHit).toBe(false);

    const overflowSender = new ObjectId();
    accumulateMoneyGraphRows(
      acc,
      [
        makeTxRow({
          subjectId: recipient,
          amount: 10,
          counterpartyType: "character",
          counterpartyId: overflowSender,
        }),
      ],
      { isAdmin: true }
    );
    expect(acc.nodes.size).toBe(MONEY_GRAPH_MAX_NODES);
    expect(acc.nodeCapHit).toBe(true);
  });
});

describe("maskMoneyGraphName", () => {
  it("returns the name unchanged for admins", () => {
    expect(maskMoneyGraphName("Alice", "character", true)).toBe("Alice");
  });

  it("truncates the name for non-admins on real accounts", () => {
    expect(maskMoneyGraphName("Alice", "character", false)).toBe("Al…");
    expect(maskMoneyGraphName("Acme Corp", "corporation", false)).toBe("Ac…");
  });

  it("leaves synthetic government/system labels unmasked for non-admins", () => {
    expect(maskMoneyGraphName("gov:US", "government", false)).toBe("gov:US");
    expect(maskMoneyGraphName("System", "system", false)).toBe("System");
  });

  it("passes through null names", () => {
    expect(maskMoneyGraphName(null, "character", false)).toBeNull();
  });
});

describe("buildMoneyGraphFilter", () => {
  it("excludes admin_transfer rows for non-admins and includes them for admins", () => {
    const ids = [new ObjectId()];
    const modFilter = buildMoneyGraphFilter(ids, 5, false) as Record<string, unknown>;
    expect(modFilter.type).toEqual({ $ne: "admin_transfer" });

    const adminFilter = buildMoneyGraphFilter(ids, 5, true) as Record<string, unknown>;
    expect(adminFilter.type).toBeUndefined();
  });

  it("filters on turn window and either side of the frontier", () => {
    const ids = [new ObjectId(), new ObjectId()];
    const filter = buildMoneyGraphFilter(ids, 42, true) as Record<string, unknown>;
    expect(filter.turn).toEqual({ $gte: 42 });
    expect(filter.$or).toEqual([{ subjectId: { $in: ids } }, { counterpartyId: { $in: ids } }]);
  });
});
