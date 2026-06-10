import amqp, { type ChannelModel, type Channel } from "amqplib";

export const LOGISTICS_EXCHANGE = "logistics.events";
export const TRACKING_EVENTS_QUEUE = "tracking-service.events";

const CONSUMED_KEYS = ["order.created", "dispatch.driver.assigned"];

export async function connect(url: string): Promise<{ connection: ChannelModel; channel: Channel }> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertExchange(LOGISTICS_EXCHANGE, "topic", { durable: true });
  return { connection, channel };
}

/** Assert tracking's work queue + DLQ + the two bindings. */
export async function assertTrackingTopology(channel: Channel): Promise<void> {
  await channel.assertQueue(TRACKING_EVENTS_QUEUE, {
    durable: true,
    deadLetterExchange: "",
    deadLetterRoutingKey: `${TRACKING_EVENTS_QUEUE}.dlq`,
  });
  await channel.assertQueue(`${TRACKING_EVENTS_QUEUE}.dlq`, { durable: true });
  for (const k of CONSUMED_KEYS) await channel.bindQueue(TRACKING_EVENTS_QUEUE, LOGISTICS_EXCHANGE, k);
  // prefetch(1): the projection upsert is read-then-replace, so two events for the SAME order
  // (order.created + dispatch.driver.assigned) processed concurrently would race on the replaceOne
  // and the placeholder-customer reconciliation — driver.assigned could clobber the real customerId.
  // This consumer is low-volume (a couple of events per order lifecycle; the high-frequency
  // location stream is over WebSocket, not here), so serializing it has negligible cost and makes
  // the read-then-write atomic-enough by construction. (Surfaced by the H integration tests.)
  await channel.prefetch(1);
}
