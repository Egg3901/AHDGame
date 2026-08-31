"use client";

import { useEffect, useState } from "react";

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.lakesidegames.net";
import { useLocale, useTranslations } from "next-intl";

type UserApiKey = {
  _id: string;
  name: string;
  scope: "public" | "private";
  lastUsedAt?: string | null;
  requestCount?: number;
};

export function ApiKeysSection() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [userKeys, setUserKeys] = useState<UserApiKey[]>([]);
  const [userKeyName, setUserKeyName] = useState("");
  const [userKeyScope, setUserKeyScope] = useState<"public" | "private">("public");
  const [newUserToken, setNewUserToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUserKeys = async () => {
    const res = await fetch("/api/settings/user-api-keys");
    const data = await res.json();
    setUserKeys(data.keys || []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUserKeys();
  }, []);

  const createUserKey = async () => {
    setError(null);
    const res = await fetch("/api/settings/user-api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: userKeyName, scope: userKeyScope }),
    });
    const data = await res.json();
    if (data.token) {
      setNewUserToken(data.token);
      setUserKeyName("");
      void loadUserKeys();
    } else {
      setError(data.error || t("apiKeys.createFailed"));
    }
  };

  const revokeUserKey = async (keyId: string) => {
    await fetch("/api/settings/user-api-keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId }),
    });
    void loadUserKeys();
  };

  const scopeLabel = (scope: string) => {
    switch (scope) {
      case "public":
        return t("apiKeys.readOnly");
      case "private":
        return t("apiKeys.readSend");
      default:
        return scope;
    }
  };

  const scopeColor = (scope: string) => {
    switch (scope) {
      case "private":
        return "text-yellow-300";
      case "public":
        return "text-green-400";
      default:
        return "text-muted";
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {t("apiKeys.intro")}{" "}
        <a
          href={`${DOCS_URL}/api/public-v1.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary/80"
        >
          {t("apiKeys.viewDocs")}
        </a>
      </p>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Personal API Keys */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("apiKeys.personalTitle")}</h3>
        <p className="text-xs text-muted">{t("apiKeys.personalHint")}</p>
        <div className="flex gap-2">
          <input
            value={userKeyName}
            onChange={(e) => setUserKeyName(e.target.value)}
            placeholder={t("apiKeys.keyNamePlaceholder")}
            className="rounded border border-card-border bg-background px-3 py-2 text-sm"
          />
          <select
            value={userKeyScope}
            onChange={(e) => setUserKeyScope(e.target.value as "public" | "private")}
            className="rounded border border-card-border bg-background px-3 py-2 text-sm"
          >
            <option value="public">{t("apiKeys.readOnly")}</option>
            <option value="private">{t("apiKeys.readSend")}</option>
          </select>
          <button
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={createUserKey}
          >
            {t("apiKeys.createKey")}
          </button>
        </div>
        {newUserToken ? (
          <div className="rounded border border-card-border bg-background p-3 text-xs break-all">
            {t("apiKeys.copyOnce")} <strong>{newUserToken}</strong>
          </div>
        ) : null}
        <div className="space-y-2">
          {userKeys.map((k) => (
            <div
              key={k._id}
              className="flex items-center justify-between rounded border border-card-border p-3 text-sm"
            >
              <div>
                <div className="font-medium">{k.name}</div>
                <div className="text-xs text-muted">
                  <span className={scopeColor(k.scope)}>{scopeLabel(k.scope)}</span> ·{" "}
                  {t("apiKeys.requests", { count: k.requestCount ?? 0 })} ·{" "}
                  {t("apiKeys.lastUsed", {
                    when: k.lastUsedAt
                      ? // eslint-disable-next-line local/no-implicit-locale-datetime -- t() interpolation needs a string, not a <LocalTime> element; keys load client-side so no SSR hydration mismatch and the runtime zone is already the viewer's
                        new Date(k.lastUsedAt).toLocaleString(locale)
                      : t("apiKeys.never"),
                  })}
                </div>
              </div>
              <button
                className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
                onClick={() => revokeUserKey(k._id)}
              >
                {t("apiKeys.revoke")}
              </button>
            </div>
          ))}
          {userKeys.length === 0 && <p className="text-xs text-muted">{t("apiKeys.noKeys")}</p>}
        </div>
      </div>
    </div>
  );
}
