/**
 * The preset assumed when a world does not state one.
 *
 * Every seeder used to carry `preset: string = "2019-default"` as a parameter
 * default, so a caller that forgot the argument silently seeded a MODERN world
 * — writing 2019 policy catalogues, budgets, sector weights and demographics
 * into a historical one, with a normal success log. Those defaults are gone and
 * `preset` is required; this constant is the one place the fallback still
 * lives, so it is greppable and reviewable rather than repeated anonymously in
 * a hundred signatures.
 *
 * Prefer the world's own `gameState.preset` — see `getGameStatePresetOrDefault`.
 * Reach for this only where there is genuinely no world to ask.
 *
 * Lives in `constants/` rather than beside `getGameStatePresetOrDefault`
 * because CLIENT components need it (the wiki's seed widgets). Importing it
 * from `db/collections/gameState` dragged `mongodb` into the browser bundle and
 * broke `next build` — a failure neither typecheck nor vitest can see.
 */
export const DEFAULT_SEED_PRESET = "2019-default";
