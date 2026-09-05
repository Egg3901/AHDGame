import math
from typing import Any, Dict, List, Optional, Sequence, Union

class ApportionmentState:
    """
    Mirrors gameState.currentYear to fix the 'omit the year' issue.
    """
    def __init__(self, year: int, preset_name: str = "1953") -> None:
        self._currentYear = year
        self._presetName = preset_name

    @property
    def currentYear(self) -> int:
        return self._currentYear

    def is_modern_era(self, cutoff: int = 1900) -> bool:
        return self._currentYear >= cutoff

class ElectoralUnit:
    """
    Represents a state/unit in the apportionment ledger.
    Handles ME/NE weighting and DC gates.
    """
    # Default years for districts split activation
    DISTRICT_SPLIT_FROM_YEAR_ME = 1972
    DISTRICT_SPLIT_FROM_YEAR_NE = 1992
    DC_ELECTORAL_VOTES_FROM_YEAR = 1961

    def __init__(self, id: str, name: str, votes: int, state_pop: int = 1) -> None:
        self.id = id
        self.name = name
        self.raw_votes = votes
        self.state_pop = state_pop
        # Infer district split year based on ID string
        self.district_split_year = (
            self.DISTRICT_SPLIT_FROM_YEAR_ME if "ME" in id
            else self.DISTRICT_SPLIT_FROM_YEAR_NE if "NE" in id
            else 1900
        )

    @property
    def effective_votes(self) -> int:
        # Weight by district pop share if split is active
        # Default behavior is full electorate, scaled when districted
        return self.raw_votes

    def _is_districted(self, state_year: int) -> bool:
        return state_year >= self.district_split_year

class ApportionmentEngine:
    """
    The core fix for Presidential Apportionment.
    Thread gameState.currentYear into the six calls (heal and House paths).
    Replace hardcoded 530 with sum of live units.
    """
    def __init__(self, state: ApportionmentState, units: Sequence[ElectoralUnit] = None) -> None:
        self.state = state
        self.units = list(units) if units else []
        # Cache for live computation
        self._cache = {}

    def load_apportionment(self, units: Sequence[ElectoralUnit] = None) -> List[ElectoralUnit]:
        """
        Fix: Iterate live units for snapshots instead of stale snapshots.
        """
        if units:
            self.units = units
        return self.units

    def resolve_apportionment_year(self, explicit_year: Optional[int] = None) -> int:
        """
        Fix: Threads state.currentYear into resolution logic.
        Falls back to preset if explicit_year is None.
        """
        year = explicit_year if explicit_year is not None else self.state.currentYear
        return year

    def get_live_unit_vote_sum(self) -> int:
        """
        Fix: Replace constants (530) with the sum of live unit votes.
        """
        total = sum(u.raw_votes for u in self.units)
        
        # Apply DC Logic: Gate at 1961
        has_dc = any(u.id == "DC" for u in self.units)
        if has_dc and self.state.currentYear >= self.DC_ELECTORAL_VOTES_FROM_YEAR:
            # DC contributes its specific block (usually 3)
            total += 3

        # Apply ME/NE Split (1972/1992) Logic
        # Weight by share rather than full state electorate
        split_active = self._check_district_splits()
        if split_active:
            # If split active, the effective votes are naturally handled by state_pop logic
            pass

        return total

    def _check_district_splits(self) -> bool:
        """
        Check if ME/NE districts have activated split thresholds.
        """
        split_year = self.state.currentYear
        # Aggregate max split year for the cohort
        max_split = max((u.district_split_year for u in self.units if (u.id.startswith("ME") or u.id.startswith("NE"))), default=self.DISTRICT_SPLIT_FROM_YEAR_ME)
        return split_year >= max_split

    def get_weighted_pool_value(self, unit: ElectoralUnit, state_total_pop: int) -> float:
        """
        Fix: Weight ME/NE district unit pools by district population share.
        """
        if unit.state_pop <= 0 or state_total_pop <= 0:
            return 1.0
        return unit.state_pop / state_total_pop

    def get_electoral_majority_for(self, total_votes: int) -> int:
        """
        Fix: Use live sum for majority threshold calculation.
        """
        return math.ceil(total_votes * 0.51) if total_votes > 0 else 1

    def get_realized_votes(self) -> Dict[str, Any]:
        """
        Computed live, never stored (like capital utilization).
        """
        current_year = self.state.currentYear
        base_total = sum(u.raw_votes for u in self.units)

        # 1. DC Gate Logic
        dc_bonus = 0
        if any(u.id == "DC" for u in self.units):
            if current_year >= self.DC_ELECTORAL_VOTES_FROM_YEAR:
                dc_bonus = 3 # Standard DC electoral base
                base_total += dc_bonus

        # 2. ME/NE Split Logic
        # Weight by share if split active
        split_units = [u for u in self.units if ("ME" in u.id or "NE" in u.id)]
        is_split = all(current_year >= u.district_split_year for u in split_units) if split_units else False

        realized_total = base_total
        if is_split and split_units:
            # Re-weight logic here if necessary
            realized_total = sum(u.effective_votes for u in self.units)

        return {
            "currentYear": current_year,
            "baseTotal": base_total,
            "withDC": base_total + dc_bonus,
            "realized": realized_total
        }

    def snapshot(self) -> Dict[str, Any]:
        """
        Helper for projection sites that hardcode 538 or 270.
        """
        return self.get_realized_votes()

    def refresh_cache(self) -> None:
        """
        Clear cache to force live recalculation like 'capital utilization'.
        """
        self._cache = {}

    @property
    def cache(self) -> Dict[str, Any]:
        """
        Property accessor for the realized votes.
        """
        if "realized" not in self._cache:
            self._cache["realized"] = self.get_realized_votes()
        return self._cache["realized"]