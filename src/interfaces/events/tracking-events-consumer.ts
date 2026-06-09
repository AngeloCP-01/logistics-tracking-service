import type { Channel } from "amqplib";
import type { Logger } from "pino";
import {
  assertTrackingTopology,
  TRACKING_EVENTS_QUEUE,
  LOGISTICS_EXCHANGE,
} from "../../infrastructure/messaging/rabbitmq-connection.js";
import type { HandleOrderCreatedUseCase } from "../../application/tracking/handle-order-created.use-case.js";
import type { HandleDriverAssignedUseCase } from "../../application/tracking/handle-driver-assigned.use-case.js";

export interface ConsumerDeps {
  channel: Channel;
  logger: Logger;
  handleOrderCreated: HandleOrderCreatedUseCase;
  handleDriverAssigned: HandleDriverAssignedUseCase;
}

export async function startTrackingEventsConsumer(deps: ConsumerDeps): Promise<{ stop: () => Promise<void> }> {
  const { channel, logger } = deps;
  await assertTrackingTopology(channel);

  const { consumerTag } = await channel.consume(TRACKING_EVENTS_QUEUE, async (msg) => {
    if (!msg) return;
    const routingKey = msg.fields.routingKey;
    let envelope: { eventId: string; eventType: string; correlationId?: string; data: Record<string, unknown> };
    try {
      envelope = JSON.parse(msg.content.toString());
    } catch {
      logger.warn({ event: "consumer_bad_json", routingKey }, "discarding");
      channel.nack(msg, false, false);
      return;
    }
    const corr = envelope.correlationId ?? envelope.eventId;
    try {
      if (envelope.eventType === "order.created") {
        await deps.handleOrderCreated.execute(
          {
            eventId: envelope.eventId,
            orderId: String(envelope.data.orderId),
            customerId: String(envelope.data.customerId),
          },
          corr,
        );
      } else if (envelope.eventType === "dispatch.driver.assigned") {
        await deps.handleDriverAssigned.execute(
          {
            eventId: envelope.eventId,
            orderId: String(envelope.data.orderId),
            driverId: String(envelope.data.driverId),
          },
          corr,
        );
      } else {
        channel.ack(msg);
        return;
      }
      channel.ack(msg);
    } catch (err) {
      const attempts = (msg.properties.headers?.["x-attempt"] as number | undefined) ?? 0;
      if (attempts < 3) {
        logger.warn({ event: "consumer_retry", attempts: attempts + 1, routingKey }, "republish");
        channel.publish(LOGISTICS_EXCHANGE, routingKey, msg.content, {
          contentType: "application/json",
          headers: { ...(msg.properties.headers ?? {}), "x-attempt": attempts + 1 },
        });
        channel.ack(msg);
      } else {
        logger.error({ event: "consumer_dlq", err, routingKey, attempts }, "to DLQ");
        channel.nack(msg, false, false);
      }
    }
  });

  return {
    stop: async () => {
      await channel.cancel(consumerTag);
    },
  };
}
