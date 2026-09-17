/**
 * Constitutional crisis event for the US President.
 *
 * The event presents ordinary constitutional choices rather than a power
 * fantasy. The roll determines whether a temporary continuity measure holds,
 * strains, or is replaced by a public settlement. Any short-term presidential
 * relief is explicitly temporary and does not erase the ruling-party cost.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.constitutionalCrisis",
  defaultOptionId: "judicialReview",
  options: [
    {
      id: "judicialReview",
      label: "Submit to constitutional review",
      description: "Let the courts and legislature settle the dispute under ordinary procedure.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The dispute enters constitutional review",
          effects: [
            { type: "approvalDelta", delta: -1 },
            { type: "democraticHealthDelta", delta: -1 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Sends Constitutional Dispute to Review",
            template:
              "{leader} sent the dispute into ordinary constitutional review, accepting a short-term political cost to keep the settlement inside the courts and legislature.",
          },
        },
      ],
    },
    {
      id: "continuityProtocol",
      label: "Adopt a temporary continuity protocol",
      description:
        "Keep essential services running under a time-limited order while review proceeds. It may steady the presidency now, but weakens trust in the boundary.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 45,
          label: "The continuity protocol holds",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "democraticHealthDelta", delta: -3 },
            { type: "presidentialHealthRelief", pct: 40, durationTurns: 16 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Adopts a Temporary Continuity Protocol",
            template:
              "{leader}'s temporary continuity protocol kept essential services moving, but the emergency boundary now carries a visible cost to constitutional trust.",
          },
        },
        {
          minRoll: 46,
          maxRoll: 100,
          label: "The temporary order outlasts its promise",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "democraticHealthDelta", delta: -6 },
            { type: "presidentialHealthRelief", pct: 60, durationTurns: 20 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country}'s Continuity Order Draws Constitutional Alarm",
            template:
              "The continuity order kept the government operating, but its extension beyond the original timetable has deepened the constitutional crisis around {leader}.",
          },
        },
      ],
    },
    {
      id: "crossPartyConference",
      label: "Call a cross-party constitutional conference",
      description:
        "Bring legislative leaders, the courts, and civic groups into a public settlement process.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 35,
          label: "The constitutional conference stalls",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "democraticHealthDelta", delta: -2 },
            { type: "presidentialHealthRelief", pct: 20, durationTurns: 10 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Constitutional Conference Stalls in {country}",
            template:
              "Talks convened by {leader} failed to settle the constitutional dispute, leaving the administration with a narrow and temporary cushion.",
          },
        },
        {
          minRoll: 36,
          maxRoll: 100,
          label: "A public constitutional settlement emerges",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "democraticHealthDelta", delta: 1 },
            { type: "presidentialHealthRelief", pct: 20, durationTurns: 12 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Reaches a Constitutional Settlement",
            template:
              "Legislative leaders, the courts, and civic groups reached a public settlement after {leader}'s conference, easing the immediate crisis.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
