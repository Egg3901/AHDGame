import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy Policy | A House Divided",
  description:
    "Privacy Policy for A House Divided: how we collect, use, store, and protect account and gameplay data.",
  pathname: "/privacy",
});

const EFFECTIVE_DATE = "April 30, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted">Effective date: {EFFECTIVE_DATE}</p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-6 sm:p-8 space-y-8">
          <section>
            <h2 className="text-lg font-bold mb-3">1. Introduction</h2>
            <p className="text-sm text-muted leading-relaxed">
              This Privacy Policy describes how A House Divided (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
              or &ldquo;our&rdquo;) collects, uses, and handles your information when you use our
              website and game at{" "}
              <a href="https://ahousedividedgame.com" className="text-primary hover:underline">
                ahousedividedgame.com
              </a>
              . By using the service, you agree to the collection and use of information as
              described in this policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">2. Information We Collect</h2>
            <div className="space-y-4 text-sm text-muted leading-relaxed">
              <div>
                <p className="font-semibold text-foreground mb-1">Account data</p>
                <p>
                  When you register, we collect your email address, username, and a hashed password.
                  Plain-text passwords are never stored.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">OAuth sign-in data</p>
                <p>
                  If you sign in using Google or Discord, we receive your email address and display
                  name from that provider. We do not receive your password for those services.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Gameplay data</p>
                <p>
                  We store your in-game character name, party affiliation, policy positions, in-game
                  actions, election history, and other gameplay activity as part of operating the
                  simulation.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Browser fingerprint</p>
                <p>
                  To enforce our one-account-per-person rule, we collect a hashed browser
                  fingerprint on registration and login. This fingerprint is derived from
                  characteristics including your browser&apos;s canvas rendering, WebGL renderer,
                  user agent string, screen resolution, timezone, and hardware concurrency. The
                  resulting hash is stored server-side and is used solely for multi-account
                  detection. It is never sold or shared with third parties.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Usage and performance data</p>
                <p>
                  We record first-party page views on our own servers (path, timestamp, and an
                  anonymous browser cookie id) for aggregate traffic dashboards visible to
                  administrators only; these records expire automatically after a limited retention
                  period.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Error data</p>
                <p>
                  Sentry collects error reports when something goes wrong, including browser
                  information and stack traces. This helps us identify and fix bugs.
                </p>
              </div>
            </div>
          </section>

          <section id="cookies">
            <h2 className="text-lg font-bold mb-3">3. Cookies</h2>
            <div className="space-y-3 text-sm text-muted leading-relaxed">
              <div>
                <p className="font-semibold text-foreground mb-1">Authentication cookie</p>
                <p>
                  We set an HTTP-only JWT cookie when you log in. This cookie is required for
                  authentication and cannot be read by client-side scripts. It expires after a
                  period of inactivity.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Anonymous traffic cookie</p>
                <p>
                  We may set an HTTP-only cookie named{" "}
                  <code className="rounded bg-card-elevated px-1 py-0.5 font-mono text-xs">
                    __ahd_track
                  </code>{" "}
                  with a random identifier. It is used for duplicate-account signals and aggregate
                  first-party traffic statistics. It is not readable by client-side scripts.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">
                  Consent and advertising preferences
                </p>
                <p>
                  When required for visitors in regulated regions, we use Google&apos;s Privacy
                  &amp; Messaging consent platform to present advertising and analytics choices. On
                  pages where that message is active, you can reopen it from the footer&apos;s{" "}
                  <span className="font-semibold text-foreground">
                    Privacy &amp; cookie settings
                  </span>{" "}
                  link to review or revoke your choices.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">
                  Third-party advertising cookies
                </p>
                <p>
                  Google and other third-party vendors use cookies to serve ads based on a
                  user&apos;s prior visits to this and other websites. See section 6 below for how
                  to opt out.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Display preference cookie</p>
                <p>
                  We store your UI layout preference in a cookie named{" "}
                  <code className="rounded bg-card-elevated px-1 py-0.5 font-mono text-xs">
                    ahd-display-mode
                  </code>
                  . This contains no personal data.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">4. How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted leading-relaxed">
              <li>To create and operate your account and in-game character</li>
              <li>To run and simulate the game world</li>
              <li>To detect and prevent multi-account abuse using browser fingerprinting</li>
              <li>
                To display advertisements, including player-run banners and ads served by Google
              </li>
              <li>To monitor site performance and diagnose errors</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">5. Third-Party Services</h2>
            <p className="text-sm text-muted leading-relaxed mb-4">
              We use the following third-party services. Each has its own privacy policy.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-card-border">
                    <th className="py-2 pr-4 text-left font-semibold text-foreground">Service</th>
                    <th className="py-2 pr-4 text-left font-semibold text-foreground">Purpose</th>
                    <th className="py-2 text-left font-semibold text-foreground">Privacy policy</th>
                  </tr>
                </thead>
                <tbody className="text-muted divide-y divide-card-border/40">
                  {[
                    {
                      name: "Sentry",
                      purpose: "Error tracking",
                      url: "https://sentry.io/privacy/",
                      label: "sentry.io/privacy",
                    },
                    {
                      name: "Discord OAuth",
                      purpose: "Optional sign-in",
                      url: "https://discord.com/privacy",
                      label: "discord.com/privacy",
                    },
                    {
                      name: "Google AdSense",
                      purpose: "Advertising; uses cookies based on your prior visits",
                      url: "https://policies.google.com/technologies/ads",
                      label: "policies.google.com/technologies/ads",
                    },
                    {
                      name: "Google Privacy & Messaging",
                      purpose: "Consent collection and revocation where required",
                      url: "https://support.google.com/adsense/answer/10924669",
                      label: "support.google.com/adsense/privacy-messaging",
                    },
                    {
                      name: "Google Analytics",
                      purpose: "Traffic and product analytics",
                      url: "https://policies.google.com/privacy",
                      label: "policies.google.com/privacy",
                    },
                    {
                      name: "Google reCAPTCHA",
                      purpose: "Bot/abuse protection on forms",
                      url: "https://policies.google.com/privacy",
                      label: "policies.google.com/privacy",
                    },
                    {
                      name: "Google OAuth",
                      purpose: "Optional sign-in",
                      url: "https://policies.google.com/privacy",
                      label: "policies.google.com/privacy",
                    },
                  ].map(({ name, purpose, url, label }) => (
                    <tr key={name}>
                      <td className="py-2 pr-4">{name}</td>
                      <td className="py-2 pr-4">{purpose}</td>
                      <td className="py-2">
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {label}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">6. Advertising and Personalization</h2>
            <div className="space-y-3 text-sm text-muted leading-relaxed">
              <p>
                We participate in Google AdSense. Third-party vendors, including Google, use cookies
                to serve ads based on a user&apos;s prior visits to this and other websites.
                Google&apos;s use of advertising cookies — including the DoubleClick (DART) cookie —
                enables it and its partners to serve ads to our users based on their visit to this
                site and/or other sites on the Internet.
              </p>
              <p>
                You can opt out of personalized advertising by visiting{" "}
                <a
                  href="https://www.google.com/settings/ads"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Google Ads Settings
                </a>
                . You can also opt out of a third-party vendor&apos;s use of cookies for
                personalized advertising by visiting{" "}
                <a
                  href="https://www.aboutads.info/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  aboutads.info
                </a>
                . For more information about how Google uses data when you use our partners&apos;
                sites or apps, see{" "}
                <a
                  href="https://policies.google.com/technologies/partner-sites"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  policies.google.com/technologies/partner-sites
                </a>
                .
              </p>
              <p>
                In addition to Google, we work with other advertising partners who may also use
                cookies to serve ads based on your prior activity. Our{" "}
                <a
                  href="/ads.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  ads.txt
                </a>{" "}
                file lists the authorized sellers of advertising on this site.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">7. Data Retention</h2>
            <p className="text-sm text-muted leading-relaxed">
              Account and gameplay data is retained for as long as your account is active. You may
              delete your account at any time from the{" "}
              <Link href="/settings" className="text-primary hover:underline">
                Settings page
              </Link>
              , which removes your account and associated character data from our systems.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">8. Children&apos;s Privacy</h2>
            <p className="text-sm text-muted leading-relaxed">
              A House Divided is not directed at children under the age of 13. We do not knowingly
              collect personal information from anyone under 13. If you believe a person under 13
              has provided us with personal information, please contact us via Discord and we will
              delete the data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">9. Your Rights</h2>
            <div className="space-y-3 text-sm text-muted leading-relaxed">
              <p>
                You may delete your account and associated data at any time via the{" "}
                <Link href="/settings" className="text-primary hover:underline">
                  Settings page
                </Link>
                . For consent choices tied to our Google consent message, use the{" "}
                <span className="font-semibold text-foreground">Privacy &amp; cookie settings</span>{" "}
                link in the site footer on pages where that message is shown. For other data access
                or deletion requests, contact us on our{" "}
                <a
                  href="https://discord.gg/DmF8zJJuqN"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Discord server
                </a>
                .
              </p>
              <p>
                <span className="font-semibold text-foreground">
                  European Economic Area, United Kingdom, and Switzerland (GDPR / UK GDPR).
                </span>{" "}
                If you are located in these regions, you have the right to access, correct, export,
                restrict the processing of, and delete your personal data, and to withdraw consent
                at any time (via the Privacy &amp; cookie settings link). Where we rely on consent —
                for example, for personalized advertising — we ask for it before the relevant
                cookies are set, using Google&apos;s certified consent management platform. You also
                have the right to lodge a complaint with your local supervisory authority.
              </p>
              <p>
                <span className="font-semibold text-foreground">
                  California residents (CCPA / CPRA).
                </span>{" "}
                You have the right to know what personal information we collect (described in
                section 2), to request its deletion, and to opt out of the &ldquo;sale&rdquo; or
                &ldquo;sharing&rdquo; of personal information as those terms are defined by
                California law. We do not sell personal information for money; third-party
                advertising cookies may constitute &ldquo;sharing,&rdquo; which you can opt out of
                via the Privacy &amp; cookie settings link or the opt-out resources in section 6. We
                do not discriminate against users who exercise these rights.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">10. Contact</h2>
            <p className="text-sm text-muted leading-relaxed">
              For privacy-related questions, email us at{" "}
              <a href="mailto:admin@ahousedividedgame.com" className="text-primary hover:underline">
                admin@ahousedividedgame.com
              </a>{" "}
              or reach us on our{" "}
              <a
                href="https://discord.gg/DmF8zJJuqN"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Discord server
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">11. Changes to This Policy</h2>
            <p className="text-sm text-muted leading-relaxed">
              We may update this Privacy Policy from time to time. The effective date at the top of
              this page will be updated to reflect any changes. Continued use of the service after
              changes are posted constitutes your acceptance of the updated policy.
            </p>
          </section>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          See also:{" "}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
        </p>
      </div>
    </div>
  );
}
