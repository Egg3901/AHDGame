/**
 * Shared types for the registration / character-creation surface.
 *
 * Lives in src/lib so both API routes and UI components can import it without
 * the UI reaching into route files (which the architecture audit blocks under
 * "app/components importing API route modules").
 */

export type CountryCreationInfo = {
  id: string;
  name: string;
  flagUrl: string;
  desc: string;
  playerCount: number;
  governmentType: string;
};
