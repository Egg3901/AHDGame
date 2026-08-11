/**
 * Create a GitHub issue from feedback.
 * Requires GIT_TOKEN and GITHUB_REPO (owner/repo) in env.
 * Returns { url, number } or null if not configured or failed.
 */
export async function createGitHubIssue(opts: {
  issueNumber: number;
  type: "bug" | "suggestion";
  title: string;
  description: string;
  category: string;
  stepsToReproduce?: string;
  severity?: number;
  impact?: string;
  priority?: number;
  context: {
    pathname: string;
    url: string;
    capturedAt: string;
    lastAction?: { label: string };
    recentActions: Array<{ label: string }>;
    viewport: { width: number; height: number };
  };
  reporterUsername?: string | null;
  screenshotUrl?: string;
}): Promise<{ url: string; number: number } | null> {
  const token = process.env.GIT_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return null;
  }

  const labels = opts.type === "bug" ? ["bug", "feedback"] : ["enhancement", "feedback"];

  let body = `**Internal ID:** #${opts.issueNumber}\n`;
  if (opts.reporterUsername) {
    body += `**Reported by:** @${opts.reporterUsername}\n`;
  }
  body += `**Category:** ${opts.category.replace(/_/g, " ")}\n\n`;
  body += `## Description\n\n${opts.description}\n\n`;

  if (opts.type === "bug" && opts.stepsToReproduce) {
    body += `## Steps to reproduce\n\n${opts.stepsToReproduce}\n\n`;
  }
  if (opts.type === "bug" && opts.severity !== undefined) {
    body += `**Severity:** ${opts.severity}/5\n\n`;
  }
  if (opts.type === "suggestion" && opts.impact) {
    body += `## Impact\n\n${opts.impact}\n\n`;
  }
  if (opts.type === "suggestion" && opts.priority !== undefined) {
    body += `**Priority:** ${opts.priority}/5\n\n`;
  }

  body +=
    `---\n\n` +
    `**Page:** ${opts.context.pathname || "/"}\n` +
    `**URL:** ${opts.context.url}\n` +
    `**Captured:** ${opts.context.capturedAt}\n` +
    `**Viewport:** ${opts.context.viewport?.width ?? 0}×${opts.context.viewport?.height ?? 0}\n`;
  if (opts.context.lastAction) {
    body += `**Last action:** ${opts.context.lastAction.label}\n`;
  }
  if (opts.context.recentActions?.length) {
    body += `**Recent actions:** ${opts.context.recentActions.map((a) => a.label).join(" → ")}\n`;
  }
  if (opts.screenshotUrl) {
    body += `\n## Screenshot\n\n![Screenshot](${opts.screenshotUrl})\n`;
  }

  const ghTitle = `[#${opts.issueNumber}] ${opts.title}`.slice(0, 256);

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: ghTitle,
        body,
        labels,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[createGitHubIssue] GitHub API error:", res.status, err);
      return null;
    }

    const data = (await res.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number };
  } catch (err) {
    console.error("[createGitHubIssue]", err);
    return null;
  }
}

/**
 * GitHub issue for a player forum suggestion (`suggestions` collection).
 * Labeled enhancement; title uses S# to distinguish from legacy feedback #N.
 */
