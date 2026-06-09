import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";

export interface MongoFixture {
  container: StartedMongoDBContainer;
  url: string; // includes the /tracking db path
}

export async function startMongo(): Promise<MongoFixture> {
  const container = await new MongoDBContainer("mongo:7").start();
  // getConnectionString() returns a base mongodb://host:port URI with no db path,
  // so append the db name + directConnection (MongoDBContainer runs as a single-node
  // replica set, so directConnection=true avoids SRV/replica-set discovery).
  const base = container.getConnectionString();
  const url = `${base}/tracking?directConnection=true`;
  return { container, url };
}

export async function stopMongo(fx: MongoFixture): Promise<void> {
  await fx.container.stop();
}
