/**
 * Shared class strings for the profile pages, so the own profile and the
 * public profile render their controls and columns the same way.
 */

/** Neutral bordered button for secondary actions such as share and edit. */
export const PROFILE_BUTTON_CLASS =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-card-border px-3 text-body-sm font-medium text-foreground transition-colors hover:bg-card-elevated disabled:opacity-50";

/** Neutral text link with a quiet underline, for navigation inside a section. */
export const PROFILE_LINK_CLASS =
  "font-medium text-foreground underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";

/** Page width shared by the header band and the body below it. */
export const PROFILE_CONTAINER_CLASS = "mx-auto max-w-7xl px-4 sm:px-6";

/** Body grid: a main column of about two thirds and an aside, 48px apart. */
export const PROFILE_GRID_CLASS = "grid max-w-full gap-x-12 gap-y-12 lg:grid-cols-3";

/**
 * The main column's width outside the grid, for content that must line up
 * with it: two of three columns plus one gap, with the gap at 3rem as above.
 */
export const PROFILE_MAIN_WIDTH_CLASS = "lg:w-[calc((200%_-_3rem)/3)]";

/** Main column: the primary blocks, 48px between sections. */
export const PROFILE_MAIN_COLUMN_CLASS = "min-w-0 space-y-12 lg:col-span-2";

/** Aside column: secondary sections with smaller headings and body text. */
export const PROFILE_ASIDE_COLUMN_CLASS = "min-w-0 space-y-10";
