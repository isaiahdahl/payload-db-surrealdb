export type NearConstraint = [number, number, number | null, number | null]

export const parseNear = (value: unknown): NearConstraint | null => {
  const parts = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map((part) => part.trim()) : [])
  if (parts.length < 2) return null
  const nums = parts.map((part) => (part === 'null' || part === '' ? null : Number(part)))
  if (typeof nums[0] !== 'number' || typeof nums[1] !== 'number' || Number.isNaN(nums[0]) || Number.isNaN(nums[1])) return null
  return [nums[0], nums[1], typeof nums[2] === 'number' && !Number.isNaN(nums[2]) ? nums[2] : null, typeof nums[3] === 'number' && !Number.isNaN(nums[3]) ? nums[3] : null]
}

const getPointCoordinates = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray((value as { coordinates?: unknown }).coordinates)) return (value as { coordinates: unknown[] }).coordinates
  return null
}

export const distanceMeters = (a: unknown, bLng: number, bLat: number): number => {
  const point = getPointCoordinates(a)
  if (!point || point.length < 2) return Number.POSITIVE_INFINITY
  const [lng, lat] = point.map(Number)
  const rad = Math.PI / 180
  const dLat = (bLat - lat) * rad
  const dLng = (bLng - lng) * rad
  const lat1 = lat * rad
  const lat2 = bLat * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export const pointInPolygon = (value: unknown, polygon: unknown): boolean => {
  const point = getPointCoordinates(value)
  if (!point || !polygon || typeof polygon !== 'object') return false
  const coordinates = (polygon as { coordinates?: unknown }).coordinates
  const ring = Array.isArray(coordinates) && Array.isArray(coordinates[0]) ? coordinates[0] as unknown[] : []
  const [x, y] = point.map(Number)
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i]
    const previous = ring[j]
    if (!Array.isArray(current) || !Array.isArray(previous)) continue
    const [xi, yi] = current.map(Number)
    const [xj, yj] = previous.map(Number)
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}
