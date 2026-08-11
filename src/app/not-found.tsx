import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        {/* Main 404 card */}
        <div className="rounded-xl border border-card-border bg-card p-8 sm:p-10 text-center space-y-6">
          {/* 404 Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-3">
              <div className="h-px flex-1 bg-card-border" />
              <h1 className="text-6xl sm:text-7xl font-black tabular-nums text-foreground">404</h1>
              <div className="h-px flex-1 bg-card-border" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">Page Not Found</h2>
          </div>

          {/* Political flavor text */}
          <div className="space-y-3">
            <p className="text-sm text-muted max-w-md mx-auto">
              This page has been <span className="font-semibold text-foreground">impeached</span>,{" "}
              <span className="font-semibold text-foreground">filibustered</span>, or simply{" "}
              <span className="font-semibold text-foreground">never existed</span>.
            </p>
            <p className="text-xs text-muted/70">
              The congressional record shows no evidence of this URL.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link
              href="/"
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Return Home
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-card-border bg-card-elevated px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-background transition-colors"
            >
              Dashboard
            </Link>
          </div>
        </div>

        {/* Quick navigation */}
        <div className="mt-6 rounded-xl border border-card-border bg-card p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-4">
            Popular Destinations
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link
              href="/elections"
              className="group rounded-lg border border-card-border bg-card-elevated p-3 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <div className="text-2xl mb-1" role="img" aria-label="Ballot box">
                🗳️
              </div>
              <div className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">
                Elections
              </div>
            </Link>
            <Link
              href="/congress"
              className="group rounded-lg border border-card-border bg-card-elevated p-3 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <div className="text-2xl mb-1" role="img" aria-label="Legislature">
                🏛️
              </div>
              <div className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">
                Congress
              </div>
            </Link>
            <Link
              href="/politicians"
              className="group rounded-lg border border-card-border bg-card-elevated p-3 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <div className="text-2xl mb-1" role="img" aria-label="Politicians">
                👔
              </div>
              <div className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">
                Politicians
              </div>
            </Link>
            <Link
              href="/parties"
              className="group rounded-lg border border-card-border bg-card-elevated p-3 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <div className="text-2xl mb-1" role="img" aria-label="Parties">
                🎭
              </div>
              <div className="text-xs font-medium text-muted group-hover:text-foreground transition-colors">
                Parties
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
