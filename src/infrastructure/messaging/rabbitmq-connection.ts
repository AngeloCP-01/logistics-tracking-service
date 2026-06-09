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
  await channel.prefetch(8);
}
