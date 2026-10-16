/** Tax receipts are world runtime state; bootstrap and migration share their indexes. */
export const INCOME_TAX_INDEXES = [
  {
    collection: "playerIncomeTaxAssessments",
    keys: { worldId: 1, status: 1, turn: 1 },
    name: "incomeTax_turn_plan",
  },
  {
    collection: "playerIncomeTaxAssessments",
    keys: { status: 1, characterId: 1 },
    name: "incomeTax_unpaid_character",
  },
  {
    collection: "financialTxLog",
    keys: { subjectType: 1, type: 1, turn: 1 },
    name: "incomeTax_subject_type_turn",
  },
  {
    collection: "playerIncomeTaxAssessments",
    keys: { worldId: 1, status: 1, _id: 1 },
    name: "incomeTax_unpaid",
  },
  {
    collection: "playerIncomeTaxAssessments",
    keys: { characterId: 1, turn: -1 },
    name: "incomeTax_character_turn",
  },
  { collection: "playerIncomeTaxBatches", keys: { turn: 1 }, name: "incomeTax_batch_turn" },
] as const;
