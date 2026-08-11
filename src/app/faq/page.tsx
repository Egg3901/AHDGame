import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { AdSenseUnit } from "@/components/AdSenseUnit";

export const metadata: Metadata = publicPageMetadata({
  title: "FAQ | A House Divided",
  description:
    "Frequently asked questions about A House Divided: gameplay, accounts, elections, corporations, investing, and technical support.",
  pathname: "/faq",
});

interface FAQItem {
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    question: "What is A House Divided?",
    answer:
      "A House Divided is a persistent multiplayer political and economic simulation. Players create characters, run for office, draft legislation, found corporations, trade stocks and forex, and shape the simulated United States, United Kingdom, Germany, and Japan. One real hour equals one simulated political week.",
  },
  {
    question: "Do I need to know real-world politics to play?",
    answer:
      "No. The game uses simplified mechanics inspired by real systems, but you learn as you go. The wiki and guides explain everything from filing candidacy to corporate bond issuance. Many successful players started with no political background.",
  },
  {
    question: "Is the game free?",
    answer:
      "Yes. A House Divided is free to play. Optional cosmetic purchases (profile borders, tints) support server costs. There are no pay-to-win mechanics. Every in-game advantage is earned through strategy and time investment.",
  },
  {
    question: "How do I create a character?",
    answer:
      "Register an account, then choose a name and country (US, UK, Germany, or Japan). Each country has its own legislature, election cycle, and economic rules. You can create multiple characters across different countries.",
  },
  {
    question: "How do elections work?",
    answer:
      "Players declare candidacy during a nomination window, campaign to raise Political Influence (PI), and compete in a primary followed by a general election. The vote formula rewards PI, favorability, and campaign upgrades. See the Running for Office guide for the full breakdown.",
  },
  {
    question: "Can I run a business in the game?",
    answer:
      "Yes. You can found a corporation in any of 12 sectors, produce and trade commodities, issue shares and bonds, and compete for market share. Corporations operate independently of political careers, so you can be both a legislator and a CEO.",
  },
  {
    question: "What is the hourly turn system?",
    answer:
      "The game advances every real hour. Each turn updates the simulation: elections progress, bills move through committees, commodity prices shift, forex rates adjust, and corporate financials update. You submit actions anytime, and they resolve on the next turn.",
  },
  {
    question: "How does the stock market work?",
    answer:
      "Publicly traded corporations issue shares with prices driven by supply, demand, dividends, and sector performance. Players buy and sell shares through the exchange. Bond markets and forex trading are also available for advanced players.",
  },
  {
    question: "What countries are available?",
    answer:
      "Currently the United States, United Kingdom, Germany, and Japan. Each has unique legislative structures, election timings, and economic starting conditions. More countries are planned for future releases.",
  },
  {
    question: "How do I report a bug or suggest a feature?",
    answer:
      "Join our Discord server (linked in the footer) and use the #bugs or #suggestions channels. You can also email admin@ahousedividedgame.com. We review every report and prioritize based on impact and player votes.",
  },
  {
    question: "Is there a mobile app?",
    answer:
      "Not yet. The web app is responsive and works well on mobile browsers. A native app is on the long-term roadmap but not currently in active development.",
  },
  {
    question: "What happens to my data if I stop playing?",
    answer:
      "Your account and characters remain indefinitely. Inactive characters may lose eligibility for certain active roles (e.g., elected office), but your assets, shares, and history are preserved. You can resume anytime.",
  },
];

export default function FAQPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Frequently Asked Questions</h1>
          <p className="mt-2 text-sm text-muted">
            Common questions about gameplay, accounts, and technical support.
          </p>
        </div>

        <AdSenseUnit
          slot="ahd-faq-top"
          format="auto"
          className="min-h-[280px] sm:min-h-[90px] mb-8"
        />

        <div className="space-y-6">
          {FAQS.map((faq, i) => (
            <details
              key={i}
              className="group rounded-xl border border-card-border bg-card p-5 open:bg-card-elevated/30"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-semibold text-foreground list-none">
                <span>{faq.question}</span>
                <span className="shrink-0 text-muted transition-transform group-open:rotate-180">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted leading-relaxed">{faq.answer}</p>
            </details>
          ))}
        </div>

        <AdSenseUnit
          slot="ahd-faq-bottom"
          format="auto"
          className="min-h-[280px] sm:min-h-[90px] mt-8"
        />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </div>
  );
}
