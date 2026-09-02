/**
 * Who is seated on an organisation ballot.
 *
 * ONE definition, read by both the turn resolver and the panels. They are here
 * together because they drifted apart and a player paid for it: the resolver
 * started seating NPP-governed members on every ballot while the panels went on
 * showing the player-only roll, so a Warsaw Pact admission that the tab reported
 * as one vote short of unanimous was in truth five short, and Selwyn watched two
 * accepted applications expire without ever seeing the threshold that killed
 * them (ticket #1257).
 *
 * The rule, in two parts:
 *
 * 1. MOST ballots seat player-enabled members plus, in active mode, every
 *    modelled member whose formed NPP government could actually resolve the
 *    consequences of its vote. That covers every majority ballot, where a
 *    silence costs a yes and nothing worse — and free-trade agreements, which
 *    are unanimous but voted only by their own named parties, each deciding an
 *    agreement it is itself signing.
 *
 * 2. AN ADMISSION AND A BLOC WAR ENTRY seat player-enabled members only. These
 *    are the ballots that ask a member to consent to someone ELSE's business
 *    while letting it block the whole thing, so a silence there is
 *    indistinguishable from a veto. An NPP government plans once every six turns
 *    and executes a single ranked action — across a 24-turn ballot that is four
 *    contested chances to vote, which it will not always spend voting. Seating
 *    it there does not give the bloc a say, it gives one distracted member a
 *    permanent veto over the whole instrument.
 *
 * `ballotIsPlayerOnly` in `resolutionRules.ts` is the arbiter of which is which
 * — NOT `requiresUnanimity`, and the FTA is exactly why the two are different
 * questions. A new ballot kind picks up the right roll by declaring itself
 * there and nowhere else.
 */
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { NppForeignPolicyMode } from "@/lib/db/types";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { foreignPolicyModeFrom } from "@/lib/nppAutonomy/foreignPolicyRollout";

/**
 * The modelled members among `memberIds` that an NPP government currently runs,
 * or an empty set when the rollout is not in active mode.
 *
 * Requires a formed government with an NPP at its head AND a bill lifecycle: a
 * country that cannot put a bill through a legislature cannot answer for a vote,
 * which is the same bar `join_conflict` billing applies.
 */
export async function nppGovernedMembers(
  db: Db,
  /**
   * Pass a thunk where fetching the roster costs a query: the rollout check
   * below short-circuits every non-active world, and there is no reason to read
   * a membership list only to throw it away.
   */
  memberIds: readonly string[] | (() => Promise<readonly string[]>)
): Promise<Set<CountryId>> {
  const rollout = await db
    .collection<{ _id: string; nppForeignPolicyMode?: NppForeignPolicyMode }>("gameState")
    .findOne({ _id: "current" }, { projection: { nppForeignPolicyMode: 1 } });
  if (foreignPolicyModeFrom(rollout?.nppForeignPolicyMode) !== "active") return new Set();

  const ids = typeof memberIds === "function" ? await memberIds() : memberIds;
  const modelled = ids.filter(
    (member): member is CountryId =>
      member in COUNTRY_CONFIGS && hasBillLifecycle(member as CountryId)
  );
  if (modelled.length === 0) return new Set();

  const formations = await db
    .collection<GovernmentFormation>("governmentFormations")
    .find({
      _id: { $in: modelled },
      status: "formed",
      $or: [{ pmNppId: { $ne: null } }, { presidentNppId: { $ne: null } }],
    })
    .toArray();
  return new Set(formations.map((formation) => formation.countryId));
}
