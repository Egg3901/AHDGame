"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageBanner, SpinnerIcon } from "./shared";
import { apiErrorText } from "@/lib/errors/catalog";
import { isPlaceholderEmail } from "@/lib/auth/placeholderEmail";

interface Props {
  email: string;
  hasPassword: boolean;
}

export function EmailSection({ email, hasPassword }: Props) {
  const t = useTranslations("settings");
  const hasRealEmail = !isPlaceholderEmail(email);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSentTo("");
    if (!newEmail.trim()) {
      setError(t("email.errorRequired"));
      return;
    }
    if (hasPassword && !currentPassword) {
      setError(t("email.errorPasswordRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          ...(hasPassword ? { currentPassword } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSentTo(data.sentTo ?? newEmail.trim());
        setNewEmail("");
        setCurrentPassword("");
        setEditing(false);
      } else {
        setError(apiErrorText(data, t("email.failed")));
      }
    } catch {
      setError(t("common.networkErrorRetry"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-muted mb-1">{t("page.email")}</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl border border-card-border bg-background/50 px-4 py-2.5 text-sm text-foreground">
            {hasRealEmail ? email : t("email.noneOnFile")}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-xl border border-card-border px-3 py-2.5 text-sm font-medium hover:bg-card-border/40 transition-colors"
            >
              {hasRealEmail ? t("email.change") : t("email.add")}
            </button>
          )}
        </div>
        {!hasRealEmail && !editing && (
          <p className="mt-1 text-xs text-muted">{t("email.noneHint")}</p>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="newEmail" className="block text-sm font-medium mb-1.5">
              {t("email.newEmail")}
            </label>
            <input
              id="newEmail"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={inputCls}
              disabled={submitting}
            />
          </div>
          {hasPassword && (
            <div>
              <label htmlFor="emailCurrentPassword" className="block text-sm font-medium mb-1.5">
                {t("security.currentPassword")}
              </label>
              <input
                id="emailCurrentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputCls}
                disabled={submitting}
              />
            </div>
          )}
          <p className="text-xs text-muted">{t("email.verifyHint")}</p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <SpinnerIcon />}
              {submitting ? t("email.sending") : t("email.sendLink")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError("");
              }}
              disabled={submitting}
              className="rounded-xl px-4 py-2.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {error && <MessageBanner ok={false} text={error} onDismiss={() => setError("")} />}
      {sentTo && (
        <MessageBanner
          ok={true}
          text={t("email.sent", { email: sentTo })}
          onDismiss={() => setSentTo("")}
        />
      )}
    </div>
  );
}
