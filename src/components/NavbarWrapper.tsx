"use client";

import { useReducer, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { usePathname, useRouter } from "next/navigation";
import type { CountryId } from "@/lib/constants/countries";
import { useToast } from "@/contexts/ToastContext";
import { useCharacterStats } from "@/contexts/CharacterStatsContext";
import { ACTION_CAP, ACTION_HOARDING_THRESHOLD } from "@/lib/actions/recommendationsConstants";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { buildClientStatusUrl } from "@/lib/statusBar/clientStatusRequest";
import { Navbar } from "./Navbar";
import { ExperimentalNavbar } from "./ExperimentalNavbar";
import { NavbarTopFlair } from "./NavbarTopFlair";
import { FeedbackModal } from "./FeedbackModal";
import { isLightweightLayoutPath } from "@/lib/constants/layoutPaths";

const EXCLUDED_PATHS = ["/login", "/register", "/banned", "/maintenance"];
const ALLOWED_WITHOUT_CHARACTER = [
  "/settings",
  "/create-character",
  "/profile",
  "/help",
  "/guides",
  "/feedback",
  "/admin",
  // A logged-in, characterless user who clicks "Just want to explore first?"
  // on /register should land on the world map, not get force-redirected to
  // /settings by the effect below.
  "/world",
];

interface AdminCharacter {
  id: string;
  name: string;
  countryId: string;
  party: string | null;
  isActive: boolean;
}

interface ImperialCharacterNav {
  id: string;
  name: string;
  countryId: string;
  royalHouse: string;
}

interface NavbarWrapperState {
  feedbackOpen: boolean;
  screenshotDataUrl: string | null;
  capturingFeedback: boolean;
  screenshotCaptureFailed: boolean;
  user: {
    username: string;
    isAdmin?: boolean;
    isModerator?: boolean;
    canSeeCampaignManager?: boolean;
    patreonTier?: string | null;
    isPatronActive?: boolean;
  } | null;
  hasCharacter: boolean;
  homeState: { id: string; name: string; countryId: string } | null;
  currentParty: { id: string; name: string; countryId: string } | null;
  activeElection: { id: string; seatId?: string; label: string } | null;
  cabinetOffice: { positionId: string; positionName: string; countryCode: string } | null;
  governorOffice: { stateId: string; stateName: string; countryCode: string } | null;
  activePresidentElectionId: string | null;
  activePresidentElectionSeatId: string | null;
  unreadCount: number;
  myCorporationId: number | null;
  myUnionId: string | null;
  isLoading: boolean;
  adminCharacters: AdminCharacter[] | null;
  imperialCharacter: ImperialCharacterNav | null;
  isImperialMode: boolean;
  wikiDisabled: boolean;
  conflictsEnabled: boolean;
  unionsEnabled: boolean;
  settlementCrisisEnabled: boolean;
}

type NavbarWrapperAction =
  | {
      type: "SET_USER_DATA";
      user: NavbarWrapperState["user"];
      hasCharacter: boolean;
      unreadCount: number;
      myCorporationId: number | null;
      myUnionId: string | null;
      homeState: NavbarWrapperState["homeState"];
      currentParty: NavbarWrapperState["currentParty"];
      adminCharacters: NavbarWrapperState["adminCharacters"];
      imperialCharacter: NavbarWrapperState["imperialCharacter"];
      isImperialMode: boolean;
    }
  | { type: "SET_ACTIVE_ELECTION"; activeElection: NavbarWrapperState["activeElection"] }
  | { type: "SET_CABINET_OFFICE"; cabinetOffice: NavbarWrapperState["cabinetOffice"] }
  | { type: "SET_GOVERNOR_OFFICE"; governorOffice: NavbarWrapperState["governorOffice"] }
  | { type: "SET_ACTIVE_PRESIDENT_ELECTION_ID"; id: string | null; seatId: string | null }
  | { type: "SET_WIKI_DISABLED"; wikiDisabled: boolean }
  | { type: "SET_CONFLICTS_ENABLED"; conflictsEnabled: boolean }
  | { type: "SET_SETTLEMENT_CRISIS_ENABLED"; settlementCrisisEnabled: boolean }
  | { type: "SET_UNIONS_ENABLED"; unionsEnabled: boolean }
  | { type: "CLEAR_ALL" }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "OPEN_FEEDBACK"; screenshotDataUrl: string | null; screenshotCaptureFailed: boolean }
  | { type: "CLOSE_FEEDBACK" }
  | { type: "SET_CAPTURING_FEEDBACK"; capturingFeedback: boolean }
  | { type: "SKIP_SCREENSHOT_OPEN_FEEDBACK" };