export async function createPlayerSuggestionGitHubIssue(opts: {
  issueNumber: number;
  title: string;
  description: string;
  category: string;
  gameSystem: string;
  impact?: string;
  priority?: number;
  context: {
    pathname: string;
    url: string;
    capturedAt: string;
    lastAction?: { label: string };
    recentActions: Array<{ label: string }>;
    viewport: { width: number; height: number };
  };
  reporterUsername?: string | null;
  /** Discord-only submitter label when there is no game username (e.g. from `/suggest` unlinked). */
  reporterDiscordSubmit?: string | null;
  screenshotUrl?: string;
}): Promise<{ url: string; number: number } | null> {
  const token = process.env.GIT_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return null;
  }

  const labels = ["enhancement", "player-suggestion"];

  let body = `**Suggestion ID:** S#${opts.issueNumber}\n`;
  if (opts.reporterUsername) {
    body += `**Reported by:** @${opts.reporterUsername}\n`;
  } else if (opts.reporterDiscordSubmit?.trim()) {
    body += `**Reported by (Discord):** ${opts.reporterDiscordSubmit.trim()}\n`;
  }
  body += `**Category:** ${opts.category.replace(/_/g, " ")}\n`;
  body += `**Game area:** ${opts.gameSystem.replace(/_/g, " ")}\n\n`;
  body += `## Description\n\n${opts.description}\n\n`;

  if (opts.impact) {
    body += `## Impact\n\n${opts.impact}\n\n`;
  }
  if (opts.priority !== undefined) {
    body += `**Priority:** ${opts.priority}/5\n\n`;
  }

  body +=
    `---\n\n` +
    `**Page:** ${opts.context.pathname || "/"}\n` +
    `**URL:** ${opts.context.url}\n` +
    `**Captured:** ${opts.context.capturedAt}\n` +
    `**Viewport:** ${opts.context.viewport?.width ?? 0}×${opts.context.viewport?.height ?? 0}\n`;
  if (opts.context.lastAction) {
    body += `**Last action:** ${opts.context.lastAction.label}\n`;
  }
  if (opts.context.recentActions?.length) {
    body += `**Recent actions:** ${opts.context.recentActions.map((a) => a.label).join(" → ")}\n`;
  }
  if (opts.screenshotUrl) {
    body += `\n## Screenshot\n\n![Screenshot](${opts.screenshotUrl})\n`;
  }

  const ghTitle = `[S#${opts.issueNumber}] ${opts.title}`.slice(0, 256);

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: ghTitle,
        body,
        labels,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[createPlayerSuggestionGitHubIssue] GitHub API error:", res.status, err);
      return null;
    }

    const data = (await res.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number };
  } catch (err) {
    console.error("[createPlayerSuggestionGitHubIssue]", err);
    return null;
  }
}

function getGhHeaders(): Record<string, string> | null {
  const token = process.env.GIT_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

// Status labels used on GitHub issues to reflect admin panel status
const STATUS_LABEL_MAP: Partial<
  Record<string, { name: string; color: string; description: string }>
> = {
  in_progress: { name: "in-progress", color: "0075ca", description: "Issue is being worked on" },
  resolved: { name: "resolved", color: "0e8a16", description: "Issue has been resolved" },
  wont_fix: { name: "wont-fix", color: "e4e669", description: "This will not be fixed" },
};

const ALL_STATUS_LABEL_NAMES = Object.values(STATUS_LABEL_MAP).map((l) => l!.name);

/**
 * Ensure a status label exists in the repo (creates it if missing).
 * 422 Unprocessable Entity = label already exists — ignored.
 */
async function ensureRepoLabel(
  repo: string,
  headers: Record<string, string>,
  label: { name: string; color: string; description: string }
): Promise<void> {
  try {
    await fetch(`https://api.github.com/repos/${repo}/labels`, {
      method: "POST",
      headers,
      body: JSON.stringify(label),
    });
    // 422 = already exists, which is fine
  } catch {
    // network errors ignored
  }
}

/**
 * Remove all status labels from an issue and add the one matching newStatus.
 * 404 on DELETE = label wasn't on the issue — ignored.
 */
async function updateStatusLabel(
  repo: string,
  headers: Record<string, string>,
  issueNumber: number,
  newStatus: string
): Promise<void> {
  // Remove all existing status labels
  await Promise.allSettled(
    ALL_STATUS_LABEL_NAMES.map((name) =>
      fetch(
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
        { method: "DELETE", headers }
      )
    )
  );

  // Add the new status label if applicable
  const labelConfig = STATUS_LABEL_MAP[newStatus];
  if (labelConfig) {
    // Create label in repo if it doesn't exist yet
    await ensureRepoLabel(repo, headers, labelConfig);

    const addRes = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ labels: [labelConfig.name] }),
      }
    );
    if (!addRes.ok) {
      console.error("[updateStatusLabel] Failed to add label:", addRes.status, await addRes.text());
    }
  }
}

