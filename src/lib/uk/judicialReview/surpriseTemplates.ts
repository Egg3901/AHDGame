/**
 * UK Judicial Review surprise templates — SCOTUS surprise-case pattern (#3607)
 * adapted for Britain without a full UKSC roster.
 *
 * Fake JR / UKSC-style titles; real `uk_*` mild option ends (opt_1 left /
 * opt_5 right). Dual effects so a proxy court lean can land either way.
 */
export type JrCaseAxis = "economic" | "social";

export interface JrCaseEffect {
  legislationTypeId: string;
  policyOptionId: string;
  effectDirection: -1 | 0 | 1;
}

export interface JrSurpriseTemplate {
  templateKey: string;
  title: string;
  axis: JrCaseAxis;
  /** Fires when proxy court lean is right-leaning (positive). */
  positiveEffect: JrCaseEffect;
  /** Fires when proxy court lean is left-leaning (negative). */
  negativeEffect: JrCaseEffect;
}

export const UK_JR_SURPRISE_TEMPLATES: JrSurpriseTemplate[] = [
  {
    templateKey: "r-save-the-marshes-v-secretary-of-state-for-environment",
    title: "R (Save the Marshes) v Secretary of State for Environment",
    axis: "economic",
    positiveEffect: {
      legislationTypeId: "uk_climate_net_zero",
      policyOptionId: "uk_climate_net_zero_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_climate_net_zero",
      policyOptionId: "uk_climate_net_zero_opt_1",
      effectDirection: 1,
    },
  },
  {
    templateKey: "r-north-sea-wind-leaseholders-v-crown-estate",
    title: "R (North Sea Wind Leaseholders) v Crown Estate Commissioners",
    axis: "economic",
    positiveEffect: {
      legislationTypeId: "uk_transport_rail",
      policyOptionId: "uk_transport_rail_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_transport_rail",
      policyOptionId: "uk_transport_rail_opt_1",
      effectDirection: 1,
    },
  },
  {
    templateKey: "r-patient-voices-alliance-v-secretary-of-state-for-health",
    title: "R (Patient Voices Alliance) v Secretary of State for Health",
    axis: "economic",
    positiveEffect: {
      legislationTypeId: "uk_nhs_funding",
      policyOptionId: "uk_nhs_funding_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_nhs_funding",
      policyOptionId: "uk_nhs_funding_opt_1",
      effectDirection: 1,
    },
  },
  {
    templateKey: "r-channel-watch-v-home-secretary",
    title: "R (Channel Watch) v Secretary of State for the Home Department",
    axis: "social",
    positiveEffect: {
      legislationTypeId: "uk_immigration_asylum",
      policyOptionId: "uk_immigration_asylum_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_immigration_asylum",
      policyOptionId: "uk_immigration_asylum_opt_1",
      effectDirection: 1,
    },
  },
  {
    templateKey: "r-licence-fee-payers-v-bbc",
    title: "R (Licence Fee Payers Association) v British Broadcasting Corporation",
    axis: "social",
    positiveEffect: {
      legislationTypeId: "uk_bbc_public_media",
      policyOptionId: "uk_bbc_public_media_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_bbc_public_media",
      policyOptionId: "uk_bbc_public_media_opt_1",
      effectDirection: 1,
    },
  },
  {
    templateKey: "r-trident-watch-v-secretary-of-state-for-defence",
    title: "R (Trident Watch) v Secretary of State for Defence",
    axis: "economic",
    // Trident ladder is inverted vs most uk_* types (right/renewal = +1).
    positiveEffect: {
      legislationTypeId: "uk_trident_defence",
      policyOptionId: "uk_trident_defence_opt_5",
      effectDirection: 1,
    },
    negativeEffect: {
      legislationTypeId: "uk_trident_defence",
      policyOptionId: "uk_trident_defence_opt_1",
      effectDirection: -1,
    },
  },
  {
    templateKey: "r-fair-votes-uk-v-speaker-of-the-commons",
    title: "R (Fair Votes UK) v Speaker of the House of Commons",
    axis: "social",
    positiveEffect: {
      legislationTypeId: "uk_electoral_reform",
      policyOptionId: "uk_electoral_reform_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_electoral_reform",
      policyOptionId: "uk_electoral_reform_opt_1",
      effectDirection: 1,
    },
  },
  {
    templateKey: "in-re-commuter-rail-timetable-v-dft",
    title: "In re Commuter Rail Timetable Challenge v Department for Transport",
    axis: "economic",
    positiveEffect: {
      legislationTypeId: "uk_transport_rail",
      policyOptionId: "uk_transport_rail_opt_5",
      effectDirection: -1,
    },
    negativeEffect: {
      legislationTypeId: "uk_transport_rail",
      policyOptionId: "uk_transport_rail_opt_1",
      effectDirection: 1,
    },
  },
];
