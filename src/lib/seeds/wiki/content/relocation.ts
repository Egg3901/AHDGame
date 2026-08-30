export const relocationContent = `# Relocation

You can change your character's **home state** (US), **region** (UK: England / Scotland / Wales / Northern Ireland; Japan's eight regions; Ireland, China, Brazil, Nigeria and the bloc countries likewise), or **Land** (Germany, East Germany). Your home anchors where you run for office, campaign cheaply, and appear in regional player lists. Moving is supported but expensive: not a button to press casually.

## Cooldown

- **72 turns** (3 real days) between relocations. This applies across all relocation types: state move, country move, and the combined CEO-and-character move all share the same cooldown.

## What always resets (any relocation)

Every relocation, even within the same country:

- **Political Influence** → 0 (in all states; you start fresh in your new home).
- **Donor Base** → 0 (level 1, no accumulated donors).
- **Group Favorability** (any state-specific demographic favorability tracks) → cleared.
- **State / regional party leadership** in the region you left (chair, vice chair, treasurer) → vacated; party replaces you via the next election.
- **Any active candidacy** (general election, primary, state-party leadership, national-party leadership, committee) → withdrawn.
- **State / regional offices** (governor, house, senate, state legislature, …) → auto-resigned. The seat is vacated in \`electedOfficials\` and the perpetual-election system will spawn a replacement race.
- **National / country-scoped offices** (President, Vice President, cabinet, chancellor, …) → **kept** on an in-country move. They only auto-resign when you change country (same rule as Central Bank Chair).
- **CEO of a corporation** → removed unless you use the combined relocate-with-corp flow (see below).
- **Military command** (country change only) → a commissioned general leaves every Command roster, vacates any Command they led, drops their conflict postings, and hands their units back to the old country's General Staff, the same cascade a dismissal runs. The relocation summary tells you when a move cost you a command.
- **Career history** → a \`"relocated"\` entry is appended with \`fromState\` / \`toState\` (and \`fromCountry\` / \`toCountry\` if the country changed).

## What only resets on country change

Changing country is more expensive than changing state:

- **National Political Influence (NPI)** → 0.
- **Party Influence** → 0.
- **Party membership** → Independent (you must re-join in the new country).
- **National party leadership positions** (chair, vice chair, treasurer) → vacated; party \`memberCount\` decrements.
- **National committee memberships** → cleared.
- **Coalition chair** (if your party led one) → cleared.
- **Central Bank Chair** → auto-resigned.
- **National / country-scoped elected offices** (President, VP, cabinet, …) → auto-resigned.

After a cross-country move you're effectively starting your political career over. You keep your money, your corporate holdings, and your personal history, but your political network is gone.

## What is preserved

Regardless of relocation type:

- **Campaign Funds and Cash on Hand** (all currencies held).
- **Savings** (all accounts, all currencies).
- **Accumulated actions.**
- **Favorability, Infamy, policy positions.**
- **Earlier career history entries** (the new \`"relocated"\` event is appended, not replacing).
- **Avatars, news posts, achievements.**
- **Stock holdings and bonds** (including sovereign and corporate).
- **Line-of-credit balances and arrears.**

Money is **not** currency-converted. If you held ₳500,000 USD and relocate to the UK, your \₳500,000 USD balance is preserved; you just start earning GBP in the new country going forward.

## Blocking conditions

You cannot relocate if:

- Target state / region doesn't exist or is the same as your current home.
- You relocated within the last 72 turns (3 real days).
- The destination country is disabled for players (admins bypass this).

There is **no** block for holding office or being an active candidate: those get auto-vacated.

## CEO and corporation rules

Corporations have a headquarters state, and the CEO must reside in that state:

- **Standard relocation** removes you as CEO if you hold the role. The corporation enters CEO vacancy; the board eventually appoints a replacement.
- **To accept a CEO role**, your home state must match the corporation's HQ state. See [Corporations](/wiki/corporations).

## Combined character + corporation relocation

When you're a CEO and click **Relocate here** from a region page, the dialog offers three choices:

1. **Cancel**: dismiss, no action.
2. **Relocate & Abandon Corporation**: standard character relocation; your CEO role is auto-vacated.
3. **Relocate & Move Corporation**: character and corporation HQ move in a single transaction via \`POST /api/character/relocate-with-corp\`. You remain CEO.

**Cross-country corporate relocations cost 2× the base 7% of market cap** (so 14%). Imperial CEOs' corporations move at no additional cost: they receive a 2-button dialog with an info line instead of the chooser.

The "Relocate & Move Corporation" button is disabled if the corporation can't afford the selected payment method (insufficient Liquid Capital, bond cooldown still active, or leverage cap reached). The other two options remain available.

**CEO headquarters moves from the CEO Office** (not the combined flow) also auto-vacate the CEO if they don't reside at the destination. The UI warns before submission but doesn't block.

## Strategy

### When to relocate within your country

- You misjudged your home state's political landscape and can't build a viable candidacy.
- You want to switch from a small state to a population-tier multiplier for donor-base income (moving from a small state to a large one boosts per-level donor income 4×).
- You want to contest a specific race that's only open to residents of a different state.
- Your target party's strongest wing is anchored in another state and you want better alignment.

Expect to lose your PI and donor base: don't relocate mid-cycle.

### When to relocate across countries

- You've wrapped up what you want to do in country A and want a full-career reset in country B.
- You're moving with a corporation in a single transaction to a strategic market.
- You want to leave behind a damaging political reputation (Favorability is preserved, but the local infrastructure isn't).

Cross-country moves are **heavy**. Plan for weeks of rebuild. Verify your target country is open to players before initiating.

### Timing around elections

- **Don't relocate during a candidacy**: your candidacy is withdrawn, handing the race to opponents.
- **Don't relocate during a state/region term of office**: those seats auto-resign.
- **National offices (President, VP, cabinet)** survive an in-country move; they are only vacated when you change country.
- **Do relocate between cycles**, early in a build phase, so you have weeks to rebuild PI before the next primary.

## Admin and moderator overrides

These endpoints run the **full** relocation pipeline: they never bypass cleanup.

- \`PATCH /api/admin/characters/update-country\`
- \`PATCH /api/admin/characters/update-state\`
- \`PATCH /api/moderator/characters/update-country\`
- \`PATCH /api/moderator/characters/update-state\`

The only difference from the player flow: cooldown, country-availability gates, and rate limits are skipped.

## Related

- [Getting Started](/wiki/getting-started): Creating a character and first steps.
- [Corporations](/wiki/corporations): Founding, HQ, CEO residency.
- [United Kingdom](/wiki/uk-overview): UK regions as "home state."
- [Germany](/wiki/de-overview) · [Japan](/wiki/jp-overview): Länder and prefectures.
`;
