"use client";

/**
 * Admin > Support > Poll Banner: composes the site-wide survey strip, previews
 * it, and switches it on or off.
 *
 * The preview is the real `PollBannerStrip`, fed a snapshot forced to
 * `enabled: true` so the admin can see what they are about to ship while the
 * toggle is still off. That is the whole reason the strip is a separate export
 * from `PollBannerNotice`: an approximation here would drift.
 *
 * Copy rules: the message goes straight to players, so no em or en dashes.
 */
import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";
import { PollBannerStrip } from "@/components/PollBannerNotice";
import {
  DEFAULT_POLL_BANNER_LINK_LABEL,
  isSafePollBannerUrl,
  POLL_BANNER_LINK_LABEL_MAX,
  POLL_BANNER_MESSAGE_MAX,
  POLL_BANNER_URL_MAX,
  type PollBannerTone,
} from "@/lib/pollBanner";

const INPUT_CLASS =
  "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const TONE_META: Record<PollBannerTone, { label: string; description: string }> = {
  info: { label: "Info", description: "Routine. Reads as an ordinary notice." },
  warning: { label: "Warning", description: "Urgent. Stands out against the rest of the page." },
};

export function PollBannerTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [url, setUrl] = useState("");
  const [tone, setTone] = useState<PollBannerTone>("info");
  const [updatedBy, setUpdatedBy] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  /**
   * Returns whether the current banner actually came back. Callers decide what
   * a failure means: on first mount it must block editing, but after a
   * successful save a failed refresh is not a failed save.
   */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/poll-banner");
      if (!res.ok) return false;
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      setMessage(data.message ?? "");
      setLinkLabel(data.linkLabel ?? "");
      setUrl(data.url ?? "");
      setTone(data.tone === "warning" ? "warning" : "info");
      setUpdatedBy(data.updatedBy ?? "");
      setUpdatedAt(data.updatedAt ?? "");
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await load();
      setLoadFailed(!ok);
      if (!ok) {
        // Falling through to a blank form would read as "no banner is
        // configured", and saving that would wipe the real one.
        setError("Could not load the current banner. Reload the page before editing it.");
      }
    })();
  }, [load]);

  const trimmedUrl = url.trim();
  const trimmedMessage = message.trim();
  const urlLooksSafe = trimmedUrl === "" || isSafePollBannerUrl(trimmedUrl);

  async function handleSave() {
    setError("");
    setSaved(false);

    // Checked here as well as in the route so the admin gets the reason next to
    // the field rather than a bare 400 from the network tab.
    if (!urlLooksSafe) {
      // The "why" already sits under the URL field; repeating it here would
      // just print the same sentence twice.
      setError("Fix the highlighted link before saving");
      return;
    }
    if (enabled && !trimmedMessage) {
      setError("Add a message before switching the banner on");
      return;
    }
    if (enabled && !trimmedUrl) {
      setError("Add a link before switching the banner on");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/poll-banner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, message, linkLabel, url, tone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save the banner");
        return;
      }
      setSaved(true);
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading poll banner...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Poll Banner</h3>
            <p className="text-xs text-muted">
              A strip under the navbar, shown to everyone including signed-out visitors. Players
              cannot dismiss it, so it stays up until you switch it off. It stays off the sign in,
              register, banned and maintenance pages, which carry no navigation.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase ${
              enabled ? "bg-success/15 text-success" : "bg-card-border/40 text-muted"
            }`}
          >
            {enabled ? "Live" : "Off"}
          </span>
        </div>

        {updatedBy && (
          <div className="mb-4 rounded-lg border border-card-border bg-background/40 p-3 text-xs text-muted">
            Last saved by <span className="font-medium text-foreground">{updatedBy}</span>
            {updatedAt && (
              <>
                {" "}
                at{" "}
                <span className="font-medium text-foreground">
                  <LocalTime value={updatedAt} />
                </span>
              </>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted"
              htmlFor="poll-banner-message"
            >
              Message
            </label>
            <input
              id="poll-banner-message"
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Please fill out the survey here for feedback about the game:"
              maxLength={POLL_BANNER_MESSAGE_MAX}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-[10px] text-muted/60">
              {message.length} of {POLL_BANNER_MESSAGE_MAX} characters
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted"
                htmlFor="poll-banner-link-label"
              >
                Link text
              </label>
              <input
                id="poll-banner-link-label"
                type="text"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder={DEFAULT_POLL_BANNER_LINK_LABEL}
                maxLength={POLL_BANNER_LINK_LABEL_MAX}
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-[10px] text-muted/60">
                Defaults to &quot;{DEFAULT_POLL_BANNER_LINK_LABEL}&quot; if left blank.
              </p>
            </div>

            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted"
                htmlFor="poll-banner-tone"
              >
                Tone
              </label>
              <select
                id="poll-banner-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value === "warning" ? "warning" : "info")}
                className={INPUT_CLASS}
              >
                {(Object.keys(TONE_META) as PollBannerTone[]).map((key) => (
                  <option key={key} value={key}>
                    {TONE_META[key].label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted/60">{TONE_META[tone].description}</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="poll-banner-url">
              Link URL
            </label>
            <input
              id="poll-banner-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://forms.gle/..."
              maxLength={POLL_BANNER_URL_MAX}
              className={INPUT_CLASS}
            />
            {!urlLooksSafe && (
              <p className="mt-1 text-[10px] text-error">
                Link must be an absolute http:// or https:// address
              </p>
            )}
          </div>

          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            htmlFor="poll-banner-enabled"
          >
            <input
              id="poll-banner-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
            Show this banner to everyone
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="mt-3 rounded-lg border border-success/30 bg-success/10 p-2 text-xs text-success">
            Saved.
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loadFailed}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
        >
          {saving && (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <h4 className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">Preview</h4>
        <p className="mb-3 text-[11px] text-muted/70">
          Exactly what players see, rendered by the same component. Shown here whether or not the
          banner is currently switched on.
        </p>
        {trimmedMessage && urlLooksSafe && trimmedUrl ? (
          <PollBannerStrip
            snapshot={{
              enabled: true,
              message: trimmedMessage,
              linkLabel: linkLabel.trim() || DEFAULT_POLL_BANNER_LINK_LABEL,
              url: trimmedUrl,
              tone,
            }}
          />
        ) : (
          <p className="text-xs text-muted">
            Fill in a message and a link to see the banner as players will.
          </p>
        )}
      </div>
    </div>
  );
}
