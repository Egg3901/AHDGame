/** Personal tax statements expose frozen assessments and unpaid liabilities to their owner. */
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { incomeTaxDebtAnchor, type IncomeTier } from "./rules/incomeTaxTiers";
import type { PlayerIncomeTaxAssessment } from "@/lib/db/types/incomeTax";
import type { CurrencyCode } from "@/lib/constants/currencies";
export interface PlayerTaxStatement {
  initialTier: IncomeTier;
  currentTier: IncomeTier;
  unpaidTaxAnchor: number;
  assessments: Array<{
    taxKind?: "income" | "capitalGains";
    turn: number;
    currency: string;
    gross: number;
    tax: number;
    net: number;
    pending: boolean;
  }>;
}
export async function loadPlayerIncomeTaxSummary(
  db: Db,
  character: Pick<Character, "_id" | "initialIncomeTier" | "incomeTier" | "demographics">,
  turn: number,
  ownerCollection: "characters" | "imperialCharacters" = "characters",
  rates?: Partial<Record<CurrencyCode, number>>
): Promise<PlayerTaxStatement> {
  const records = await db
    .collection<PlayerIncomeTaxAssessment>("playerIncomeTaxAssessments")
    .find(
      {
        status: { $in: ["unpaid", "collected", "paid"] },
        characterId: character._id,
        ownerCollection,
        $or: [{ turn: { $gte: turn - 12 } }, { status: "unpaid" }],
      },
      {
        projection: {
          turn: 1,
          currency: 1,
          status: 1,
          gross: 1,
          federal: 1,
          regional: 1,
          net: 1,
          sourceFx: 1,
          taxKind: 1,
        },
      }
    )
    .toArray();
  return {
    initialTier: character.initialIncomeTier ?? character.demographics?.wealth ?? "middle",
    currentTier:
      character.incomeTier ??
      character.initialIncomeTier ??
      character.demographics?.wealth ??
      "middle",
    unpaidTaxAnchor: records.reduce(
      (sum, record) =>
        sum +
        (record.status === "unpaid"
          ? incomeTaxDebtAnchor(
              record.federal + record.regional,
              record.sourceFx,
              rates?.[record.currency as CurrencyCode]
            )
          : 0),
      0
    ),
    assessments: records
      .map((record) => ({
        ...(record.taxKind ? { taxKind: record.taxKind } : {}),
        turn: record.turn,
        currency: record.currency,
        gross: record.gross,
        tax: record.federal + record.regional,
        net: record.net,
        pending: record.status === "unpaid",
      }))
      .sort((a, b) => b.turn - a.turn),
  };
}

/** One projected read supplies outstanding liabilities to portfolio and wealth snapshots. */
export async function loadUnpaidIncomeTaxByCharacter(
  db: Db,
  rates?: Partial<Record<CurrencyCode, number>>
): Promise<Map<string, number>> {
  const rows = await db
    .collection<PlayerIncomeTaxAssessment>("playerIncomeTaxAssessments")
    .find(
      { status: "unpaid" },
      { projection: { characterId: 1, currency: 1, federal: 1, regional: 1, sourceFx: 1 } }
    )
    .toArray();
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.characterId.toHexString();
    const debt = incomeTaxDebtAnchor(
      row.federal + row.regional,
      row.sourceFx,
      rates?.[row.currency as CurrencyCode]
    );
    totals.set(key, (totals.get(key) ?? 0) + debt);
  }
  return totals;
}
