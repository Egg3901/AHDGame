import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Contact | A House Divided",
  description:
    "Contact the A House Divided team by email or Discord for support, bug reports, or general questions about the political and economic simulation.",
  pathname: "/contact",
});

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Contact Us</h1>
          <p className="mt-2 text-sm text-muted">
            We&apos;re a small team — here&apos;s how to reach us.
          </p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-6 sm:p-8 space-y-8">
          <section>
            <h2 className="text-lg font-bold mb-3">Email</h2>
            <p className="text-sm text-muted leading-relaxed">
              For account issues, privacy requests, bug reports, or general enquiries, email us at
              the address below. Include your in-game username and, for bug reports, the page you
              were on and roughly when it happened — it makes tracking things down much faster. We
              aim to reply within a few days; account-security and privacy requests are prioritised.
            </p>
            <a
              href="mailto:admin@ahousedividedgame.com"
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-card-border bg-card-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
            >
              <svg
                className="h-4 w-4 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              admin@ahousedividedgame.com
            </a>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Discord</h2>
            <p className="text-sm text-muted leading-relaxed mb-3">
              Our Discord server is the fastest way to get help, report bugs, give feedback, or just
              talk politics. The admin team is active there daily.
            </p>
            <a
              href="https://discord.gg/DmF8zJJuqN"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-card-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
            >
              <svg className="h-4 w-4 text-muted" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Join our Discord
            </a>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">In-game bug reports</h2>
            <p className="text-sm text-muted leading-relaxed">
              If you&apos;re logged in, use the <strong className="text-foreground">Help</strong>{" "}
              menu in the top navigation bar and select{" "}
              <strong className="text-foreground">Report bug / Suggest</strong>. This captures a
              screenshot automatically and sends it to the team.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Press &amp; partnerships</h2>
            <p className="text-sm text-muted leading-relaxed">
              Writing about the game, interested in a community collaboration, or running a
              politics/strategy community that wants to get involved? Email us with a short
              description of what you have in mind and we&apos;ll get back to you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Privacy &amp; legal</h2>
            <p className="text-sm text-muted leading-relaxed">
              For data access or deletion requests, see our{" "}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              . For questions about rules and conduct, see our{" "}
              <Link href="/terms" className="text-primary hover:underline">
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
