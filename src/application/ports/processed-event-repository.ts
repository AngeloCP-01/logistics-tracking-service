export interface ProcessedEventRepository {
  /** Returns true if this eventId was newly recorded (i.e. not seen before). */
  recordIfNew(eventId: string, eventType: string): Promise<boolean>;
}
