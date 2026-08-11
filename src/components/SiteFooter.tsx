"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";

// Only show the footer on long-content public pages where a footer at the
// bottom of scroll is natural. Game pages have min-h-screen containers that
// would cause the footer to float far below content if shown globally.
const FOOTER_PATH_PREFIXES = [
  "/news",
  "/elections",
  "/congress",
  "/officials",
  "/politicians",
  "/character",
  "/parties",
  "/changelog",
  "/map",
  "/world",
  "/budget",
  "/policy",
  "/corporations",
  "/whitehouse",
  "/country",
  "/state",
  "/uk",
  "/wiki",
  "/guides",
  "/privacy",
  "/terms",
  "/about",
  "/contact",
  "/faq",
  "/login",
  "/register",
];

export function SiteFooter({ displayMode }: { displayMode?: "focused" | "classic" }) {
  const pathname = usePathname();
  if (displayMode === "focused") return null;
  if (!FOOTER_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <footer className="border-t border-card-border/40 bg-card/30 pb-14">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-muted">
            A House Divided <span className="text-muted/70">|</span> Political &amp; Economic Sim
            Game
          </p>
          <a
            href="https://lakesidegames.net"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
          >
            <Image
              src="/lakeside-mark.svg"
              alt="Lakeside Games"
              width={18}
              height={18}
              className="opacity-80"
            />
            <span>a Lakeside Games game</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href="/about"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            About
          </Link>
          <Link
            href="/contact"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Contact
          </Link>
          <Link href="/faq" className="text-xs text-muted transition-colors hover:text-foreground">
            FAQ
          </Link>
          <Link
            href="/privacy"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Terms of Service
          </Link>
          <CookieSettingsLink
            hideOnPrivacyPage
            className="text-xs text-muted transition-colors hover:text-foreground"
          />
          <a
            href="https://discord.gg/DmF8zJJuqN"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Discord
          </a>
        </div>
      </div>
    </footer>
  );
}
