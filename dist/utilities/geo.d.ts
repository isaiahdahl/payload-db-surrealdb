export type NearConstraint = [number, number, number | null, number | null];
export declare const parseNear: (value: unknown) => NearConstraint | null;
export declare const distanceMeters: (a: unknown, bLng: number, bLat: number) => number;
export declare const pointInPolygon: (value: unknown, polygon: unknown) => boolean;
