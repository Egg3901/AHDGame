/**
 * The three NPP market sweeps (bond buy, stock buy, stock sell) on a fixed
 * fixture. The command cores are stubbed, so these tests pin DECISIONS: which
 * NPP buys or sells what, and how much. Below v6 the decisions are pinned
 * exactly; at v6 (NPP engine 6, opportunity-driven investing) they are checked
 * for their shape and for volume.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";

vi.mock("@/lib/nppAutonomy/v3/finance/nppShares", () => ({
  nppBuyShares: vi.fn(async () => ({ ok: true })),
  nppSellShares: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/nppAutonomy/v3/finance/nppBonds", () => ({
  nppBuyBond: vi.fn(async () => ({ ok: true })),
}));

import { nppBuyShares, nppSellShares } from "@/lib/nppAutonomy/v3/finance/nppShares";
import { nppBuyBond } from "@/lib/nppAutonomy/v3/finance/nppBonds";
import {
  investNppBondSurplus,
  investNppStockSurplus,
  sellNppStockSurplus,
} from "./nppActionProcessing";

const COUNTRIES = [
  { id: "US", currency: "USD" },
  { id: "UK", currency: "GBP" },
  { id: "JP", currency: "JPY" },
] as const;

function idFor(kind: number, i: number): ObjectId {
  return ObjectId.createFromHexString(
    kind.toString(16).padStart(2, "0") + i.toString(16).padStart(22, "0")
  );
}

/** Small LCG so the fixture is the same on every run without Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function label(id: ObjectId): string {
  const hex = id.toHexString();
  return `${hex.slice(0, 2)}:${parseInt(hex.slice(2), 16)}`;
}

/** One market per country: NPPs with cash, listed corps, bonds, and NPP holdings. */
function buildFixture(): Db {
  const rand = lcg(1953);
  const db = createInMemoryDb();
  const npps: Record<string, unknown>[] = [];
  const corps: Record<string, unknown>[] = [];
  const bonds: Record<string, unknown>[] = [];
  let nppIndex = 0;
  let corpIndex = 0;
  let bondIndex = 0;
  for (const country of COUNTRIES) {
    const countryNpps: ObjectId[] = [];
    for (let i = 0; i < 120; i++) {
      const _id = idFor(1, nppIndex++);
      countryNpps.push(_id);
      npps.push({
        _id,
        countryId: country.id,
        retiredAt: null,
        personality: {
          loyalty: 50,
          ambition: Math.floor(rand() * 101),
          stubbornness: Math.floor(rand() * 101),
        },
        nppInvestmentCashAnchor: 4_000 + Math.floor(rand() * 40_000),
      });
    }
    for (let c = 0; c < 12; c++) {
      const sharePrice = 5 + Math.floor(rand() * 95);
      // Value ratio spread across roughly 0.6x to 1.6x of the price.
      const fundamentalSharePrice = Math.round(sharePrice * (0.6 + rand()) * 100) / 100;
      const holders = [0, 1, 2, 3].map((k) => ({
        nppId: countryNpps[(c * 7 + k * 13) % countryNpps.length],
        shares: 100 + Math.floor(rand() * 5_000),
      }));
      corps.push({
        _id: idFor(2, corpIndex++),
        countryId: country.id,
        liquidCurrencyCode: country.currency,
        sharePrice,
        fundamentalSharePrice,
        totalShares: 10_000_000,
        publicFloat: 200_000 + Math.floor(rand() * 2_000_000),
        shareholders: holders,
        ceoId: holders[0].nppId,
      });
    }
    for (let b = 0; b < 6; b++) {
      bonds.push({
        _id: idFor(3, bondIndex++),
        countryId: country.id,
        currencyCode: country.currency,
        maturityTurn: 10_000,
        publicFloat: 1_000 + Math.floor(rand() * 50_000),
        marketPrice: 0.85 + rand() * 0.3,
        couponRate: Math.round((0.5 + rand() * 6) * 100) / 100,
      });
    }
  }
  db.seed("npps", npps);
  db.seed("corporations", corps);
  db.seed("bonds", bonds);
  db.seed("exchangeRates", []);
  return db as unknown as Db;
}

