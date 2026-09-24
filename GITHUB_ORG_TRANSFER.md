# GitHub organization transfer runbook

Prepared 2026-09-23 and updated 2026-09-24. This is a staging inventory. No product repositories, remotes, or deployments have been transferred.

## Current state

- `LakesideGames` is taken by a separate organization. The authenticated `Egg3901` account has no membership in it. Do not use that organization as the transfer target.
- `lakesidegamedev` is the confirmed organization. `Egg3901` has active admin access. Its display name, description, website, and public `.github/profile/README.md` are set. No product repositories have transferred.
- The active game repository is `Egg3901/AHDGame`. `Egg3901/a-house-divided` is a separate retired repository; do not substitute one for the other.
- `adhd-bot` is owned on GitHub by `Egg3901`, but the local checkout's `origin` is `arle-bina/adhd-bot`. Resolve that mismatch before changing its remote.
- `lakeside-agency` has no `origin` in the local checkout. Establish its intended GitHub repository before including it.
- `AHDGame-buildfix` is another checkout of `AHDGame`; `Rotunda` is another checkout of `AHDClient`; `ahd-docs-public` is another checkout of `ahd-docs`. Update their remotes along with the primary checkouts.
- `paseo-pr` points to `getpaseo/paseo`, not an `Egg3901` repository. Do not rewrite it. Inventory Paseo-managed worktrees separately by their actual remotes.

## Transfer scope

The scope is active Lakeside Games titles and the services used to build, operate, or publish them. This is a repository inventory, not an instruction to transfer all repositories in one batch.

| Group                            | Repositories owned by `Egg3901`                                                                       | Evidence                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A House Divided game and clients | `AHDGame`, `AHDClient`, `AHDNative`                                                                   | Current game and maintained native client work. Keep these names.                                      |
| Other Lakeside games             | `ahd-sim` (Electioneer), `metroforge`, `metroforge-native`, `grand-century`, `foreshore`, `verdigris` | Listed as games in the ops dashboard; repos exist under `Egg3901`.                                     |
| Live services and documentation  | `LSGD-ops-dash`, `adhd-bot`, `ahd-docs`, `ask`, `lakeside-accounts`, `lakeside-auth`                  | Ops dashboard, bot, docs, assistant, account portal, and shared authentication.                        |
| Development tooling              | `lakeside-code`                                                                                       | Recently active Lakeside development workspace; transfer if its access model should be organizational. |

Verify deployment or operational use before including `rialto`, `corpgame`, `LakesideHub`, `railway-ollama`, `ahd-docs-internal`, and `a-house-divided`. The dashboard names Margin of Victory but does not identify a GitHub repository for it. Leave the personal profile `Egg3901`, `savant-trading`, `personal-ops`, `personal-dashboard`, and unrelated or retired bot/game repositories with the personal account unless their ownership is separately decided. `paseo` is its own project and is outside this transfer.

`ahd-client` (Electron) and `ahd-android` (Capacitor) are deprecated. Keep their history, release assets, and download links available while checking for remaining users, but exclude them from the active transfer set. Archive them after successor links and downloads are verified.

## Proposed repository names

Use `LSGD` for shared Lakeside services, retain the established `AHDGame`/`AHDClient`/`AHDNative` names, and use the product name for other games. These are target names, not current GitHub URLs. Rename at transfer only after checking code references, release links, package metadata, integrations, and name availability in the organization.