/**
 * Sync admin panel changes to the linked GitHub issue.
 * - Updates issue state (open/closed) and state_reason based on status
 * - Updates status labels to reflect in_progress / resolved / wont_fix
 * - Adds a comment for status changes and admin notes (unless skipComment is set)
 * Keeps GitHub in sync with admin panel — no divergence.
 */
export async function syncFeedbackToGitHub(opts: {
  githubIssueNumber: number;
  previousStatus?: string;
  newStatus?: string;
  previousAdminNotes?: string;
  newAdminNotes?: string;
  adminUsername?: string;
  /** Set true during backfill to skip posting a status-change comment */
  skipComment?: boolean;
}): Promise<void> {
  const headers = getGhHeaders();
  if (!headers) return;

  const repo = process.env.GITHUB_REPO!;
  const { githubIssueNumber } = opts;

  try {
    // 1. Update issue state, state_reason, and status label if status changed
    if (opts.newStatus) {
      const state: "open" | "closed" =
        opts.newStatus === "resolved" || opts.newStatus === "wont_fix" ? "closed" : "open";

      // state_reason clarifies why an issue was closed (shown in GitHub UI)
      const stateReason: string | undefined =
        opts.newStatus === "resolved"
          ? "completed"
          : opts.newStatus === "wont_fix"
            ? "not_planned"
            : undefined;

      const patchRes = await fetch(
        `https://api.github.com/repos/${repo}/issues/${githubIssueNumber}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(stateReason ? { state, state_reason: stateReason } : { state }),
        }
      );

      if (!patchRes.ok) {
        console.error(
          "[syncFeedbackToGitHub] PATCH issue failed:",
          patchRes.status,
          await patchRes.text()
        );
      }

      // Sync status label (in-progress / resolved / wont-fix)
      await updateStatusLabel(repo, headers, githubIssueNumber, opts.newStatus);
    }

    // 2. Add comment for status change and/or admin notes
    if (!opts.skipComment) {
      const commentParts: string[] = [];
      if (opts.previousStatus !== opts.newStatus && opts.newStatus) {
        const label =
          opts.newStatus === "resolved"
            ? "Resolved"
            : opts.newStatus === "wont_fix"
              ? "Won't fix"
              : opts.newStatus === "in_progress"
                ? "In progress"
                : opts.newStatus;
        commentParts.push(`**Status:** ${opts.previousStatus ?? "—"} → ${label}`);
      }
      if (
        opts.newAdminNotes !== undefined &&
        opts.newAdminNotes !== (opts.previousAdminNotes ?? "")
      ) {
        commentParts.push(`**Admin notes:**\n${opts.newAdminNotes || "_Cleared_"}`);
      }

      if (commentParts.length > 0) {
        const commentBody =
          `_Updated from admin panel${opts.adminUsername ? ` by @${opts.adminUsername}` : ""}_\n\n` +
          commentParts.join("\n\n");

        const commentRes = await fetch(
          `https://api.github.com/repos/${repo}/issues/${githubIssueNumber}/comments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ body: commentBody }),
          }
        );

        if (!commentRes.ok) {
          console.error(
            "[syncFeedbackToGitHub] POST comment failed:",
            commentRes.status,
            await commentRes.text()
          );
        }
      }
    }
  } catch (err) {
    console.error("[syncFeedbackToGitHub]", err);
  }
}

// —— Player suggestions (`suggestions` collection) — separate GitHub label namespace ——

const SUGGESTION_GH_STATUS_MAP: Record<
  string,
  { name: string; color: string; description: string }
> = {
  not_reviewed: { name: "s-not-reviewed", color: "d4c5f9", description: "Not reviewed" },
  planned: { name: "s-planned", color: "c2e0c6", description: "Planned" },
  in_progress: { name: "s-in-progress", color: "0075ca", description: "In progress" },
  completed: { name: "s-completed", color: "0e8a16", description: "Completed" },
  not_implementing: {
    name: "s-not-implementing",
    color: "e4e669",
    description: "Not implementing",
  },
};

