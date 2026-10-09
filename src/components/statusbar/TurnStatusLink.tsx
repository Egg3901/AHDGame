import type { ReactNode } from "react";
import { TURN_STATUS_URL } from "@/lib/constants/statusPage";

export const TURN_STATUS_LINK_LABEL = "Turn status, opens in a new tab";

/**
 * Wraps the turn timer or turn processing indicator in a link to the public
 * turn status page. When disabled (singleplayer, where there is no hosted
 * turn schedule) the children render unchanged with no wrapper.
 */
export function TurnStatusLink({
  enabled,
  className = "",
  children,
}: {
  enabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <a
      href={TURN_STATUS_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={TURN_STATUS_LINK_LABEL}
      title="Turn status"
      className={`rounded-md text-inherit no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${className}`.trim()}
    >
      {children}
    </a>
  );
}
