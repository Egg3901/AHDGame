import test from "node:test";
import assert from "node:assert/strict";
import { findStagingQualification } from "./staging-qualification.mjs";

const sha = (letter) => letter.repeat(40);
const repo = "example/game";
const now = Date.parse("2026-10-14T12:00:00Z");
function fixture() {
  const head = sha("a"),
    merge = sha("b"),
    tree = sha("c"),
    dev = sha("d"),
    trusted = sha("e");
  const repository = { id: 9, full_name: repo, default_branch: "development" };
  const side = (ref, commit) => ({ ref, sha: commit, repo: repository });
  const promotion = {
    number: 30,
    state: "open",
    head: side("staging", head),
    base: side("main", sha("f")),
    merge_commit_sha: merge,
  };
  const previous = {
    number: 20,
    state: "closed",
    merged_at: "2026-10-14T11:00:00Z",
    head: side("development", dev),
    base: side("staging", sha("f")),
    merge_commit_sha: head,
  };
  const jobName = `qualified-development-staging-tree-${tree}`;
  const run = {
    id: 100,
    run_attempt: 1,
    workflow_id: 50,
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    head_branch: "development",
    head_sha: dev,
    status: "completed",
    conclusion: "success",
    check_suite_id: 200,
    updated_at: "2026-10-14T10:59:00Z",
    repository,
    head_repository: repository,
  };
  const jobs = {
    total_count: 2,
    jobs: [
      { name: "lint", status: "completed", conclusion: "success" },
      {
        id: 300,
        name: "verify",
        steps: [{ name: jobName, status: "completed", conclusion: "success" }],
        status: "completed",
        conclusion: "success",
        check_run_url: `https://api.github.com/repos/${repo}/check-runs/300`,
      },
    ],
  };
  const check = {
    id: 300,
    name: "verify",
    head_sha: dev,
    status: "completed",
    conclusion: "success",
    check_suite: { id: 200 },
    app: { id: 15368, slug: "github-actions" },
    details_url: `https://github.com/${repo}/actions/runs/100/job/300`,
  };
  const security = Object.fromEntries(
    ["semgrep.yml", "dependency-review.yml"].map((file, index) => {
      const context = index === 0 ? "custom-rules" : "dependency-review";
      const id = 101 + index,
        jobId = 301 + index;
      return [
        file,
        {
          info: { id: 51 + index, path: `.github/workflows/${file}`, state: "active" },
          run: {
            ...run,
            id,
            workflow_id: 51 + index,
            path: `.github/workflows/${file}`,
            check_suite_id: 201 + index,
          },
          jobs: {
            total_count: 1,
            jobs: [
              {
                id: jobId,
                name: context,
                status: "completed",
                conclusion: "success",
                check_run_url: `https://api.github.com/repos/${repo}/check-runs/${jobId}`,
                steps: [
                  { name: `qualified-tree-${tree}`, status: "completed", conclusion: "success" },
                ],
              },
            ],
          },
          check: {
            ...check,
            id: jobId,
            name: context,
            check_suite: { id: 201 + index },
            details_url: `https://github.com/${repo}/actions/runs/${id}/job/${jobId}`,
          },
        },
      ];
    })
  );
  const commits = Object.fromEntries(
    [head, merge, trusted].map((id) => [id, { sha: id, commit: { tree: { sha: tree } } }])
  );
  const blobs = {
    ".github/workflows/ci.yml": sha("1"),
    "scripts/ci/staging-qualification.mjs": sha("2"),
    ".github/workflows/semgrep.yml": sha("3"),
    ".github/workflows/dependency-review.yml": sha("4"),
  };
  const calls = [];
  const state = {
    promotion,
    previous,
    run,
    jobs,
    check,
    commits,
    blobs,
    repository,
    security,
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: ["verify", "custom-rules", "dependency-review"].map(
            (context) => ({ context })
          ),
        },
      },
    ],
  };
  const api = async (path) => {
    calls.push(path);
    if (path === "") return state.repository;
    if (path === "rules/branches/staging") return state.rules;
    for (const [file, gate] of Object.entries(state.security)) {
      if (path === `actions/workflows/${file}`) return gate.info;
      if (path.startsWith(`actions/workflows/${file}/runs?`)) return { workflow_runs: [gate.run] };
      if (path === `actions/runs/${gate.run.id}/attempts/1/jobs?per_page=100`) return gate.jobs;
      if (path === `check-runs/${gate.check.id}`) return gate.check;
    }
    if (path === "pulls/30") return state.promotion;
    if (path === "actions/workflows/ci.yml")
      return { id: 50, path: ".github/workflows/ci.yml", state: "active" };
    if (path.startsWith("contents/")) return { sha: state.blobs[path.slice(9).split("?ref=")[0]] };
    if (path === "commits/development") return { sha: trusted };
    if (path === `commits/${head}/pulls?per_page=30`) return [state.previous];
    if (path === `commits/${merge}/pulls?per_page=30`)
      return [{ ...state.promotion, state: "closed", merged_at: "2026-10-14T11:30:00Z" }];
    if (path.startsWith("commits/")) return state.commits[path.slice(8)];
    if (path.startsWith("actions/workflows/ci.yml/runs?"))
      return { total_count: 1, workflow_runs: [state.run] };
    if (path === "actions/runs/100/attempts/1/jobs?per_page=100") return state.jobs;
    if (path === "check-runs/300") return state.check;
    throw new Error(`unexpected API ${path}`);
  };
  const input = {
    api,
    repository: repo,
    eventName: "pull_request",
    event: { number: 30, pull_request: structuredClone(promotion), repository },
    checkout: {
      commit: merge,
      tree,
      workflowBlob: blobs[".github/workflows/ci.yml"],
      scriptBlob: blobs["scripts/ci/staging-qualification.mjs"],
      externalBlobs: {
        "semgrep.yml": blobs[".github/workflows/semgrep.yml"],
        "dependency-review.yml": blobs[".github/workflows/dependency-review.yml"],
      },
    },
    now,
  };
  return { input, state, calls, head, merge, tree };
}

