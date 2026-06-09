import type { Db, Collection, MongoServerError } from "mongodb";
import type { ProcessedEventRepository } from "../../application/ports/processed-event-repository.js";
import { PROCESSED_EVENTS } from "./mongo-bootstrap.js";

interface ProcessedEventDoc {
  eventId: string;
  eventType: string;
  processedAt: Date;
}

export class MongoProcessedEventRepository implements ProcessedEventRepository {
  private readonly coll: Collection<ProcessedEventDoc>;
  constructor(db: Db) {
    this.coll = db.collection<ProcessedEventDoc>(PROCESSED_EVENTS);
  }

  async recordIfNew(eventId: string, eventType: string): Promise<boolean> {
    try {
      await this.coll.insertOne({ eventId, eventType, processedAt: new Date() });
      return true;
    } catch (err) {
      if ((err as MongoServerError)?.code === 11000) return false;   // duplicate key → already processed
      throw err;
    }
  }
}
