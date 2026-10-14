/** Button to a suggestion's post in the Discord suggestions channel. */
export function DiscordDiscussLink({ href, compact }: { href: string; compact?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Discuss on Discord"
      className={
        compact
          ? "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[#8b94f7] transition-colors hover:bg-[#5865F2]/15 hover:text-[#aab1ff]"
          : "inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#5865F2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#4752c4]"
      }
    >
      <svg
        className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.7 13.7 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.5 0 12.6 12.6 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.93 1.52C.6 9.06-.25 13.62.17 18.12a19.9 19.9 0 0 0 6.04 3.03 14.7 14.7 0 0 0 1.29-2.1 12.9 12.9 0 0 1-2.03-.97l.5-.39a14.2 14.2 0 0 0 12.07 0l.5.39c-.65.38-1.33.71-2.04.98a14.5 14.5 0 0 0 1.3 2.09 19.8 19.8 0 0 0 6.04-3.03c.5-5.22-.84-9.74-3.52-13.75ZM8.02 15.33c-1.18 0-2.15-1.08-2.15-2.42s.95-2.42 2.15-2.42 2.17 1.09 2.15 2.42c0 1.34-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.42s.95-2.42 2.15-2.42 2.17 1.09 2.15 2.42c0 1.34-.94 2.42-2.15 2.42Z" />
      </svg>
      {compact ? "Discord" : "Discuss on Discord"}
    </a>
  );
}
