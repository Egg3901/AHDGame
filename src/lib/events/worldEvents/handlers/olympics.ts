/**
 * World Events v1 Phase 3 flavor event: the Olympics. Country scope, no
 * decision required (single default option) — like `royalEvent`/`sportsVictory`,
 * this is a wire-only morale event plus a temporary construction/tourism
 * sector-demand bump for whichever country was selected to host.
 *
 * Host selection happens BEFORE this handler runs, in `driver.ts`
 * (`offerGlobalHostCountryEvent`): the host country is picked deterministically
 * from a hash of the current turn (no Math.random, sim-reproducible) and the
 * event is then offered directly to that host's country scope, same as any
 * other country-scope event. This handler only applies the host's effects —
 * there is no bidding, no escrow, no losing countries, no multi-turn state
 * machine.
 *
 * `sectorType: "entertainment"` stands in for tourism (no dedicated
 * `CorporationType` exists — see `royalEvent.ts`'s doc comment for the same
 * finding); `construction` is a real sector and used as-is for the venue
 * build-out.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.olympics",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "acknowledge",
      label: "Host the Games",
      description: "The nation hosts the Olympic Games.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A successful Olympic Games",
          effects: [
            { type: "approvalDelta", delta: 6 },
            { type: "sectorDemandModifier", sectorType: "construction", pct: 8, durationTurns: 6 },
            { type: "sectorDemandModifier", sectorType: "entertainment", pct: 8, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Hosts the Olympic Games",
            template:
              "The Olympic Games opened in {country} to international fanfare, drawing visitors and media attention from around the world. {leader} welcomed athletes and dignitaries at the opening ceremony.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
