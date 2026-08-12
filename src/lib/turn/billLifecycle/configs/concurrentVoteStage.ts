import { getJointSittingOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import type { CountryId } from "@/lib/constants/countries";
import type { ConcurrentVoteStage } from "../types";

/**
 * The concurrent bicameral vote, shared by every national config.
 *
 * Both chambers vote at once, each into its own tally, and the bill passes only if
 * EVERY voting chamber clears the bar. Identical in every country, so it is defined once
 * rather than copied into six configs that would then drift.
 *
 * ⚠️ Chambers come from `getJointSittingOfficeTypes`, NEVER `legislature.bicameral`.
 * Germany's `1953-default` override sets `bicameral: true` over an APPOINTED Bundesrat
 * with no `upperElectionSystem` — the bicameral reading would open a chamber with no
 * electable members, leaving its tally structurally empty so `requireAll` fails every
 * German bill. The helper gates on an upper chamber that actually has voters, which is
 * the property that matters. It is also preset-sensitive (TR and ES flip
 * `upperElectionSystem` between eras), which is why `StageBillContext` carries a preset.
 *
 * Nothing produces an `active_both` bill until the Join Conflict provision lands, so
 * this stage is registered but unreached until then — that silence is expected.
 */
export const CONCURRENT_VOTE_STAGE: ConcurrentVoteStage = {
  kind: "concurrentVote",
  status: "active_both",
  chambersFor: (b) => getJointSittingOfficeTypes((b.countryId ?? "US") as CountryId, b.preset),
  voteFieldFor: (b, officeType) =>
    officeType === getJointSittingOfficeTypes((b.countryId ?? "US") as CountryId, b.preset)[0]
      ? "votes"
      : "otherChamberVotes",
  // Simple majority by design: a bloc war-entry bill is honouring a treaty the country
  // already ratified, and the bloc vote is the hard gate. `closeConcurrentVoteStage`
  // still resolves nat/priv's two-thirds supersede per bill.
  passRule: "simpleMajority",
  requireAll: true,
  onPassStatus: "signed",
  votingDurationHours: 24,
  // Int-org and join-conflict provisions skip the executive; anything else that adopts
  // this stage in a presidential country still routes to the President.
  execActionCheckOnPass: true,
};
