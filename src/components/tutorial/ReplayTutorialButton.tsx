import Link from "next/link";

/**
 * Entry point to the tutorial hub. Rendered on the profile page.
 *
 * This used to fire the coach's replay event directly, which always restarted
 * the whole tour. The hub lets the player pick a single chapter, change what
 * they asked to be shown, or resume where they left off, so linking there is
 * strictly more useful than one button that only does one of those.
 */
export function ReplayTutorialButton({ className }: { className?: string }) {
  return (
    <Link
      href="/tutorial"
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card/50 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/50"
      }
    >
      <span aria-hidden>🎓</span>
      Tutorial
    </Link>
  );
}
