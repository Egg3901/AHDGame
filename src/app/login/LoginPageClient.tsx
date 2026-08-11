"use client";

import Link from "next/link";
import Image from "next/image";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  OAUTH_DEVICE_KEY_COOKIE,
  OAUTH_FINGERPRINT_COOKIE,
  OAUTH_FINGERPRINT_MAX_AGE_SECONDS,
} from "@/lib/auth/oauthFingerprint";
import { generateFingerprintData, type StoredFingerprintComponents } from "@/lib/utils/fingerprint";
import { getOrCreateDeviceKey } from "@/lib/utils/deviceKey";
import { loginDestination } from "@/lib/auth/lakesideLoginReturn";
import { Input, Label, Button, SectionLabel } from "@/components/ui";

const DISCORD_ERROR_MESSAGES: Record<string, string> = {
  discord_not_configured: "Discord login is not configured on this server.",
  access_denied: "Discord authorization was denied.",
  missing_params: "Discord login failed. Please try again.",
  invalid_state: "Discord login expired. Please try again.",
  session_expired: "Discord login expired or was interrupted. Please try again.",
  rate_limited: "You're sending requests too quickly. Please wait a moment and try again.",
  not_configured: "Discord login is not configured on this server.",
  exchange_failed: "Discord login failed. Please try again.",
  already_linked: "This Discord account is already linked to another user.",
};

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Google login is not configured on this server.",
  access_denied: "Google authorization was denied.",
  missing_params: "Google login failed. Please try again.",
  invalid_state: "Google login expired. Please try again.",
  exchange_failed: "Google login failed. Please try again.",
  already_linked: "This Google account is already linked to another user.",
};

interface LoginPageClientProps {
  initialMaintenanceMode: boolean;
  wireframeColor?: string;
  eraLabel?: string;
  eraTagline?: string;
  /** CDN URL for the era-specific left-panel background image (modern eras only). */
  loginImageUrl?: string;
}

