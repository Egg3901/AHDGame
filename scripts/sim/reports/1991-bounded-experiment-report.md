# Bounded experiment report reads

Qualified runtime source: `b4e3edc45c3b1aa4e7ff3b77a894da0acb6292b0`.

The headless `sim_experiment_report` previously hydrated every report chunk before sampling three operational timelines. Nested long-horizon telemetry was transferred and decoded although it was absent from the response. The completed 480-turn 1991 control report has 158 chunks, including 89,280 approval points and 178,560 macro points, so that path could materialize approximately 1.25 GB for a small request.

The summary reader now projects metadata and samples inline reports inside Mongo. For chunked reports it validates small descriptors for the full generation, then fetches only the requested operational sample points in one batch. It does not transfer nested approval or macro points. Full-export readers remain available to collectors and storage qualification.

Five actual isolated replica-set checks pass. They prove sampling parity across chunk boundaries, legacy inline and version-one compatibility, explicit missing-chunk and invalid-manifest failures, and invalid-limit rejection without a database request. The combined storage, recovery and summary qualification passes 28 checks across three suites.

| Ten-point summary fixture | Commands | Request bytes | Response bytes |
| ------------------------- | -------: | ------------: | -------------: |
| Previous full hydration   |        3 |          1036 |       27064803 |
| Bounded summary           |        3 |          6449 |           6745 |

Both paths return identical operational samples from a synthetic report above 26 MB. A read-only request against the recovered 158-chunk control report also returns ten points per operational timeline: four commands (including one descriptor get-more), 3,668 request bytes and 62,888 response bytes, with a 48,950-byte sampled report. The original simulation source remains `9c73c5ea76422c9a157f9645eec6980b3dfa471b`. No engine simulation is executed by these checks. The transfer reduction does not establish an engine balance or whole-world horizon result.

Scoped TypeScript, lint, formatting and the architecture audit pass, with zero architecture blockers and 66 existing warnings. The durable transaction CI job includes the actual Mongo summary checks.

This component fixes the headless game MCP implementation. The canonical external Rust MCP reader has its own implementation and qualification. No service deployment or report rewrite is performed by this change.
