"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { PartyOption } from "../register/components/registerTypes";
import { isStartingPartyEligible } from "@/lib/registration/rules/startingParty";

/** Keep the starting-party picker and its current selection aligned with the home region. */
export function useStartingPartyOptions<T extends { party: string; homeState: string }>(
  parties: PartyOption[],
  formData: T,
  isAdmin: boolean,
  setFormData: Dispatch<SetStateAction<T>>,
  setPartyTouched: Dispatch<SetStateAction<boolean>>
) {
  const eligibleParties = useMemo(
    () => parties.filter((p) => isStartingPartyEligible(p, formData.homeState, isAdmin)),
    [parties, formData.homeState, isAdmin]
  );
  if (formData.party !== "independent" && !eligibleParties.some((p) => p.id === formData.party)) {
    setFormData((prev) => ({ ...prev, party: "independent" }));
    setPartyTouched(false);
  }
  return {
    eligibleParties,
    majorParties: eligibleParties.filter((p) => p.isDefault),
    communityParties: eligibleParties.filter((p) => !p.isDefault),
  };
}
