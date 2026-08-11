/**
 * Generates varied flavor content for politician Wikipedia-style pages.
 * Uses a hash of politicianId to pick different templates so profiles feel distinct.
 */

const BIO_TEMPLATES = [
  "{name} is an American politician from {state}. {They} {affiliation} and currently {office_status}. {name} has built a reputation in {state} politics through {approach}.",
  "{name}, a {party} politician from {state}, {office_status}. Known for {approach}, {they} have been active in {state} political circles.",
  "A {state} native, {name} entered politics as {affiliation}. {They} {office_status} and has focused on {approach} throughout {their} career.",
  "{name} represents {state} as {affiliation}. {They} {office_status} and is recognized for {approach} in the political arena.",
  "From {state}, {name} is {affiliation} who {office_status}. {Their} political style emphasizes {approach}.",
  "{name} has been a fixture in {state} politics as {affiliation}. {They} {office_status} and are known for {approach}.",
  "An American politician hailing from {state}, {name} {affiliation}. {They} {office_status} and have gained notice for {approach}.",
  "{name} is {affiliation} based in {state}. {They} {office_status} and bring a focus on {approach} to {their} work.",
];

const APPROACHES = [
  "grassroots organizing",
  "coalition building",
  "policy-focused campaigning",
  "constituent outreach",
  "party alignment",
  "bipartisan engagement",
  "state-level advocacy",
  "national visibility",
  "local community ties",
  "strategic fundraising",
  "demographic outreach",
  "issue-based messaging",
];

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

export interface PoliticianContext {
  name: string;
  stateName: string;
  partyName: string;
  isIndependent: boolean;
  hasOffice: boolean;
  officeLabel: string;
  isNPP: boolean;
}

export function generatePoliticianFlavor(politicianId: string, ctx: PoliticianContext): string {
  const h = simpleHash(politicianId);
  const template = pick(BIO_TEMPLATES, h);
  const approach = pick(APPROACHES, h + 1);

  const affiliation = ctx.isIndependent
    ? "runs as an independent"
    : `is a member of the ${ctx.partyName}`;
  const they = ctx.isNPP ? "They" : "They";
  const their = ctx.isNPP ? "their" : "their";

  const office_status = ctx.hasOffice
    ? `serves as ${ctx.officeLabel}`
    : "is not currently holding office";

  return template
    .replace(/\{name\}/g, ctx.name)
    .replace(/\{state\}/g, ctx.stateName)
    .replace(/\{affiliation\}/g, affiliation)
    .replace(/\{they\}/g, they)
    .replace(/\{their\}/g, their)
    .replace(/\{office_status\}/g, office_status)
    .replace(/\{approach\}/g, approach)
    .replace(/\{party\}/g, ctx.partyName);
}
