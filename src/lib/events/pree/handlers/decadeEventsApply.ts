import type { EventHandler } from "@/lib/events/substrate/types";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

export const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};
