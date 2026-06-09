import { MongoClient, type Db } from "mongodb";

export interface MongoHandle {
  client: MongoClient;
  db: Db;
}

export async function createMongo(url: string): Promise<MongoHandle> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  // The DB name is taken from the connection string path; fall back to "tracking".
  const db = client.db();
  return { client, db };
}
