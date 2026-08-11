/**
 * World Events v1 Phase 3 flavor event: the World's Fair. Same simple
 * pattern as `olympics.ts` (see that file's doc comment for the host-selection
 * mechanics in `driver.ts`) — a separate, parallel handler rather than a
 * shared "bidding engine", at cheaper/smaller magnitudes.
 *
 * `sectorType: "technology"` stands in for the Fair's exposition/innovation
 * showcase focus, matching the `scientificBreakthrough` (Phase 2) precedent
 * for technology-adjacent demand (no dedicated "services"/"expo"
 * `CorporationType` exists).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.worldsFair",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "acknowledge",
      label: "Host the Fair",
      description: "The nation hosts the World's Fair.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A well-attended World's Fair",
          effects: [
            { type: "approvalDelta", delta: 3 },
            { type: "sectorDemandModifier", sectorType: "technology", pct: 5, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Hosts the World's Fair",
            template:
              "The World's Fair opened in {country}, showcasing exhibits and innovations from participating nations. {leader} toured the exposition on opening day.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
