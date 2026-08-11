/**
 * World Events v1 Phase 2 executive decision event: a foreign state visit.
 * Country scope, executive decides how to host it. Per plan §2.2, country
 * events skip the primaryStat roll branch entirely — each option below has a
 * single full-range (1-100) outcome tier, so the outcome is option-
 * deterministic rather than roll-modified.
 *
 * Vacant-executive safety (plan §7 — timeout default must never be
 * treasury-negative): `defaultOptionId` is "standard", which has a
 * `treasuryDelta` of 0. "lavish" (positive approval, treasury cost) is
 * never the default.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.stateVisit",
  defaultOptionId: "standard",
  options: [
    {
      id: "lavish",
      label: "Host lavishly",
      description: "Roll out a full state occasion with all the trimmings.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A lavish state visit",
          effects: [
            { type: "approvalDelta", delta: 4 },
            { type: "treasuryDelta", deltaAnchor: -15_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Hosts Lavish State Visit",
            template:
              "{leader} welcomed the visiting delegation to {country} with a full state occasion, drawing praise for the reception.",
          },
        },
      ],
    },
    {
      id: "standard",
      label: "Host standard reception",
      description: "A normal diplomatic reception — modest, no special expense.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A standard state visit",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "treasuryDelta", deltaAnchor: 0 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Receives Visiting Delegation",
            template:
              "{leader} hosted a standard diplomatic reception for the visiting delegation in {country}.",
          },
        },
      ],
    },
    {
      id: "decline",
      label: "Decline the visit",
      description: "Politely decline to host, citing scheduling.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The visit is declined",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "treasuryDelta", deltaAnchor: 0 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Declines State Visit",
            template:
              "{leader}'s government declined to host the proposed state visit, citing scheduling conflicts.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
