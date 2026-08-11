import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { AdSenseUnit } from "@/components/AdSenseUnit";

export const metadata: Metadata = publicPageMetadata({
  title: "About | A House Divided",
  description:
    "Learn about A House Divided, a real-time multiplayer political and economic simulation set in the US, UK, Germany, and Japan: elections, legislation, parties, corporations, and markets on an hourly clock with no seasonal resets.",
  pathname: "/about",
});

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">About A House Divided</h1>
          <p className="mt-2 text-sm text-muted">
            A real-time multiplayer political and economic simulation
          </p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-6 sm:p-8 space-y-8">
          <section>
            <h2 className="text-lg font-bold mb-3">What is A House Divided?</h2>
            <p className="text-sm text-muted leading-relaxed">
              A House Divided is a browser-based political and economic simulation game where
              players create politicians, run for elected office, propose and vote on legislation,
              manage campaign strategies, and shape the political landscape of simulated countries.
              The game runs continuously in real time: one real hour equals one game week, so the
              world keeps moving whether you&apos;re logged in or not.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">How it works</h2>
            <div className="space-y-3 text-sm text-muted leading-relaxed">
              <p>
                Players register an account and create a politician character with a party
                affiliation, home state, and policy positions. From there, they can run in elections
                for seats in Congress, state legislatures, governorships, and executive offices like
                the Presidency.
              </p>
              <p>
                The game simulates a full political ecosystem: parties organize, coalitions form,
                bills move through legislatures, and demographic groups respond to policy decisions
                over time. Non-player politicians (NPPs) fill empty seats and vote autonomously
                based on their ideology, ensuring the simulation stays active even when human
                players are offline.
              </p>
              <p>
                Currently simulated countries include the{" "}
                <Link href="/country/us" className="text-primary hover:underline">
                  United States
                </Link>
                ,{" "}
                <Link href="/country/uk" className="text-primary hover:underline">
                  United Kingdom
                </Link>
                , and{" "}
                <Link href="/country/jp" className="text-primary hover:underline">
                  Japan
                </Link>
                .
              </p>
            </div>
          </section>

          <AdSenseUnit
            slot="ahd-about-inarticle"
            format="auto"
            className="min-h-[280px] sm:min-h-[90px] my-6"
          />

          <section>
            <h2 className="text-lg font-bold mb-3">Who runs it?</h2>
            <p className="text-sm text-muted leading-relaxed">
              A House Divided is an independent project maintained by a small admin team. The game
              has no affiliation with any real political party, government, or organization. It is
              provided purely for entertainment purposes.
            </p>
            <a
              href="https://lakesidegames.net"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              <Image
                src="/lakeside-mark.svg"
                alt="Lakeside Games"
                width={20}
                height={20}
                className="opacity-80"
              />
              <span>a Lakeside Games game</span>
            </a>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Get involved</h2>
            <div className="space-y-2 text-sm text-muted leading-relaxed">
              <p>
                The best way to get involved is to{" "}
                <Link href="/register" className="text-primary hover:underline">
                  create an account
                </Link>{" "}
                and jump in. Our{" "}
                <Link
                  href="https://wiki.ahousedividedgame.com/getting-started"
                  className="text-primary hover:underline"
                >
                  new player guide
                </Link>{" "}
                walks you through the basics.
              </p>
              <p>
                For community discussion, announcements, and support, join our{" "}
                <a
                  href="https://discord.gg/DmF8zJJuqN"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Discord server
                </a>
                . You can also reach us by email at{" "}
                <a
                  href="mailto:admin@ahousedividedgame.com"
                  className="text-primary hover:underline"
                >
                  admin@ahousedividedgame.com
                </a>
                .
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Credits &amp; attributions</h2>
            <div className="space-y-3 text-sm text-muted leading-relaxed">
              <p>
                A House Divided is built on open-source software and uses a number of third-party
                assets. We gratefully acknowledge the following:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Country flags are served via{" "}
                  <a
                    href="https://flagcdn.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    flagcdn.com
                  </a>{" "}
                  (free for any use).
                </li>
                <li>
                  Select photography is provided by{" "}
                  <a
                    href="https://unsplash.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Unsplash
                  </a>{" "}
                  contributors under the Unsplash License.
                </li>
                <li>
                  Some imagery is sourced from{" "}
                  <a
                    href="https://commons.wikimedia.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Wikimedia Commons
                  </a>{" "}
                  under its respective Creative Commons or public-domain licenses.
                </li>
                <li>
                  Typefaces: Geist and Geist Mono by{" "}
                  <a
                    href="https://vercel.com/font"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Vercel
                  </a>
                  , and Lora by Cyreal, both distributed under the SIL Open Font License.
                </li>
                <li>Built with Next.js, React, Tailwind CSS, and MongoDB. Hosted on Vercel.</li>
              </ul>
              <p>
                If you believe an asset on this site is used incorrectly, please{" "}
                <Link href="/contact" className="text-primary hover:underline">
                  contact us
                </Link>{" "}
                and we will correct or remove it promptly.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Explore the simulation</h2>
            <div className="flex flex-wrap gap-3">
              {[
                { href: "/country/us/elections", label: "Elections" },
                { href: "/country/us/politicians", label: "Politicians" },
                { href: "/country/us/legislature", label: "Congress" },
                { href: "/country/us/parties", label: "Parties" },
                { href: "/news", label: "News" },
                { href: "/wiki", label: "Wiki" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {label}
                </Link>
              ))}
            </div>
          </section>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>{" "}
          &middot;{" "}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>{" "}
          &middot;{" "}
          <Link href="/contact" className="text-primary hover:underline">
            Contact
          </Link>
        </p>
      </div>
    </div>
  );
}