type Call = string;

function buyCalls(): Call[] {
  return vi
    .mocked(nppBuyShares)
    .mock.calls.map(([, npp, corpId, shares]) => `${label(npp._id)}>${label(corpId)}x${shares}`);
}
function bondCalls(): Call[] {
  return vi
    .mocked(nppBuyBond)
    .mock.calls.map(([, npp, bondId, units]) => `${label(npp._id)}>${label(bondId)}x${units}`);
}
function sellCalls(): Call[] {
  return vi
    .mocked(nppSellShares)
    .mock.calls.map(([, npp, corpId, shares]) => `${label(npp._id)}<${label(corpId)}x${shares}`);
}

const TURNS = [100, 104, 108, 112, 116, 120, 124, 128];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NPP market sweeps below v6", () => {
  it("keeps the engine 5 stock buy decisions", async () => {
    await investNppStockSurplus(buildFixture(), 100);
    expect(buyCalls()).toMatchInlineSnapshot(`
      [
        "01:1>02:0x265",
        "01:26>02:6x52",
        "01:44>02:1x69",
        "01:69>02:1x98",
        "01:90>02:1x39",
        "01:91>02:11x292",
        "01:103>02:1x6",
        "01:122>02:21x110",
        "01:137>02:22x40",
        "01:143>02:20x1368",
        "01:161>02:22x73",
        "01:185>02:17x18",
        "01:186>02:12x174",
        "01:187>02:17x102",
        "01:201>02:12x3",
        "01:217>02:22x95",
        "01:240>02:32x210",
        "01:242>02:35x218",
        "01:244>02:35x168",
        "01:263>02:35x210",
        "01:282>02:35x153",
        "01:292>02:25x138",
        "01:293>02:33x420",
        "01:314>02:35x111",
        "01:318>02:34x194",
        "01:319>02:35x379",
        "01:330>02:30x801",
        "01:342>02:24x150",
      ]
    `);
  });

  it("keeps the engine 5 bond buy decisions", async () => {
    await investNppBondSurplus(buildFixture(), 100);
    expect(bondCalls()).toMatchInlineSnapshot(`
      [
        "01:9>03:3x8",
        "01:20>03:3x3",
        "01:30>03:3x2",
        "01:34>03:0x5",
        "01:38>03:3x19",
        "01:49>03:0x8",
        "01:77>03:0x3",
        "01:93>03:2x18",
        "01:105>03:3x6",
        "01:109>03:4x4",
        "01:118>03:2x3",
        "01:151>03:8x10",
        "01:163>03:7x16",
        "01:206>03:8x6",
        "01:224>03:10x1",
        "01:229>03:10x8",
        "01:278>03:16x16",
        "01:317>03:17x4",
        "01:323>03:14x6",
        "01:324>03:14x13",
        "01:328>03:13x1",
        "01:332>03:13x5",
        "01:338>03:12x15",
      ]
    `);
  });

  it("keeps the engine 5 stock sell decisions", async () => {
    await sellNppStockSurplus(buildFixture(), 100);
    expect(sellCalls()).toMatchInlineSnapshot(`
      [
        "01:168<02:17x491",
      ]
    `);
  });

  it("keeps the engine 5 purchase counts over eight cycles", async () => {
    const counts = { stock: 0, bond: 0, sell: 0 };
    for (const turn of TURNS) {
      vi.clearAllMocks();
      await investNppStockSurplus(buildFixture(), turn);
      await investNppBondSurplus(buildFixture(), turn);
      await sellNppStockSurplus(buildFixture(), turn);
      counts.stock += buyCalls().length;
      counts.bond += bondCalls().length;
      counts.sell += sellCalls().length;
    }
    expect(counts).toMatchInlineSnapshot(`
      {
        "bond": 126,
        "sell": 21,
        "stock": 225,
      }
    `);
  });
});
