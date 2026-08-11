/**
 * Negative margin for profile / character hero: pull the identity row up by half the
 * `ProfilePictureUpload` `hero` avatar height at each breakpoint so the banner fold
 * crosses the avatar center (classic overlap, without absolute positioning).
 */
export const PROFILE_HERO_OVERLAP_CLASSES =
  "-mt-12 sm:-mt-[4.5rem] md:-mt-20 lg:-mt-[5.5rem]" as const;
