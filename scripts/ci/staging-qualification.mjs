import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WORKFLOW = ".github/workflows/ci.yml";
const SCRIPT = "scripts/ci/staging-qualification.mjs";
const SECURITY = [
  { context: "custom-rules", file: "semgrep.yml" },
  { context: "dependency-review", file: "dependency-review.yml" },
];
const SHA = /^[a-f0-9]{40}$/;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const success = (value) => value?.status === "completed" && value.conclusion === "success";

/** Reuse GitHub-native full qualification of the exact tested Git tree. */
export async function findStagingQualification({
  api,
  repository,
  eventName,
  event,
  checkout,
  now = Date.now(),
}) {
  const promotion =
    eventName === "pull_request"
      ? event?.pull_request?.head?.ref === "staging" && event.pull_request.base?.ref === "main"
      : eventName === "push" && event?.ref === "refs/heads/main";
  const fallback = (reason) => ({ reuse: false, promotion, reason });
  if (!promotion) return fallback("not a staging promotion");
  try {
    if (
      ![checkout.commit, checkout.tree, checkout.workflowBlob, checkout.scriptBlob].every((x) =>
        SHA.test(x || "")
      )
    )
      return fallback("checkout identity unavailable");
    const repo = await api("");
    if (repo.full_name !== repository || event.repository?.full_name !== repository)
      return fallback("repository identity differs");
    const sameRepo = (side) => side?.repo?.id === repo.id && side.repo.full_name === repository;
    const isPromotion = (pr) =>
      pr?.head?.ref === "staging" &&
      pr.base?.ref === "main" &&
      sameRepo(pr.head) &&
      sameRepo(pr.base);
    const commitTree = async (sha) => {
      if (!SHA.test(sha || "")) throw new Error("commit unavailable");
      const commit = await api(`commits/${sha}`);
      if (commit?.sha !== sha || !SHA.test(commit.commit?.tree?.sha || ""))
        throw new Error("tree unavailable");
      return commit.commit.tree.sha;
    };
    let pr;
    if (eventName === "pull_request") {
      pr = await api(`pulls/${Number(event.number)}`);
      if (
        !isPromotion(pr) ||
        pr.state !== "open" ||
        pr.head.sha !== event.pull_request.head.sha ||
        pr.base.sha !== event.pull_request.base.sha ||
        pr.merge_commit_sha !== checkout.commit
      )
        return fallback("promotion changed since checkout");
    } else {
      if (event.after !== checkout.commit) return fallback("push differs from checkout");
      const pulls = await api(`commits/${checkout.commit}/pulls?per_page=30`);
      if (!Array.isArray(pulls) || pulls.length >= 30)
        return fallback("promotion association unavailable");
      pr = pulls.find(
        (p) => isPromotion(p) && p.merged_at && p.merge_commit_sha === checkout.commit
      );
      if (!pr) return fallback("main push is not a merged staging promotion");
    }
    if (
      (await commitTree(checkout.commit)) !== checkout.tree ||
      (await commitTree(pr.head.sha)) !== checkout.tree
    )
      return fallback("promotion changes the tested tree");

    // Neither PR-authored workflows nor altered proof code may grant reuse.
    const trusted = await api(`commits/${encodeURIComponent(repo.default_branch)}`);
    if (!SHA.test(trusted?.sha || "")) return fallback("trusted branch unavailable");
    const workflow = await api("actions/workflows/ci.yml");
    if (
      !Number.isSafeInteger(workflow?.id) ||
      workflow.path !== WORKFLOW ||
      workflow.state !== "active"
    )
      return fallback("workflow identity unavailable");
    const expected = [
      [WORKFLOW, checkout.workflowBlob],
      [SCRIPT, checkout.scriptBlob],
      ...SECURITY.map(({ file }) => [`.github/workflows/${file}`, checkout.externalBlobs?.[file]]),
    ];
    if (expected.some(([, blob]) => !SHA.test(blob || "")))
      return fallback("security workflow identity unavailable");
    for (const [file, blob] of expected) {
      if ((await api(`contents/${file}?ref=${trusted.sha}`))?.sha !== blob)
        return fallback("proof code differs from trusted branch");
    }

    const rules = await api("rules/branches/staging");
    if (!Array.isArray(rules)) return fallback("required branch gates unavailable");
    const supported = new Set(["verify", ...SECURITY.map((gate) => gate.context)]);
    const required = rules
      .filter((rule) => rule.type === "required_status_checks")
      .flatMap((rule) => rule.parameters?.required_status_checks || []);
    if (required.some((gate) => !supported.has(gate.context)))
      return fallback("additional required gates need full checks");

    const nativeCheck = async (job, run, name) => {
      if (!job || job.name !== name || !success(job)) return false;
      const prefix = `https://api.github.com/repos/${repository}/check-runs/`;
      if (!job.check_run_url?.startsWith(prefix)) return false;
      const checkId = job.check_run_url.slice(prefix.length);
      if (!/^\d+$/.test(checkId)) return false;
      const check = await api(`check-runs/${checkId}`);
      return (
        success(check) &&
        check.id === Number(checkId) &&
        check.name === name &&
        check.head_sha === run.head_sha &&
        check.app?.id === 15368 &&
        check.app.slug === "github-actions" &&
        check.check_suite?.id === run.check_suite_id &&
        check.details_url ===
          `https://github.com/${repository}/actions/runs/${run.id}/job/${job.id}`
      );
    };
    const validRun = (run, expectedWorkflow, head) => {
      const age = now - Date.parse(run?.updated_at);
      return (
        run?.workflow_id === expectedWorkflow.id &&
        run.path === expectedWorkflow.path &&
        run.event === "pull_request" &&
        run.head_branch === "development" &&
        run.head_sha === head &&
        run.repository?.id === repo.id &&
        run.head_repository?.id === repo.id &&
        Number.isFinite(age) &&
        age >= 0 &&
        age <= MAX_AGE_MS &&
        Number.isSafeInteger(run.id) &&
        Number.isSafeInteger(run.run_attempt) &&
        run.run_attempt > 0
      );
    };
    const securityPassed = async (head) => {
      for (const { file, context } of SECURITY) {
        const info = await api(`actions/workflows/${file}`);
        if (
          !Number.isSafeInteger(info?.id) ||
          info.path !== `.github/workflows/${file}` ||
          info.state !== "active"
        )
          return false;
        const runs = await api(
          `actions/workflows/${file}/runs?event=pull_request&head_sha=${head}&per_page=20`
        );
        const run = runs?.workflow_runs?.[0];
        if (
          !validRun(run, info, head) ||
          ["failure", "cancelled", "timed_out"].includes(run.conclusion)
        )
          return false;
        const jobs = await api(
          `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
        );
        if (!Array.isArray(jobs?.jobs) || jobs.total_count !== jobs.jobs.length) return false;
        const job = jobs.jobs.find((j) => j.name === context);
        if (
          !job?.steps?.some(
            (step) => step.name === `qualified-tree-${checkout.tree}` && success(step)
          ) ||
          !(await nativeCheck(job, run, context))
        )
          return false;
      }
      return true;
    };

    const firstPromotions = await api(`commits/${pr.head.sha}/pulls?per_page=30`);
    if (!Array.isArray(firstPromotions) || firstPromotions.length >= 30)
      return fallback("first promotion association unavailable");
    for (const prior of firstPromotions) {
      if (
        !prior.merged_at ||
        prior.merge_commit_sha !== pr.head.sha ||
        prior.head?.ref !== "development" ||
        prior.base?.ref !== "staging" ||
        !sameRepo(prior.head) ||
        !sameRepo(prior.base)
      )
        continue;
      let trustedReceipt = true;
      for (const [file, blob] of expected) {
        if ((await api(`contents/${file}?ref=${prior.merge_commit_sha}`))?.sha !== blob)
          trustedReceipt = false;
      }
      if (!trustedReceipt) continue;
      const listed = await api(
        `actions/workflows/ci.yml/runs?event=pull_request&head_sha=${prior.head.sha}&per_page=20`
      );
      // A later failed/restarted attempt must not be masked by an older pass.
      const candidate = listed?.workflow_runs?.[0];
      if (!success(candidate) || !validRun(candidate, workflow, prior.head.sha)) continue;
      {
        const jobs = await api(
          `actions/runs/${candidate.id}/attempts/${candidate.run_attempt}/jobs?per_page=100`
        );
        if (!Array.isArray(jobs?.jobs) || jobs.total_count !== jobs.jobs.length) continue;
        const name = `qualified-development-staging-tree-${checkout.tree}`;
        const receipt = jobs.jobs.find((j) => j.name === name && success(j));
        if (!receipt || !jobs.jobs.some((j) => j.name === "verify" && success(j))) continue;
        if (
          !(await nativeCheck(receipt, candidate, name)) ||
          !(await securityPassed(prior.head.sha))
        )
          continue;
        return {
          reuse: true,
          promotion: true,
          tree: checkout.tree,
          qualificationRun: candidate.id,
          qualificationPr: prior.number,
          reason: "identical tree passed full development-to-staging qualification",
        };
      }
    }
    return fallback("no complete recent full-qualification receipt");
  } catch {
    return fallback("qualification evidence unavailable");
  }
}

async function main() {
  const git = (...args) => execFileSync("git", ["rev-parse", ...args], { encoding: "utf8" }).trim();
  const checkout = {
    commit: git("HEAD"),
    tree: git("HEAD^{tree}"),
    workflowBlob: git(`HEAD:${WORKFLOW}`),
    scriptBlob: git(`HEAD:${SCRIPT}`),
    externalBlobs: Object.fromEntries(
      SECURITY.map(({ file }) => [file, git(`HEAD:.github/workflows/${file}`)])
    ),
  };
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const deadline = AbortSignal.timeout(30_000);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "")) throw new Error("repository unavailable");
  const api = async (path) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path ? `/${path}` : ""}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
      }
    );
    if (!response.ok) throw new Error("GitHub evidence unavailable");
    return response.json();
  };
  const result = await findStagingQualification({
    api,
    repository,
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    checkout,
  });
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `reuse=${result.reuse}\npromotion=${result.promotion}\ntree=${checkout.tree}\nqualification_run=${result.qualificationRun || ""}\n`
  );
  console.log(`Promotion qualification: ${result.reason}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Infrastructure, malformed events and unavailable identities all fail closed.
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "reuse=false\npromotion=true\n");
    console.log("Promotion qualification unavailable; full checks required.");
  });
}
