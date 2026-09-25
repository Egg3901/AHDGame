# AHD hosting scale-up

## Current baseline

Read-only Railway API snapshot on 2026-09-25, AHD Production, production
environment, preceding 24 hours. Resource samples are five-minute averages,
so they do not rule out shorter spikes.

| Measure                             |  Observed | Available |
| ----------------------------------- | --------: | --------: |
| CPU, five-minute maximum            | 0.33 vCPU |    5 vCPU |
| Memory, five-minute maximum         |   2.76 GB |      9 GB |
| Memory, five-minute p95             |   2.04 GB |      9 GB |
| HTTP p95, median five-minute bucket |     85 ms |         — |
| HTTP p99, worst five-minute bucket  |  3,321 ms |         — |

The current service is not persistently CPU or memory bound. Increasing its
resource limit has no measured benefit yet. Aggregate HTTP timings also hide
slow routes, so page and API work needs route-level timings before tuning.

## First scale boundary: isolate the turn scheduler

The web process currently owns the hourly turn schedule. Web deployments can
terminate an in-flight turn, and a second web replica would start another
in-process scheduler. `CRON_OWNER=worker` already disables the web scheduler;
`scripts/turn-worker.ts` owns it in a separate process. The worker now starts
Sentry and the heap watchdog before loading the cron graph. Its command is
`npm run start:turn-worker`.
The command uses the web service's V8 heap settings so the worker watchdog
retains the same memory backstop.

Set up one worker service from the **same AHD source revision** as the web
service, with one replica and no public domain. Use the same game database and
the runtime variables required by the turn process, including Sentry's server
DSN. Match the current web service's 5 vCPU and 9 GB memory limits for the
initial cutover; measure peak turn usage before sizing the worker down. Set
`CRON_OWNER=worker` on the worker. The product manager can configure
the Railway service, variables, build command, and start command; do not put
their values in the repository or handoff text. Railway's current guidance
supports a separate service from the same repository with its own start
command. New services cannot opt in to the retiring `railway.toml` format, so
configure the worker's start command and disable its HTTP health check in the
Railway dashboard. Verify its effective deployment settings before cutover.

### Staging cutover

Only a production Railway environment was visible in the baseline snapshot.
Create an isolated staging environment with a seeded test world before this
rehearsal. Never point a staging worker at the production database.

1. Start the worker against the **staging** database with one replica. Confirm
   its log reaches `cron initialized, waiting for the clock` and Sentry
   receives the worker service's monitor/check-in events. Confirm the effective
   start command in the Railway deployment details; it must be
   `npm run start:turn-worker`, with no `/api/health` check inherited from web.
2. While staging web still owns cron, let one scheduled turn complete. The
   database processing lock must prevent a duplicate turn when both processes
   fire. Check turn number, lock state, phase warnings, and exact source SHA.
3. Set `CRON_OWNER=worker` on staging web after a completed turn. Redeploy web.
   Verify the next two turns run from the worker and no web cron tick appears.
   Retire or redirect the old web service's missed-check-in alert, which will
   now be silent by design; retain the worker monitor alert.
4. Exercise a web redeploy between turns and verify the worker remains running.
   Repeat in production only after this sequence passes.

### Production cutover and rollback

Use one production worker and keep web at one replica for the first two turns.
Start the worker first, confirm it is healthy, then set `CRON_OWNER=worker` on
web just after a completed turn. If the worker misses a turn or fails, unset
`CRON_OWNER` on web and redeploy web **before** stopping the worker; the database
lock protects the temporary overlap. Record the last completed turn and check
that the next scheduled turn advances exactly once.

Do not increase web replicas in this cutover. Every web process currently runs
startup migrations, whose marker check and write are separate operations. Two
simultaneous web boots can run the same migration. Coordinate startup
migrations across replicas, or move them to a single required pre-deploy step,
before testing two web replicas. Keep the worker at one replica.

## Next measurements

- Record per-route p95/p99 and error rate for corporation and other slow APIs;
  the whole-service Railway percentile cannot explain a six-second page.
- Profile one pinned mature turn, including per-phase BSON bytes and Mongo
  round trips, before changing turn budgets or query shapes.
- After worker isolation and startup migration coordination, load-test one
  versus two web replicas against staging. Compare latency, errors, Mongo
  connections, and turn duration before changing production replica count.

Railway references: [Scaling](https://docs.railway.com/deployments/scaling),
[multiple services from one repo](https://docs.railway.com/deployments/monorepo),
[Config as Code status](https://docs.railway.com/config-as-code).
