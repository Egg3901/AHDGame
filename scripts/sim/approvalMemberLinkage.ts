import { governmentApprovalFavorabilityDrain } from "@/lib/turn/governmentApprovalFavorability";

const scenarios = [
  { country: "US", government: "presidential player", approval: 50, members: 8 },
  { country: "UK", government: "parliamentary coalition", approval: 45, members: 5 },
  { country: "CN", government: "one-party command NPP", approval: 25, members: 12 },
  { country: "RU", government: "vacant or ceremonial-only", approval: 0, members: 0 },
];

console.log("# Approval member linkage kernel simulation\n");
console.log(
  "This exercises the portable drain rule only. Resolver fixtures are country-scoped: US president, UK PM, RU PM over ceremonial president, and CN NPP PM.\n"
);
console.log(
  "| Country | Government | Approval | Members | Drain/member/turn | 48-turn/member | 96-turn/member | Total drain/turn |"
);
console.log("|---|---|---:|---:|---:|---:|---:|---:|");
for (const scenario of scenarios) {
  const drain = governmentApprovalFavorabilityDrain(scenario.approval);
  console.log(
    `| ${scenario.country} | ${scenario.government} | ${scenario.approval} | ${scenario.members} | ${drain.toFixed(3)} | ${(drain * 48).toFixed(3)} | ${(drain * 96).toFixed(3)} | ${(drain * scenario.members).toFixed(3)} |`
  );
}

console.log("\n## Isolated public-expectations modifier\n");
console.log("| Baseline approval | Modifier | Effective approval | Drain/member/turn |");
console.log("|---:|---:|---:|---:|");
for (const baseline of [50, 45]) {
  const effective = baseline - 5;
  console.log(
    `| ${baseline} | -5 | ${effective} | ${governmentApprovalFavorabilityDrain(effective).toFixed(3)} |`
  );
}
