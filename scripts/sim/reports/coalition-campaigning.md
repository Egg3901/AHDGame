# Coalition campaigning balance run

Reproduce with `npx tsx scripts/sim/coalition-campaigning.ts`. The adjacent JSON is the deterministic output. All voters and candidates are synthetic; this run uses the production granular turnout derivation and competitive vote allocator.

| Aligned canvasses | Current target turnout | New target turnout | New bucket modifier |
| ----------------- | ---------------------: | -----------------: | ------------------: |
| 1                 |                  50.0% |              50.5% |                2.00 |
| 5                 |                  50.1% |              52.0% |                8.19 |
| 10                |                  50.1% |              53.1% |               13.03 |
| 20                |                  50.2% |              54.1% |               17.57 |

The fixture blends race, age, education, and wealth, each starting at 50% turnout. White voters represent 40% of the eligible population. Ten aligned actions add approximately 13,000 voters per million eligible people. Canvassing mobilizes voters for every candidate; ideological fit determines who benefits from the added turnout.

The new base input is 2 points times squared alignment fit, doubled in the closing campaign window. Inputs remain capped at 20 points. A six-turn half-life makes continued activity matter: one aligned action per turn sustains an input near 10 points rather than permanently banking a full 20-point modifier. Original-rule races retain their existing 0.05-point base and 2% decay.

Ads apply a separate competitive-weight bonus. Each matching cell responds to candidate-to-target fit, candidate-to-cell fit, agreement between its identities, and the target audience's ideological cohesion. Overlapping targets share a 15% cap. Exposure loses half its value in twelve turns and is capped at 3, preventing long flights from storing many turns of near-saturated influence. The cap was added after the uncapped simulation showed that a twelve-turn flight retained almost its full effect another twelve turns after spending stopped.

An ad flight in the mixed-identity fixture gives individual matching cells bonuses from approximately 1.66% to 12.38% at saturation. Nonmatching cells receive zero. The candidate's overall share moves from 32.44% to 32.62%. Ten aligned canvasses plus that flight move it to 33.11%. This is a strongly opposed electorate, so campaigning helps without overturning its underlying preferences.

In a symmetric electorate where the opponent starts with 52 approval against 50, the same combination moves the candidate from 49.63% to 50.34%, changing the winner of a close race. Approval weights are unchanged.

The script asserts ballot conservation, meaningful turnout after blending, geographic and identity scope, building and fading ad effects, and a contestable close race. Unit and integration coverage additionally checks both general and primary vote-distribution paths, old-race compatibility, complete cell identities, overlapping targets, prepaid/manual equivalence, authorization, spending, and rollback on concurrent purchases.

These are controlled balance scenarios, not a forecast of every race. Existing party organization, registration, campaign strength, accumulated ballots, and election-specific factors continue to affect actual outcomes. Score-based regional primaries average the cell bonuses into their existing regional share calculation; presidential primaries and general elections apply them within demographic allocation.

A separate full-turn profile used two copies of the same freshly bootstrapped 2019 synthetic world (14,985 initial documents), with four advertised regional primary races and eight initial candidates. Both versions completed turn 2. Primary snapshots used 23 reads/writes and approximately 1.0 MiB of returned BSON before the change, versus 29 and 1.2 MiB afterward; the existing phase budget is 800 round trips. The extra context reads are batched across regions. Whole-turn counts were 10,045 versus 10,057, with 59.1 versus 59.3 MiB returned. Other world activity has random choices, so whole-turn differences are descriptive rather than an isolated benchmark of advertising. Local wall-clock time is not used as a performance claim.