export default function LoginPageClient({
  initialMaintenanceMode,
  wireframeColor,
  eraLabel,
  eraTagline,
  loginImageUrl,
}: LoginPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [fingerprintComponents, setFingerprintComponents] = useState<StoredFingerprintComponents>(
    {}
  );
  const [deviceKey, setDeviceKey] = useState("");
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const maintenanceMode = initialMaintenanceMode;

  /** Prefer live URL search — useSearchParams can lag; Ops SSO depends on returnTo surviving submit. */
  const readReturnTo = () => {
    const fromHook = searchParams.get("returnTo");
    if (fromHook) return fromHook;
    if (typeof window === "undefined") return null;
    try {
      return new URLSearchParams(window.location.search).get("returnTo");
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const reason = searchParams.get("reason") || searchParams.get("error");
    const discordStatus = searchParams.get("discord");
    const googleStatus = searchParams.get("google");
    if ((discordStatus === "error" && reason) || reason === "discord_not_configured") {
      setError(DISCORD_ERROR_MESSAGES[reason] || "Discord login failed. Please try again.");
    } else if (googleStatus === "error" && reason) {
      setError(GOOGLE_ERROR_MESSAGES[reason] || "Google login failed. Please try again.");
    }
  }, [searchParams]);

  useEffect(() => {
    generateFingerprintData().then(({ hash, components }) => {
      setFingerprint(hash);
      setFingerprintComponents(components);
    });
    setDeviceKey(getOrCreateDeviceKey());
  }, []);

  const oauthLoginUrl = (path: "/api/auth/discord/login" | "/api/auth/google/login") => {
    const returnTo = readReturnTo();
    if (!returnTo) return path;
    const url = new URL(path, window.location.origin);
    url.searchParams.set("returnTo", returnTo);
    return `${url.pathname}${url.search}`;
  };

  const beginDiscordOAuth = () => {
    const cookieSuffix = `; max-age=${OAUTH_FINGERPRINT_MAX_AGE_SECONDS}; path=/; samesite=lax${
      window.location.protocol === "https:" ? "; secure" : ""
    }`;
    if (fingerprint) {
      document.cookie = `${OAUTH_FINGERPRINT_COOKIE}=${encodeURIComponent(fingerprint)}${cookieSuffix}`;
    }
    if (deviceKey) {
      document.cookie = `${OAUTH_DEVICE_KEY_COOKIE}=${encodeURIComponent(deviceKey)}${cookieSuffix}`;
    }
    window.location.href = oauthLoginUrl("/api/auth/discord/login");
  };

  const beginGoogleOAuth = () => {
    const cookieSuffix = `; max-age=${OAUTH_FINGERPRINT_MAX_AGE_SECONDS}; path=/; samesite=lax${
      window.location.protocol === "https:" ? "; secure" : ""
    }`;
    if (fingerprint) {
      document.cookie = `${OAUTH_FINGERPRINT_COOKIE}=${encodeURIComponent(fingerprint)}${cookieSuffix}`;
    }
    if (deviceKey) {
      document.cookie = `${OAUTH_DEVICE_KEY_COOKIE}=${encodeURIComponent(deviceKey)}${cookieSuffix}`;
    }
    window.location.href = oauthLoginUrl("/api/auth/google/login");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          fingerprint,
          fingerprintComponents,
          deviceKey: deviceKey || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "banned") {
          const reason = encodeURIComponent(data.reason || "Violation of rules");
          router.push(`/banned?reason=${reason}`);
          return;
        }
        throw new Error(data.error || "Login failed");
      }

      // Use a full navigation so the AuthDataProvider remounts and picks up the
      // freshly set session cookie. router.push would keep the provider's prior
      // (logged-out) state, causing navbar/footer to render as signed-out until
      // the user manually refreshes.
      const nextPath = loginDestination(readReturnTo(), data.user);
      window.location.assign(nextPath);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {wireframeColor ? (
        /* ── CRT wireframe panel (1953, 1979) ─────────────────────────────── */
        <aside className="relative hidden w-5/12 flex-col justify-between overflow-hidden border-r border-card-border bg-card-muted p-10 lg:flex xl:w-1/2 xl:p-14">
          {/* Era-specific image ghosted behind the CRT overlay */}
          {loginImageUrl && (
            <Image
              src={loginImageUrl}
              unoptimized
              alt=""
              aria-hidden="true"
              fill
              className="object-cover opacity-10 grayscale"
              priority
              sizes="(min-width: 1280px) 50vw, 42vw"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <div aria-hidden="true" className="absolute inset-0 bg-background/40" />
          <div
            aria-hidden="true"
            className="absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-primary/10 blur-3xl"
          />
          {/* Top accent */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-primary/40 to-transparent" />
          {/* Logo */}
          <Link href="/" className="relative z-10 flex items-center gap-2.5">
            <Image
              src={CDN_LOGO_URL}
              unoptimized
              alt="A House Divided Logo"
              width={36}
              height={36}
              className="object-contain"
            />
            <span className="text-body-lg font-semibold tracking-tight text-foreground">
              A House Divided
            </span>
          </Link>
          {/* Era copy */}
          <div className="relative z-10 max-w-lg border-l border-primary/40 pl-6">
            <p className="mb-3 font-mono text-body-xs uppercase tracking-widest text-primary">
              {eraLabel}
            </p>
            <p className="font-mono text-heading-lg font-semibold leading-snug text-foreground xl:text-display">
              {eraTagline}
            </p>
          </div>
        </aside>
      ) : (
        /* ── Modern panel (1991+) ──────────────────────────────────────────── */
        <aside className="relative hidden w-5/12 flex-col justify-between overflow-hidden border-r border-card-border bg-card-muted p-10 lg:flex xl:w-1/2 xl:p-14">
          {/* Era-specific background image (renders when uploaded to CDN) */}
          {loginImageUrl && (
            <Image
              src={loginImageUrl}
              unoptimized
              alt=""
              aria-hidden="true"
              fill
              className="object-cover opacity-30"
              priority
              sizes="(min-width: 1280px) 50vw, 42vw"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <div aria-hidden="true" className="absolute inset-0 bg-background/45" />
          <div
            aria-hidden="true"
            className="absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-primary/15 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="absolute -right-24 bottom-16 h-80 w-80 rounded-full bg-secondary/10 blur-3xl"
          />
          {/* Top accent */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-primary/40 to-transparent" />
          {/* Logo */}
          <Link href="/" className="relative z-10 flex items-center gap-2.5">
            <Image
              src={CDN_LOGO_URL}
              unoptimized
              alt="A House Divided Logo"
              width={36}
              height={36}
              className="object-contain"
            />
            <span className="text-body-lg font-semibold tracking-tight text-foreground">
              A House Divided
            </span>
          </Link>
          {/* Era copy */}
          <div className="relative z-10 max-w-lg border-l border-primary/40 pl-6">
            <p className="mb-3 text-body-xs font-semibold uppercase tracking-widest text-primary">
              {eraLabel}
            </p>
            <p className="font-display text-heading-lg font-semibold leading-snug tracking-tight text-foreground xl:text-display">
              {eraTagline}
            </p>
          </div>
        </aside>
      )}

      <main className="relative flex w-full flex-col justify-center overflow-hidden bg-background px-4 py-5 sm:px-8 sm:py-10 lg:w-7/12 lg:px-12 xl:w-1/2 xl:px-20">
        {/* Mobile-only blurred hero background (desktop shows it in the left panel) */}
        {loginImageUrl && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden"
          >
            <Image
              src={loginImageUrl}
              unoptimized
              alt=""
              fill
              className="scale-110 object-cover opacity-30 blur-2xl"
              priority
              sizes="100vw"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            {/* Scrim so the form stays readable over the image */}
            <div className="absolute inset-0 bg-background/80" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-48 -top-48 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-secondary/5 blur-3xl" />
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <Link href="/" className="mb-5 flex items-center gap-2.5 sm:mb-7 lg:hidden">
            <Image
              src={CDN_LOGO_URL}
              unoptimized
              alt="A House Divided Logo"
              width={36}
              height={36}
              className="object-contain"
            />
            <span className="text-body-lg font-semibold tracking-tight">A House Divided</span>
          </Link>

          <section className="relative overflow-hidden rounded-xl border border-card-border bg-card/90 p-5 shadow-panel backdrop-blur-sm sm:p-8">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-primary/40 to-transparent"
            />
            {maintenanceMode && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <div>
                  <p className="text-body font-semibold text-warning">Maintenance Mode Active</p>
                  <p className="text-body-sm text-muted">
                    Only admin accounts can sign in during maintenance. New registrations are
                    temporarily closed.
                  </p>
                </div>
              </div>
            )}

            <div className="mb-7 border-b border-card-border pb-6">
              <SectionLabel as="p">Account</SectionLabel>
              <h1 className="mt-1 font-display text-display font-semibold tracking-tight text-foreground">
                Welcome back
              </h1>
              <p className="mt-2 text-body text-muted">
                Sign in to continue your political career.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-6 flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-body text-error"
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
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

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-5">
                <div>
                  <Label htmlFor="email">Email or Username</Label>
                  <Input
                    id="email"
                    type="text"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="username or email@example.com"
                    className="bg-card-muted"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-body-sm font-medium text-primary transition-colors hover:text-primary-dark link-underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter your password"
                    className="bg-card-muted"
                  />
                </div>
              </div>

              <Button
                type="submit"
                isLoading={isLoading}
                size="lg"
                className="w-full shadow-glow-sm transition-shadow hover:shadow-glow"
              >
                Sign in
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-card-border" />
              </div>
              <div className="relative flex justify-center text-body-sm">
                <span className="bg-card px-3 text-muted">or continue with</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={beginGoogleOAuth}
                className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-card-border bg-card px-4 py-3 text-body font-medium text-foreground shadow-card transition-colors hover:bg-card-muted"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <button
                type="button"
                onClick={beginDiscordOAuth}
                className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-secondary/40 bg-secondary px-4 py-3 text-body font-semibold text-foreground shadow-card transition-colors hover:bg-secondary-dark"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                Continue with Discord
              </button>
            </div>

            {maintenanceMode ? (
              <p className="mt-8 text-center text-body-sm text-muted">
                Registration is closed during maintenance.{" "}
                <Link
                  href="/maintenance"
                  className="font-medium text-warning transition-colors hover:text-warning/80 link-underline"
                >
                  View details
                </Link>
              </p>
            ) : (
              <p className="mt-8 text-center text-body text-muted">
                New to the game?{" "}
                <Link
                  href="/register"
                  className="font-medium text-primary transition-colors hover:text-primary-dark link-underline"
                >
                  Create an account
                </Link>
              </p>
            )}

            <p className="mt-6 border-t border-card-border pt-5 text-center text-body-sm leading-relaxed text-muted/70">
              By signing in, you agree to the use of essential cookies for authentication and
              security purposes, including fraud prevention and multi-account detection.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
