"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type UserApiKey = {
  _id: string;
  name: string;
  scope: "public" | "private";
  lastUsedAt?: string | null;
  requestCount?: number;
};

export function ApiKeysSection() {
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
      setError(data.error || "Failed to create API key");
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
        return "Read only";
      case "private":
        return "Read + send funds";
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
        API keys allow external applications to interact with your account.{" "}
        <Link href="/api-guide" className="text-primary underline hover:text-primary/80">
          View API documentation →
        </Link>
      </p>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Personal API Keys */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Personal API Keys</h3>
        <p className="text-xs text-muted">
          Keys tied to your account. Public keys can only read public data. Private keys can also
          send campaign funds and trade forex on your behalf — treat them like a password.
        </p>
        <div className="flex gap-2">
          <input
            value={userKeyName}
            onChange={(e) => setUserKeyName(e.target.value)}
            placeholder="Key name"
            className="rounded border border-card-border bg-background px-3 py-2 text-sm"
          />
          <select
            value={userKeyScope}
            onChange={(e) => setUserKeyScope(e.target.value as "public" | "private")}
            className="rounded border border-card-border bg-background px-3 py-2 text-sm"
          >
            <option value="public">Read only</option>
            <option value="private">Read + send funds</option>
          </select>
          <button
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={createUserKey}
          >
            Create key
          </button>
        </div>
        {newUserToken ? (
          <div className="rounded border border-card-border bg-background p-3 text-xs break-all">
            Copy now (shown once): <strong>{newUserToken}</strong>
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
                  {k.requestCount ?? 0} requests · last used{" "}
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("en-US") : "never"}
                </div>
              </div>
              <button
                className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
                onClick={() => revokeUserKey(k._id)}
              >
                Revoke
              </button>
            </div>
          ))}
          {userKeys.length === 0 && <p className="text-xs text-muted">No personal API keys yet.</p>}
        </div>
      </div>
    </div>
  );
}