const ALL_SUGGESTION_GH_STATUS_NAMES = Object.values(SUGGESTION_GH_STATUS_MAP).map((l) => l.name);

async function updateSuggestionStatusLabel(
  repo: string,
  headers: Record<string, string>,
  issueNumber: number,
  newStatus: string
): Promise<void> {
  await Promise.allSettled(
    ALL_SUGGESTION_GH_STATUS_NAMES.map((name) =>
      fetch(
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
        { method: "DELETE", headers }
      )
    )
  );

  const labelConfig = SUGGESTION_GH_STATUS_MAP[newStatus];
  if (labelConfig) {
    await ensureRepoLabel(repo, headers, labelConfig);
    const addRes = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ labels: [labelConfig.name] }),
      }
    );
    if (!addRes.ok) {
      console.error(
        "[updateSuggestionStatusLabel] Failed to add label:",
        addRes.status,
        await addRes.text()
      );
    }
  }
}

/**
 * Sync admin changes for a player suggestion to its linked GitHub issue.
 */
export async function syncSuggestionToGitHub(opts: {
  githubIssueNumber: number;
  previousStatus?: string;
  newStatus?: string;
  previousAdminNotes?: string;
  newAdminNotes?: string;
  adminUsername?: string;
  skipComment?: boolean;
}): Promise<void> {
  const headers = getGhHeaders();
  if (!headers) return;

  const repo = process.env.GITHUB_REPO!;
  const { githubIssueNumber } = opts;

  try {
    if (opts.newStatus) {
      const state: "open" | "closed" =
        opts.newStatus === "completed" || opts.newStatus === "not_implementing" ? "closed" : "open";

      const stateReason: string | undefined =
        opts.newStatus === "completed"
          ? "completed"
          : opts.newStatus === "not_implementing"
            ? "not_planned"
            : undefined;

      const patchRes = await fetch(
        `https://api.github.com/repos/${repo}/issues/${githubIssueNumber}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(stateReason ? { state, state_reason: stateReason } : { state }),
        }
      );

      if (!patchRes.ok) {
        console.error(
          "[syncSuggestionToGitHub] PATCH issue failed:",
          patchRes.status,
          await patchRes.text()
        );
      }

      await updateSuggestionStatusLabel(repo, headers, githubIssueNumber, opts.newStatus);
    }

    if (!opts.skipComment) {
      const suggestionStatusLabel = (s: string) =>
        ({
          not_reviewed: "Not reviewed",
          planned: "Planned",
          in_progress: "In progress",
          completed: "Completed",
          not_implementing: "Not implementing",
        })[s] ?? s;

      const commentParts: string[] = [];
      if (opts.previousStatus !== opts.newStatus && opts.newStatus) {
        commentParts.push(
          `**Status:** ${opts.previousStatus ? suggestionStatusLabel(opts.previousStatus) : "—"} → ${suggestionStatusLabel(opts.newStatus)}`
        );
      }
      if (
        opts.newAdminNotes !== undefined &&
        opts.newAdminNotes !== (opts.previousAdminNotes ?? "")
      ) {
        commentParts.push(`**Admin notes:**\n${opts.newAdminNotes || "_Cleared_"}`);
      }

      if (commentParts.length > 0) {
        const commentBody =
          `_Updated from admin (player suggestions)${opts.adminUsername ? ` by @${opts.adminUsername}` : ""}_\n\n` +
          commentParts.join("\n\n");

        const commentRes = await fetch(
          `https://api.github.com/repos/${repo}/issues/${githubIssueNumber}/comments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ body: commentBody }),
          }
        );

        if (!commentRes.ok) {
          console.error(
            "[syncSuggestionToGitHub] POST comment failed:",
            commentRes.status,
            await commentRes.text()
          );
        }
      }
    }
  } catch (err) {
    console.error("[syncSuggestionToGitHub]", err);
  }
}
