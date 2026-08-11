# Security and Exploit Policy

A House Divided is a live competitive game with a persistent economy. A bug that lets a player mint money, see hidden information, or act outside the rules is a security issue here, the same as an auth bypass.

## Reporting

**Never open a public issue for a vulnerability or game exploit.**

Report privately via one of:

- **GitHub**: [Report a vulnerability](https://github.com/Egg3901/AHDGame/security/advisories/new) (private security advisory)
- **Email**: admin@ahousedividedgame.com
- **Discord**: DM a member of the staff team

Include a reproduction. For economy exploits, the sequence of in-game actions is the reproduction.

## Scope

In scope:

- Authentication, session, and authorization flaws
- Economy exploits: money creation, duplication, negative-cost actions, oracle access to hidden financials (fog of war)
- Election and legislation manipulation outside intended mechanics
- Injection of any kind, data exposure of other players' private information
- Abuse of the public API or Discord bot surface beyond its permissions

Out of scope:

- Findings that require admin access
- Rate-limit gripes without demonstrated impact, and denial-of-service
- Game balance opinions (strong strategies are not exploits; open an issue or a Discord thread)

## What you get

We don't run a cash bounty. What we do:

- **Credit** in the changelog and the in-game contributor recognition, unless you prefer anonymity
- **Supporter time** on your game account for meaningful reports
- Fast turnaround: the deploy pipeline ships fixes same-day when warranted

## Rules of engagement

Test against a **local world** (the repo gives you everything to run one), not production. If a discovery only manifests on production, verify it minimally: no scaled abuse, no touching other players' accounts or assets, no automation farms. Report promptly; sitting on an exploit while using it is a ban, reporting it is a thank-you.
