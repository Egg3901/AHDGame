"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input, Label, Modal, Button, SectionLabel } from "@/components/ui";
import { normalizeReferralCode } from "@/lib/auth/normalizeReferralCode";

/** Why a social signup button is unusable on this deployment. */
export interface SocialAvailability {
  available: boolean;
  reason: "not_configured" | "test_mode" | null;
}

type SocialProvider = "discord" | "google";

interface AccountSectionProps {
  formData: {
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
    adminKey: string;
    referralCode: string;
    testSecret: string;
  };
  testMode?: boolean;
  /** Null until the server has answered; the buttons stay enabled meanwhile. */
  discord?: SocialAvailability | null;
  google?: SocialAvailability | null;
  showAdminKey?: boolean;
  /**
   * Called when the player is ready to leave for OAuth. `referralCode` is either
   * a normalized ObjectId hex string or null (explicitly continuing without one).
   */
  onSocialRegister: (provider: SocialProvider, referralCode: string | null) => void;
  onChange: (updates: Partial<AccountSectionProps["formData"]>) => void;
}

export function AccountSection({
  formData,
  testMode,
  discord,
  google,
  showAdminKey,
  onSocialRegister,
  onChange,
}: AccountSectionProps) {
  const t = useTranslations("auth.register.account");
  const passwordTooShort = formData.password.length > 0 && formData.password.length < 8;
  const passwordMismatch =
    formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword;

  const [gateProvider, setGateProvider] = useState<SocialProvider | null>(null);
  const [gateDraft, setGateDraft] = useState("");
  const [gateError, setGateError] = useState("");

  // A social button that cannot work is disabled here rather than left live to
  // bounce the player through a redirect into an error page they never asked
  // for. `undefined`/`null` means the server has not answered yet.
  const discordBlocked = discord ? !discord.available : false;
  const googleBlocked = google ? !google.available : false;
  const bothBlocked = discordBlocked && googleBlocked;
  const reasonFor = (m: SocialAvailability | null | undefined, provider: string): string | null => {
    if (!m || m.available || !m.reason) return null;
    return m.reason === "test_mode"
      ? t("unavailableTestMode", { provider })
      : t("unavailableNotConfigured", { provider });
  };

  const providerLabel = gateProvider === "google" ? "Google" : "Discord";

  const requestSocial = (provider: SocialProvider) => {
    const normalized = normalizeReferralCode(formData.referralCode);
    if (normalized) {
      onSocialRegister(provider, normalized);
      return;
    }
    // Soft gate: ask once before leaving, so Discord/Google don't silently
    // drop a referral the player meant to enter.
    setGateDraft(formData.referralCode.trim());
    setGateError("");
    setGateProvider(provider);
  };

  const continueWithCode = () => {
    if (!gateProvider) return;
    const normalized = normalizeReferralCode(gateDraft);
    if (!normalized) {
      setGateError(t("gateInvalid"));
      return;
    }
    onChange({ referralCode: normalized });
    const provider = gateProvider;
    setGateProvider(null);
    onSocialRegister(provider, normalized);
  };

  const continueWithout = () => {
    if (!gateProvider) return;
    const provider = gateProvider;
    setGateProvider(null);
    onSocialRegister(provider, null);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card/90 shadow-panel backdrop-blur-sm">
      <div className="relative border-b border-card-border px-5 py-5 sm:px-7 sm:py-6">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-primary/40 to-transparent" />
        <SectionLabel as="p">{t("sectionLabel")}</SectionLabel>
        <h2 className="mt-1 font-display text-heading font-semibold text-foreground">
          {t("heading")}
        </h2>
        <p className="mt-1 text-body-sm text-muted">
          {bothBlocked ? t("subBothBlocked") : t("subDefault")}
        </p>
      </div>
      <div className="p-5 sm:p-7">
        {/* Social quick-register — referral first so OAuth never skips it */}
        <div className="space-y-3 rounded-lg border border-card-border bg-card-muted p-4 sm:p-5">
          {!bothBlocked && (
            <div>
              <Label htmlFor="referralCodeSocial">
                {t("referralLabel")} <span className="font-normal text-muted">{t("optional")}</span>
              </Label>
              <Input
                id="referralCodeSocial"
                type="text"
                value={formData.referralCode}
                onChange={(e) => onChange({ referralCode: e.target.value })}
                className="bg-card font-mono text-sm tracking-wider"
                placeholder={t("referralPlaceholder")}
                maxLength={36}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-body-sm leading-relaxed text-muted">{t("referralHint")}</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => requestSocial("discord")}
            disabled={discordBlocked}
            title={reasonFor(discord, "Discord") ?? undefined}
            className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-secondary/40 bg-secondary px-4 py-3 text-body font-semibold text-foreground shadow-card transition-colors hover:bg-secondary-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-secondary"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            {t("registerWithDiscord")}
          </button>
          <button
            type="button"
            onClick={() => requestSocial("google")}
            disabled={googleBlocked}
            title={reasonFor(google, "Google") ?? undefined}
            className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-card-border bg-card px-4 py-3 text-body font-medium text-foreground shadow-card transition-colors hover:bg-card/80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {t("registerWithGoogle")}
          </button>
          {discordBlocked && (
            <p className="text-center text-body-sm text-warning">{reasonFor(discord, "Discord")}</p>
          )}
          {googleBlocked && (
            <p className="text-center text-body-sm text-warning">{reasonFor(google, "Google")}</p>
          )}
          <p className="mt-2 text-center text-body-sm leading-relaxed text-muted">
            {bothBlocked ? t("socialHintBlocked") : t("socialHint")}
          </p>
        </div>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-card-border" />
          </div>
          <div className="relative flex justify-center text-body-sm">
            <span className="bg-card px-3 text-muted">{t("orRegisterWithEmail")}</span>
          </div>
        </div>

        <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="email" required>
              {t("emailLabel")}
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => onChange({ email: e.target.value })}
              className="bg-card-muted"
              placeholder={t("emailPlaceholder")}
            />
          </div>

          <div>
            <Label htmlFor="username" required>
              {t("usernameLabel")}
            </Label>
            <Input
              id="username"
              type="text"
              required
              value={formData.username}
              onChange={(e) => onChange({ username: e.target.value })}
              className="bg-card-muted"
              placeholder={t("usernamePlaceholder")}
            />
          </div>

          <div>
            <Label htmlFor="password" required>
              {t("passwordLabel")}
            </Label>
            <Input
              id="password"
              type="password"
              required
              value={formData.password}
              onChange={(e) => onChange({ password: e.target.value })}
              className="bg-card-muted"
              placeholder={t("passwordPlaceholder")}
            />
            {passwordTooShort && (
              <p className="mt-1 text-body-sm text-warning">{t("passwordTooShort")}</p>
            )}
          </div>

          <div>
            <Label htmlFor="confirmPassword" required>
              {t("confirmPasswordLabel")}
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={(e) => onChange({ confirmPassword: e.target.value })}
              className="bg-card-muted"
              placeholder={t("confirmPasswordPlaceholder")}
            />
            {passwordMismatch && (
              <p className="mt-1 text-body-sm text-error">{t("passwordsDontMatch")}</p>
            )}
          </div>

          {testMode && (
            <div className="sm:col-span-2">
              <Label htmlFor="testSecret" required>
                {t("testSecretLabel")}
              </Label>
              <Input
                id="testSecret"
                type="password"
                required
                value={formData.testSecret}
                onChange={(e) => onChange({ testSecret: e.target.value })}
                className="border-secondary/30 bg-secondary/5 focus:border-secondary focus:ring-secondary"
                placeholder={t("testSecretPlaceholder")}
              />
              <p className="mt-1 text-body-sm text-muted">{t("testSecretHint")}</p>
            </div>
          )}

          {showAdminKey && (
            <div className="sm:col-span-2">
              <Label htmlFor="adminKey">
                {t("adminKeyLabel")} <span className="text-muted font-normal">{t("optional")}</span>
              </Label>
              <Input
                id="adminKey"
                type="password"
                value={formData.adminKey}
                onChange={(e) => onChange({ adminKey: e.target.value })}
                className="border-warning/30 bg-warning/5 focus:border-warning focus:ring-warning"
                placeholder={t("adminKeyPlaceholder")}
              />
              <p className="mt-1 text-body-sm text-muted">{t("adminKeyHint")}</p>
            </div>
          )}

          {/* Keep referral on the email path too — same field, shared state */}
          {bothBlocked && (
            <div className="sm:col-span-2">
              <Label htmlFor="referralCode">
                {t("referralLabel")} <span className="text-muted font-normal">{t("optional")}</span>
              </Label>
              <Input
                id="referralCode"
                type="text"
                value={formData.referralCode}
                onChange={(e) => onChange({ referralCode: e.target.value })}
                className="bg-card-muted font-mono text-sm tracking-wider"
                placeholder={t("referralEmailPlaceholder")}
                maxLength={36}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-2 text-body-sm leading-relaxed text-muted">
                {t("referralBonusHint")}
              </p>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={gateProvider !== null}
        title={t("gateTitle")}
        onClose={() => setGateProvider(null)}
      >
        <p className="mb-4 text-body-sm leading-relaxed text-muted">
          {t("gateIntro", { provider: providerLabel })}
        </p>
        <Label htmlFor="referralGateInput">{t("referralLabel")}</Label>
        <Input
          id="referralGateInput"
          type="text"
          value={gateDraft}
          onChange={(e) => {
            setGateDraft(e.target.value);
            if (gateError) setGateError("");
          }}
          className="font-mono text-sm tracking-wider"
          placeholder={t("gatePlaceholder")}
          maxLength={36}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              continueWithCode();
            }
          }}
        />
        {gateError && <p className="mt-2 text-body-sm text-warning">{gateError}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={continueWithout}>
            {t("continueWithout")}
          </Button>
          <Button type="button" variant="primary" onClick={continueWithCode}>
            {t("continueWith", { provider: providerLabel })}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
