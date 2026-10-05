import { collectionHelper as aliasedCollectionHelper } from "./collectionHelper";

type FixtureDb = {
  collection<T>(name: string): unknown;
};

declare const db: FixtureDb;

export function callsite(): void {
  aliasedCollectionHelper(db, "fixtureImportedAlias");
}
