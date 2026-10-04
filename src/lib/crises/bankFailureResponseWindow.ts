/**
 * Domestic bank stress opens a short response window when a bank turns red but stays solvent.
 * The window offers the existing funded recapitalization, guarantee, and resolution actions.
 * `ensureBankFailureResponseWindow` creates or resumes that choice for the bank's country.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Crisis, CrisisTemplate } from "@/lib/db/types/crisis";
import { ObjectId } from "mongodb";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";
import { createCrisisInteraction } from "./interactionEngine";
import { isCrisisInteractionEnabled } from "./featureFlag";

const RESPONSE_TEMPLATE: CrisisTemplate = {
  name: "Domestic Bank Stress",
  description:
    "A domestic bank has entered severe financial stress. The government and central bank can choose a funded intervention or begin resolution before the bank becomes insolvent.",
  heroImage:
    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1600&q=70",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { country: 3 },
  effects: [],
  wireMessageOnStart: "A domestic bank has entered severe financial stress.",
  wireMessageOnEnd: "The domestic bank response window has closed.",
  interactionDefinition: {
    autoResolveOnExpiry: true,
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Domestic bank response",
        description:
          "Choose how to respond to the stressed bank. Public support is paid through the existing funded intervention process.",
        requiredRoles: ["headOfState", "financeMinister", "centralBankChair"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "decline",
            label: "Take no action",
            description: "No public intervention is chosen before the response window closes.",
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "recapitalize",
            label: "Recapitalize the banking system",
            description: "Commit 2% of GDP in funded public capital to eligible domestic banks.",
            treasuryCostPctGdp: 0.02,
            nextNodeId: "terminal",
            effects: [],
            action: { kind: "financialCrisisResponse", response: "recapitalize" },
          },
          {
            optionId: "guarantee",
            label: "Guarantee deposits",
            description:
              "Commit 1.2% of GDP in funded deposit protection for eligible domestic banks.",
            treasuryCostPctGdp: 0.012,
            nextNodeId: "terminal",
            effects: [],
            action: { kind: "financialCrisisResponse", response: "guarantee" },
          },
          {
            optionId: "resolve",
            label: "Resolve the weakest bank",
            description:
              "Begin the existing bank resolution waterfall for the weakest eligible domestic bank.",
            nextNodeId: "terminal",
            effects: [],
            action: { kind: "financialCrisisResponse", response: "resolve" },
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response window closed",
        description: "The domestic bank response window is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        outcomeMessage: "The domestic bank response window has closed.",
        outcomeEffects: [],
      },
    ],
  },
};

/** Return an isolated copy for consumers that need to inspect or test the choice tree. */
export function getBankFailureResponseTemplate(): CrisisTemplate {
  return structuredClone(RESPONSE_TEMPLATE);
}

export function bankFailureResponseEventId(bankId: string, charteredTurn: number): string {
  return `bank_failure_response:${bankId}:${charteredTurn}`;
}

/** Open one country-authorized choice for a red but not yet failed bank epoch. */
export async function ensureBankFailureResponseWindow(
  db: Db,
  input: {
    bankId: ObjectId;
    countryId: string;
    charteredTurn: number;
    currentTurn: number;
  }
): Promise<ObjectId | null> {
  if (!(await isCrisisInteractionEnabled())) return null;

  const eventId = bankFailureResponseEventId(input.bankId.toString(), input.charteredTurn);
  const crises = db.collection<Crisis>("crises");
  const existing = await crises.findOne({ livingConflictEventId: eventId });
  if (existing) {
    if (existing.status === "active" && existing.interactionDefinition) {
      await createCrisisInteraction(db, existing);
    }
    return existing._id;
  }

  try {
    return await createCrisisFromTemplate(db, {
      template: RESPONSE_TEMPLATE,
      templateKey: "bank_failure_response",
      scope: "country",
      countryIds: [input.countryId as CountryId],
      regionIds: [],
      currentTurn: input.currentTurn,
      autoGenerated: true,
      autoSource: "condition",
      livingConflictEventId: eventId,
    });
  } catch (error) {
    // The unique living-event key arbitrates concurrent solvency workers. If a
    // worker inserted the crisis before failing to create its interaction, the
    // next pass finds it below and repairs that projection.
    const winner = await crises.findOne({ livingConflictEventId: eventId });
    if (!winner) throw error;
    if (winner.status === "active" && winner.interactionDefinition) {
      await createCrisisInteraction(db, winner);
    }
    return winner._id;
  }
}
