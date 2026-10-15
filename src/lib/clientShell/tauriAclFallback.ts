/**
 * Recover from desktop/mobile client plugin scripts that the client itself
 * refuses to run on this site.
 *
 * The AHDClient shell loads the live site with zero Tauri permissions, but some
 * Tauri plugins still inject page scripts into every webview: one intercepts
 * clicks on `target="_blank"` links and asks the plugin to open them, another
 * replaces `window.confirm`. Those calls are then refused ("Command
 * plugin:opener|open_url not allowed by ACL"), so the link does nothing and the
 * refused promise surfaces as an unhandled rejection.
 *
 * This module only runs inside the shell (where `__TAURI_INTERNALS__` exists).
 * It remembers the last new-tab link the player clicked and, when the shell
 * refuses to open it, opens it with `window.open`, which the shell routes to
 * the system browser on its own. The refused rejection is marked handled.
 */

/** The exact refusal strings Tauri uses for the plugin commands it injects. */
const TAURI_ACL_REFUSAL =
  /^Command plugin:(dialog\|(?:confirm|message|ask)|shell\|open|opener\|open_url) not allowed by ACL$/;

const LINK_COMMANDS = new Set(["shell|open", "opener|open_url"]);

/** Clicks older than this are not the link the refused command was about. */
const LINK_MEMORY_MS = 5_000;

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

/** Plugin command (`opener|open_url`) a refusal is about, or null. */
export function tauriAclRefusedCommand(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const match = TAURI_ACL_REFUSAL.exec(reason.trim());
  return match ? match[1] : null;
}

/** Sentry message for the same refusal, captured as a non-Error rejection. */
export function isTauriAclRefusalMessage(message: string): boolean {
  const prefix = "Non-Error promise rejection captured with value: ";
  return (
    message.startsWith(prefix) && tauriAclRefusedCommand(message.slice(prefix.length)) !== null
  );
}

export function isTauriShell(win: Window): boolean {
  return typeof (win as TauriWindow).__TAURI_INTERNALS__ === "object";
}

function newTabLinkHref(event: MouseEvent): string | null {
  const anchor = event
    .composedPath()
    .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
  if (!anchor?.href) return null;
  if (anchor.target !== "_blank" && !event.ctrlKey && !event.shiftKey) return null;
  try {
    const url = new URL(anchor.href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

let installed = false;

/** Install once per page. No-op outside the AHDClient shell. */
export function installTauriAclFallback(win: Window = window): void {
  if (installed || !isTauriShell(win)) return;
  installed = true;

  let lastLink: { href: string; at: number } | null = null;

  // Capture phase so the href is recorded before the plugin's own listener
  // runs. Nothing here prevents or stops the click.
  win.addEventListener(
    "click",
    (event) => {
      const href = newTabLinkHref(event);
      if (href) lastLink = { href, at: Date.now() };
    },
    true
  );

  win.addEventListener("unhandledrejection", (event) => {
    const command = tauriAclRefusedCommand(event.reason);
    if (!command) return;
    event.preventDefault();
    if (!LINK_COMMANDS.has(command)) return;
    const link = lastLink;
    lastLink = null;
    if (link && Date.now() - link.at <= LINK_MEMORY_MS) {
      win.open(link.href, "_blank", "noopener,noreferrer");
    }
  });
}

/** Test hook: allow a fresh install in each test. */
export function resetTauriAclFallbackForTests(): void {
  installed = false;
}
