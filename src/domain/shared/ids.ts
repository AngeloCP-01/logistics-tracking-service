const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderId = string & { readonly __brand: "OrderId" };
export const OrderId = {
  of(value: string): OrderId {
    if (!UUID_RX.test(value)) throw new Error(`invalid OrderId: ${value}`);
    return value as OrderId;
  },
};

export type DriverId = string & { readonly __brand: "DriverId" };
export const DriverId = {
  of(value: string): DriverId {
    if (!UUID_RX.test(value)) throw new Error(`invalid DriverId: ${value}`);
    return value as DriverId;
  },
};

export type UserId = string & { readonly __brand: "UserId" };
export const UserId = {
  of(value: string): UserId {
    if (!UUID_RX.test(value)) throw new Error(`invalid UserId: ${value}`);
    return value as UserId;
  },
};
