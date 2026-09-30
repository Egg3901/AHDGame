/**
 * National European decisions reflect party policy and current inflation.
 * Dates permit a proposal; ordinary parliamentary votes still decide the law.
 */
import type { CountryId } from "@/lib/constants/countries";
import { euroAdoptionRefusal, type EuroAdoptionConditions } from "@/lib/currency/euro/rules";
import { canRatifyMaastricht, type EuropeanIntegrationState } from "../rules";

export interface EuropeanPartyPolicy {
  economic: number;
  social: number;
}

export interface NationalEuropeanDecision {
  kind: "maastricht" | "euro";
  action: "ratify" | "reject";
  reasons: string[];
}

/** Existing party axes are -5..5. Trade openness supports integration;
 * sovereignty preference weighs against delegating national powers. */
export function europeanIntegrationSupport(policy: EuropeanPartyPolicy): number {
  if (!Number.isFinite(policy.economic) || !Number.isFinite(policy.social)) return 0;
  const economic = Math.max(-5, Math.min(5, policy.economic));
  const social = Math.max(-5, Math.min(5, policy.social));
  return Math.max(-40, Math.min(40, 10 + 2 * economic - 4 * social));
}

export function selectNationalEuropeanDecision(input: {
  countryId: CountryId;
  date: string;
  members: readonly string[];
  membershipId?: string;
  state: EuropeanIntegrationState;
  policy: EuropeanPartyPolicy;
  inflationRate?: number;
  euro: EuroAdoptionConditions;
}): NationalEuropeanDecision | null {
  if (!input.members.includes(input.countryId)) return null;
  if (!Number.isFinite(input.policy.economic) || !Number.isFinite(input.policy.social)) return null;
  const support = europeanIntegrationSupport(input.policy);
  if (canRatifyMaastricht(input.date, input.state.stage)) {
    const action = support > 0 ? "ratify" : "reject";
    const previous = input.state.ratifications[input.countryId];
    if (
      previous?.membershipId === input.membershipId &&
      previous?.approved === (action === "ratify")
    )
      return null;
    // Severe monetary instability delays new integration commitments, but does
    // not stop a sovereignty-oriented government from seeking rejection.
    if (
      action === "ratify" &&
      (input.inflationRate == null ||
        !Number.isFinite(input.inflationRate) ||
        input.inflationRate > 20)
    )
      return null;
    return {
      kind: "maastricht",
      action,
      reasons: [
        action === "ratify"
          ? "The governing party favors trade integration over retaining national discretion."
          : "The governing party favors retaining national discretion over deeper integration.",
        "Ratification remains subject to the ordinary parliamentary vote.",
      ],
    };
  }
  if (
    euroAdoptionRefusal(input.euro) ||
    support <= 0 ||
    input.inflationRate == null ||
    !Number.isFinite(input.inflationRate) ||
    input.inflationRate > 8
  )
    return null;
  return {
    kind: "euro",
    action: "ratify",
    reasons: [
      "The governing party supports shared monetary policy and trade integration.",
      `Current inflation (${input.inflationRate.toFixed(1)}%) permits considering monetary accession.`,
      "The national parliament must authorize accession before any conversion is fixed.",
    ],
  };
}
