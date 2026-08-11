"use client";

import { useAuthMe } from "@/contexts/AuthDataContext";

interface UserData {
  username: string;
  isAdmin: boolean;
}

interface HomeState {
  id: string;
  name: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawUser = Record<string, any>;

interface UseUserDataResult {
  userData: UserData | null;
  /** Full /api/auth/me user object — avoids re-fetching for pages that need extra fields */
  rawUser: RawUser | null;
  hasCharacter: boolean;
  homeState: HomeState | null;
  loading: boolean;
  /** Non-null when the shared auth fetch hit a transient failure (429, 5xx, network). */
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for fetching and managing user authentication data.
 * Reads from the shared AuthDataContext — no extra network request.
 */
export function useUserData(): UseUserDataResult {
  const { user, loading, authFetchError, refetch } = useAuthMe();

  const userData: UserData | null = user
    ? { username: user.username, isAdmin: user.isAdmin }
    : null;

  const homeState: HomeState | null =
    user?.character?.homeState && user?.character?.homeStateName
      ? { id: user.character.homeState, name: user.character.homeStateName }
      : null;

  return {
    userData,
    rawUser: user,
    hasCharacter: user?.hasCharacter ?? false,
    homeState,
    loading,
    error: authFetchError === "none" ? null : authFetchError,
    refetch: async () => {
      refetch(true);
    },
  };
}
