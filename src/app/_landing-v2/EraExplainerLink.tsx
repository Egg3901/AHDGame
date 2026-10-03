import type { EraConfig } from "@/components/landing/eraThemes";

const TONE_CLASSES = {
  // The broadcast hero sits on the always-dark satellite backdrop, like its dek.
  onDark: "text-white/80 decoration-white/30 hover:text-white hover:decoration-white/70",
  theme:
    "text-foreground/80 decoration-foreground/30 hover:text-foreground hover:decoration-foreground/70",
} as const;

/**
 * A quiet text link under the hero copy to the era's explainer page on the
 * studio site. It leaves ahousedividedgame.com, so it opens in a new tab, the
 * same rule `publicLinks.ts` applies to the drawer and footer.
 */
export function EraExplainerLink({
  explainer,
  tone = "theme",
}: {
  explainer: EraConfig["explainer"];
  tone?: keyof typeof TONE_CLASSES;
}) {
  if (!explainer) return null;
  return (
    <a
      href={explainer.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`pointer-events-auto mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 transition-colors ${TONE_CLASSES[tone]}`}
    >
      {explainer.label}
      <span aria-hidden="true">→</span>
    </a>
  );
}
