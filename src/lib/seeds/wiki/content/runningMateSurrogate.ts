export const runningMateSurrogateContent = `# Running Mate Surrogate Campaigning

In a presidential general, your running mate is not just a name on the ticket. The player who owns the running-mate character can spend their own turn on the road, campaigning for the ticket as a surrogate.

This page covers those surrogate actions. For selecting a running mate and the VP's standing bonuses, see [General Elections](/wiki/general-elections).

## Who can act

Only the player whose character **is** the running mate. They act on the presidential nominee's campaign, not their own (a running mate has no separate candidacy). Campaign managers do not get surrogate actions, and NPP-led tickets have no player running mate, so they never generate them.

Surrogate actions are **presidential general phase only**. They are unavailable during the primary and on non-presidential races.

## The daily surrogate pool

Both surrogate actions draw from one shared pool: **2 surrogate actions per day**, refilled every day at **midnight Eastern Time**. The cap is fixed at the value the race opened under, so a live race keeps the same allowance for its whole run. When the pool is empty, further surrogate actions are blocked until the next reset.

Surrogate actions cost the running mate's **own** character actions on top of the shared pool, so a busy VP still has to budget their turn.

## State visit (travel)

Sending the running mate to a state sets where the ticket is campaigning.

- **Effect:** while the VP is traveling in a state, the ticket gains **+1.0% favorability per turn** in that state, on top of the nominee's own travel-presence bonus. This is the same favorability the vote engine reads, so it moves real votes.
- **Cost:** 1 from the shared surrogate pool, plus **3 to 10** of the VP's own actions depending on the state's electoral weight (the same travel cost the nominee pays).
- Must be a state in the ticket's own country.

## Canvass for the ticket

Once the running mate is traveling in a state, they can canvass there for the ticket, exactly like a candidate canvassing their home state.

- **Effect:** boosts a demographic group's turnout in that state (alignment-scaled, doubled during the final campaign-season window, with diminishing returns on repeated canvasses of the same group).
- **Cost:** 1 from the shared surrogate pool, plus the VP's own actions and **₳100** in campaign funds per canvass.

## Why use a surrogate

A surrogate effectively gives the ticket a second campaigner covering a different state. A well-used running mate can hold a favorability edge in a battleground the nominee cannot reach that turn, or drive turnout in a friendly group while the nominee works elsewhere. The 2-per-day cap keeps it from replacing the nominee's own ground game.

## Related

- [General Elections](/wiki/general-elections): running-mate selection and the VP's base bonuses.
- [Canvassing](/wiki/canvassing): the turnout mechanic the ticket canvass uses.
- [Campaign Manager](/wiki/campaign-manager): the campaign page and its owner-only briefing.
- [Political Operations and Campaign Presence](/wiki/political-operations): the nominee's own state presence and travel.
`;
