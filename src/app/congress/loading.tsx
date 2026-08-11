import { LegislatureSkeleton } from "@/app/country/[code]/legislature/LegislatureSkeleton";

/**
 * /congress server-redirects to country/[code]/legislature. Render the shared
 * legislature skeleton so the flash during the redirect already matches the
 * destination layout instead of a generic card shell.
 */
export default function CongressLoading() {
  return <LegislatureSkeleton />;
}
