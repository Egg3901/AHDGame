# Arab uprisings: retained-world acceptance

Issue: #2157. Related crisis gate: #2158; tracker: #2159.

## Source and scope

- Clean gameplay/replay source: `8731bf008fa9eb4c0d7d1641da0b779f7a8ffa7b`.
- Completed retained world: run `a2b5adb8-dd9a-4480-8781-50befc0fd53d`, source `47bb364e1f605c895d186e51f6a19b6ed4de5ff3`, 2027 European control, 48 processed full-world turns.
- Qualification: five separate 216-turn subsystem continuations plus one public capacity-refusal control, each in a new isolated sandbox database. The crisis calendar starts in 2011 against retained later-era stocks. This tests alternative policy trajectories; it does not claim a new full-world historical reconstruction.
- Runtime after the pin incorporates the additive financial/pandemic integration, public per-origin resolution copy and this report. The Arab trajectory, expenditure and exposure formulas are unchanged.
- Machine-readable observations: [acceptance JSON](issue-2157-arab-uprisings-acceptance.json).

The source contains observed background sovereign records for Egypt, Libya and Syria. Their population estimates are 350,000 each, with existing sector capacities. Tunisia and Yemen remain explicitly represented unavailable actors; no Turkish, Jordanian or other government is substituted for them. Unit coverage exercises a Tunisian origin and unavailable-authority handling. These estimates qualify game mechanics at the retained world's scale, not historical population or refugee forecasts.

## Controlled setup and public authority

The neutral case preserves the retained background signals. Other cases change only Syria's observed stability and agriculture demand: stability 0.70 for reform, 0.10 for transition, 0.50 for the authoritarian path and 0.35 for war; agriculture demand is three times existing capacity. The food shock is removed after the first reform/transition policy or after war starts, as recorded by the runner.

No conflict outcome, displacement, GDP, budget or army strength is assigned to obtain a successful trajectory. The capacity-refusal case explicitly reduces US unit readiness and support equipment to zero to test rejection. Four synthetic foreign executives authorize public API choices. No origin offices, ballots or legislative approvals are fabricated.

Background governments make separately recorded simulated policy decisions from local legitimacy, mobilization and cohesion. Playable-origin policy requires an authorized public response. Missing public respondents contribute no reform, aid, arms, sanctions or spending by default. The background policy model is not an elected-consent or legislative process.

## Results

| Continuation           | Turns | Shared windows | Public decisions | Observed Syrian paths                                     |
| ---------------------- | ----: | -------------: | ---------------: | --------------------------------------------------------- |
| Capacity refusal       |     1 |              1 |                0 | Structural pressure; intervention rejected                |
| Retained neutral       |   216 |              9 |                0 | Structural pressure                                       |
| Reform                 |   216 |              9 |                0 | Structural pressure, reform                               |
| Negotiated transition  |   216 |              9 |                0 | Pressure, protest, transition                             |
| Authoritarian control  |   216 |              9 |                0 | Pressure, protest, authoritarian control, renewed protest |
| Civil war and recovery |   216 |              9 |               32 | Pressure, protest, civil war, frozen settlement           |

- The neutral and refusal cases produce zero displacement and no treasury changes. Reform and transition remain peaceful.
- Every accepted public decision is retried and rejected: **32 duplicate rejections**, with exact treasury reconciliation after the retry. The refusal test rejects through the ordinary server capability checks before charging the treasury.
- War requires repression, fragmented authority, armed opposition and actual outside military/proxy support. Unaffected origins retain independent policies. There is one regional event family and nine windows per 216-turn continuation.
- Displacement peaks at **20**, corresponding to **2% origin labour exposure** at the authored scale. Recovery ends at **10**, with reconstruction **15** and infrastructure damage falling from **10 to 5**.
- At peak, 7,000 people-equivalent are displaced at origin: 3,500 internally and 3,500 externally. Actual host allocations sum to 3,500 within floating-point error on every turn. The model stores exposure and leaves population stocks unchanged.
- Actual macro turns persist a maximum **0.79 per-turn output-unit reduction** relative to the same-tick, same-country kernel without crisis modifiers. All peaceful cases have zero crisis output loss after restricting comparisons to actual macro tick boundaries.
- Hosting exposure reaches **0.00003198868865345813**. Ordinary macro output and playable-region labour/potential-growth consumers read the same bounded exposure model; overlapping conflicts aggregate before one cap.
- The real counterterrorism spillover consumer records a maximum standing threat contribution of **1.974** in the war case and **0.544** in the authoritarian case. Peaceful controls remain zero. The contribution is reconciled by differences and can recede with recovery.
- Foreign policy creates durable military, covert and humanitarian commitments. In the war case, exact public response costs are **493,504,048,926 US budget units**, **116,576,745,570 German budget units**, and **72,852,089,718 Turkish budget units**. These native-currency amounts are not summed across countries. UK sanctions choices cost zero under the authored menu.
- Sanctions attach to the most repressive, fragmented origin, decay over time and reduce its macro output by at most 5%. Existing capacity is retained for recovery. Host protection changes the allocation weights and carries real response costs.

## Production and regression coverage

The portable rules cover independent regional pressure, both observed and missing authorities, different NPC policies, reform, transition, authoritarian control, civil war, frozen settlement, recovery, refugee allocation, capability gating, sanctions, spillover, legacy Syrian-state migration and retries. The final focused run passed **79 tests across five files** covering regional rules, shared turn materialization, public response resolution, macro-country behavior and retained Yugoslav exposure regression. Targeted lint and architecture checks also passed.

The normal driver initializes and samples the region with four projected batch reads every twelve turns, then emits shared windows. It preserves legacy Syrian conflict consequences when upgrading a previously opened aggregate state. Accepted responses and per-origin consequences are persisted together with resolution IDs; retry can repair a skipped trajectory without recharging public spending. Public results name each origin's outcome.

The replay uses the normal driver, event materializer, public decision/role resolver, expiry resolver, campaign capability loader, macro-country turn and counterterrorism spillover consumer. It does not run unrelated whole-world phases or repair inherited source-world issues.

## Reproduce

Use a new target prefix in an isolated simulator Mongo service:

```sh
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ npx tsx --tsconfig tsconfig.json scripts/sim/arabUprisingsReplay.ts \
  --source=ahd_sim_audit_europe_control_2027_0929 \
  --target=ahd_sim_arab_qualification_unique \
  --out=/tmp/arab-qualification.json
```

The runner refuses a dirty source, reused target, non-simulator database name or non-sandbox endpoint. Each case gets its own target database. Add `--scenario=civil_war_recovery` to reproduce one continuation.

## Contemporary primary anchors

These sources explain the modeled relationships. Numerical thresholds are explicit gameplay calibrations.

- [UN Security Council humanitarian briefing, 30 August 2012](https://press.un.org/en/2012/sc10752.doc.htm): internal and external displacement, host pressure and the interaction of conflict and humanitarian conditions.
- [UN Deputy Secretary-General, 30 August 2012](https://www.un.org/sg/en/content/former-deputy-secretary-general/statement/2012-08-30/deputy-secretary-generals-remarks-ministerial-meeting-of-the-security-council-the-humanitarian-situation-syria): state fragmentation, outside arms, humanitarian access and funding constraints.
- [UNHCR briefing, 18 April 2013](https://www.unhcr.org/news/news-releases/un-high-commissioner-refugees-warns-security-council-terrifying-humanitarian): growing cross-border refugee pressure and regional humanitarian needs.
- [Security Council resolution 2254, 18 December 2015](https://press.un.org/en/2015/sc12171.doc.htm): negotiation, ceasefire and a Syrian-led political transition.
