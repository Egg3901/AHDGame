"use client";

import Link from "next/link";
import Image from "next/image";
import { CDN_LOGO_URL, CDN_HERO_LINCOLN_URL } from "@/lib/images/staticCdnAssets";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  OAUTH_DEVICE_KEY_COOKIE,
  OAUTH_FINGERPRINT_COOKIE,
  OAUTH_FINGERPRINT_MAX_AGE_SECONDS,
  OAUTH_REFERRAL_CODE_COOKIE,
} from "@/lib/auth/oauthFingerprint";
import { generateFingerprintData, type StoredFingerprintComponents } from "@/lib/utils/fingerprint";
import { getOrCreateDeviceKey } from "@/lib/utils/deviceKey";
import { Button } from "@/components/ui";
import { AccountSection, type SocialAvailability } from "./components/AccountSection";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { normalizeReferralCode } from "@/lib/auth/normalizeReferralCode";

const TURNSTILE_ENABLED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * `heroImageUrl` is resolved server-side from the world's seed year (see
 * `page.tsx`) so a 1953 world does not greet new players with a US Civil War
 * monument. Undefined only when the DB read failed, in which case the
 * era-neutral Lincoln hero is the deliberate fallback.
 */
export default function RegisterPageClient({ heroImageUrl }: { heroImageUrl?: string }) {
  const t = useTranslations("auth.register");
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [fingerprintComponents, setFingerprintComponents] = useState<StoredFingerprintComponents>(
    {}
  );
  const [deviceKey, setDeviceKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  const [testMode, setTestMode] = useState(false);
  // Which signup routes this deployment can actually complete. Null until the
  // server answers, so the buttons are never disabled on a slow network.
  const [discordSignup, setDiscordSignup] = useState<SocialAvailability | null>(null);
  const [googleSignup, setGoogleSignup] = useState<SocialAvailability | null>(null);
  const showAdminKey = searchParams.get("admin") === "1";

  // Scroll to error when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  // Form data (account fields only)
  const [formData, setFormData] = useState({
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
    adminKey: "",
    referralCode: "",
    testSecret: "",
    termsAccepted: false,
    ageConfirmed: false,
  });

  // Prefill referral from share links (?ref= / ?referral=)
  useEffect(() => {
    const fromQuery =
      normalizeReferralCode(searchParams.get("ref")) ??
      normalizeReferralCode(searchParams.get("referral"));
    if (!fromQuery) return;
    setFormData((prev) => (prev.referralCode ? prev : { ...prev, referralCode: fromQuery }));
  }, [searchParams]);

  // Generate fingerprint and check test mode on mount
  useEffect(() => {
    generateFingerprintData().then(({ hash, components }) => {
      setFingerprint(hash);
      setFingerprintComponents(components);
    });
    setDeviceKey(getOrCreateDeviceKey());

    const fetchSignupMethods = async () => {
      try {
        const res = await fetch("/api/auth/signup-methods");
        if (res.ok) {
          const data = await res.json();
          setTestMode(data.testMode ?? false);
          setDiscordSignup(data.discord ?? null);
          setGoogleSignup(data.google ?? null);
        }
      } catch {
        // silent
      }
    };
    fetchSignupMethods();
  }, []);

  const beginSocialRegistration = (provider: "discord" | "google", referralCode: string | null) => {
    const cookieSuffix = `; max-age=${OAUTH_FINGERPRINT_MAX_AGE_SECONDS}; path=/; samesite=lax${
      window.location.protocol === "https:" ? "; secure" : ""
    }`;
    if (fingerprint) {
      document.cookie = `${OAUTH_FINGERPRINT_COOKIE}=${encodeURIComponent(fingerprint)}${cookieSuffix}`;
    }
    if (deviceKey) {
      document.cookie = `${OAUTH_DEVICE_KEY_COOKIE}=${encodeURIComponent(deviceKey)}${cookieSuffix}`;
    }
    const code = normalizeReferralCode(referralCode);
    if (code) {
      document.cookie = `${OAUTH_REFERRAL_CODE_COOKIE}=${encodeURIComponent(code)}${cookieSuffix}`;
      setFormData((prev) => ({ ...prev, referralCode: code }));
    }
    window.location.href =
      provider === "google" ? "/api/auth/google/login" : "/api/auth/discord/login";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Account validation
    if (!formData.email || !formData.username || !formData.password) {
      setError(t("errors.fillRequired"));
      setIsLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t("errors.passwordsMismatch"));
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      setError(t("errors.passwordMin"));
      setIsLoading(false);
      return;
    }

    if (!formData.termsAccepted) {
      setError(t("errors.acceptTerms"));
      setIsLoading(false);
      return;
    }

    if (!formData.ageConfirmed) {
      setError(t("errors.confirmAge"));
      setIsLoading(false);
      return;
    }

    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError(t("errors.completeChallenge"));
      setIsLoading(false);
      return;
    }

    try {
      // Step 1: Create account
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          username: formData.username,
          password: formData.password,
          adminKey: formData.adminKey || undefined,
          referralCode: normalizeReferralCode(formData.referralCode) || undefined,
          testSecret: formData.testSecret || undefined,
          ageConfirmed: formData.ageConfirmed,
          termsAccepted: formData.termsAccepted,
          fingerprint,
          fingerprintComponents,
          deviceKey: deviceKey || undefined,
          turnstileToken: turnstileToken || undefined,
        }),
      });

      const registerData = await registerRes.json();

      if (!registerRes.ok) {
        throw new Error(registerData.error || t("errors.registrationFailed"));
      }

      // Step 2: Auto-login
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          fingerprint,
          fingerprintComponents,
          deviceKey: deviceKey || undefined,
        }),
      });

      if (!loginRes.ok) {
        throw new Error(t("errors.accountCreatedLoginFailed"));
      }

      // Launch character creation immediately after account setup. Use a full
      // navigation so the AuthDataProvider remounts with the freshly set
      // session cookie — soft navigation leaves it stuck in the logged-out
      // state captured on the register page mount.
      window.location.assign("/create-character");
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.generic"));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-card-border bg-background/90 backdrop-blur-xl">
        <div className="h-[2px] w-full bg-gradient-to-r from-primary/60 via-primary/30 to-transparent" />
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src={CDN_LOGO_URL}
              unoptimized
              alt={t("logoAlt")}
              width={36}
              height={36}
              className="object-contain shrink-0"
            />
            <span className="hidden sm:inline text-base font-semibold tracking-tight">
              A House Divided
            </span>
          </Link>
          <Link
            href="/login"
            className="text-right text-body-sm text-muted transition-colors hover:text-foreground sm:text-body"
          >
            {t("alreadyHaveAccount")}{" "}
            <span className="font-medium text-primary">{t("headerSignIn")}</span>
          </Link>
        </div>
      </header>

      {/* Hero banner */}
      <section className="relative overflow-hidden border-b border-card-border bg-card-muted">
        <div className="absolute inset-0">
          <Image
            src={heroImageUrl ?? CDN_HERO_LINCOLN_URL}
            unoptimized
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center opacity-35"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/80 to-background/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        </div>
        <div className="relative z-10 mx-auto max-w-3xl px-4 py-8 text-left sm:px-6 sm:py-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-body-xs font-medium uppercase tracking-wider text-primary">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            {t("badge")}
          </div>
          <h1 className="max-w-xl font-display text-display font-semibold tracking-tight text-foreground">
            {t("heading")}
          </h1>
          <p className="mt-3 max-w-xl text-body text-muted sm:text-body-lg">{t("subheading")}</p>
          <div className="mt-5 flex flex-col gap-2 text-body-sm text-muted sm:flex-row sm:items-center sm:gap-5">
            <p>
              {t.rich("newHere", {
                link: (chunks) => (
                  <Link
                    href="https://wiki.ahousedividedgame.com/getting-started"
                    target="_blank"
                    className="font-medium text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <span className="hidden text-card-border sm:inline" aria-hidden="true">
              /
            </span>
            <p>
              {t.rich("exploreFirst", {
                link: (chunks) => (
                  <Link href="/world" className="font-medium text-primary hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="relative mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Subtle background decoration */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-48 top-0 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -left-40 bottom-0 h-80 w-80 rounded-full bg-secondary/5 blur-3xl" />
        </div>

        {testMode && (
          <div
            role="status"
            className="relative mb-5 flex items-center gap-3 rounded-lg border border-secondary/30 bg-secondary/10 px-4 py-3 text-body text-secondary shadow-card"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5"
              />
            </svg>
            {t("testModeNotice")}
          </div>
        )}

        {error && (
          <div
            ref={errorRef}
            role="alert"
            className="relative mb-5 flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-body text-error shadow-card"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative space-y-5">
          {/* Account Information */}
          <AccountSection
            formData={{
              email: formData.email,
              username: formData.username,
              password: formData.password,
              confirmPassword: formData.confirmPassword,
              adminKey: formData.adminKey,
              referralCode: formData.referralCode,
              testSecret: formData.testSecret,
            }}
            testMode={testMode}
            discord={discordSignup}
            google={googleSignup}
            showAdminKey={showAdminKey}
            onSocialRegister={beginSocialRegistration}
            onChange={(updates) => setFormData((prev) => ({ ...prev, ...updates }))}
          />

          {/* Submit area */}
          <div className="relative overflow-hidden rounded-xl border border-card-border bg-card/90 p-5 shadow-panel backdrop-blur-sm sm:p-7">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/40 via-secondary/30 to-transparent" />
            <div className="mb-6 space-y-3 rounded-lg border border-card-border bg-card-muted p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={formData.termsAccepted}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, termsAccepted: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-card-border accent-primary"
                />
                <span className="text-body-sm leading-relaxed text-muted">
                  {t.rich("termsCheckbox", {
                    terms: (chunks) => (
                      <Link href="/terms" target="_blank" className="text-primary hover:underline">
                        {chunks}
                      </Link>
                    ),
                    privacy: (chunks) => (
                      <Link
                        href="/privacy"
                        target="_blank"
                        className="text-primary hover:underline"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={formData.ageConfirmed}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, ageConfirmed: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-card-border accent-primary"
                />
                <span className="text-body-sm leading-relaxed text-muted">{t("ageCheckbox")}</span>
              </label>
            </div>
            {TURNSTILE_ENABLED && (
              <div className="flex justify-center sm:justify-start">
                <TurnstileWidget
                  onVerify={setTurnstileToken}
                  onExpire={() => setTurnstileToken("")}
                />
              </div>
            )}
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-center sm:text-left">
                <p className="text-body font-medium">{t("readyToStart")}</p>
                <p className="text-body-sm text-muted">{t("createToBegin")}</p>
              </div>
              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                disabled={TURNSTILE_ENABLED && !turnstileToken}
                size="lg"
                className="w-full shadow-glow-sm transition-shadow hover:shadow-glow sm:w-auto sm:min-w-60"
              >
                {isLoading ? t("creatingAccount") : t("createAccount")}
              </Button>
            </div>
          </div>
        </form>
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-card-border bg-card-muted/50">
        <div className="mx-auto max-w-7xl space-y-3 px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body-sm text-muted">{t("footerTagline")}</p>
            <Link
              href="/login"
              className="text-body-sm text-muted transition-colors hover:text-foreground"
            >
              {t("alreadyHaveAccount")}
            </Link>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              href="/privacy"
              className="text-body-sm text-muted/60 transition-colors hover:text-muted"
            >
              {t("privacyPolicy")}
            </Link>
            <Link
              href="/terms"
              className="text-body-sm text-muted/60 transition-colors hover:text-muted"
            >
              {t("termsOfService")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
