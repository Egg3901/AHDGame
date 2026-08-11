/**
 * Lakeside Games account fields.
 *
 * A House Divided accounts and Lakeside Games accounts are the same user
 * record: the studio account system is this `users` collection. Every account
 * created here is therefore a Lakeside account, and these fields stamp that
 * explicitly so the Lakeside platform (the account portal, Electioneer, and
 * future games) can recognize how and when the account joined.
 *
 * Spread `lakesideAccountFields()` into any new-user insert. It is additive and
 * does not change existing game behavior.
 */
export function lakesideAccountFields(source: "ahd" | "ahd-google" | "ahd-discord") {
  return {
    lakesideAccount: true,
    lakesideCreatedAt: new Date(),
    lakesideAccountSource: source,
  };
}
