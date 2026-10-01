import { closeDb } from "../utils/db";

export async function closeResetDb(): Promise<void> {
  const applicationClient = global._mongoClientPromise;
  global._mongoClientPromise = undefined;
  try {
    if (applicationClient) await (await applicationClient).close();
  } finally {
    await closeDb();
  }
}
