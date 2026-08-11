/**
 * Decision-handler registration barrel.
 *
 * Imported once at app startup (from the turn-system entry point) so
 * the central registry has all stage handlers available before the
 * decision-queue resolve / expire paths dispatch.
 *
 * Each handler module exports its `DecisionHandler` constant; this
 * file is the one place that registers them. Adding a new stage means
 * adding one import + one register call here.
 */
import { registerDecisionHandler } from "./registry";
import { stage1AddressDiscontentHandler } from "./stage1AddressDiscontent";
import { stage2RespondToUnrestHandler } from "./stage2RespondToUnrest";
import { stage3RespondToFactionSplitHandler } from "./stage3RespondToFactionSplit";
import { stage4FaceCollapseHandler } from "./stage4FaceCollapse";

registerDecisionHandler(stage1AddressDiscontentHandler);
registerDecisionHandler(stage2RespondToUnrestHandler);
registerDecisionHandler(stage3RespondToFactionSplitHandler);
registerDecisionHandler(stage4FaceCollapseHandler);
