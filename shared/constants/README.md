# shared/constants/

Constants and pure functions that are imported by **both client components and server code**.

## Boundary with `src/lib/constants/`

| Location                       | What belongs here                                                                         | Example                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **`shared/constants/`** (here) | Pure functions and constants needed on both client and server (formulas, bill categories) | `calculateFavorabilityAboveThresholdPenalty()`, `BILL_CATEGORIES`, `POLICY_TAU` |
| **`src/lib/constants/`**       | Server-only constants (country configs, state data, game tuning)                          | `getCountryConfig()`, `STATES`, `CABINET_POSITIONS`                             |

## Why this exists

Next.js App Router enforces a client/server boundary. Files in `src/lib/` are server-only by convention. When a formula or constant needs to be used in a client component (e.g., displaying policy effects in the UI) AND on the server (e.g., applying effects in turn processing), it must live outside `src/lib/`.

## When to add here

Add a new file here only when:

1. The constant/function is needed in a `"use client"` component, AND
2. It is also used in server-side code (`src/lib/`, API routes, turn processing)

If it's server-only, put it in `src/lib/constants/` instead.
