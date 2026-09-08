# Immediate targeted ad actions

Reproduce with `npx tsx scripts/sim/standing-targeted-ads.ts`. This synthetic fixture uses the production electorate and both primary and general vote allocators.

Each action costs 1 action point and 100 anchor campaign funds. A purchase immediately adds one percentage point of nominal target strength, capped at 25%. Alignment and cohesion determine the resulting voter-group bonus. Strength halves over 24 turns and never receives scheduled future top-ups.

| Actions | Funds | Initial strength | Synthetic candidate share |
| ------- | ----- | ---------------- | ------------------------- |
| 1       | 100   | 1%               | 50.150%                   |
| 5       | 500   | 5%               | 50.741%                   |
| 10      | 1000  | 10%              | 51.457%                   |
| 25      | 2500  | 25%              | 53.467%                   |

The symmetric no-ad candidate starts at 50%. A three-action purchase has strength 3.00% immediately, 2.9146% next turn and 1.50% after 24 turns. A perfectly aligned homogeneous target reaches exactly 25% competitive bonus at saturation. These are synthetic examples, not live election forecasts.

Original and version-1 elections both consume the same bonus. Primary and general allocation conserve the voter pool. Ads in another region give zero benefit. Regional eligibility is enforced separately by HTTP regression tests: home state normally, other states only for an active presidential candidacy.

No new turn-phase database reads are introduced by this correction. Region eligibility adds bounded reads to preview and purchase requests. Existing historical flight records are read as their paid action effort credited upfront, then decay; they never schedule future purchases.
