import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { publishTender, submitBid, awardTender } from "./commands";
import { settleTenderSigningFee } from "./signingFee";
import { tenders, ensureGovernmentContractIndexes } from "./persistence";
import { tenderView } from "./queries";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { lotProductionCost, lotPriceBand } from "@/lib/military/defenceLotEconomics";
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: async () => ({ currentTurn: 1, preset: "1953-default" }),
}));
vi.mock("@/lib/turn/ensureFederalBudget", () => ({
  ensureFederalBudget: async (db: Db, countryId: string) =>
    db.collection("federalBudget").findOne({ countryId }),
}));
const government = {
  userId: new ObjectId().toHexString(),
  isAdmin: true,
  hasCharacter: false,
} as AuthUserWithCharacter;
const owner = new ObjectId(),
  corpId = new ObjectId(),
  sectorId = new ObjectId();
const ceo = {
  userId: owner.toHexString(),
  isAdmin: false,
  hasCharacter: false,
} as AuthUserWithCharacter;
const now = new Date("2026-10-14T12:00:00Z");
describe.skipIf(!REAL_MONGO_ENABLED)(
  "complete government bidding on owned standalone Mongo",
  () => {
    let f: IsolatedMongod;
    beforeAll(async () => {
      f = await startIsolatedMongod("ahd-contract-flow-");
    }, 40000);
    afterAll(async () => {
      if (f) await stopIsolatedMongod(f);
    }, 25000);
    beforeEach(async () => {
      await f.db.dropDatabase();
      await ensureGovernmentContractIndexes(f.db);
      await f.db.collection("gameConfig").insertOne({
        _id: "default" as never,
        contractIssuanceEnabled: true,
        treasuryCashLedgerEnabled: false,
      });
      await f.db.collection("federalBudget").insertOne({
        _id: "US" as never,
        countryId: "US",
        gdp: 387e9,
        treasuryBalance: 1000,
        spending: { byCategory: { defense: 100e9 } },
        defenseAppropriation: {
          balance: 100e9,
          encumbered: 0,
          accruedThroughTurn: 1,
          arrearsRatio: 0,
        },
      });
      await f.db
        .collection("stateResourceCapacity")
        .insertOne({ countryId: "US", stateId: "TX", resources: { oil: 1000 } });
      await f.db.collection("corporations").insertOne({
        _id: corpId,
        userId: owner,
        name: "Synthetic supplier",
        type: "extraction",
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 1000,
        totalShares: 100,
        shareholders: [],
      });
      await f.db.collection("corporateSectors").insertOne({
        _id: sectorId,
        corporationId: corpId,
        countryId: "US",
        stateId: "TX",
        sectorType: "extraction",
        strategyId: "standard",
        revenue: 1e9,
      });
    });

    it.each([6, 24, 48])(
      "starts a %s-turn bidding duration at the server's actual publication turn",
      async (biddingTurns) => {
        const id = await publishTender(
          f.db,
          "US",
          {
            title: "Server timed concession",
            description: "Synthetic server timed concession",
            biddingTurns,
            terms: {
              type: "extraction",
              stateId: "TX",
              resource: "oil",
              share: 0.1,
              termTurns: 48,
              royaltyRatePerTurn: 0.01,
              minimumSigningFeeAnchor: 0,
            },
          },
          government,
          20,
          now
        );
        const tender = (await tenders(f.db).findOne({ _id: id }))!;
        expect(tender.closesTurn).toBe(20 + biddingTurns);
        expect(tender.awardDeadlineTurn).toBe(20 + biddingTurns + 24);
        expect(tender).not.toHaveProperty("biddingTurns");
      }
    );

    async function extraction() {
      const id = await publishTender(
        f.db,
        "US",
        {
          title: "Oil concession",
          description: "Synthetic resource concession",
          closesTurn: 7,
          awardDeadlineTurn: 31,
          terms: {
            type: "extraction",
            stateId: "TX",
            resource: "oil",
            share: 0.3,
            termTurns: 48,
            royaltyRatePerTurn: 0.01,
            minimumSigningFeeAnchor: 100,
          },
        },
        government,
        1,
        now
      );
      const row = (await tenders(f.db).findOne({ _id: id }))!;
      await submitBid(
        f.db,
        row,
        { corporationId: corpId.toHexString(), amount: 200, expectedRevision: 0 },
        ceo,
        1,
        now
      );
      return (await tenders(f.db).findOne({ _id: id }))!;
    }
    it("publishes untargeted concessions, seals bids and activates exactly one paid contract", async () => {
      const row = await extraction();
      expect((await tenderView(f.db, row, 1, government)).bids).toEqual([]);
      expect((await tenderView(f.db, row, 1, ceo)).bids[0].amount).toBe(200);
      expect(JSON.stringify(await tenderView(f.db, row, 7, government))).not.toContain(
        owner.toHexString()
      );
      await awardTender(
        f.db,
        row,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      await awardTender(
        f.db,
        (await tenders(f.db).findOne({ _id: row._id }))!,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      expect(
        await f.db.collection("extractionContracts").countDocuments({ status: "active" })
      ).toBe(1);
      expect((await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital).toBe(
        800
      );
      expect(
        (await f.db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance
      ).toBe(1200);
    });

    it.each(["owner", "shareholding"] as const)(
      "requires acknowledgement and discloses extraction %s interests exactly once",
      async (basis) => {
        let row = await extraction();
        const characterId = new ObjectId();
        const official = {
          ...government,
          userId: basis === "owner" ? owner.toHexString() : government.userId,
          hasCharacter: true,
          character: { _id: characterId, name: "Synthetic official" },
        } as AuthUserWithCharacter;
        await f.db.collection("characters").insertOne({ _id: characterId, favorability: 50 });
        if (basis === "shareholding")
          await f.db
            .collection("corporations")
            .updateOne({ _id: corpId }, { $set: { shareholders: [{ characterId, shares: 5 }] } });
        // A zero-fee concession is still a valuable resource allocation.
        await tenders(f.db).updateOne(
          { _id: row._id },
          {
            $set: {
              "terms.minimumSigningFeeAnchor": 0,
              [`bids.${corpId.toHexString()}.amount`]: 0,
            },
          }
        );
        row = (await tenders(f.db).findOne({ _id: row._id }))!;
        expect(
          (await tenderView(f.db, row, 7, official)).awardWarnings?.[corpId.toHexString()]
        ).toMatchObject({ basis, favorabilityPenalty: 4.1 });
        expect((await tenderView(f.db, row, 1, official)).awardWarnings).toEqual({});
        expect((await tenderView(f.db, row, 7, ceo)).awardWarnings).toBeUndefined();
        await expect(
          awardTender(
            f.db,
            row,
            corpId.toHexString(),
            "Synthetic concession award.",
            official,
            7,
            now
          )
        ).rejects.toThrow("Acknowledge the conflict");
        expect(await f.db.collection("extractionContracts").countDocuments()).toBe(0);
        expect(
          (await f.db.collection("characters").findOne({ _id: characterId }))?.favorability
        ).toBe(50);
        await awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Synthetic concession award.",
          official,
          7,
          now,
          true
        );
        // Recreate an interruption after disclosure but before the tender's completion marker.
        await tenders(f.db).updateOne({ _id: row._id }, { $set: { status: "awarding" } });
        await f.db
          .collection("corporations")
          .updateOne({ _id: corpId }, { $set: { userId: new ObjectId(), shareholders: [] } });
        await awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Synthetic concession award.",
          government,
          7,
          now
        );
        expect(
          (await f.db.collection("characters").findOne({ _id: characterId }))?.favorability
        ).toBe(45.9);
        expect(await f.db.collection("newsPosts").countDocuments()).toBe(1);
        const post = await f.db.collection("newsPosts").findOne({});
        expect(post?.content).toContain(
          basis === "owner" ? "owns Synthetic supplier" : "holds 5.0%"
        );
        expect(post?.content).toContain("30.0% of oil");
        const awarded = (await tenders(f.db).findOne({ _id: row._id }))!;
        expect((await tenderView(f.db, awarded, 7)).selfDealing).toEqual({
          ministerName: "Synthetic official",
          favorabilityPenalty: 4.1,
        });
      }
    );
    it("does not penalize an extraction interest below five percent", async () => {
      const row = await extraction();
      const characterId = new ObjectId();
      const official = {
        ...government,
        hasCharacter: true,
        character: { _id: characterId, name: "Synthetic official" },
      } as AuthUserWithCharacter;
      await f.db.collection("characters").insertOne({ _id: characterId, favorability: 50 });
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { shareholders: [{ characterId, shares: 4.99 }] } });
      expect((await tenderView(f.db, row, 7, official)).awardWarnings).toEqual({});
      // The server rechecks ownership if it changes after the official reads the preview.
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { shareholders: [{ characterId, shares: 5 }] } });
      await expect(
        awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Synthetic concession award.",
          official,
          7,
          now
        )
      ).rejects.toThrow("Acknowledge the conflict");
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { shareholders: [{ characterId, shares: 4.99 }] } });
      await awardTender(
        f.db,
        row,
        corpId.toHexString(),
        "Synthetic concession award.",
        official,
        7,
        now
      );
      expect(await f.db.collection("newsPosts").countDocuments()).toBe(0);
      expect(
        (await f.db.collection("characters").findOne({ _id: characterId }))?.favorability
      ).toBe(50);
    });

    it("does not disclose or penalize an unfunded conflicted extraction award", async () => {
      const row = await extraction();
      const characterId = new ObjectId();
      const official = {
        ...government,
        userId: owner.toHexString(),
        hasCharacter: true,
        character: { _id: characterId, name: "Synthetic official" },
      } as AuthUserWithCharacter;
      await f.db.collection("characters").insertOne({ _id: characterId, favorability: 50 });
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { liquidCapital: 0 } });
      await expect(
        awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Synthetic concession award.",
          official,
          7,
          now,
          true
        )
      ).rejects.toThrow("cannot fund");
      const fresh = (await tenders(f.db).findOne({ _id: row._id }))!;
      expect(fresh.status).toBe("open");
      expect(fresh.awardSelfDealing).toBeUndefined();
      expect(await f.db.collection("newsPosts").countDocuments()).toBe(0);
      expect(
        (await f.db.collection("characters").findOne({ _id: characterId }))?.favorability
      ).toBe(50);
    });

    it("records revisions and withdrawals atomically, even after the corporation changes industry", async () => {
      let row = await extraction();
      await submitBid(
        f.db,
        row,
        { corporationId: corpId.toHexString(), amount: 300, expectedRevision: 1 },
        ceo,
        2,
        now
      );
      row = (await tenders(f.db).findOne({ _id: row._id }))!;
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { type: "manufacturing" } });
      await submitBid(
        f.db,
        row,
        { corporationId: corpId.toHexString(), amount: 1, expectedRevision: 2, withdraw: true },
        ceo,
        2,
        now
      );
      row = (await tenders(f.db).findOne({ _id: row._id }))!;
      expect(row.bidHistory?.map((b) => [b.amount, b.withdrawn])).toEqual([
        [200, false],
        [300, false],
        [300, true],
      ]);
      expect((await tenderView(f.db, row, 2, government)).bidHistory).toEqual([]);
      expect((await tenderView(f.db, row, 2, ceo)).bidHistory).toHaveLength(3);
      expect(JSON.stringify(await tenderView(f.db, row, 7, government))).not.toContain(
        owner.toHexString()
      );
    });
    it("credits funded Treasury cash and its fiscal mirror exactly once", async () => {
      await f.db
        .collection("gameConfig")
        .updateOne({ _id: "default" as never }, { $set: { treasuryCashLedgerEnabled: true } });
      await f.db
        .collection("gameState")
        .insertOne({ _id: "current" as never, preset: "1953-default", currentTurn: 3 });
      await f.db
        .collection("federalBudget")
        .updateOne({ countryId: "US" }, { $set: { treasuryCashLocal: 25, currencyCode: "USD" } });
      const row = await extraction();
      await awardTender(
        f.db,
        row,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      const budget = await f.db.collection("federalBudget").findOne({ countryId: "US" });
      expect(budget?.treasuryCashLocal).toBe(225);
      expect(budget?.treasuryBalance).toBe(1200);
    });
    it("credits regional royalties without also crediting the national Treasury", async () => {
      await f.db.collection("enactedLaws").insertOne({
        scope: "national",
        countryId: "US",
        legislationTypeId: "resource_extraction_authority",
        policyOptionIndex: 2,
        enactedAt: now,
      });
      await f.db.collection("stateBudgets").insertOne({
        _id: "TX" as never,
        countryId: "US",
        revenue: { resourceRoyalties: 0, total: 100 },
      });
      const row = await extraction();
      expect(row.issuerLevel).toBe("state");
      await awardTender(
        f.db,
        row,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      expect(
        (await f.db.collection("stateBudgets").findOne({ countryId: "US" }))?.revenue
      ).toMatchObject({ resourceRoyalties: 200, total: 300 });
      expect(
        (await f.db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance
      ).toBe(1000);
    });
    it("uses the government's recorded native currency rather than assuming the static country default", async () => {
      await f.db
        .collection("federalBudget")
        .updateOne({ countryId: "US" }, { $set: { currencyCode: "EUR" } });
      await f.db.collection("exchangeRates").insertOne({ currencyCode: "EUR", rate: 0.8 });
      const row = await extraction();
      await awardTender(
        f.db,
        row,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      expect((await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital).toBe(
        800
      );
      expect(
        (await f.db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance
      ).toBe(1160);
    });
    it("recovers a lost debit acknowledgement without charging the corporation again", async () => {
      const row = await extraction();
      let injected = false;
      const interrupted = new Proxy(f.db, {
        get(target, key) {
          if (key !== "collection") {
            const v = Reflect.get(target, key);
            return typeof v === "function" ? v.bind(target) : v;
          }
          return (name: string) =>
            new Proxy(target.collection(name), {
              get(c, method) {
                if (name === "corporations" && method === "updateOne")
                  return async (...args: unknown[]) => {
                    const update = args[1] as { $inc?: { liquidCapital?: number } };
                    const result = await (
                      c.updateOne as (...args: unknown[]) => Promise<unknown>
                    ).apply(c, args);
                    if (!injected && (update.$inc?.liquidCapital ?? 0) < 0) {
                      injected = true;
                      throw new Error("Synthetic lost debit acknowledgement");
                    }
                    return result;
                  };
                const v = Reflect.get(c, method);
                return typeof v === "function" ? v.bind(c) : v;
              },
            });
        },
      }) as Db;
      try {
        await awardTender(
          interrupted,
          row,
          corpId.toHexString(),
          "Highest qualifying signing fee.",
          government,
          7,
          now
        );
      } catch {}
      expect(injected).toBe(true);
      await f.db
        .collection("gameConfig")
        .updateOne({ _id: "default" as never }, { $set: { contractIssuanceEnabled: false } });
      await awardTender(
        f.db,
        (await tenders(f.db).findOne({ _id: row._id }))!,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      expect((await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital).toBe(
        800
      );
      expect(
        (await f.db.collection("federalBudget").findOne({ countryId: "US" }))?.treasuryBalance
      ).toBe(1200);
      expect(
        await f.db.collection("extractionContracts").countDocuments({ status: "active" })
      ).toBe(1);
    });
    it("lets the current CEO review and withdraw a predecessor bid without exposing it to the predecessor", async () => {
      const row = await extraction();
      const nextOwner = new ObjectId();
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { userId: nextOwner } });
      const nextCeo = { ...ceo, userId: nextOwner.toHexString() };
      expect((await tenderView(f.db, row, 1, ceo)).bids).toEqual([]);
      expect((await tenderView(f.db, row, 1, nextCeo)).bids[0].revision).toBe(1);
      await submitBid(
        f.db,
        row,
        { corporationId: corpId.toHexString(), amount: 0, expectedRevision: 1, withdraw: true },
        nextCeo,
        1,
        now
      );
      expect(
        (await tenders(f.db).findOne({ _id: row._id }))?.bids[corpId.toHexString()].withdrawn
      ).toBe(true);
    });
    it.each([0, 200])(
      "does not start a new %s signing-fee settlement while issuance is paused",
      async (amount) => {
        const row = await extraction();
        const contract = {
          _id: new ObjectId(row.contractId),
          tenderId: row._id,
          corporationId: corpId,
          countryId: "US",
          stateId: "TX",
          resource: "oil",
          share: 0.3,
          grantedBy: "US",
          grantedByLevel: "national",
          grantedTurn: 3,
          status: "offered",
          signingFeeAnchor: amount,
          signingFeeAttemptKey: new ObjectId().toHexString(),
        } as import("@/lib/db/types").ExtractionContract;
        await f.db.collection("extractionContracts").insertOne(contract);
        const corp = await f.db
          .collection<import("@/lib/db/types").Corporation>("corporations")
          .findOne({ _id: corpId });
        await expect(
          settleTenderSigningFee(f.db, contract, corp!, 3, now, false, false)
        ).rejects.toThrow(/disabled/);
        expect(await f.db.collection("bankMoneyMoves").countDocuments({})).toBe(0);
        expect(
          (await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital
        ).toBe(1000);
      }
    );
    it("rejects stale bid revisions and bids at the exact closing turn", async () => {
      const row = await extraction();
      await expect(
        submitBid(
          f.db,
          row,
          { corporationId: corpId.toHexString(), amount: 300, expectedRevision: 0 },
          ceo,
          2,
          now
        )
      ).rejects.toThrow(/changed/);
      await expect(
        submitBid(
          f.db,
          row,
          { corporationId: corpId.toHexString(), amount: 300, expectedRevision: 1 },
          ceo,
          7,
          now
        )
      ).rejects.toThrow(/closed/);
    });
    it("reopens selection after an unaffordable signing fee without leaving an unpaid active contract", async () => {
      const row = await extraction();
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { liquidCapital: 50 } });
      await expect(
        awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Highest qualifying signing fee.",
          government,
          7,
          now
        )
      ).rejects.toThrow();
      expect((await tenders(f.db).findOne({ _id: row._id }))?.status).toBe("open");
      expect(
        await f.db.collection("extractionContracts").countDocuments({ status: "active" })
      ).toBe(0);
      expect((await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital).toBe(
        50
      );
    });
    it("recovers when a paid contract exists but the award completion acknowledgement is lost", async () => {
      const row = await extraction();
      let fail = true;
      const interrupted = new Proxy(f.db, {
        get(target, key) {
          if (key !== "collection") {
            const v = Reflect.get(target, key);
            return typeof v === "function" ? v.bind(target) : v;
          }
          return (name: string) => {
            const col = target.collection(name);
            return new Proxy(col, {
              get(c, method) {
                if (name === "governmentTenders" && method === "updateOne")
                  return async (...args: unknown[]) => {
                    const update = args[1] as { $set?: { status?: string } };
                    if (fail && update.$set?.status === "awarded") {
                      fail = false;
                      throw new Error("Synthetic lost completion");
                    }
                    return (c.updateOne as (...args: unknown[]) => Promise<unknown>).apply(c, args);
                  };
                const v = Reflect.get(c, method);
                return typeof v === "function" ? v.bind(c) : v;
              },
            });
          };
        },
      }) as Db;
      await expect(
        awardTender(
          interrupted,
          row,
          corpId.toHexString(),
          "Highest qualifying signing fee.",
          government,
          7,
          now
        )
      ).rejects.toThrow(/Synthetic/);
      await awardTender(
        f.db,
        (await tenders(f.db).findOne({ _id: row._id }))!,
        corpId.toHexString(),
        "Highest qualifying signing fee.",
        government,
        7,
        now
      );
      expect((await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital).toBe(
        800
      );
      expect(await f.db.collection("extractionContracts").countDocuments({})).toBe(1);
    });
    it("serializes competing award requests to one contract and one payment", async () => {
      const row = await extraction();
      const result = await Promise.allSettled([
        awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Highest qualifying signing fee.",
          government,
          7,
          now
        ),
        awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Highest qualifying signing fee.",
          government,
          7,
          now
        ),
      ]);
      expect(result.some((r) => r.status === "fulfilled")).toBe(true);
      expect(await f.db.collection("extractionContracts").countDocuments({})).toBe(1);
      expect((await f.db.collection("corporations").findOne({ _id: corpId }))?.liquidCapital).toBe(
        800
      );
    });
    it("converts a defence tender into an active grade-preserving order and releases the unused maximum", async () => {
      await f.db
        .collection("corporations")
        .updateOne({ _id: corpId }, { $set: { type: "defense" } });
      await f.db
        .collection("corporateSectors")
        .updateOne({ _id: sectorId }, { $set: { sectorType: "defense", strategyId: "standard" } });
      const anchor = lotPrice("US", militaryPriceAnchor(387e9, undefined))!;
      const band = lotPriceBand({
        anchorPrice: anchor,
        productionCost: lotProductionCost("standard", anchor)!,
        grade: 0,
      })!;
      const maximum = band.ceiling + 100;
      const id = await publishTender(
        f.db,
        "US",
        {
          title: "Ground equipment",
          description: "Synthetic equipment procurement",
          closesTurn: 49,
          awardDeadlineTurn: 73,
          terms: {
            type: "defence",
            component: "ground",
            lots: 1,
            grade: 0,
            maximumPricePerLot: maximum,
          },
        },
        government,
        1,
        now
      );
      let row = (await tenders(f.db).findOne({ _id: id }))!;
      await submitBid(
        f.db,
        row,
        {
          corporationId: corpId.toHexString(),
          sectorId: sectorId.toHexString(),
          amount: band.suggested,
          expectedRevision: 0,
        },
        ceo,
        1,
        now
      );
      row = (await tenders(f.db).findOne({ _id: id }))!;
      const official = { ...government, userId: owner.toHexString() } as AuthUserWithCharacter;
      await expect(
        awardTender(
          f.db,
          row,
          corpId.toHexString(),
          "Lowest qualifying equipment price.",
          official,
          49,
          now
        )
      ).rejects.toThrow("Acknowledge the conflict");
      await awardTender(
        f.db,
        row,
        corpId.toHexString(),
        "Lowest qualifying equipment price.",
        official,
        49,
        now,
        true
      );
      const contract = await f.db.collection("defenceContracts").findOne({ tenderId: id });
      expect(contract).toMatchObject({
        status: "active",
        gradeCeiling: 0,
        pricePerLot: band.suggested,
        lotsOrdered: 1,
      });
      expect(contract?.allocationWindowId).toBe("US:0");
      expect(
        await f.db.collection("defenceProcurementAllocations").findOne({ _id: "US:4" as never })
      ).toBeNull();
      expect(
        (await f.db.collection("federalBudget").findOne({ countryId: "US" }))?.defenseAppropriation
          .encumbered
      ).toBe(band.suggested);
      expect(
        (await f.db.collection("corporateSectors").findOne({ _id: sectorId }))
          ?.contractMutationOwner
      ).toBeUndefined();
    });
  }
);