| Current             | Target                     | Decision                               |
| ------------------- | -------------------------- | -------------------------------------- |
| `AHDGame`           | `AHDGame`                  | Canonical live game and server.        |
| `AHDClient`         | `AHDClient`                | Maintained released client.            |
| `AHDNative`         | `AHDNative`                | Native client in development.          |
| `ahd-client`        | no transfer; archive later | Deprecated Electron shell.             |
| `ahd-android`       | no transfer; archive later | Deprecated Capacitor shell.            |
| `ahd-sim`           | `Electioneer`              | Use the game title.                    |
| `metroforge`        | `MetroForgeSite`           | Distinguish storefront from game code. |
| `metroforge-native` | `MetroForge`               | Canonical game code.                   |
| `grand-century`     | `GrandCentury`             | Use the game title.                    |
| `foreshore`         | `Foreshore`                | Use the game title.                    |
| `verdigris`         | `Verdigris`                | Use the game title.                    |
| `LSGD-ops-dash`     | `LSGDOpsDashboard`         | Shared operations service.             |
| `adhd-bot`          | `AHDBot`                   | Product-specific Discord bot.          |
| `ahd-docs`          | `AHDDocs`                  | Product-specific documentation.        |
| `ask`               | `LSGDAsk`                  | Shared question-answering service.     |
| `lakeside-accounts` | `LSGDAccounts`             | Shared account portal.                 |
| `lakeside-auth`     | `LSGDAuth`                 | Shared identity broker.                |
| `lakeside-code`     | `LSGDCode`                 | Shared development workspace.          |

The older `a-house-divided` repository is not the canonical game. Keep historical and superseded repositories available until release/download consumers and automation no longer use them; then archive them with a pointer to the successor.

## References to change with the transfer

| Repository      | Live or maintained references                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AHDGame`       | `.github/CODEOWNERS` names `@Egg3901`; `.github/ISSUE_TEMPLATE/config.yml` links to the old owner; `scripts/analysis/export-lean-atlas.ts` and `src/lib/publicImageProxy.ts` embed old URLs. Historical simulation reports and test fixtures should retain their original attribution.                                                                                                                                    |
| `AHDNative`     | `.github/workflows/verify.yml` and `scripts/shared-rules.mjs` refer to old-owner repositories. Review validation scripts and release URLs.                                                                                                                                                                                                                                                                                |
| `LSGD-ops-dash` | `config/dashboard.yaml` has been corrected locally to the current `Egg3901/AHDGame` URL; deploy that change separately. `ticket-ship-notify.js` defaults to `Egg3901/AHDGame`; `download-portal.js` defaults to `Egg3901/AHDClient`; `worldsim-dashboard.js` has an old-owner issue fallback. `package.json` repository, bugs, and homepage URLs also use the old owner. Update tests and fixtures with behavior changes. |
| `ahd-client`    | `.github/CODEOWNERS` and issue templates contain old-owner references.                                                                                                                                                                                                                                                                                                                                                    |

Search all transferred repositories for `Egg3901`, `egg3901`, `github.com/`, and `api.github.com/repos/`. Distinguish executable configuration from historical reports, author names, and test fixtures. Check deployed environment variables such as `AHD_GITHUB_REPO`; repository secrets can be listed by name, but their values cannot be read back from GitHub.

GitHub retains repository webhooks, secrets, and deploy keys during transfer, but connected GitHub Apps must be checked for access under the new organization. GitHub redirects old repository URLs without a stated time limit; creating a repository or fork at the old location permanently removes that redirect. GitHub Pages URLs do not redirect. Check private-repository branch protection and Pages features against the receiving organization's plan before moving private repositories.

## Cutover order

1. Confirm the transfer set and target repo names. Check organization permissions, GitHub App access, branch protection/rulesets, environments, Pages, webhooks, and Actions secrets/variables for each repo.
2. Capture Railway service-to-repository links and deployment status. Check other GitHub Apps and automation with repository-level installation access.
3. Transfer one low-risk repository first; verify clone, fetch, pull request workflows, Actions, and deployment integration. Then transfer the remaining approved repositories.
4. Relink each Railway service to the transferred repository and verify a deployment. Update live repo identifiers and URLs in code/config, then deploy those changes.
5. On every VPS and local checkout, enumerate actual remotes with `git remote -v`. For a transferred repo, run `git remote set-url origin https://github.com/lakesidegamedev/REPO.git`. Include alternate checkouts and worktrees. Verify with `git ls-remote origin HEAD` and a normal fetch.
6. Recheck CODEOWNERS resolution, private-repo access, release downloads, issue filing, GitHub API calls, Pages, webhooks, Actions, and Railway after redirects are removed or bypassed. Search again for old-owner references.

The dashboard's stale AHD project link has been corrected to the current `Egg3901/AHDGame` URL. Do not pre-change remaining default repo identifiers or remotes to `lakesidegamedev`: they currently target live repositories and would switch behavior before transfer.
