/** Native Assembly campaigns retain their filed actors until statutory ballot certification. */
import type { Election } from "@/lib/db/types";
import { isBgFoundingCampaign } from "@/lib/countries/bg/rules/foundingCampaign1990";
import { hu1991PrimaryAdvanceLimit } from "@/lib/countries/hu/rules/assemblyCampaign1991";
import { russianAssemblyPrimaryAdvanceLimit } from "@/lib/countries/ru/assemblyPrimaryProgression";

export function nativeAssemblyPrimaryAdvanceLimit(
  election: Election,
  candidates: number
): number | null {
  return isBgFoundingCampaign(election)
    ? candidates
    : (hu1991PrimaryAdvanceLimit(election, candidates) ??
        russianAssemblyPrimaryAdvanceLimit(election, candidates));
}
