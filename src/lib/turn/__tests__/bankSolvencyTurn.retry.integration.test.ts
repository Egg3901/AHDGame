import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { resumeSettlement } from "@/lib/banking/settlementJournal";
import { turnMoveKey } from "@/lib/banking/moneyMove";
import { processBankSolvencyTurn } from "../bankSolvencyTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const TURN = 200;
const BANK = new ObjectId();

describe("bank run retry accounting", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([1, 2, 3])(
    "preserves the deposit liability after interruption at bank write %i",
    async (onCall) => {
      const memory = createInMemoryDb();
      memory.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
      memory.seed("centralBanks", [
        { _id: "US", bankReserveRequirement: 0.1, externalBroadMoney: 0 },
      ]);
      memory.seed("corporations", [
        {
          _id: BANK,
          name: "Run Bank",
          countryId: "US",
          liquidCapital: 0,
          liquidCurrencyCode: "USD",
          bankCharter: {
            type: "retail",
            status: "active",
            currency: "USD",
            charteredTurn: 1,
            postedCapital: 300_000,
            cashReserves: 1_000_000,
            npcDeposits: 1_000_000,
            totalDeposits: 1_000_000,
            totalLoans: 300_000,
            depositOffset: 0,
            lendingOffset: 0,
            warningBand: "amber",
          },
        },
      ]);
      const fault = withInjectedCrash(memory, {
        collection: "corporations",
        op: "updateOne",
        onCall,
        afterWrite: true,
      });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(fault.db);
      try {
        await processBankSolvencyTurn(fault.db, TURN);
      } catch {
        /* Retry the interrupted turn below. */
      }
      fault.disarm();
      if (onCall === 1) {
        const incomplete = await processBankSolvencyTurn(memory as unknown as Db, TURN);
        expect(incomplete.banksEvaluated).toBe(0);
      }
      // Recovery owns abandoned money legs. The live turn must wait for it.
      await resumeSettlement(
        memory as unknown as Db,
        turnMoveKey("solvency-deposit-flight", BANK.toString(), TURN)
      );
      await processBankSolvencyTurn(memory as unknown as Db, TURN);
      const charter = memory.collection("corporations").docs[0].bankCharter as {
        cashReserves: number;
        npcDeposits: number;
        totalDeposits: number;
      };
      expect(charter.cashReserves).toBe(900_000);
      expect(charter.npcDeposits).toBe(900_000);
      expect(charter.totalDeposits).toBe(900_000);
      expect(memory.collection("centralBanks").docs[0].externalBroadMoney).toBe(100_000);
    }
  );
});
