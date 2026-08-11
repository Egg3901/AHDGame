import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Terms of Service | A House Divided",
  description:
    "Terms of Service and community rules for A House Divided, including acceptable use, accounts, and conduct in the multiplayer simulation.",
  pathname: "/terms",
});

const EFFECTIVE_DATE = "April 30, 2026";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted">Effective date: {EFFECTIVE_DATE}</p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-6 sm:p-8 space-y-8">
          <section>
            <h2 className="text-lg font-bold mb-3">1. Introduction</h2>
            <p className="text-sm text-muted leading-relaxed">
              By accessing or using A House Divided (&ldquo;the Service&rdquo;) at{" "}
              <a href="https://ahousedividedgame.com" className="text-primary hover:underline">
                ahousedividedgame.com
              </a>
              , you agree to be bound by these Terms of Service. If you do not agree to these terms,
              do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">2. The Service</h2>
            <p className="text-sm text-muted leading-relaxed">
              A House Divided is a browser-based political simulation game provided for
              entertainment purposes only. Nothing in the game, on the website, or in any associated
              community constitutes legal, financial, or political advice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">3. Age Requirement</h2>
            <p className="text-sm text-muted leading-relaxed">
              A House Divided is not directed at or intended for use by children under the age of
              13. By using the Service, you represent and warrant that you are at least 13 years
              old. If you are under 13, you may not use the Service. We reserve the right to
              terminate any account we have reason to believe is held by a person under 13. Players
              under the age of majority in their jurisdiction must have permission from a parent or
              guardian.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">4. Accounts</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted leading-relaxed">
              <li>You must provide accurate and truthful information when registering.</li>
              <li>
                You are responsible for maintaining the security of your account and password.
              </li>
              <li>You may only hold one account (see Game &amp; Community Rules below).</li>
              <li>
                We reserve the right to suspend or terminate accounts that violate these terms.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">5. Game &amp; Community Rules</h2>
            <p className="text-sm text-muted leading-relaxed mb-4">
              The following rules apply in-game and in all official A House Divided Discord servers.
              Violations may result in a warning, temporary suspension, or permanent ban at admin
              discretion.
            </p>
            <div className="space-y-5 text-sm text-muted leading-relaxed">
              <div>
                <p className="font-semibold text-foreground mb-1">No multi-accounting</p>
                <p>
                  Do not create or operate more than one account. If you believe you might be
                  sharing an IP address with another player (e.g. a household member), contact an
                  admin before playing to explain the situation. Multi-accounting will result in a
                  ban.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">No exploit abuse</p>
                <p>
                  Do not intentionally use game exploits to gain an advantage. If you discover an
                  exploit, report it privately to an admin immediately. Players found abusing an
                  exploit will be banned. Knowing about an exploit and failing to report it while
                  others abuse it may also result in a ban.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">No automation</p>
                <p>Account automation (auto clickers, bots, etc.) are strictly prohibited.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Protect personal information</p>
                <p>
                  Do not share your real name, photo, location, or any other personally identifying
                  information in-game or in any official game Discord server. This rule exists to
                  protect you from doxxing and harassment. Do not attempt to identify, expose, or
                  harass other players using personal information &mdash; doing so will result in a
                  ban.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">
                  No hate speech or hateful imagery
                </p>
                <p>
                  Racism, sexism, homophobia, transphobia, antisemitism, rape jokes, and all other
                  forms of derogatory or hate speech are strictly forbidden in-game and in the
                  official Discord, including any attempt to circumvent filters using similar
                  terminology. Openly hateful ideologies &mdash; such as Nazism &mdash; are
                  forbidden. Hateful imagery, including but not limited to the swastika and the
                  Confederate battle flag, may not be used as player-uploaded profile images.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Be respectful</p>
                <p>
                  Conduct yourself respectfully in all in-game communications and the official
                  Discord. Do not harass other players through direct messages, spam discussion
                  channels, or make inappropriate personal attacks against other community members.
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Admin discretion</p>
                <p>
                  Bans and account deletions are fully at the discretion of the admin team. You may
                  make a case for yourself, but the final decision rests with the admins.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">6. Intellectual Property</h2>
            <p className="text-sm text-muted leading-relaxed">
              All game content, code, design, and assets are owned by A House Divided. You may not
              reproduce, redistribute, or create derivative works from any game content without
              prior written permission.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">7. Disclaimer of Warranties</h2>
            <p className="text-sm text-muted leading-relaxed">
              The Service is provided &ldquo;as is&rdquo; without warranty of any kind. We make no
              guarantees about uptime, data persistence, or the continuity of game state. The game
              world may change, be updated, or become temporarily unavailable without notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">8. Limitation of Liability</h2>
            <p className="text-sm text-muted leading-relaxed">
              To the fullest extent permitted by applicable law, A House Divided and its operators
              shall not be liable for any indirect, incidental, special, consequential, or punitive
              damages arising out of or related to your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">9. Governing Law</h2>
            <p className="text-sm text-muted leading-relaxed">
              These Terms of Service are governed by and construed in accordance with the laws of
              the United States, without regard to conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">10. Changes to These Terms</h2>
            <p className="text-sm text-muted leading-relaxed">
              We may update these Terms of Service at any time. Continued use of the Service after
              changes are posted constitutes your acceptance of the updated terms. The effective
              date at the top of this page reflects the date of the most recent revision.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">11. Contact</h2>
            <p className="text-sm text-muted leading-relaxed">
              For questions about these terms, email us at{" "}
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
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          By using A House Divided, you agree to these Terms of Service and our{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
