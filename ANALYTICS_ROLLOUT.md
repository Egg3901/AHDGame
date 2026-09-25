# Analytics rollout: PostHog and Sentry

Sentry SaaS in the `lakeside-games` US organization is the production error destination. The existing GlitchTip organization and project remain a fallback when `SENTRY_URL` and the GlitchTip DSNs are explicitly set. PostHog Cloud US is for product analytics; Sentry remains the error source of truth.

## Account and deployment state

- PostHog's DPA was signed and verified in the dashboard. The PostHog Cloud US project has $50,000 in startup credits, and its fourteen product billing limits were raised to $100/month each on September 24, 2026.
- The product manager added `NEXT_PUBLIC_POSTHOG_KEY` directly to AHD Production in Railway on September 25, 2026. Railway applied the variable and redeployed. Verify the key is present by name in the effective deployment settings, without reading or copying its value.
- The Ops Credentials portal is still unable to save to Railway. Its repair is independent of this rollout; do not direct the product manager back to that form for this key.

## Engineering deployment checks

- The A House Divided project and DSN already exist in the Lakeside Games Sentry organization. Verify the deployed `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` point to that project, `SENTRY_ORG=lakeside-games`, `SENTRY_PROJECT` matches its actual slug, and no GlitchTip `SENTRY_URL` override remains.
- Source-map upload requires build-time `SENTRY_AUTH_TOKEN`. The optional in-game admin issue feed separately needs server-only `SENTRY_API_TOKEN` with read access. Keep tokens out of the repository and chat.
- Keep PostHog error tracking disabled, then configure failed-turn, crash, and sustained API-failure alerts in Sentry after staging verification.
- Confirm the Ops Credentials portal save failure is tracked separately; it did not block the direct Railway key entry.

## Two destinations behind one wrapper

Product events fan out from a single choke point, `captureProductEvent` in
`src/lib/analytics/capture.ts`. No call site knows or cares which destinations
are live, so instrumentation is written once:

- **PostHog** (`src/lib/analytics/posthogClient.ts`) — breadth. Session replay,
  feature flags, experiments, surveys, error tracking. The daily driver.
- **Amplitude** (`src/lib/analytics/amplitudeClient.ts`) — depth. Retention
  curves, behavioural cohorts and funnel decomposition. Opened when there is a
  hard retention question.

Both are consent-gated. Withdrawing consent stops both, not just PostHog. A
destination whose key is absent is a silent no-op, so either tool can be
provisioned independently without suppressing the other, and the fan-out uses
`Promise.allSettled` so one destination failing never suppresses the other.

Both keys are public project keys supplied as deployment settings, never
committed or pasted into chat:

- `NEXT_PUBLIC_POSTHOG_KEY` — **present in AHD Production**, added 2026-09-25.
- `NEXT_PUBLIC_AMPLITUDE_API_KEY` — **not yet provisioned.** Amplitude needs a
  project created and this key set before it receives anything.

Do not double-instrument: every event in the table below already goes to every
configured destination.

## Current repository integration

PostHog loads only on the hosted multiplayer site after the existing optional analytics consent is accepted. Rejecting or resetting consent opts out and clears the PostHog identity. The Google consent message on ad content does not itself grant PostHog consent; those pages remain untracked unless the AHD analytics choice was accepted elsewhere.

PostHog autocapture, automatic pageviews, session replay, and surveys are disabled. Named area events avoid raw URLs and player text; the SDK denies URL and referrer properties. Identification uses an opaque account ID without name or email. Amplitude receives the same event set via the shared fan-out so retention and funnel questions can be answered without a second instrumentation pass.

OpenReplay session replay has been **removed** and is not part of the production stack. PostHog plus Amplitude are the whole of it. If replay is ever revisited, make that a deliberate decision on its own merits — do not restore the old provider.


| Event                  | Trigger                                                   | Properties                                                                                          |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `area_viewed`          | Opted-in visit to a named area                            | `area`: landing, registration, character_creation, profile, corporations, banking, media, elections |
| `game_visit`           | First opted-in authenticated view in a browser visit      | None                                                                                                |
| `account_created`      | Successful email/password registration response           | None                                                                                                |
| `character_created`    | Successful character creation response                    | None                                                                                                |
| `first_turn_completed` | Newly created character later sees a completed world turn | None                                                                                                |
| `party_joined`         | Successful direct party join                              | None                                                                                                |
| `message_sent`         | Successful player mail send                               | None                                                                                                |
| `election_entered`     | Successful entry into an election from its detail page    | None                                                                                                |

The first-turn anchor is local to one browser. Older characters and players using another device are not reconstructed. OAuth signup is not yet included in `account_created`. Interrupted navigation may undercount browser events. Validate the funnel against first-party account and character counts before using it for decisions.

Sentry keeps browser, server, edge, API, and turn capture paths. The release is the commit SHA in all runtimes. Source-map upload requires the build-time token. Broad console-log shipping is disabled for the initial SaaS rollout while errors and sampled traces remain enabled.

## Subsequent slices

1. Build and validate the onboarding funnel and next-day retention dashboard in PostHog.
2. Validate coverage of the initial first-week action events, then add other action paths needed for D7 and D30 retention analysis. Treat correlations as leads to investigate, not proof of causation.
3. Add discovery metrics for corporations, banking, and media. Use existing performance telemetry to measure slow corporation pages.
4. Replay is settled: OpenReplay is removed and PostHog session replay stays off. If a replay capability is ever wanted again, scope it as a fresh decision with its own masking and privacy review rather than reviving OpenReplay.
5. Pilot one UI or tutorial feature flag and experiment with a defined outcome. Flags must have local defaults and stay off the turn's critical path. Scope surveys to specific open product questions.

Before launch, verify accepted, rejected, and withdrawn consent; singleplayer exclusion; event volumes; Sentry error arrival; readable browser stacks; release identity; and alert delivery in staging.
