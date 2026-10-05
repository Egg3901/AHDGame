type FixtureDb = {
  collection<T>(name: string): unknown;
};

export function collectionHelper(db: FixtureDb, collectionName: string): void {
  db.collection<{ _id: string }>(collectionName);
}