test("an identical promotion reuses only a successful native full-qualification receipt", async () => {
  const f = fixture();
  const result = await findStagingQualification(f.input);
  assert.equal(result.reuse, true);
  assert.equal(result.qualificationRun, 100);
  assert.equal(result.tree, f.tree);
  assert.equal(result.promotion, true);
});

test("an identical merged promotion can also avoid duplicate main-push CI", async () => {
  const f = fixture();
  f.input.eventName = "push";
  f.input.event = { ref: "refs/heads/main", after: f.merge, repository: f.state.repository };
  assert.equal((await findStagingQualification(f.input)).reuse, true);
});

const invalid = {
  "different tested merge tree": (f) => {
    f.state.commits[f.merge].commit.tree.sha = sha("0");
  },
  "staging head changed after the event": (f) => {
    f.state.promotion.head.sha = sha("0");
  },
  "fork source": (f) => {
    f.state.promotion.head.repo = { id: 10, full_name: "other/game" };
  },
  "failed prior run": (f) => {
    f.state.run.conclusion = "failure";
  },
  "stale prior run": (f) => {
    f.state.run.updated_at = "2026-10-12T00:00:00Z";
  },
  "wrong workflow id": (f) => {
    f.state.run.workflow_id = 51;
  },
  "wrong workflow path": (f) => {
    f.state.run.path = ".github/workflows/other.yml";
  },
  "wrong run source": (f) => {
    f.state.run.head_sha = sha("0");
  },
  "missing receipt": (f) => {
    f.state.jobs.jobs.pop();
    f.state.jobs.total_count = 1;
  },
  "missing native tree step": (f) => {
    f.state.jobs.jobs[1].steps = [];
  },
  "failed native tree step": (f) => {
    f.state.jobs.jobs[1].steps[0].conclusion = "failure";
  },
  "failed receipt": (f) => {
    f.state.jobs.jobs[1].conclusion = "failure";
  },
  "counterfeit check app": (f) => {
    f.state.check.app = { id: 1, slug: "other" };
  },
  "wrong native suite association": (f) => {
    f.state.check.check_suite.id = 201;
  },
  "wrong check head": (f) => {
    f.state.check.head_sha = sha("0");
  },
  "wrong run job URL": (f) => {
    f.state.check.details_url = `https://github.com/${repo}/actions/runs/101/job/300`;
  },
  "untrusted current workflow": (f) => {
    f.input.checkout.workflowBlob = sha("0");
  },
  "untrusted current proof script": (f) => {
    f.input.checkout.scriptBlob = sha("0");
  },
  "unmerged first promotion": (f) => {
    f.state.previous.merged_at = null;
  },
  "wrong first promotion target": (f) => {
    f.state.previous.base.ref = "main";
  },
  "different receipt tree": (f) => {
    f.state.jobs.jobs[1].steps[0].name = `qualified-development-staging-tree-${sha("0")}`;
  },
  "incomplete jobs response": (f) => {
    f.state.jobs.total_count = 101;
  },
};
for (const [name, mutate] of Object.entries(invalid))
  test(`${name} falls back to full checks`, async () => {
    const f = fixture();
    mutate(f);
    const result = await findStagingQualification(f.input);
    assert.equal(result.reuse, false);
    assert.equal(result.promotion, true);
  });

test("API failure falls back to full checks", async () => {
  const f = fixture();
  f.input.api = async () => {
    throw new Error("unavailable");
  };
  assert.deepEqual((await findStagingQualification(f.input)).reuse, false);
});

test("ordinary feature requests cannot reuse a promotion receipt", async () => {
  const f = fixture();
  f.input.event.pull_request.base.ref = "development";
  const result = await findStagingQualification(f.input);
  assert.equal(result.reuse, false);
  assert.equal(result.promotion, false);
  assert.equal(f.calls.length, 0);
});

for (const file of ["semgrep.yml", "dependency-review.yml"]) {
  for (const kind of [
    "failed",
    "missing",
    "stale",
    "wrong tree",
    "counterfeit app",
    "wrong workflow",
  ])
    test(`${file} ${kind} cannot reuse a prior red or missing security gate`, async () => {
      const f = fixture();
      const gate = f.state.security[file];
      if (kind === "failed") gate.run.conclusion = "failure";
      if (kind === "missing") {
        gate.jobs.jobs = [];
        gate.jobs.total_count = 0;
      }
      if (kind === "stale") gate.run.updated_at = "2026-10-12T00:00:00Z";
      if (kind === "wrong tree") gate.jobs.jobs[0].steps[0].name = `qualified-tree-${sha("0")}`;
      if (kind === "counterfeit app") gate.check.app = { id: 1, slug: "other" };
      if (kind === "wrong workflow") gate.run.workflow_id = 999;
      assert.equal((await findStagingQualification(f.input)).reuse, false);
    });
}

test("a newly required unsupported branch gate falls back to full checks", async () => {
  const f = fixture();
  f.state.rules[0].parameters.required_status_checks.push({ context: "new-security-gate" });
  assert.equal((await findStagingQualification(f.input)).reuse, false);
});
