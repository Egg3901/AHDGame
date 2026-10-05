import Link from "next/link";
import { ERROR_CATALOG } from "@/lib/errors/catalog";

const DESTINATIONS = [
  { href: "/elections", label: "Elections" },
  { href: "/congress", label: "Congress" },
  { href: "/politicians", label: "Politicians" },
  { href: "/parties", label: "Parties" },
];

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full space-y-5 text-center">
        <p className="text-6xl font-black tabular-nums text-foreground">404</p>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-foreground">Page not found</h1>
          <p className="text-sm text-muted">{ERROR_CATALOG.PAGE_NOT_FOUND.message}</p>
          <p className="font-mono text-xs text-muted" data-testid="error-code">
            PAGE_NOT_FOUND
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Home
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-card-border px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-card-elevated transition-colors"
          >
            Dashboard
          </Link>
        </div>
        <nav
          aria-label="Popular destinations"
          className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm"
        >
          {DESTINATIONS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="text-muted hover:text-foreground transition-colors"
            >
              {d.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
