import type { ObjectId } from "mongodb";
import { createNotification } from "@/lib/notifications";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CommodityType } from "@/lib/constants/commodities";

export type SupplyAgreementEvent = "accepted" | "taken" | "started" | "cancelled" | "expired";

const VERB: Record<SupplyAgreementEvent, string> = {
  accepted: "accepted",
  taken: "taken",
  started: "started",
  cancelled: "cancelled",
  expired: "expired",
};

/**
 * Tell one CEO a supply agreement changed state. `actor` names who caused it
 * and is omitted for expiry, which nobody caused. A vacant corporation has no
 * one to tell.
 */
export async function notifySupplyAgreementEvent(args: {
  recipient: Pick<Corporation, "_id" | "userId">;
  actor?: Pick<Corporation, "name">;
  agreementId: ObjectId;
  commodity: CommodityType;
  event: SupplyAgreementEvent;
  detail?: string;
}): Promise<void> {
  if (!args.recipient.userId) return;
  const link = args.event === "started" ? "with" : "by";
  const by = args.actor?.name ? ` ${link} ${args.actor.name}` : "";
  await createNotification({
    userId: args.recipient.userId,
    type: "corp_supply_agreement_update",
    title: `Supply agreement ${VERB[args.event]}`,
    message: `Your ${args.commodity} supply agreement was ${VERB[args.event]}${by}.${args.detail ? ` ${args.detail}` : ""}`,
    metadata: {
      corporationId: args.recipient._id.toString(),
      agreementId: args.agreementId.toString(),
      event: args.event,
    },
  });
}
