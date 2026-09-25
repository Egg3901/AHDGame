### Removed

- Removed the OpenReplay session-replay integration. PostHog and Amplitude are
  now the complete analytics stack: PostHog for event breadth, flags, and
  experiments, Amplitude for retention and funnel depth, both fed by the single
  `captureProductEvent` fan-out. The provider, its observability module and
  tests, the `@openreplay/tracker` dependency, and the session-replay privacy
  disclosure are all gone. PostHog session replay remains disabled.
