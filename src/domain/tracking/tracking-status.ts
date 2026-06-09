export const TrackingStatus = {
  CREATED: "created",
  IN_TRANSIT: "in_transit",
  COMPLETED: "completed",
} as const;
export type TrackingStatus = (typeof TrackingStatus)[keyof typeof TrackingStatus];

const RANK: Record<TrackingStatus, number> = {
  [TrackingStatus.CREATED]: 0,
  [TrackingStatus.IN_TRANSIT]: 1,
  [TrackingStatus.COMPLETED]: 2,
};

export function rank(s: TrackingStatus): number {
  return RANK[s];
}

export function isAtOrAfter(s: TrackingStatus, target: TrackingStatus): boolean {
  return RANK[s] >= RANK[target];
}
