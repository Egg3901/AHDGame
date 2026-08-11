/**
 * Lightweight content filter for player-submitted wiki content.
 *
 * This is a first-pass safety net, not a replacement for moderator review.
 * It flags the most obvious problem content (slurs, spam, link-stuffing) so
 * the submission is rejected before it ever reaches the review queue.
 *
 * Keep the blocklist short and conservative — any word here will reject
 * submissions outright, so avoid anything that has non-profane uses.
 */

// Hard-block regexes. Use word boundaries so we don't trip on substrings
// inside legitimate words (e.g. "scunthorpe"). Entries here should be things
// a moderator would always reject.
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /\b(n[i1]gg?[e3]r(s|z)?|f[a4]gg?[o0]t(s|z)?|tr[a4]nn(y|ies))\b/i,
  /\b(k[i1]ke(s|z)?|ch[i1]nk(s|z)?|sp[i1]c(s|z)?|w[e3]tb[a4]ck(s|z)?)\b/i,
  /\b(kill\s+(yourself|urself)|k[yi]s)\b/i,
  // Crude sexual solicitation / CSAM red flags — kept intentionally narrow
  /\b(lolic[o0]n|sh[o0]tac[o0]n|cp\s+(link|pack|forum))\b/i,
];

// Soft blocks — reject with a gentler message. Useful for things that are
// almost always spam but sometimes legitimate.
const SPAM_PATTERNS: RegExp[] = [
  /\b(viagra|cialis|mg\d+)\b/i,
  /\b(buy\s+followers|free\s+robux|crypto\s+giveaway)\b/i,
];

export interface ContentFilterResult {
  ok: boolean;
  reason?: string;
}

export interface ContentFilterInput {
  title: string;
  description: string;
  content: string;
  tags?: string[];
}

/**
 * Run the content filter against a wiki submission. Returns `{ ok: true }`
 * when the content is acceptable, or `{ ok: false, reason }` with a
 * user-facing message when it should be rejected.
 */
export function screenWikiContent(input: ContentFilterInput): ContentFilterResult {
  const haystack = [input.title, input.description, input.content, ...(input.tags ?? [])]
    .join("\n")
    .toLowerCase();

  for (const pattern of HARD_BLOCK_PATTERNS) {
    if (pattern.test(haystack)) {
      return {
        ok: false,
        reason:
          "Your submission contains language that violates the community rules. Revise and resubmit.",
      };
    }
  }

  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(haystack)) {
      return {
        ok: false,
        reason: "Your submission looks like spam. Remove external product/promotional references.",
      };
    }
  }

  // Link-stuffing heuristic: reject when more than a quarter of non-whitespace
  // characters are inside markdown/raw URLs. Legitimate encyclopedia prose
  // almost never breaches this.
  const linkRatio = computeLinkRatio(input.content);
  if (linkRatio > 0.25) {
    return {
      ok: false,
      reason:
        "Too many links relative to body text. Wiki pages should be primarily your own writing.",
    };
  }

  // Excessive shouting
  const letterCount = (input.content.match(/[A-Za-z]/g) ?? []).length;
  const upperCount = (input.content.match(/[A-Z]/g) ?? []).length;
  if (letterCount > 200 && upperCount / letterCount > 0.6) {
    return {
      ok: false,
      reason: "Please don't write entirely in capital letters.",
    };
  }

  return { ok: true };
}

function computeLinkRatio(content: string): number {
  const total = content.replace(/\s+/g, "").length;
  if (total < 100) return 0;
  const markdownLinkChars = (content.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).join("").length;
  const bareUrlChars = (content.match(/https?:\/\/\S+/g) ?? []).join("").length;
  return (markdownLinkChars + bareUrlChars) / total;
}
