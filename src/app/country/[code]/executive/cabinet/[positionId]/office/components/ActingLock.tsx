"use client";

/**
 * Compatibility hooks for cabinet controls that accept acting-scope metadata.
 * The current authority policy has no acting-only restrictions, including when
 * a cached briefing still lists the former scopes. The provider and props stay
 * compatible with existing office panels; holder permissions remain separate.
 */

import { createContext, useContext } from "react";
import { barredScopeMessage, type CabinetLeverScope } from "@/lib/cabinet/actingScope";

export type ActingMemberSlice = {
  acting?: boolean;
  barredScopes?: CabinetLeverScope[];
} | null;

const ActingLockContext = createContext<ActingMemberSlice>(null);

/**
 * Publish the seated holder's restrictions to every control in the office.
 *
 * Defaults to unrestricted when absent, so a subtree rendered outside a provider
 * (a test, a storybook) behaves exactly as it did before this shipped.
 */
export function ActingLockProvider({
  member,
  children,
}: {
  member: ActingMemberSlice;
  children: React.ReactNode;
}) {
  return <ActingLockContext.Provider value={member}>{children}</ActingLockContext.Provider>;
}

/**
 * Resolve a scope to the reason it is locked, or `null` when it is open.
 *
 * The pure form, for callers that already hold the member. The office page
 * resolves its own locks this way before the provider is even mounted.
 */
export function actingLock(member: ActingMemberSlice, scope: CabinetLeverScope): string | null {
  if (!member?.barredScopes?.includes(scope)) return null;
  return barredScopeMessage(scope);
}

/**
 * The hook form, for a control deep in the tree:
 *
 *     const lock = useActingLock("assets");
 *     <Button disabled={!!lock} …/>
 *     <ActingLockNote reason={lock} />
 */
export function useActingLock(scope: CabinetLeverScope): string | null {
  return actingLock(useContext(ActingLockContext), scope);
}

/**
 * The line explaining a locked control, sat next to the control it explains.
 *
 * Renders nothing when `reason` is null, so a caller can drop it in
 * unconditionally and let the lock decide.
 */
export function ActingLockNote({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p className="mt-2 flex items-start gap-2 text-xs text-muted" role="note">
      <svg
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gov-soft"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 1 1 6 0v3H9V7z" />
      </svg>
      <span>{reason}</span>
    </p>
  );
}
