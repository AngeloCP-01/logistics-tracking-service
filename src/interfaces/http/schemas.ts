import { z } from "zod";

export const orderIdParam = z.object({ orderId: z.string().uuid() });

export const routeQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
