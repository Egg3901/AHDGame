# Government accountability mechanism qualification

The treatment makes sustained poor performance cost the parties responsible for government. It preserves responsibility across nominee replacements, shares executive responsibility across a coalition, and attributes the legislative share across elected lower and upper chambers. A Senate majority carries responsibility even when the same party lacks a House majority. Regional registration advantages are earned by executive approval, and direct executive voting penalties continue to worsen down to zero approval.

Source: `7f040eb422e05488dc1a67e3cc2312213f3bc396`. The source worktree was clean at execution. Run `npx tsx scripts/sim/governmentAccountability.ts --out=<report.json>`.

## Method and findings

The production swing-flow allocator ran 480 deterministic paired scenarios: eight office families, NPP and mixed actors, three demographic distributions, five approval ratings, and new or long-serving governing parties. The control uses the previous favorability drain and represents the previous capped executive drag through an equivalent approval input. This is a synthetic mechanism comparison, not execution of the old build.

All scenarios passed vote conservation, nonnegative vote counts, party-label invariance, and unchanged performance treatment at approval 50 or above. Long-serving poor governments lost up to 14.7 percentage points relative to this control. Sixteen synthetic cases crossed the 50 percent vote-share line; that is a sensitivity result, not a forecast of seat turnover or a target turnover rate.

The regional registration planner also ran paired 192-turn trajectories, conserving a total electorate of 100 on every turn. From identical starting registration of 40, the governor's party ended at:

| Approval | Unconditional officeholding control | Approval-earned treatment |
| -------- | ----------------------------------: | ------------------------: |
| 30       |                             56.1139 |                   54.0548 |
| 50       |                             56.1139 |                   54.0548 |
| 60       |                             56.1139 |                   55.0844 |
| 70       |                             56.1139 |                   56.1139 |

## Qualification still required

This report does not model PR seat allocation, changing demographics, endogenous party formation, or full government lifecycles. The balance treatment must remain unmerged until source-pinned integrated sandbox runs cover multiple ordinary election cycles, no-start custom-party maturation and supply, NPP and mixed actors, government attribution, confidence losses, regime escalation, and repeated Brazil presidency cycles. Turn-phase byte and round-trip measurements are also pending.

The current worldsim connector cannot express the separate `startingParties=none` setting for the 1991 preset. A normal 1991 job is not evidence for that scenario. The new eligibility tests cover a mature custom party with local presence, an immature party, and an absent organization, but do not replace integrated no-start qualification.

Brazil's 1953 five-year plurality and 1979 six-year modeled congressional selection are pinned era approximations. The 1979 model represents Congress only, omits federal-state delegations, and continues the preset's selection system rather than automatically replaying Brazil's subsequent constitutional transition. Modern eras use a majority ballot and a fresh two-candidate runoff when needed. Historical references: [TSE presidential election history](https://www.tse.jus.br/comunicacao/noticias/2022/Fevereiro/90-anos-da-justica-eleitoral-12-eleicoes-presidenciais-ja-foram-realizadas-no-brasil-desde-1945), [TSE 1985 electoral college](https://www.tse.jus.br/jurisprudencia/julgados-historicos/eleicao-de-1985-fidelidade-partidaria-no-colegio-eleitoral).
