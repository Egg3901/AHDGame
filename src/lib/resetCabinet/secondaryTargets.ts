/** Named secondary drivers that the reset Cabinet action register may target. */
export interface ActionSecondaryTarget {
  id: string;
  label: string;
  description: string;
  /** Candidates for later causal integration, not an automatic metric bonus. */
  potentialDownstreamPrimaries: readonly string[];
}

export const actionSecondaryTargets: readonly ActionSecondaryTarget[] = [
  {
    id: "S:borderSecurity",
    label: "Border casework capacity",
    description:
      "Completed lawful immigration and border casework. This is administrative throughput, not migration stock or a direct population-growth score.",
    potentialDownstreamPrimaries: [],
  },
  {
    id: "S:costOfLiving",
    label: "Consumer living costs",
    description:
      "Observed household basket prices. Purchasing power changes only after prices, income, taxes, and transfers are reconciled.",
    potentialDownstreamPrimaries: ["02", "07"],
  },
  {
    id: "S:governmentApproval",
    label: "Government approval",
    description:
      "A short-lived political response to observable governing behavior, not a substitute for public trust or service delivery.",
    potentialDownstreamPrimaries: [],
  },
  {
    id: "S:partyDiscipline",
    label: "Party discipline",
    description:
      "Verified party voting coordination. It affects legislative reliability, not a citizen outcome directly.",
    potentialDownstreamPrimaries: [],
  },
  {
    id: "S:roboticsAdoption",
    label: "Industrial robotics adoption",
    description:
      "Working technology deployments in firms. Productivity and employment respond through later production and labor calculations.",
    potentialDownstreamPrimaries: ["06"],
  },
  {
    id: "S:smallBusinessFormation",
    label: "Small-business formation",
    description:
      "Verified new firm entry after licensing and financing barriers. Output and jobs respond through the economy, not an instant Cabinet bonus.",
    potentialDownstreamPrimaries: ["05", "06"],
  },
  {
    id: "S:tradeGrowth",
    label: "Trade activity",
    description:
      "Realized export and import activity. Trade balance and output depend on both flows and domestic production.",
    potentialDownstreamPrimaries: ["08"],
  },
  {
    id: "S:workLifeBalance",
    label: "Work-life conditions",
    description:
      "Observed working hours and compliance. Family and health outcomes follow through household and care processes over time.",
    potentialDownstreamPrimaries: ["20", "55"],
  },
];

export function actionSecondaryTarget(id: string): ActionSecondaryTarget | undefined {
  return actionSecondaryTargets.find((target) => target.id === id);
}
