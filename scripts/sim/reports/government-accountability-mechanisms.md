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

This report does not model PR seat allocation, changing demographics, endogenous party formation, or full government lifecycles. It supports the direction of the isolated mechanisms and does not establish an overall turnover rate. Remaining verification uses repository checks and deterministic regression fixtures for executive identity, coalition support, no-start eligibility, confidence, regime transitions and repeat election cycles. Turn-phase byte and round-trip measurements remain unverified.

The owner explicitly prohibited sandbox execution on 2026-10-04. All three queued world jobs were cancelled at turn 0 before execution. No sandbox qualification is planned or claimed. The no-start eligibility fixtures cover a mature custom party with local presence, an immature party, and an absent organization; these are code-level checks rather than a full-world forecast.

Brazil's 1953 five-year plurality and 1979 six-year modeled congressional selection are pinned era approximations. The 1979 model represents Congress only, omits federal-state delegations, and continues the preset's selection system rather than automatically replaying Brazil's subsequent constitutional transition. Modern eras use a majority ballot and a fresh two-candidate runoff when needed. Historical references: [TSE presidential election history](https://www.tse.jus.br/comunicacao/noticias/2022/Fevereiro/90-anos-da-justica-eleitoral-12-eleicoes-presidenciais-ja-foram-realizadas-no-brasil-desde-1945), [TSE 1985 electoral college](https://www.tse.jus.br/jurisprudencia/julgados-historicos/eleicao-de-1985-fidelidade-partidaria-no-colegio-eleitoral).
