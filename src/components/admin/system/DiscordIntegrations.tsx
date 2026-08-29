"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

const INPUT_CLASS =
  "w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary";
const BUTTON_CLASS =
  "text-sm px-3 py-1.5 rounded border border-white/20 text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

type GeneralKey = "game" | "news" | "suggestions" | "changelog";

/**
 * The subset of general webhooks `POST /api/admin/discord/test` accepts.
 * Changelog is excluded deliberately — it has its own route
 * (`/api/admin/discord/test-changelog`) with a different payload, and typing
 * it out here keeps the compiler in sync with the route's zod schema.
 */
type TestableGeneralKey = Exclude<GeneralKey, "changelog">;

const EMPTY_GENERAL: Record<GeneralKey, string> = {
  game: "",
  news: "",
  suggestions: "",
  changelog: "",
};

interface ElectionType {
  id: string;
  label: string;
}

/** Mirrors `CountryWebhookDescriptor` (server-only, so structurally duplicated). */
interface CountryWebhook {
  countryId: string;
  name: string;
  flagEmoji: string;
  url: string;
  note?: string;
  electionTypes: ElectionType[];
}

interface ConfigPayload {
  general: Record<GeneralKey, string>;
  countries: CountryWebhook[];
}

const GENERAL_SECTIONS: { key: GeneralKey; label: string; description: string }[] = [
  {
    key: "game",
    label: "Game Events Webhook",
    description:
      "Receives: election results, bill passages, government formation/collapse, leadership elections, new primaries opening. Also the catch-all feed for countries with no webhook of their own.",
  },
  {
    key: "news",
    label: "News Channel Webhook",
    description: "Receives: player news posts from the in-game news feed.",
  },
  {
    key: "suggestions",
    label: "Player Suggestions Webhook",
    description:
      "Receives: new posts to the player suggestion forum, including from the in-game submit flow. Use Backfill to Discord to post rich embeds for older rows that were never synced.",
  },
  {
    key: "changelog",
    label: "Changelog Webhook",
    description:
      "Receives: patch notes from content/changelog/public/ posts, categorised with colour-coded embeds per section. Updates to previously posted versions only send the new items.",
  },
];

