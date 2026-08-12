"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageBanner, SpinnerIcon } from "./shared";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21"
        />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

interface Props {
  hasPassword: boolean;
  onPasswordSet: () => void;
}

export function SecuritySection({ hasPassword, onPasswordSet }: Props) {
  const t = useTranslations("settings");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordValidation = (() => {
    if (!newPassword) return { valid: false, strengthMsg: "", matches: false, strength: 0 };
    const hasLength = newPassword.length >= 8;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const strength = [hasLength, hasUpper, hasNumber].filter(Boolean).length;
    const strengthMsg =
      strength === 1
        ? t("security.strengthWeak")
        : strength === 2
          ? t("security.strengthFair")
          : t("security.strengthStrong");
    const matches = confirmPassword === newPassword && confirmPassword.length > 0;
    return { valid: hasLength, strengthMsg, matches, strength };
  })();

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (hasPassword && !currentPassword) {
      setPasswordError(t("security.errorCurrentRequired"));
      return;
    }
    if (!newPassword || !confirmPassword) {
      setPasswordError(t("security.errorAllRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("security.errorMismatch"));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t("security.errorTooShort"));
      return;
    }
    if (hasPassword && currentPassword === newPassword) {
      setPasswordError(t("security.errorSameAsCurrent"));
      return;
    }

    setChangingPassword(true);
    try {
      if (hasPassword) {
        // Change existing password
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await res.json();
        if (res.ok) {
          setPasswordSuccess(t("security.changedSuccess"));
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        } else {
          setPasswordError(data.error || t("security.changeFailed"));
        }
      } else {
        // Set password for the first time (social-only accounts)
        const res = await fetch("/api/auth/set-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        });
        const data = await res.json();
        if (res.ok) {
          setPasswordSuccess(t("security.setSuccess"));
          setNewPassword("");
          setConfirmPassword("");
          onPasswordSet();
        } else {
          setPasswordError(data.error || t("security.setFailed"));
        }
      }
    } catch {
      setPasswordError(t("common.networkErrorRetry"));
    } finally {
      setChangingPassword(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-card-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed pr-10";

  return (
    <>
      <p className="text-sm text-muted mb-6">
        {hasPassword ? t("security.introChange") : t("security.introSet")}
      </p>
      <form onSubmit={handlePasswordSubmit} className="space-y-4">
        {hasPassword && (
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium mb-1.5">
              {t("security.currentPassword")}
            </label>
            <div className="relative">
              <input
                id="currentPassword"
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputCls}
                disabled={changingPassword}
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                aria-label={
                  showCurrentPassword ? t("security.hidePassword") : t("security.showPassword")
                }
              >
                <EyeIcon open={showCurrentPassword} />
              </button>
            </div>
          </div>
        )}
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium mb-1.5">
            {hasPassword ? t("security.newPassword") : t("security.password")}
          </label>
          <div className="relative">
            <input
              id="newPassword"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputCls}
              disabled={changingPassword}
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
              aria-label={
                showNewPassword ? t("security.hidePassword") : t("security.showPassword")
              }
            >
              <EyeIcon open={showNewPassword} />
            </button>
          </div>
          {newPassword && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex gap-1 flex-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                      passwordValidation.strength >= i
                        ? i === 1
                          ? "bg-error"
                          : i === 2
                            ? "bg-warning"
                            : "bg-success"
                        : "bg-card-border"
                    }`}
                  />
                ))}
              </div>
              <span
                className={`text-xs ${
                  passwordValidation.strength === 1
                    ? "text-error"
                    : passwordValidation.strength === 2
                      ? "text-warning"
                      : "text-success"
                }`}
              >
                {passwordValidation.strengthMsg}
              </span>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1.5">
            {hasPassword ? t("security.confirmNewPassword") : t("security.confirmPassword")}
          </label>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputCls}
              disabled={changingPassword}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
              aria-label={
                showConfirmPassword ? t("security.hidePassword") : t("security.showPassword")
              }
            >
              <EyeIcon open={showConfirmPassword} />
            </button>
          </div>
          {confirmPassword && (
            <p
              className={`mt-1 text-xs flex items-center gap-1 ${passwordValidation.matches ? "text-success" : "text-error"}`}
            >
              {passwordValidation.matches ? (
                <>
                  <svg
                    className="h-3 w-3 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {t("security.passwordsMatch")}
                </>
              ) : (
                <>
                  <svg
                    className="h-3 w-3 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  {t("security.passwordsNoMatch")}
                </>
              )}
            </p>
          )}
        </div>
        {passwordError && (
          <MessageBanner ok={false} text={passwordError} onDismiss={() => setPasswordError("")} />
        )}
        {passwordSuccess && (
          <MessageBanner
            ok={true}
            text={passwordSuccess}
            onDismiss={() => setPasswordSuccess("")}
          />
        )}
        <button
          type="submit"
          disabled={changingPassword}
          className="rounded-xl bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {changingPassword && <SpinnerIcon />}
          {changingPassword
            ? hasPassword
              ? t("security.changing")
              : t("security.setting")
            : hasPassword
              ? t("security.changePassword")
              : t("security.setPassword")}
        </button>
      </form>
    </>
  );
}
