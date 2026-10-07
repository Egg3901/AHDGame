# Game telemetry foundation

All browser game events use the existing consent-gated `captureProductEvent`
wrapper and opaque account identity. The fetch observer records acknowledged
same-origin player mutations; reads, admin, public, bot and analytics endpoints
are excluded. A network exception without an API response is not an acknowledged
rejection. Cosmetic character changes and onboarding acknowledgements do not
qualify for activation.

## Events

- `player_action_succeeded`: action_domain, action_type, scope, entity_type,
  entity_id, resource_type, resource_amount. Resource fields describe reported
  spending, never returned account balances.
- `player_action_rejected`: the same action/entity fields and a controlled
  failure_code instead of resource fields. Raw errors and request content are
  never captured.
- `first_meaningful_action`: action_domain, action_type,
  turns_since_character_creation, starting_nation_id, creation_path,
  character_count. Consent-approved creation anchors live in analyticsRecords;
  an ownership-checked atomic claim deduplicates across browsers. Existing
  characters are not backfilled.
- `election_action_succeeded`: election_id, election_type, phase, action_type,
  party_id, target_region_id, cost_type, cost_amount.
- `election_resolved`: election_id, election_type, scope, candidate_count,
  player_candidate_count, turnout_pct, seats_available. Primary and general
  phases have distinct deduplication identities.
- Server `election_won`: election_id, election_type, party_id, seat_count,
  vote_share_pct, margin_pct, incumbent, outcome_source=server_resolution.
  Legacy office/margin aliases remain. The compatible results-view event remains
  and carries outcome_source=client_view; use the server source for outcome counts.
- `bill_status_changed`: bill_id, from_status, to_status, scope, chamber,
  category, provision_family, vote_margin. Temporary resolution claims are
  excluded; only real gameplay status changes are captured.
- `office_transition`: office_type, transition_type, party_id,
  selection_method, tenure_turns, career_stage. The system identity represents
  office transitions; no officeholder name is captured.

## Semantic corrections and context

`bill_passed` now means server enactment, rather than a sponsor viewing a signed
bill. `war_ended` now means actual peace, victory or expiry, including automatic
peace windows. Their old browser captures were removed. `war_declared` retains
its existing confirmed live-conflict behavior. Other existing event names remain.

Every game event has iteration_id and turn_number; nation_id is present when one
nation is concerned. Iterations use the recorded type and number. Missing legacy
iteration records use unknown and unavailable clocks use zero. Unknown turnout,
completed office tenure, or Germany list-only vote shares use unknown rather than
invented values. German reconciled winner incumbency is unknown where the prior
state cannot be recovered.

`turn_completed.actions_taken` retains its breadcrumb-dispatch semantics, and
`turn_processed.players_active` retains its recent-visit proxy semantics. Use the
new acknowledged action stream to measure successful gameplay.

## Delivery behavior

Turn outcome buffers are isolated from concurrent API request flushes. The turn
shell releases them after the durable game-state commit; uncommitted, local and
sandbox turns discard their buffers. New idempotent world outcomes claim stable
iteration/event identities with one batched analyticsRecords write per database
at flush. This is best-effort at-most-once emission, not a durable outbox: a crash
or SDK failure after claiming an event can lose it. Activation also has this
at-most-once delivery limitation, including consent withdrawal after its claim.
No migration or gameplay document fields are added.

## Phase 2 browser coverage

Successful actions additionally emit party_action_succeeded,
corporation_action_succeeded, market_action_succeeded, battle_action_succeeded,
diplomacy_action_succeeded, or crisis_action_succeeded as applicable. These reuse
the backbone action/entity/spending fields and controlled domain-specific fields.
The productArea map broadens area_viewed to named gameplay areas while preserving
previous area names. The server contracts are documented in
[WORLD_EVENTS.md](./WORLD_EVENTS.md).

### Observed account cohorts

Browser product events carry the same account metadata in PostHog and Amplitude,
using the authenticated `client-nav` response already loaded by the application:

| Event property         | Meaning                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `account_created_date` | Account creation date, `YYYY-MM-DD` UTC, or `unknown`        |
| `account_age_days`     | UTC calendar days between creation and capture, or `unknown` |
| `account_age_band`     | `day_0`, `days_1_6`, `days_7_plus`, or `unknown`             |
| `account_role`         | `admin`, `moderator`, `player`, or `unknown`                 |

These are event-time properties. Missing, malformed, and future creation dates
remain unknown. `player` requires both admin and moderator flags to be explicitly
false. This does not identify test accounts. No account query runs per event.
Server events do not acquire browser consent or these properties by inference.

Use `game_visit` for observed account presence and `player_action_succeeded` for
acknowledged actions. Split by creation date or event-time age to separate recent
accounts from older accounts creating new characters. `day_0` means the same UTC
calendar date, not the first 24 hours. OAuth accounts are eligible for this
metadata without fabricating `account_created` events. Registration events still
cover only the consented password-registration path. Its pending marker is bound
to the returned account ID; legacy unowned markers are discarded.

Both destinations use the opaque authenticated account ID. Amplitude now resets
its device ID before assigning an account, on account switching, and on logout;
consent withdrawal opts out and resets both SDKs. Historical anonymous Amplitude
identities are not backfilled or linked to these accounts. Compare account uniques
only after rollout, and check actual destination delivery before interpreting
counts. PostHog resets before a different account is identified, including initial
SDK hydration, so a persisted previous account cannot absorb the next account.

Events with known account context wait for SDK initialization. Work started under
an account is discarded if the identity changes before delivery. Events without
a known account are not queued for assignment to an arbitrary later login.
Milestone helpers do not consume pending signup markers or claim durable character
activation before account context exists. A claim already in flight at logout can
still complete server-side while its browser event is dropped. Analytics delivery
is best effort; the activation claim is not a delivery acknowledgement.

For analysis, use complete UTC days after rollout and report unknown metadata
separately. Exclude `account_role` admin/moderator where a player-only population
is needed; require `account_role = player` for a strict known non-staff population
and show excluded unknowns. Test traffic remains unexcluded unless independently
identified by an existing documented project filter. Never sum generic successful
actions with their overlapping domain-specific events. Rejection codes remain
HTTP response classes, not detailed rule or reliability diagnoses.