const initialState: NavbarWrapperState = {
  feedbackOpen: false,
  screenshotDataUrl: null,
  capturingFeedback: false,
  screenshotCaptureFailed: false,
  user: null,
  hasCharacter: false,
  homeState: null,
  currentParty: null,
  activeElection: null,
  cabinetOffice: null,
  governorOffice: null,
  activePresidentElectionId: null,
  activePresidentElectionSeatId: null,
  unreadCount: 0,
  myCorporationId: null,
  myUnionId: null,
  isLoading: true,
  adminCharacters: null,
  imperialCharacter: null,
  isImperialMode: false,
  wikiDisabled: false,
  conflictsEnabled: false,
  unionsEnabled: false,
  settlementCrisisEnabled: false,
};

function navbarWrapperReducer(
  state: NavbarWrapperState,
  action: NavbarWrapperAction
): NavbarWrapperState {
  switch (action.type) {
    case "SET_USER_DATA":
      return {
        ...state,
        user: action.user,
        hasCharacter: action.hasCharacter,
        unreadCount: action.unreadCount,
        myCorporationId: action.myCorporationId,
        myUnionId: action.myUnionId,
        homeState: action.homeState,
        currentParty: action.currentParty,
        adminCharacters: action.adminCharacters,
        imperialCharacter: action.imperialCharacter,
        isImperialMode: action.isImperialMode,
      };
    case "SET_ACTIVE_ELECTION":
      return { ...state, activeElection: action.activeElection };
    case "SET_CABINET_OFFICE":
      return { ...state, cabinetOffice: action.cabinetOffice };
    case "SET_GOVERNOR_OFFICE":
      return { ...state, governorOffice: action.governorOffice };
    case "SET_ACTIVE_PRESIDENT_ELECTION_ID":
      return {
        ...state,
        activePresidentElectionId: action.id,
        activePresidentElectionSeatId: action.seatId,
      };
    case "SET_WIKI_DISABLED":
      return { ...state, wikiDisabled: action.wikiDisabled };
    case "SET_CONFLICTS_ENABLED":
      return { ...state, conflictsEnabled: action.conflictsEnabled };
    case "SET_SETTLEMENT_CRISIS_ENABLED":
      return { ...state, settlementCrisisEnabled: action.settlementCrisisEnabled };
    case "SET_UNIONS_ENABLED":
      return { ...state, unionsEnabled: action.unionsEnabled };
    case "CLEAR_ALL":
      return {
        ...state,
        user: null,
        hasCharacter: false,
        homeState: null,
        currentParty: null,
        activeElection: null,
        cabinetOffice: null,
        governorOffice: null,
        activePresidentElectionId: null,
        activePresidentElectionSeatId: null,
        unreadCount: 0,
        myCorporationId: null,
        myUnionId: null,
        adminCharacters: null,
        imperialCharacter: null,
        isImperialMode: false,
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "OPEN_FEEDBACK":
      return {
        ...state,
        feedbackOpen: true,
        capturingFeedback: false,
        screenshotDataUrl: action.screenshotDataUrl,
        screenshotCaptureFailed: action.screenshotCaptureFailed,
      };
    case "CLOSE_FEEDBACK":
      return {
        ...state,
        feedbackOpen: false,
        screenshotDataUrl: null,
        screenshotCaptureFailed: false,
      };
    case "SET_CAPTURING_FEEDBACK":
      return {
        ...state,
        capturingFeedback: action.capturingFeedback,
        screenshotCaptureFailed: false,
      };
    case "SKIP_SCREENSHOT_OPEN_FEEDBACK":
      return {
        ...state,
        screenshotDataUrl: null,
        screenshotCaptureFailed: true,
        feedbackOpen: true,
      };
    default:
      return state;
  }
}

export function NavbarWrapper({
  displayMode,
  initialPageCountry,
}: {
  displayMode?: "focused" | "classic";
  initialPageCountry?: CountryId | null;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const useLightweightNav = isLightweightLayoutPath(pathname);
  const isExcludedPath = EXCLUDED_PATHS.includes(pathname);
  const router = useRouter();
  const { showToast } = useToast();
  const { setStats: setCharacterStats } = useCharacterStats();
  const { navData, loading: authBootstrapLoading } = useAuthMe();
  const demographicsToastShown = useRef(false);
  const statusLoadedRef = useRef(false);
  const [state, dispatch] = useReducer(navbarWrapperReducer, initialState);

  const fetchStatusData = useCallback(
    async (layout: string | null | undefined, retryCount = 0) => {
      let shouldRetry = false;
      try {
        const res = await fetch(buildClientStatusUrl(layout), {
          signal: AbortSignal.timeout(10_000),
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!res.ok) {
          if (res.status >= 500 && retryCount === 0) {
            shouldRetry = true;
          }
          return;
        }

        const data = await res.json();

        if (data.status === "no-character") {
          setCharacterStats(null);
          return;
        }

        setCharacterStats({
          name: data.name,
          actions: data.actions ?? 0,
          actionCap: data.actionCap ?? ACTION_CAP,
          hoardThreshold: data.hoardThreshold ?? ACTION_HOARDING_THRESHOLD,
          funds: data.funds ?? 0,
          campaignFundsStored: data.campaignFundsStored ?? data.funds ?? 0,
          cashOnHand: data.cashOnHand ?? 0,
          personalHomeLiquid: data.personalHomeLiquid ?? data.cashOnHand ?? 0,
          homeCurrency: data.homeCurrency ?? "USD",
          corp: data.corpNav ?? null,
          projectedIncome: data.projectedIncome ?? null,
          campaignIncomeBreakdown: data.campaignIncomeBreakdown ?? null,
          donorBaseLevel: data.donorBaseLevel ?? 0,
          politicalInfluence: data.politicalInfluence ?? 0,
          favorability: data.favorability ?? 0,
          currentOfficeType: data.currentOfficeType ?? null,
          isCentralBankChair: data.isCentralBankChair ?? false,
          chairActionBonus: data.chairActionBonus ?? 0,
          baseActionsPerTurn: data.baseActionsPerTurn ?? 4,
          officeActionBonus: data.officeActionBonus ?? 0,
          bonusActionsFromParty: data.bonusActionsFromParty ?? 0,
          dividendIncome: data.dividendIncome ?? 0,
          bondIncome: data.bondIncome ?? 0,
          electionStats: data.electionStats ?? null,
        });
      } catch {
        if (retryCount === 0) {
          shouldRetry = true;
        }
      } finally {
        if (shouldRetry) {
          setTimeout(() => {
            void fetchStatusData(layout, 1);
          }, 2_000);
        }
      }
    },
    [setCharacterStats]
  );

  useEffect(() => {
    if (useLightweightNav || isExcludedPath) return;
    if (authBootstrapLoading) return;
    if (!navData) {
      dispatch({ type: "SET_LOADING", isLoading: false });
      return;
    }

    dispatch({
      type: "SET_ACTIVE_PRESIDENT_ELECTION_ID",
      id: navData.activePresidentElectionId ?? null,
      seatId: navData.activePresidentElectionSeatId ?? null,
    });
    dispatch({ type: "SET_WIKI_DISABLED", wikiDisabled: navData.wikiDisabled ?? false });
    dispatch({
      type: "SET_CONFLICTS_ENABLED",
      conflictsEnabled: navData.conflictsEnabled ?? false,
    });
    dispatch({
      type: "SET_SETTLEMENT_CRISIS_ENABLED",
      settlementCrisisEnabled: navData.settlementCrisisEnabled ?? false,
    });
    dispatch({
      type: "SET_UNIONS_ENABLED",
      unionsEnabled: navData.unionsEnabled ?? false,
    });

    if (navData.user) {
      dispatch({
        type: "SET_USER_DATA",
        user: {
          username: navData.user.username,
          isAdmin: navData.user.isAdmin,
          isModerator: navData.user.isModerator,
          canSeeCampaignManager: navData.user.canSeeCampaignManager,
          patreonTier: navData.user.patreonTier ?? null,
          isPatronActive: navData.user.isPatronActive ?? false,
        },
        hasCharacter: navData.hasCharacter,
        unreadCount: navData.unreadCount ?? 0,
        myCorporationId: navData.myCorporationId ?? null,
        myUnionId: navData.myUnionId ?? null,
        homeState: navData.homeState ?? null,
        currentParty: navData.currentParty ?? null,
        adminCharacters: (navData.adminCharacters as AdminCharacter[] | null) ?? null,
        imperialCharacter: (navData.imperialCharacter as ImperialCharacterNav | null) ?? null,
        isImperialMode: navData.isImperialMode ?? false,
      });
      dispatch({ type: "SET_ACTIVE_ELECTION", activeElection: navData.activeElection ?? null });
      dispatch({ type: "SET_CABINET_OFFICE", cabinetOffice: navData.cabinetOffice ?? null });
      dispatch({
        type: "SET_GOVERNOR_OFFICE",
        governorOffice: (navData.governorOffice as NavbarWrapperState["governorOffice"]) ?? null,
      });

      if (navData.hasCharacter && navData.missingDemographics && !demographicsToastShown.current) {
        demographicsToastShown.current = true;
        setTimeout(() => {
          showToast(t("wrapper.demographicsToast"), "warning");
        }, 1500);
      }
    } else {
      dispatch({ type: "CLEAR_ALL" });
      setCharacterStats(null);
    }

    dispatch({ type: "SET_LOADING", isLoading: false });
  }, [
    authBootstrapLoading,
    isExcludedPath,
    navData,
    setCharacterStats,
    showToast,
    t,
    useLightweightNav,
  ]);

  useEffect(() => {
    statusLoadedRef.current = false;
  }, [navData?.user?.id, navData?.user?.character?.id]);

  useEffect(() => {
    if (useLightweightNav || isExcludedPath) return;
    if (authBootstrapLoading || !navData) return;
    if (statusLoadedRef.current) return;
    statusLoadedRef.current = true;
    void fetchStatusData(navData.user?.statusBarLayout);
  }, [authBootstrapLoading, fetchStatusData, isExcludedPath, navData, useLightweightNav]);

  useEffect(() => {
    if (useLightweightNav || isExcludedPath) return;
    if (state.isLoading) return;
    if (state.user && !state.hasCharacter) {
      const isAllowed = ALLOWED_WITHOUT_CHARACTER.some((path) => pathname.startsWith(path));
      if (!isAllowed && pathname !== "/") {
        router.push("/settings");
      }
    }
  }, [
    useLightweightNav,
    isExcludedPath,
    state.user,
    state.hasCharacter,
    state.isLoading,
    pathname,
    router,
  ]);

  const handleOpenFeedback = useCallback(async () => {
    if (state.capturingFeedback) return;

    dispatch({ type: "SET_CAPTURING_FEEDBACK", capturingFeedback: true });
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      const { captureFeedbackScreenshot } =
        await import("@/lib/feedback/captureFeedbackScreenshot");
      const { dataUrl, captureFailed } = await captureFeedbackScreenshot();
      dispatch({
        type: "OPEN_FEEDBACK",
        screenshotDataUrl: dataUrl,
        screenshotCaptureFailed: captureFailed,
      });
    } catch {
      dispatch({ type: "OPEN_FEEDBACK", screenshotDataUrl: null, screenshotCaptureFailed: true });
    }
  }, [state.capturingFeedback]);

  const handleCloseFeedback = useCallback(() => {
    dispatch({ type: "CLOSE_FEEDBACK" });
  }, []);

  // Memoized so the memoized ExperimentalNavbar is not defeated by a fresh
  // object identity on every wrapper render.
  const activeCharacterProfile = useMemo(() => {
    if (!navData?.user) return undefined;
    const char = navData.isImperialMode
      ? (navData.user.imperialCharacter as {
          avatarUrl?: string | null;
          profileHeaderImageUrl?: string | null;
          borderKey?: string | null;
          tintColor?: string | null;
          name?: string;
        } | null)
      : (navData.user.character as {
          avatarUrl?: string | null;
          profileHeaderImageUrl?: string | null;
          borderKey?: string | null;
          tintColor?: string | null;
          name?: string;
        } | null);
    if (!char) return undefined;
    return {
      avatarUrl: char.avatarUrl ?? null,
      profileHeaderImageUrl: char.profileHeaderImageUrl ?? null,
      borderKey: char.borderKey ?? null,
      tintColor: char.tintColor ?? null,
      name: char.name ?? navData.characterName ?? navData.user.username,
    };
  }, [navData]);

  if (displayMode === "focused") {
    return null;
  }

  if (isExcludedPath) {
    return null;
  }

  const navBootLoading = state.isLoading && !useLightweightNav;

  // The redesigned navbar is the default; users can opt back to the classic
  // chrome in Settings → Appearance (enableExperimentalUI === false). Lightweight
  // layouts always use the classic chrome regardless of the preference.
  const useExperimentalNav = !useLightweightNav && navData?.user?.enableExperimentalUI !== false;

  return (
    <>
      <NavbarTopFlair bootLoading={navBootLoading} />
      {state.isLoading && !useLightweightNav ? (
        <nav className="sticky top-0 z-50 border-b border-card-border bg-card/50 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <Image
                src={CDN_LOGO_URL}
                unoptimized
                alt="A House Divided Logo"
                width={40}
                height={40}
                className="object-contain"
              />
              <span className="text-lg font-semibold tracking-tight">A House Divided</span>
            </div>
            <div className="hidden md:block h-4 w-32 animate-pulse rounded bg-card-border" />
            <div className="md:hidden h-9 w-9 animate-pulse rounded-lg bg-card-border" />
          </div>
        </nav>
      ) : (
        <>
          {useExperimentalNav ? (
            <ExperimentalNavbar
              user={state.user ?? undefined}
              showProfile={state.hasCharacter}
              currentParty={state.currentParty ?? undefined}
              unreadCount={state.unreadCount}
              characterProfile={activeCharacterProfile}
              onOpenFeedback={handleOpenFeedback}
              feedbackCapturing={state.capturingFeedback}
              initialPageCountry={initialPageCountry}
              homeState={state.homeState ?? undefined}
              activeElection={state.activeElection ?? undefined}
              cabinetOffice={state.cabinetOffice ?? undefined}
              governorOffice={state.governorOffice ?? undefined}
              isImperialMode={state.isImperialMode}
              wikiDisabled={state.wikiDisabled}
              myCorporationId={state.myCorporationId ?? undefined}
              myUnionId={state.myUnionId ?? undefined}
              adminCharacters={state.adminCharacters ?? undefined}
              imperialCharacter={state.imperialCharacter ?? undefined}
              conflictsEnabled={state.conflictsEnabled}
              settlementCrisisEnabled={state.settlementCrisisEnabled}
              unionsEnabled={state.unionsEnabled}
              activePresidentElectionId={state.activePresidentElectionId ?? undefined}
              activePresidentElectionSeatId={state.activePresidentElectionSeatId ?? undefined}
            />
          ) : (
            <Navbar
              user={useLightweightNav ? undefined : (state.user ?? undefined)}
              showProfile={useLightweightNav ? false : state.hasCharacter}
              homeState={useLightweightNav ? undefined : (state.homeState ?? undefined)}
              currentParty={useLightweightNav ? undefined : (state.currentParty ?? undefined)}
              activeElection={useLightweightNav ? undefined : (state.activeElection ?? undefined)}
              cabinetOffice={useLightweightNav ? undefined : (state.cabinetOffice ?? undefined)}
              governorOffice={useLightweightNav ? undefined : (state.governorOffice ?? undefined)}
              activePresidentElectionId={
                useLightweightNav ? undefined : (state.activePresidentElectionId ?? undefined)
              }
              activePresidentElectionSeatId={
                useLightweightNav ? undefined : (state.activePresidentElectionSeatId ?? undefined)
              }
              unreadCount={useLightweightNav ? 0 : state.unreadCount}
              onOpenFeedback={handleOpenFeedback}
              feedbackCapturing={state.capturingFeedback}
              adminCharacters={useLightweightNav ? undefined : (state.adminCharacters ?? undefined)}
              myCorporationId={useLightweightNav ? undefined : (state.myCorporationId ?? undefined)}
              imperialCharacter={
                useLightweightNav ? undefined : (state.imperialCharacter ?? undefined)
              }
              isImperialMode={useLightweightNav ? false : state.isImperialMode}
              wikiDisabled={useLightweightNav ? false : state.wikiDisabled}
              conflictsEnabled={useLightweightNav ? false : state.conflictsEnabled}
              unionsEnabled={useLightweightNav ? false : state.unionsEnabled}
              initialPageCountry={initialPageCountry}
            />
          )}
          <FeedbackModal
            isOpen={state.feedbackOpen}
            onClose={handleCloseFeedback}
            initialScreenshotDataUrl={state.screenshotDataUrl}
            autoCaptureFailed={state.screenshotCaptureFailed}
          />
        </>
      )}
    </>
  );
}
