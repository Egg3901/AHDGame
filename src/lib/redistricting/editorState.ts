import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { Pool } from "./pools";

export function cyclePool(p: Pool): Pool {
  return p === "left" ? "right" : p === "right" ? "grey" : "left";
}

export function cellsToSquares(cells: Pool[]): DistrictSquares {
  const out: DistrictSquares = { left: 0, right: 0, grey: 0 };
  for (const c of cells) out[c] += 1;
  return out;
}

export function gridToSquares(grid: Pool[][]): DistrictSquares[] {
  return grid.map(cellsToSquares);
}

export function tallyAllocation(grid: Pool[][]): DistrictSquares {
  return grid.reduce<DistrictSquares>(
    (acc, cells) => {
      const s = cellsToSquares(cells);
      return { left: acc.left + s.left, right: acc.right + s.right, grey: acc.grey + s.grey };
    },
    { left: 0, right: 0, grey: 0 }
  );
}

export function remainingBudget(budget: DistrictSquares, grid: Pool[][]): DistrictSquares {
  const used = tallyAllocation(grid);
  return {
    left: budget.left - used.left,
    right: budget.right - used.right,
    grey: budget.grey - used.grey,
  };
}