/** One webhook URL input plus its action buttons. */
function WebhookField({
  label,
  description,
  value,
  onChange,
  children,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-white mb-1">{label}</label>
        <p className="text-xs text-muted mb-2">{description}</p>
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className={INPUT_CLASS}
        />
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

/** Description sentence for a country card — derived, plus its optional note. */
function countryDescription(country: CountryWebhook): string {
  const races = country.electionTypes.map((t) => t.label).join(", ");
  const base = `Receives: ${country.name} election results (${races}), bill passages, government formation/collapse, primaries opening.`;
  return country.note ? `${base} ${country.note}` : base;
}

export function DiscordIntegrations() {
  const [general, setGeneral] = useState<Record<GeneralKey, string>>(EMPTY_GENERAL);
  const [countries, setCountries] = useState<CountryWebhook[]>([]);
  /**
   * Saving before the initial GET resolves would PATCH the all-empty-string
   * defaults, which `$unset`s every configured webhook. Gate Save on a
   * successful load rather than letting a failed fetch wipe the config.
   */
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingElection, setTestingElection] = useState<string | null>(null);
  const [testingChangelog, setTestingChangelog] = useState<"latest" | "updates" | null>(null);
  const [backfillingSuggestions, setBackfillingSuggestions] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  /**
   * Set when the save was refused because another deployment owns these
   * webhooks (#1208). Holds the offer to take them, so the admin can resolve it
   * here instead of reaching for curl.
   */
  const [ownershipConflict, setOwnershipConflict] = useState(false);

  useEffect(() => {
    fetchJson<ConfigPayload>("/api/admin/config/discord", { feature: "admin-discord-config" })
      .then((data) => {
        setGeneral({ ...EMPTY_GENERAL, ...(data.general ?? {}) });
        setCountries(data.countries ?? []);
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  const setCountryUrl = useCallback((countryId: string, url: string) => {
    setCountries((prev) => prev.map((c) => (c.countryId === countryId ? { ...c, url } : c)));
  }, []);

  async function handleSave(claimWebhooks = false) {
    if (!loaded) {
      setMessage({
        type: "error",
        text: "Config has not loaded yet — refresh before saving to avoid clearing existing webhooks.",
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    setOwnershipConflict(false);
    try {
      const countryWebhooks: Record<string, string> = {};
      for (const c of countries) countryWebhooks[c.countryId] = c.url;
      const res = await fetch("/api/admin/config/discord", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          general,
          countryWebhooks,
          ...(claimWebhooks ? { claimWebhooks: true } : {}),
        }),
      });
      // Show the server's reason, the way handleTest below already does. A bare
      // "Save failed" hides the one message that says what to do about it.
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        if (res.status === 409) setOwnershipConflict(true);
        throw new Error(data?.error ?? "Save failed");
      }
      setMessage({ type: "success", text: "Webhook URLs saved." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save. Check console.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(
    body: { target: TestableGeneralKey } | { countryId: string },
    key: string
  ) {
    setTesting(key);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/discord/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setMessage({ type: "success", text: `Test embed sent to ${key} webhook.` });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTesting(null);
    }
  }

  async function handleTestElection(countryId: string, electionType: string) {
    const key = `${countryId}-${electionType}`;
    setTestingElection(key);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/discord/test-election", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionType, countryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setMessage({
        type: "success",
        text: `Test ${electionType} results sent (${data.resultsShown} results).`,
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTestingElection(null);
    }
  }

  async function handleTestChangelog(mode: "latest" | "updates") {
    setTestingChangelog(mode);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/discord/test-changelog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      if (mode === "latest") {
        setMessage({
          type: "success",
          text: `Changelog ${data.version} sent (${data.embeds} embeds).`,
        });
      } else {
        setMessage({
          type: "success",
          text: `Changelog sync: ${data.sent?.length ?? 0} version(s) sent, ${data.skipped?.length ?? 0} unchanged.`,
        });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTestingChangelog(null);
    }
  }

  /** One batch: rich embeds for suggestions missing `discordPostedAt` (up to 25). */
  async function handleBackfillSuggestionsToDiscord() {
    setBackfillingSuggestions(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/suggestions?limit=25`, { method: "PUT" });
      const data = (await res.json()) as {
        error?: string;
        posted?: number;
        failed?: number;
        skipped?: number;
        processed?: number;
        remaining?: number;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Backfill failed");

      const remaining = data.remaining ?? 0;
      if ((data.processed ?? 0) === 0 && remaining === 0) {
        setMessage({ type: "success", text: data.message ?? "Nothing to sync." });
        return;
      }
      const tail =
        remaining > 0
          ? ` ${remaining} still pending — click again to sync the next batch.`
          : " All caught up.";
      setMessage({
        type: "success",
        text: `Discord backfill: ${data.posted ?? 0} posted, ${data.failed ?? 0} failed, ${data.skipped ?? 0} skipped.${tail}`,
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Backfill failed." });
    } finally {
      setBackfillingSuggestions(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">Discord Webhooks</h3>
        <p className="text-sm text-muted">
          Configure Discord webhook URLs to broadcast game events and player news posts. Leave blank
          to disable. Country channels are listed for every country enabled for players.
        </p>
      </div>

      <div className="space-y-4">
        {GENERAL_SECTIONS.map((section) => (
          <WebhookField
            key={section.key}
            label={section.label}
            description={section.description}
            value={general[section.key]}
            onChange={(next) => setGeneral((g) => ({ ...g, [section.key]: next }))}
          >
            <button
              onClick={() =>
                section.key === "changelog"
                  ? handleTestChangelog("latest")
                  : handleTest({ target: section.key }, section.key)
              }
              disabled={
                !general[section.key] ||
                testing === section.key ||
                (section.key === "changelog" && testingChangelog === "latest")
              }
              className={BUTTON_CLASS}
            >
              {section.key === "changelog"
                ? testingChangelog === "latest"
                  ? "Sending…"
                  : "Post Latest Version"
                : testing === section.key
                  ? "Sending…"
                  : "Send Test"}
            </button>

            {section.key === "changelog" ? (
              <button
                onClick={() => handleTestChangelog("updates")}
                disabled={!general.changelog || testingChangelog === "updates"}
                className={BUTTON_CLASS}
              >
                {testingChangelog === "updates" ? "Syncing…" : "Sync All Updates"}
              </button>
            ) : null}

            {section.key === "suggestions" ? (
              <button
                type="button"
                onClick={() => void handleBackfillSuggestionsToDiscord()}
                disabled={
                  !general.suggestions || backfillingSuggestions || testing === "suggestions"
                }
                className={BUTTON_CLASS}
              >
                {backfillingSuggestions ? "Backfilling…" : "Backfill to Discord"}
              </button>
            ) : null}
          </WebhookField>
        ))}

        <div className="pt-2">
          <h4 className="text-sm font-semibold text-white mb-1">Country Events</h4>
          <p className="text-xs text-muted mb-3">
            One channel per player-enabled country. Enable or disable countries in Admin Panel &gt;
            Countries — a disabled country&apos;s URL is retained but its channel stops receiving
            events.
          </p>
          <div className="space-y-4">
            {countries.length === 0 ? (
              <p className="text-xs text-muted">No countries are currently enabled for players.</p>
            ) : (
              countries.map((country) => (
                <WebhookField
                  key={country.countryId}
                  label={`${country.flagEmoji} ${country.name} Game Events Webhook`}
                  description={countryDescription(country)}
                  value={country.url}
                  onChange={(next) => setCountryUrl(country.countryId, next)}
                >
                  <button
                    onClick={() => handleTest({ countryId: country.countryId }, country.countryId)}
                    disabled={(!country.url && !general.game) || testing === country.countryId}
                    className={BUTTON_CLASS}
                  >
                    {testing === country.countryId ? "Sending…" : "Send Test"}
                  </button>
                </WebhookField>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-white mb-1">
              Test Election Results
            </label>
            <p className="text-xs text-muted mb-3">
              Send test election result embeds using the most recent election data. Each
              country&apos;s tests go to its own webhook, with global fallback.
            </p>
          </div>
          {countries.length === 0 ? (
            <p className="text-xs text-muted">No countries are currently enabled for players.</p>
          ) : (
            countries.map((country) => (
              <div key={country.countryId} className="space-y-1">
                <p className="text-xs font-medium text-white">
                  {country.flagEmoji} {country.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  {country.electionTypes.map((et) => {
                    const key = `${country.countryId}-${et.id}`;
                    return (
                      <button
                        key={key}
                        onClick={() => handleTestElection(country.countryId, et.id)}
                        disabled={(!country.url && !general.game) || testingElection === key}
                        className={BUTTON_CLASS}
                      >
                        {testingElection === key ? "Sending…" : `Test ${et.label}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {loadFailed && (
        <p className="text-sm text-red-400">
          Could not load the current webhook configuration. Saving is disabled so existing webhooks
          are not overwritten — refresh to try again.
        </p>
      )}

      {message && (
        <p className={`text-sm ${message.type === "success" ? "text-green-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      {ownershipConflict && (
        <p className="text-sm text-amber-400">
          Taking these webhooks over points this deployment&apos;s game events at the channels
          above. Do it only if this deployment is meant to be the one posting to them.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {/* Arrow function, not a bare reference: React would pass the click event
            as the first argument, and every save would claim ownership. */}
        <button
          onClick={() => handleSave()}
          disabled={saving || !loaded}
          className="px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Webhooks"}
        </button>

        {ownershipConflict && (
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-4 py-2 rounded-md border border-amber-500 text-amber-300 text-sm font-medium hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
          >
            Take ownership and save
          </button>
        )}
      </div>
    </div>
  );
}
