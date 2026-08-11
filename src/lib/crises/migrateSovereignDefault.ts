import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Crisis } from "@/lib/db/types/crisis";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { createCrisisInteraction } from "@/lib/crises/interactionEngine";
import { getGameState } from "@/lib/gameState";

/**
 * Migration: Convert existing sovereign default crisis records to the new
 * generalized crisis interaction system.
 */

const SOVEREIGN_DEFAULT_TEMPLATE: Omit<
  Crisis,
  "_id" | "createdBy" | "createdAt" | "resolvedAt" | "startTurn" | "endTurn" | "status"
> = {
  name: "Sovereign Debt Crisis",
  description:
    "The government has defaulted on its debt obligations. Bond markets are frozen, the currency is under pressure, and austerity measures are imminent.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 8,
  effects: [
    {
      effectType: "tick",
      targetType: "metric",
      metricCategory: "economic",
      metricField: "gdpGrowth",
      value: -0.025,
      sectorType: null,
      strategyId: null,
      label: "GDP contraction from default",
    },
    {
      effectType: "tick",
      targetType: "metric",
      metricCategory: "economic",
      metricField: "unemploymentRate",
      value: 0.02,
      sectorType: null,
      strategyId: null,
      label: "Unemployment from austerity",
    },
    {
      effectType: "tick",
      targetType: "inflation",
      metricCategory: null,
      metricField: null,
      value: 0.015,
      sectorType: null,
      strategyId: null,
      label: "Inflation from currency pressure",
    },
    {
      effectType: "tick",
      targetType: "approval",
      metricCategory: "government",
      metricField: "overall",
      value: -0.04,
      sectorType: null,
      strategyId: null,
      label: "Government approval erosion",
    },
  ],
  wireMessageOnStart:
    "Sovereign debt crisis: the government has defaulted. Bond markets freeze and austerity looms.",
  wireMessageOnEnd: "The sovereign debt crisis is resolved. Markets cautiously reopen.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "executive_choice",
        type: "choice",
        title: "Executive Choice",
        description:
          "The country has defaulted on its debt. As head of state, what is your resolution strategy?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "bailout",
            label: "International Bailout",
            description:
              "Accept IMF/EU conditions. Severe austerity, but restores market access quickly.",
            nextNodeId: "legislative_ratification",
            effects: [
              {
                effectType: "flat",
                targetType: "metric",
                metricCategory: "economic",
                metricField: "gdpGrowth",
                value: -0.03,
                sectorType: null,
                strategyId: null,
                label: "Bailout austerity GDP hit",
              },
              {
                effectType: "flat",
                targetType: "approval",
                metricCategory: "government",
                metricField: "overall",
                value: -0.06,
                sectorType: null,
                strategyId: null,
                label: "Bailout unpopularity",
              },
            ],
          },
          {
            optionId: "restructure",
            label: "Debt Restructuring",
            description:
              "Negotiate with creditors for haircuts and extended maturities. Moderate pain, slower recovery.",
            nextNodeId: "legislative_ratification",
            effects: [
              {
                effectType: "flat",
                targetType: "metric",
                metricCategory: "economic",
                metricField: "gdpGrowth",
                value: -0.015,
                sectorType: null,
                strategyId: null,
                label: "Restructuring GDP hit",
              },
              {
                effectType: "flat",
                targetType: "approval",
                metricCategory: "government",
                metricField: "overall",
                value: -0.03,
                sectorType: null,
                strategyId: null,
                label: "Restructuring unpopularity",
              },
            ],
          },
          {
            optionId: "repudiate",
            label: "Debt Repudiation",
            description:
              "Refuse to pay. Immediate relief but permanent market exclusion and diplomatic isolation.",
            nextNodeId: "terminal",
            effects: [
              {
                effectType: "flat",
                targetType: "metric",
                metricCategory: "economic",
                metricField: "gdpGrowth",
                value: -0.05,
                sectorType: null,
                strategyId: null,
                label: "Repudiation GDP collapse",
              },
              {
                effectType: "flat",
                targetType: "metric",
                metricCategory: "economic",
                metricField: "smallBusinessFormation",
                value: -0.15,
                sectorType: null,
                strategyId: null,
                label: "Repudiation investor flight",
              },
              {
                effectType: "flat",
                targetType: "approval",
                metricCategory: "government",
                metricField: "overall",
                value: -0.02,
                sectorType: null,
                strategyId: null,
                label: "Repudiation base rally",
              },
            ],
          },
          {
            optionId: "monetize",
            label: "Monetize Debt",
            description:
              "Central bank prints money to pay creditors. Hyperinflation risk but no immediate default.",
            nextNodeId: "legislative_ratification",
            effects: [
              {
                effectType: "flat",
                targetType: "inflation",
                metricCategory: null,
                metricField: null,
                value: 0.05,
                sectorType: null,
                strategyId: null,
                label: "Monetization inflation spike",
              },
              {
                effectType: "flat",
                targetType: "metric",
                metricCategory: "economic",
                metricField: "gdpGrowth",
                value: -0.02,
                sectorType: null,
                strategyId: null,
                label: "Monetization GDP hit",
              },
            ],
          },
        ],
      },
      {
        nodeId: "legislative_ratification",
        type: "choice",
        title: "Legislative Ratification",
        description: "The resolution requires legislative ratification. Will parliament approve?",
        requiredRoles: ["cabinet"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "ratify_yes",
            label: "Ratify",
            description: "Parliament approves the resolution. Crisis duration reduced by 2 turns.",
            nextNodeId: "terminal",
            effects: [
              {
                effectType: "flat",
                targetType: "metric",
                metricCategory: "economic",
                metricField: "gdpGrowth",
                value: 0.01,
                sectorType: null,
                strategyId: null,
                label: "Ratification stability bonus",
              },
            ],
          },
          {
            optionId: "ratify_no",
            label: "Reject",
            description:
              "Parliament rejects the resolution. Crisis extends by 2 turns and approval drops.",
            nextNodeId: "terminal",
            effects: [
              {
                effectType: "flat",
                targetType: "approval",
                metricCategory: "government",
                metricField: "overall",
                value: -0.04,
                sectorType: null,
                strategyId: null,
                label: "Rejection approval hit",
              },
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Resolution Complete",
        description: "The sovereign debt crisis resolution is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export async function migrateSovereignDefaultToCrisisSystem(db: Db): Promise<{
  migrated: number;
  skipped: number;
  errors: string[];
}> {
  const oldDecisions = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .find({ state: { $in: ["open", "executiveProposed"] } })
    .toArray();

  const result = { migrated: 0, skipped: 0, errors: [] as string[] };

  for (const old of oldDecisions) {
    try {
      const existing = await db.collection<Crisis>("crises").findOne({
        name: "Sovereign Debt Crisis",
        countryIds: old.countryCode,
        status: "active",
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      const currentTurn = await getCurrentTurn(db);
      const crisisDoc: Crisis = {
        ...SOVEREIGN_DEFAULT_TEMPLATE,
        _id: new ObjectId(),
        countryIds: [old.countryCode],
        regionIds: [],
        status: "active",
        createdBy: old.proposingCharacterId ?? new ObjectId(),
        createdAt: new Date(),
        resolvedAt: null,
        startTurn: old.firedAtTurn ?? currentTurn,
        endTurn: null,
      };

      const insertResult = await db.collection<Crisis>("crises").insertOne(crisisDoc);
      await createCrisisInteraction(db, crisisDoc);

      if (old.executiveChoice && old.state === "executiveProposed") {
        const interaction = await db
          .collection("crisisInteractions")
          .findOne({ crisisId: insertResult.insertedId });

        if (interaction) {
          const choiceMap: Record<string, string> = {
            bailout: "bailout",
            restructure: "restructure",
            repudiate: "repudiate",
            monetize: "monetize",
          };
          const optionId = choiceMap[old.executiveChoice];

          if (optionId) {
            await db
              .collection("crisisInteractions")
              .updateOne(
                { _id: interaction._id },
                { $set: { currentNodeId: "legislative_ratification" } }
              );
          }
        }
      }

      result.migrated++;
    } catch (err) {
      result.errors.push(`Failed to migrate ${old._id}: ${String(err)}`);
    }
  }

  return result;
}

async function getCurrentTurn(db: Db): Promise<number> {
  // Filtered on the canonical doc — see the note in `getGameStatePreset`. An
  // unfiltered read here can return a non-canonical `gameState` document and
  // silently stamp the migration at turn 1.
  const gameState = await getGameState(db);
  return gameState?.currentTurn ?? 1;
}
