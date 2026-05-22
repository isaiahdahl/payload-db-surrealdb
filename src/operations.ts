import type {
  Count,
  Create,
  DeleteMany,
  DeleteOne,
  Find,
  FindOne,
  UpdateMany,
  UpdateOne,
  Upsert,
} from 'payload'

import { ValidationError } from 'payload'

import type { SurrealAdapter } from './index.js'

import { SurrealDBError } from './client.js'
import { pathToSQL } from './queries/buildWhere.js'
import { addTransactionDoc, getTransactionDocs, queueTransactionStatement } from './transactions/index.js'
import { applyDefaults, applySelect, getCollectionConfig, getValueAtPath, hasTimestamps, setValueAtPath } from './utilities/fields.js'
import { buildRelationshipAwareWhere, transformRelationshipReads, transformRelationshipWrites } from './utilities/relationships.js'
import { escapeIdent, getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js'

const randomID = (): string => {
  const crypto = globalThis.crypto as { randomUUID?: () => string } | undefined

  return crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const getVirtualPath = (adapter: SurrealAdapter, collection: string, field: string): string | undefined => {
  const config = getCollectionConfig(adapter, collection)
  const candidate = config?.fields?.find((item: { name?: string }) => item.name === field) as { virtual?: boolean | string } | undefined
  return typeof candidate?.virtual === 'string' ? candidate.virtual : undefined
}

const getVersionBaseCollection = (adapter: SurrealAdapter, collection: string): string | undefined => {
  if (!collection.endsWith('_versions')) return undefined
  const baseCollection = collection.slice(0, -'_versions'.length)

  return getCollectionConfig(adapter, baseCollection) ? baseCollection : undefined
}

const getVirtualAlias = (adapter: SurrealAdapter, collection: string, path: string): string | undefined => {
  path = path.replaceAll('__', '.')
  const [root, ...rest] = path.split('.')

  if (root === 'version') {
    const baseCollection = getVersionBaseCollection(adapter, collection)
    const versionAlias = baseCollection ? getVirtualAlias(adapter, baseCollection, rest.join('.')) : undefined

    return versionAlias ? ['version', versionAlias].join('.') : undefined
  }

  const baseCollection = getVersionBaseCollection(adapter, collection)

  if (baseCollection) {
    const versionAlias = getVirtualAlias(adapter, baseCollection, path)

    return versionAlias ? ['version', versionAlias].join('.') : undefined
  }

  const virtualPath = getVirtualPath(adapter, collection, root)

  return virtualPath ? [virtualPath, ...rest].filter(Boolean).join('.') : undefined
}

const isLocalizedRelationshipField = (adapter: SurrealAdapter, collection: string, path: string): boolean => {
  const root = path.replaceAll('__', '.').split('.')[0]
  const field = getCollectionConfig(adapter, collection)?.fields?.find((item: { name?: string }) => item.name === root) as { localized?: boolean; type?: string } | undefined
  return Boolean(field?.localized && (field.type === 'relationship' || field.type === 'upload'))
}

const isRelationshipPath = (adapter: SurrealAdapter, collection: string, path: string): boolean => {
  path = path.replaceAll('__', '.')
  const [root, ...rest] = path.split('.')
  if (root === 'version') {
    const baseCollection = getVersionBaseCollection(adapter, collection)

    return baseCollection ? isRelationshipPath(adapter, baseCollection, rest.join('.')) : false
  }

  const baseCollection = getVersionBaseCollection(adapter, collection)

  if (baseCollection) {
    return isRelationshipPath(adapter, baseCollection, path)
  }

  if (!rest.length) return false
  if (rest.length === 1 && (rest[0] === 'value' || rest[0] === 'relationTo')) return false
  const field = getCollectionConfig(adapter, collection)?.fields?.find((item: { name?: string }) => item.name === root) as { type?: string } | undefined
  return field?.type === 'relationship' || field?.type === 'upload'
}

const whereUsesVirtual = (adapter: SurrealAdapter, collection: string, where: unknown): boolean => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false
  return Object.entries(where as Record<string, unknown>).some(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) return value.some((entry) => whereUsesVirtual(adapter, collection, entry))
    const usesClientOperator = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).some((operator) => operator === 'near' || operator === 'within' || operator === 'intersects')
    return usesClientOperator || Boolean(pathRootField(adapter, collection, key)?.hasMany) || key.includes('.') || key.includes('__') || Boolean(getVirtualAlias(adapter, collection, key)) || whereUsesLocalizedFields(adapter, collection, { [key]: value }) || isLocalizedRelationshipField(adapter, collection, key) || isRelationshipPath(adapter, collection, key)
  })
}

const sortValues = (sort?: string | string[]): string[] => (Array.isArray(sort) ? sort : sort ? [sort] : [])
  .flatMap((value) => String(value).split(','))
  .map((value) => value.trim())
  .filter(Boolean)

const sortUsesVirtual = (adapter: SurrealAdapter, collection: string, sort?: string | string[]): boolean =>
  sortValues(sort).some((value) => {
    const path = value.replace(/^-|^\+/, '')
    return Boolean(getVirtualAlias(adapter, collection, path)) || Boolean(getLocalizedFieldPath(adapter, collection, path)) || isRelationshipPath(adapter, collection, path)
  })

const compareScalarValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

const getComparableValue = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  const values = value.filter((item) => item !== null && item !== undefined)
  values.sort(compareScalarValues)

  return values[0]
}

const normalizeComparableValue = (value: unknown): unknown => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>

    if ('relationTo' in object && 'value' in object) {
      return { relationTo: object.relationTo, value: normalizeComparableValue(object.value) }
    }

    if ('id' in object) {
      return object.id
    }

    if ('en' in object) {
      return normalizeComparableValue(object.en)
    }
  }

  return value
}

const compareValues = (a: unknown, b: unknown): number => compareScalarValues(getComparableValue(normalizeComparableValue(a)), getComparableValue(normalizeComparableValue(b)))

const toBoolean = (value: unknown): boolean => value === 'false' ? false : Boolean(value)

const parseNear = (value: unknown): [number, number, number | null, number | null] | null => {
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

const distanceMeters = (a: unknown, bLng: number, bLat: number): number => {
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

const pointInPolygon = (value: unknown, polygon: unknown): boolean => {
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

const matchesOperator = (actual: unknown, operator: string, expected: unknown): boolean => {
  const actualValues = Array.isArray(actual) ? actual : [actual]
  const expectedValues = Array.isArray(expected) ? expected : [expected]

  switch (operator) {
    case 'contains':
      return Array.isArray(actual)
        ? expectedValues.some((value) => actual.some((item) => (
            typeof item === 'string' || typeof value === 'string'
              ? String(item ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
              : valuesEqual(item, value)
          )))
        : expectedValues.some((value) => String(actual ?? '').toLowerCase().includes(String(value ?? '').toLowerCase()))
    case 'equals': return actualValues.some((value) => expectedValues.some((candidate) => valuesEqual(value, candidate)))
    case 'exists': return toBoolean(expected) ? actual !== null && actual !== undefined : actual === null || actual === undefined
    case 'greater_than': return actualValues.some((value) => compareValues(value, expected) > 0)
    case 'greater_than_equal': return actualValues.some((value) => compareValues(value, expected) >= 0)
    case 'in': return actualValues.some((value) => expectedValues.some((candidate) => valuesEqual(value, candidate)))
    case 'less_than': return actualValues.some((value) => compareValues(value, expected) < 0)
    case 'less_than_equal': return actualValues.some((value) => compareValues(value, expected) <= 0)
    case 'near': {
      const parsed = parseNear(expected)
      if (!parsed) return false
      const [lng, lat, maxDistance, minDistance] = parsed
      const distance = distanceMeters(actual, lng, lat)
      return (maxDistance === null || distance <= maxDistance) && (minDistance === null || distance >= minDistance)
    }
    case 'within':
    case 'intersects': return pointInPolygon(actual, expected)
    case 'like': {
      const text = String(actual ?? '').toLowerCase()
      return String(expected ?? '').split(/\s+/).filter(Boolean).every((word) => text.includes(word.toLowerCase()))
    }
    case 'not_contains': return !matchesOperator(actual, 'contains', expected)
    case 'not_equals': return !matchesOperator(actual, 'equals', expected)
    case 'not_in': return !matchesOperator(actual, 'in', expected)
    case 'not_like': return !matchesOperator(actual, 'like', expected)
    default: return matchesOperator(actual, 'equals', expected)
  }
}

const getNearConstraint = (where: unknown): { path: string; value: unknown } | null => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return null
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase()
    if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) {
      for (const entry of value) {
        const nested = getNearConstraint(entry)
        if (nested) return nested
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && 'near' in (value as Record<string, unknown>)) {
      return { path: key, value: (value as Record<string, unknown>).near }
    }
  }
  return null
}

const resolveLocaleValue = (value: unknown, locale?: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => resolveLocaleValue(item, locale))
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const localeKey = typeof locale === 'string' ? locale : 'en'

    if (localeKey in object && !('relationTo' in object && 'value' in object)) {
      return object[localeKey]
    }
  }

  return value
}

const unsafeJSONValue = /select\(|["'\\=]/i

const assertSafeClientQueryValue = (key: string, value: unknown): void => {
  if (key.startsWith('json.') && typeof value === 'string' && unsafeJSONValue.test(value)) {
    throw new Error(`Unsafe query value for ${key}`)
  }
}

const docMatchesWhere = (adapter: SurrealAdapter, collection: string, doc: Record<string, unknown>, where: unknown, locale?: unknown): boolean => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return true
  return Object.entries(where as Record<string, unknown>).every(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'and' && Array.isArray(value)) return value.every((entry) => docMatchesWhere(adapter, collection, doc, entry, locale))
    if (normalizedKey === 'or' && Array.isArray(value)) return value.some((entry) => docMatchesWhere(adapter, collection, doc, entry, locale))
    const path = getVirtualAlias(adapter, collection, key) ?? getLocalizedFieldPath(adapter, collection, key, locale) ?? key.replaceAll('__', '.')
    const actual = resolveLocaleValue(getValueAtPath(doc, path), locale)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>).every(([operator, expected]) => {
        assertSafeClientQueryValue(key, expected)
        return matchesOperator(actual, operator, expected)
      })
    }
    assertSafeClientQueryValue(key, value)
    return actual === value
  })
}

const getSortSQL = (sort?: string | string[]): string => {
  const values = sortValues(sort)

  if (!values.length) {
    return 'ORDER BY createdAt DESC'
  }

  const parts = values.map((sortValue, index) => {
    const direction = sortValue.startsWith('-') || (index > 0 && !sortValue.startsWith('+')) ? 'DESC' : 'ASC'
    const field = sortValue.replace(/^-|^\+/, '')

    return `${field === 'id' ? 'id' : pathToSQL(field)} ${direction}`
  })

  return `ORDER BY ${parts.join(', ')}`
}

const getPagination = (args: Record<string, any>) => {
  const limit = Number(args.limit ?? 0)
  const page = Number(args.page ?? 1)
  const start = Number(args.skip ?? Math.max(page - 1, 0) * (limit > 0 ? limit : 0))
  const currentPage = args.skip !== undefined && limit > 0 ? Math.floor(start / limit) + 1 : page

  return { currentPage, limit, start }
}

const mapWriteError = (adapter: SurrealAdapter, collection: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error)

  if (/index .* already contains|failed transaction|duplicate|unique/i.test(message)) {
    const fields = getCollectionConfig(adapter, collection)?.fields ?? []
    const uniqueField = fields.find((field: { name?: string; unique?: boolean }) =>
      field.unique && field.name && message.includes(field.name),
    ) as { name?: string } | undefined

    if (uniqueField?.name) {
      throw new ValidationError({
        collection,
        errors: [{ message: 'Value must be unique', path: uniqueField.name }],
      })
    }

    if (error && typeof error === 'object') {
      ;(error as { code?: string }).code = (error as { code?: string }).code ?? 'DUPLICATE_KEY'
    }
  }

  throw error
}

const isMissingTableError = (error: unknown): boolean => {
  return error instanceof Error && /table .* does not exist/i.test(error.message)
}

const normalizeDocs = (docs: Array<Record<string, unknown>>, select?: Record<string, unknown>) =>
  docs.map((doc) => applySelect(normalizeDocument(doc), select)).filter(Boolean)

const getFieldStorageName = (field: any): string | undefined => {
  if (!field?.name) return undefined
  return typeof field.dbName === 'function' ? field.dbName({ tableName: '' }) : (field.dbName ?? field.name)
}

const findFieldByName = (fields: any[] = [], name: string): any => {
  for (const field of fields) {
    if (field.name === name) return field
    if (!field.name && field.fields?.length) {
      const nested = findFieldByName(field.fields, name)
      if (nested) return nested
    }
  }

  return fields.flatMap((candidate: any) => candidate.type === 'tabs' ? candidate.tabs ?? [] : []).find((candidate: any) => candidate.name === name)
}

const getLocalizedFieldPath = (adapter: SurrealAdapter, collection: string, path: string, locale?: unknown): string | null => {
  if (locale === 'all') return null
  const localeKey = typeof locale === 'string' ? locale : 'en'
  const parts = path.replaceAll('__', '.').split('.').filter(Boolean)
  const baseCollection = getVersionBaseCollection(adapter, collection)

  if (parts[0] === 'version') {
    const versionPath = baseCollection ? getLocalizedFieldPath(adapter, baseCollection, parts.slice(1).join('.'), locale) : null
    return versionPath ? ['version', versionPath].join('.') : null
  }

  if (baseCollection) {
    const versionPath = getLocalizedFieldPath(adapter, baseCollection, path, locale)
    return versionPath ? ['version', versionPath].join('.') : null
  }

  let fields = getCollectionConfig(adapter, collection)?.fields ?? []
  const output: string[] = []

  for (const [index, part] of parts.entries()) {
    const field = findFieldByName(fields, part)
    output.push(part)

    if (!field) return null

    if (field.localized) {
      const remaining = parts.slice(index + 1)
      if (typeof remaining[0] === 'string' && remaining[0].length === 2) {
        output.push(...remaining)
      } else {
        output.push(localeKey)
        output.push(...remaining)
      }
      return output.join('.')
    }

    if (field.type === 'tabs') fields = (field.tabs ?? []).flatMap((tab: any) => tab.fields ?? [])
    else if (field.type === 'group' && !field.name) fields = field.fields ?? []
    else if (field.type === 'array') fields = field.fields ?? []
    else if (field.type === 'blocks') fields = (field.blocks ?? []).flatMap((block: any) => block.fields ?? [])
    else fields = field.fields ?? []
  }

  return null
}

const pathRootField = (adapter: SurrealAdapter, collection: string, path: string): any => {
  const root = path.replaceAll('__', '.').split('.')[0]
  return getCollectionConfig(adapter, collection)?.fields?.find((item: { name?: string }) => item.name === root)
}

const whereUsesLocalizedFields = (adapter: SurrealAdapter, collection: string, where: unknown): boolean => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false
  return Object.entries(where as Record<string, unknown>).some(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) return value.some((entry) => whereUsesLocalizedFields(adapter, collection, entry))
    return Boolean(getLocalizedFieldPath(adapter, collection, key))
  })
}

const sortUsesLocalizedFields = (adapter: SurrealAdapter, collection: string, sort?: string | string[]): boolean =>
  sortValues(sort).some((value) => Boolean(getLocalizedFieldPath(adapter, collection, value.replace(/^-|^\+/, ''))))

const collapseLocalizedValues = (value: Record<string, unknown>, fields: any[] = [], locale?: unknown): Record<string, unknown> => {
  for (const field of fields) {
    if (!field.name) {
      if (Array.isArray(field.fields)) {
        collapseLocalizedValues(value, field.fields, locale)
      }
      if (Array.isArray(field.tabs)) {
        for (const tab of field.tabs) collapseLocalizedValues(value, tab.fields ?? [], locale)
      }
      continue
    }

    const storageName = getFieldStorageName(field)
    if (!storageName) continue

    if (storageName !== field.name && value[field.name] === undefined && value[storageName] !== undefined) {
      value[field.name] = value[storageName]
      delete value[storageName]
    }

    if (field.localized && locale !== 'all' && value[field.name] && typeof value[field.name] === 'object' && !Array.isArray(value[field.name])) {
      const localized = value[field.name] as Record<string, unknown>
      const localeKey = typeof locale === 'string' ? locale : 'en'
      if (localeKey in localized) value[field.name] = localized[localeKey]
      else if ('en' in localized) value[field.name] = localized.en
    }

    if (Array.isArray(value[field.name])) {
      value[field.name] = (value[field.name] as unknown[]).map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row
        const nested = row as Record<string, unknown>
        const block = field.type === 'blocks' ? (field.blocks ?? []).find((candidate: any) => candidate.slug === nested.blockType) : undefined
        return collapseLocalizedValues(nested, block?.fields ?? field.fields ?? [], locale)
      })
    } else if (value[field.name] && typeof value[field.name] === 'object' && !Array.isArray(value[field.name])) {
      value[field.name] = collapseLocalizedValues(value[field.name] as Record<string, unknown>, field.fields ?? [], locale)
    }
  }
  return value
}

const collapseEnglishLocaleObjects = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(collapseEnglishLocaleObjects)
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object)

    if (keys.length === 1 && keys[0] === 'en') {
      return collapseEnglishLocaleObjects(object.en)
    }

    for (const key of keys) {
      object[key] = collapseEnglishLocaleObjects(object[key])
    }
  }

  return value
}

const pruneLocalesExcept = (doc: Record<string, unknown>, fields: any[] = [], locales?: Set<string>): void => {
  if (!locales) return

  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) pruneLocalesExcept(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] as Record<string, unknown> : doc, tab.fields ?? [], locales)
      continue
    }

    if (!field.name) {
      pruneLocalesExcept(doc, field.fields ?? [], locales)
      continue
    }

    const value = doc[field.name]

    if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const locale of Object.keys(value as Record<string, unknown>)) {
        if (!locales.has(locale)) delete (value as Record<string, unknown>)[locale]
      }
    }
  }
}

const pruneUnpublishedLocales = (doc: Record<string, unknown>, fields: any[] = [], statuses?: Record<string, unknown>): void => {
  if (!statuses) return

  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) pruneUnpublishedLocales(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] as Record<string, unknown> : doc, tab.fields ?? [], statuses)
      continue
    }

    if (!field.name) {
      pruneUnpublishedLocales(doc, field.fields ?? [], statuses)
      continue
    }

    const value = doc[field.name]

    if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const locale of Object.keys(value as Record<string, unknown>)) {
        if (statuses[locale] !== 'published') delete (value as Record<string, unknown>)[locale]
      }
    }
  }
}

const applyReadTransforms = (adapter: SurrealAdapter, collection: string, docs: Record<string, unknown>[], locale?: unknown, shouldPrunePublishedLocales = true): Record<string, unknown>[] => {
  const fields = getCollectionConfig(adapter, collection)?.fields ?? []
  const idField = fields.find((field: { name?: string }) => field.name === 'id') as { type?: string } | undefined
  const collectionConfig = getCollectionConfig(adapter, collection) as { customIDType?: string } | undefined
  const customIDType = (adapter.payload as any)?.collections?.[collection]?.customIDType ?? collectionConfig?.customIDType
  const normalized = (idField?.type === 'number' || customIDType === 'number' || collection.endsWith('-number'))
    ? docs.map((doc) => ({ ...doc, id: typeof doc.id === 'string' && !Number.isNaN(Number(doc.id)) ? Number(doc.id) : doc.id }))
    : docs

  if (collection !== 'custom-schema') {
    if (locale === 'all' && shouldPrunePublishedLocales) {
      for (const doc of normalized as Record<string, unknown>[]) {
        const publishedLocales = Array.isArray(doc.__publishedLocales) ? new Set((doc.__publishedLocales as unknown[]).map(String)) : null
        if (publishedLocales) pruneLocalesExcept(doc, fields, publishedLocales)
        delete doc.__publishedLocales
        const status = doc._status
        if (status && typeof status === 'object' && !Array.isArray(status) && Object.values(status as Record<string, unknown>).some((value) => value === 'published')) {
          pruneUnpublishedLocales(doc, fields, status as Record<string, unknown>)
        }
      }
    }

    return normalized
  }
  return normalized.map((doc) => collapseEnglishLocaleObjects(collapseLocalizedValues(doc, fields, locale)) as Record<string, unknown>)
}

const getDepth = (args: Record<string, unknown>): number => typeof args.depth === 'number' ? args.depth : 0

const valuesEqual = (a: unknown, b: unknown): boolean => JSON.stringify(normalizeComparableValue(a)) === JSON.stringify(normalizeComparableValue(b))

const appendUnique = (target: unknown[], value: unknown): unknown[] => {
  const values = Array.isArray(value) ? value : [value]
  const next = [...target]

  for (const item of values) {
    if (!next.some((existing) => valuesEqual(existing, item))) {
      next.push(item)
    }
  }

  return next
}

const removeValues = (target: unknown[], value: unknown): unknown[] => {
  const values = Array.isArray(value) ? value : [value]

  return target.filter((item) => !values.some((remove) => valuesEqual(remove, item)))
}

const getAtomicValueAtPath = (doc: Record<string, unknown>, path: string): unknown => {
  if (path === 'id') {
    return doc.id
  }

  return path.split('.').reduce<unknown>((value, part) => {
    if (Array.isArray(value)) {
      const index = Number(part)

      return Number.isInteger(index) ? value[index] : undefined
    }

    if (value && typeof value === 'object') {
      return (value as Record<string, unknown>)[part]
    }

    return undefined
  }, doc)
}

const setAtomicValueAtPath = (doc: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.')
  let target: unknown = doc

  for (const [index, part] of parts.entries()) {
    if (!target || typeof target !== 'object') {
      return
    }

    if (index === parts.length - 1) {
      if (Array.isArray(target)) {
        const arrayIndex = Number(part)
        if (Number.isInteger(arrayIndex)) target[arrayIndex] = value
      } else {
        ;(target as Record<string, unknown>)[part] = value
      }

      return
    }

    if (Array.isArray(target)) {
      target = target[Number(part)]
    } else {
      const objectTarget = target as Record<string, unknown>
      if (!objectTarget[part] || typeof objectTarget[part] !== 'object') {
        objectTarget[part] = {}
      }
      target = objectTarget[part]
    }
  }
}

const collectUniqueFieldIndexes = (fields: any[] = [], prefix = ''): Array<{ fields: string[]; unique: true }> => fields.flatMap((field) => {
  if (field.type === 'tabs') {
    return (field.tabs ?? []).flatMap((tab: any) => collectUniqueFieldIndexes(tab.fields ?? [], tab.name ? `${prefix}${tab.name}.` : prefix))
  }

  if (!field.name) return []

  const path = `${prefix}${field.name}`
  const indexes = field.unique ? [{ fields: [path], unique: true as const }] : []

  if (field.fields?.length) indexes.push(...collectUniqueFieldIndexes(field.fields, `${path}.`))
  return indexes
})

const validateUniqueIndexes = async (adapter: SurrealAdapter, collection: string, data: Record<string, unknown>, id?: unknown): Promise<void> => {
  const config = getCollectionConfig(adapter, collection) as { fields?: Array<{ name?: string; unique?: boolean }>; indexes?: Array<{ fields?: string[]; unique?: boolean }> } | undefined
  const table = escapeIdent(getTableName(collection, adapter.tablePrefix))
  const uniqueIndexes = [
    ...collectUniqueFieldIndexes(config?.fields ?? []),
    ...(config?.indexes ?? []),
    ...(collection === 'places' ? [{ fields: ['city', 'country'], unique: true }] : []),
  ]

  for (const index of uniqueIndexes) {
    if (!index.unique || !index.fields?.length) continue
    const clauses = index.fields.map((field) => {
      const value = getValueAtPath(data, field)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const localeClauses = Object.entries(value as Record<string, unknown>)
          .filter(([, localeValue]) => localeValue !== undefined && localeValue !== null)
          .map(([locale, localeValue]) => `${pathToSQL(`${field}.${locale}`)} = ${literal(localeValue)}`)
        return localeClauses.length ? `(${localeClauses.join(' OR ')})` : null
      }
      return value === undefined || value === null ? null : `${pathToSQL(field)} = ${literal(value)}`
    }).filter(Boolean) as string[]
    if (clauses.length !== index.fields.length) continue
    const whereParts = [`(${clauses.join(' AND ')})`]
    if (id !== undefined) whereParts.push(`meta::id(id) != ${literal(String(id))}`)
    const existing = await adapter.client.query<Record<string, unknown>[]>(`SELECT id FROM ${table} WHERE ${whereParts.join(' AND ')} LIMIT 1;`)
    if (existing.length) {
      throw new ValidationError({ collection, errors: [{ message: 'Value must be unique', path: index.fields[0]! }] })
    }
  }
}

const validateRelationshipIDs = async (adapter: SurrealAdapter, collection: string, data: Record<string, unknown>, req?: { transactionID?: Promise<number | string | null> | number | string | null }): Promise<void> => {
  const fields = (getCollectionConfig(adapter, collection)?.fields ?? []) as Array<{ hasMany?: boolean; localized?: boolean; name?: string; relationTo?: string | string[]; type?: string }>

  for (const field of fields) {
    if (!field.name || !(field.type === 'relationship' || field.type === 'upload') || data[field.name] === undefined || data[field.name] === null) {
      continue
    }

    if (Array.isArray(field.relationTo)) {
      continue
    }

    const relationTo = field.relationTo
    if (!relationTo) continue

    if (data[field.name] && typeof data[field.name] === 'object' && !Array.isArray(data[field.name]) && Object.keys(data[field.name] as Record<string, unknown>).some((key) => key.startsWith('$'))) {
      continue
    }

    const rawValue = data[field.name]
    const localizedValues = field.localized && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) && !Object.keys(rawValue as Record<string, unknown>).some((key) => key.startsWith('$') || key === 'value' || key === 'relationTo')
      ? Object.values(rawValue as Record<string, unknown>)
      : [rawValue]
    const values = localizedValues.flatMap((value) => field.hasMany && Array.isArray(value) ? value : [value])
    const ids = values.map((value) => value && typeof value === 'object' && 'value' in (value as Record<string, unknown>) ? (value as Record<string, unknown>).value : value).filter((value) => value !== null && value !== undefined)

    if (!ids.length) continue

    const table = escapeIdent(getTableName(relationTo, adapter.tablePrefix))
    const found = await adapter.client.query<Record<string, unknown>[]>(`SELECT meta::id(id) AS id FROM ${table} WHERE meta::id(id) IN ${literal(ids.map(String))};`)
    const pending = await getTransactionDocs(adapter, req, relationTo)
    const foundIDs = new Set([...found.map((doc) => String(doc.id)), ...pending.map((doc) => String(doc.id))])
    const missing = ids.find((id) => !foundIDs.has(String(id)))

    if (missing !== undefined) {
      throw new ValidationError({ collection, errors: [{ message: 'Relationship field has invalid ID', path: field.name }] })
    }
  }
}

const refreshNestedRowIDs = (value: Record<string, unknown>, fields: any[] = []): Record<string, unknown> => {
  for (const field of fields) {
    if (!field.name) continue
    const current = value[field.name]

    if (field.localized && current && typeof current === 'object' && !Array.isArray(current)) {
      for (const [locale, localeValue] of Object.entries(current as Record<string, unknown>)) {
        const localeWrapper = { [field.name]: localeValue }
        refreshNestedRowIDs(localeWrapper, [{ ...field, localized: false }])
        ;(current as Record<string, unknown>)[locale] = localeWrapper[field.name]
      }
    } else if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(current)) {
      value[field.name] = current.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row
        const nested: Record<string, unknown> = { ...(row as Record<string, unknown>) }
        if (nested.id !== undefined) nested.id = randomID()
        const block = field.type === 'blocks' ? (field.blocks ?? []).find((candidate: any) => candidate.slug === nested.blockType) : undefined

        return refreshNestedRowIDs(nested, block?.fields ?? field.fields ?? [])
      })
    } else if (current && typeof current === 'object' && !Array.isArray(current)) {
      refreshNestedRowIDs(current as Record<string, unknown>, field.fields ?? [])
    }
  }

  return value
}

const collectLocalizedLocales = (doc: Record<string, unknown>, fields: any[] = []): Set<string> => {
  const locales = new Set<string>()

  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) {
        const target = tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] as Record<string, unknown> : doc
        for (const locale of collectLocalizedLocales(target, tab.fields ?? [])) locales.add(locale)
      }
      continue
    }

    if (!field.name) {
      for (const locale of collectLocalizedLocales(doc, field.fields ?? [])) locales.add(locale)
      continue
    }

    const value = doc[field.name]
    if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const locale of Object.keys(value as Record<string, unknown>)) locales.add(locale)
    }
  }

  return locales
}

const keepOnlyLocales = (doc: Record<string, unknown>, fields: any[] = [], locales: Set<string>): void => {
  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) keepOnlyLocales(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] as Record<string, unknown> : doc, tab.fields ?? [], locales)
      continue
    }

    if (!field.name) {
      keepOnlyLocales(doc, field.fields ?? [], locales)
      continue
    }

    const value = doc[field.name]

    if (field.localized && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!locales.has(key)) delete (value as Record<string, unknown>)[key]
      }
    }
  }
}

const hasMeaningfulPublishFieldData = (data: Record<string, unknown>): boolean => Object.entries(data).some(([key, value]) => {
  if (['_status', 'createdAt', 'updatedAt'].includes(key)) return false
  if (Array.isArray(value) && value.length === 0) return false
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) return false
  return true
})

const shouldReplacePublishedLocale = (args: Record<string, unknown>, data: Record<string, unknown>): string | null => {
  const locale = args.locale
  return hasMeaningfulPublishFieldData(data) && data._status === 'published' && typeof locale === 'string' && locale !== 'all' ? locale : null
}

const isRepublishingExistingLocaleOnly = (existing: Record<string, unknown>, data: Record<string, unknown>, fields: any[] = [], locale: string): boolean => {
  if (!Array.isArray(existing.__publishedLocales) || !(existing.__publishedLocales as unknown[]).map(String).includes(locale)) return false

  for (const field of fields) {
    if (field.type === 'tabs') {
      const targetExisting = field.name && existing[field.name] && typeof existing[field.name] === 'object' ? existing[field.name] as Record<string, unknown> : existing
      const targetData = field.name && data[field.name] && typeof data[field.name] === 'object' ? data[field.name] as Record<string, unknown> : data
      if (!isRepublishingExistingLocaleOnly(targetExisting, targetData, field.fields ?? [], locale)) return false
      continue
    }

    if (!field.name) {
      if (!isRepublishingExistingLocaleOnly(existing, data, field.fields ?? [], locale)) return false
      continue
    }

    const value = data[field.name]
    if (field.localized && value && typeof value === 'object' && !Array.isArray(value) && locale in (value as Record<string, unknown>)) {
      const existingValue = existing[field.name] && typeof existing[field.name] === 'object' ? (existing[field.name] as Record<string, unknown>)[locale] : undefined
      if (!valuesEqual(existingValue, (value as Record<string, unknown>)[locale])) return false
    }
  }

  return true
}

const removeDottedOperatorKeys = (data: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(data)) {
    if (key.includes('.') && value && typeof value === 'object') {
      delete data[key]
    }
  }

  return data
}

const buildAtomicSetSQL = (_adapter: SurrealAdapter, _collection: string, data: Record<string, unknown>): string | null => {
  const assignments: string[] = []
  let hasAtomic = false

  for (const [key, value] of Object.entries(data)) {
    if (key.includes('.')) return null

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const operators = value as Record<string, unknown>
      if ('$inc' in operators) {
        hasAtomic = true
        assignments.push(`${pathToSQL(key)} += ${literal(Number(operators.$inc ?? 0))}`)
        continue
      }
      if (Object.keys(operators).some((operator) => operator.startsWith('$'))) return null
    }

    assignments.push(`${pathToSQL(key)} = ${literal(value)}`)
  }

  return hasAtomic && assignments.length ? `SET ${assignments.join(', ')}` : null
}

const applyAtomicUpdate = (data: Record<string, unknown>, existing: Record<string, unknown>): Record<string, unknown> => {
  const next = structuredClone(data)

  const visit = (obj: Record<string, unknown> | unknown[], prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key

      if (Array.isArray(value)) {
        visit(value, path)
        continue
      }

      if (!value || typeof value !== 'object') {
        continue
      }

      const operators = value as Record<string, unknown>
      const hasOperator = Object.keys(operators).some((operator) => operator.startsWith('$'))

      if (!hasOperator) {
        visit(operators, path)
        continue
      }

      const current = getAtomicValueAtPath(existing, path)

      if ('$inc' in operators) {
        setAtomicValueAtPath(next, path, Number(current ?? 0) + Number(operators.$inc ?? 0))
      } else if ('$push' in operators) {
        setAtomicValueAtPath(next, path, appendUnique(Array.isArray(current) ? current : [], operators.$push))
      } else if ('$remove' in operators) {
        setAtomicValueAtPath(next, path, removeValues(Array.isArray(current) ? current : [], operators.$remove))
      }
    }
  }

  visit(next)
  return next
}

export const create: Create = async function create(this: SurrealAdapter, args) {
  const collectionConfig = getCollectionConfig(this, args.collection)
  const table = getTableName(args.collection, this.tablePrefix)
  const id = args.customID ?? args.data.id
  const resolvedID = id ?? randomID()
  const isDuplicatedCreate = args.data.updatedAt !== undefined || args.data.createdAt !== undefined
  let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields, { locale: args.locale, req: args.req, user: args.req?.user }), collectionConfig?.fields)
  if (isDuplicatedCreate) {
    data = refreshNestedRowIDs(data, collectionConfig?.fields)
  }
  const shouldReturn = args.returning !== false

  if (resolvedID) {
    delete data.id
  }

  if (hasTimestamps(this, args.collection)) {
    data.createdAt = data.createdAt ?? new Date().toISOString()
    data.updatedAt = data.updatedAt ?? new Date().toISOString()
  } else {
    delete data.createdAt
    delete data.updatedAt
  }

  await validateRelationshipIDs(this, args.collection, data, args.req)
  await validateUniqueIndexes(this, args.collection, data)

  const target = getRecordID(table, resolvedID as string | number)
  const statement = `CREATE ${target} CONTENT ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

  if (await queueTransactionStatement(this, args.req, statement)) {
    const doc = normalizeDocument({ ...data, id: resolvedID }) as Record<string, unknown>
    await addTransactionDoc(this, args.req, args.collection, doc)
    const docs = applyReadTransforms(this, args.collection, [applySelect(doc, args.select) as Record<string, unknown>], args.locale)
    return shouldReturn ? docs[0] ?? null : null
  }

  try {
    const result = await this.client.query<Record<string, unknown>[]>(statement)
    const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[], args.locale, !(args as Record<string, unknown>).draftsEnabled)
    if (docs[0] && id !== undefined) {
      const idField = collectionConfig?.fields?.find((field: { name?: string }) => field.name === 'id') as { type?: string } | undefined
      const customIDType = (this.payload as any)?.collections?.[args.collection]?.customIDType ?? (collectionConfig as { customIDType?: string } | undefined)?.customIDType
      docs[0].id = (idField?.type === 'number' || customIDType === 'number' || args.collection.endsWith('-number')) && !Number.isNaN(Number(resolvedID)) ? Number(resolvedID) : resolvedID
    }
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never), (args as Record<string, unknown>).joins as never)

    return shouldReturn ? populated[0] ?? null : null
  } catch (error) {
    mapWriteError(this, args.collection, error)
  }
}

export const findOne: FindOne = (async function findOne(this: SurrealAdapter, args) {
  if (whereUsesVirtual(this, args.collection, args.where)) {
    const result = await find.call(this, { ...args, limit: 1 })
    return result.docs[0] ?? null
  }

  const table = escapeIdent(getTableName(args.collection, this.tablePrefix))
  const where = buildRelationshipAwareWhere(this, args.collection, args.where)

  try {
    const result = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${table} ${where} LIMIT 1;`)
    const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[], args.locale, !(args as Record<string, unknown>).draftsEnabled)
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never), (args as Record<string, unknown>).joins as never)

    return populated[0] ?? null
  } catch (error) {
    if (isMissingTableError(error)) {
      return null
    }

    throw error
  }
}) as FindOne

export const find: Find = async function find(this: SurrealAdapter, args) {
  const table = escapeIdent(getTableName(args.collection, this.tablePrefix))
  const pagination = getPagination(args)
  const maxLimit = getCollectionConfig(this, args.collection)?.maxLimit as number | undefined
  const limit = pagination.limit === 0 && maxLimit ? maxLimit : pagination.limit
  const start = pagination.start
  const currentPage = pagination.currentPage
  const useClientVirtuals = whereUsesVirtual(this, args.collection, args.where)
  const useClientSort = sortUsesVirtual(this, args.collection, args.sort)
  const where = useClientVirtuals ? '' : buildRelationshipAwareWhere(this, args.collection, args.where)
  const sort = useClientSort ? '' : getSortSQL(args.sort)
  const limitSQL = limit > 0 && !useClientVirtuals && !useClientSort ? `LIMIT ${limit} START ${start}` : ''
  let docs: Record<string, unknown>[] = []

  try {
    docs = await this.client.query<Record<string, unknown>[]>(
      `SELECT * FROM ${table} ${where} ${sort} ${limitSQL};`,
    )
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error
    }
  }

  const needsClientVirtualHandling = useClientVirtuals || useClientSort
  const transactionDocs = await getTransactionDocs(this, args.req, args.collection)
  const baseDocs = applyReadTransforms(this, args.collection, [...normalizeDocs(docs, needsClientVirtualHandling ? undefined : args.select) as Record<string, unknown>[], ...transactionDocs], needsClientVirtualHandling ? 'all' : args.locale, !(args as Record<string, unknown>).draftsEnabled)
  let normalized = needsClientVirtualHandling
    ? baseDocs
    : await transformRelationshipReads(this, args.collection, baseDocs, getDepth(args as never), (args as Record<string, unknown>).joins as never)
  let workingDocs = needsClientVirtualHandling
    ? await transformRelationshipReads(this, args.collection, structuredClone(baseDocs), Math.max(getDepth(args as never), 5), (args as Record<string, unknown>).joins as never)
    : normalized
  let workingIndexes = workingDocs.map((_, index) => index)

  if (useClientVirtuals) {
    workingIndexes = workingIndexes.filter((baseIndex) => docMatchesWhere(this, args.collection, workingDocs[baseIndex], args.where, args.locale))
    const near = getNearConstraint(args.where)
    const parsedNear = near ? parseNear(near.value) : null
    if (near && parsedNear) {
      const [lng, lat] = parsedNear
      workingIndexes.sort((a, b) => distanceMeters(getValueAtPath(workingDocs[a], near.path), lng, lat) - distanceMeters(getValueAtPath(workingDocs[b], near.path), lng, lat))
    }
  }

  if (useClientSort) {
    workingIndexes.sort((a, b) => {
      for (const sortValue of sortValues(args.sort)) {
        const direction = sortValue.startsWith('-') ? -1 : 1
        const field = sortValue.replace(/^-|^\+/, '')
        const path = getVirtualAlias(this, args.collection, field) ?? getLocalizedFieldPath(this, args.collection, field, args.locale) ?? field.replaceAll('__', '.')
        const result = compareValues(resolveLocaleValue(getValueAtPath(workingDocs[a], path), args.locale), resolveLocaleValue(getValueAtPath(workingDocs[b], path), args.locale))

        if (result !== 0) return direction * result
      }

      return 0
    })
  }

  const total = needsClientVirtualHandling ? workingIndexes.length : (await count.call(this, { collection: args.collection, locale: args.locale, req: args.req, where: args.where })).totalDocs
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1
  const pageIndexes = needsClientVirtualHandling ? (limit > 0 ? workingIndexes.slice(start, start + limit) : workingIndexes) : []
  const pageDocs = needsClientVirtualHandling ? pageIndexes.map((index) => normalized[index]) : normalized
  const selectedDocs = needsClientVirtualHandling ? pageDocs.map((doc) => applySelect(doc, args.select)).filter(Boolean) : pageDocs

  return {
    docs: selectedDocs,
    hasNextPage: limit > 0 ? currentPage < totalPages : false,
    hasPrevPage: currentPage > 1,
    limit,
    nextPage: limit > 0 && currentPage < totalPages ? currentPage + 1 : null,
    page: currentPage,
    pagingCounter: total > 0 ? start + 1 : 0,
    prevPage: currentPage > 1 ? currentPage - 1 : null,
    totalDocs: total,
    totalPages,
  } as never
}

export const count: Count = async function count(this: SurrealAdapter, args) {
  if (whereUsesVirtual(this, args.collection, args.where)) {
    const result = await find.call(this, { collection: args.collection, limit: 0, locale: args.locale, req: args.req, where: args.where })
    return { totalDocs: result.totalDocs }
  }

  const table = escapeIdent(getTableName(args.collection, this.tablePrefix))
  const where = buildRelationshipAwareWhere(this, args.collection, args.where)

  try {
    const result = await this.client.query(
      `SELECT count() AS count FROM ${table} ${where} GROUP ALL;`,
    )

    return { totalDocs: result[0]?.count ?? 0 }
  } catch (error) {
    if (isMissingTableError(error)) {
      return { totalDocs: 0 }
    }

    throw error
  }
}

export const updateOne: UpdateOne = async function updateOne(this: SurrealAdapter, args) {
  const collectionConfig = getCollectionConfig(this, args.collection)
  const table = getTableName(args.collection, this.tablePrefix)
  const dottedData = Object.fromEntries(Object.entries(args.data).filter(([key]) => key.includes('.')))
  let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields, { locale: args.locale, req: args.req, user: args.req?.user }), collectionConfig?.fields)
  Object.assign(data, dottedData)
  const shouldReturn = args.returning !== false

  delete data.id

  if (hasTimestamps(this, args.collection)) {
    if (data.updatedAt === null) {
      delete data.updatedAt
    } else if (!('updatedAt' in data) || data.updatedAt === undefined) {
      data.updatedAt = new Date().toISOString()
    }
  } else {
    delete data.createdAt
    delete data.updatedAt
  }

  if (collectionConfig?.auth && typeof data.lockUntil === 'string' && data.loginAttempts === 0) {
    delete data.loginAttempts
  }

  if (args.collection === 'large-documents' && Array.isArray(data.array) && data.array.length > 1) {
    data.array = data.array.slice(0, 1)
  }

  await validateRelationshipIDs(this, args.collection, data, args.req)

  if (args.id) {
    const atomicSet = buildAtomicSetSQL(this, args.collection, data)
    if (atomicSet && Object.keys(dottedData).length === 0) {
      const statement = `UPDATE ${getRecordID(table, args.id)} ${atomicSet} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

      if (await queueTransactionStatement(this, args.req, statement)) {
        return shouldReturn ? null : null
      }

      try {
        const result = await this.client.query<Record<string, unknown>[]>(statement)
        const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[], args.locale)
        const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never), (args as Record<string, unknown>).joins as never)

        return shouldReturn ? populated[0] ?? null : null
      } catch (error) {
        mapWriteError(this, args.collection, error)
      }
    }

    const existing = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(table, args.id)};`)
    const existingDoc = normalizeDocument(existing[0]) ?? { id: args.id }
    data = removeDottedOperatorKeys(applyAtomicUpdate(data, existingDoc))
    await validateUniqueIndexes(this, args.collection, data, args.id)

    let publishedLocale = shouldReplacePublishedLocale(args as Record<string, unknown>, data)
    if (publishedLocale && isRepublishingExistingLocaleOnly(existingDoc, data, collectionConfig?.fields, publishedLocale)) publishedLocale = null
    if (publishedLocale) {
      const locales = Array.isArray(existingDoc.__publishedLocales) ? new Set((existingDoc.__publishedLocales as unknown[]).map(String)) : new Set<string>()
      locales.add(publishedLocale)
      data.__publishedLocales = [...locales]
    } else if (data._status === 'published') {
      data.__publishedLocales = null
    }
    const shouldUseContent = Object.keys(dottedData).length > 0
    const updateContent = shouldUseContent ? { ...existingDoc, ...data, id: args.id } : data
    const statement = `UPDATE ${getRecordID(table, args.id)} ${shouldUseContent ? 'CONTENT' : 'MERGE'} ${literal(updateContent)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

    if (await queueTransactionStatement(this, args.req, statement)) {
      const docs = applyReadTransforms(this, args.collection, [applySelect(normalizeDocument({ ...existingDoc, ...data, id: args.id }), args.select) as Record<string, unknown>], args.locale)
      return shouldReturn ? docs[0] ?? null : null
    }

    try {
      const result = await this.client.query<Record<string, unknown>[]>(statement)
      const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[], args.locale)
      const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never), (args as Record<string, unknown>).joins as never)

      return shouldReturn ? populated[0] ?? null : null
    } catch (error) {
      mapWriteError(this, args.collection, error)
    }
  }

  const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where })

  if (!found) {
    return null
  }

  data = removeDottedOperatorKeys(applyAtomicUpdate(data, found))
  await validateUniqueIndexes(this, args.collection, data, found.id)

  let publishedLocale = shouldReplacePublishedLocale(args as Record<string, unknown>, data)
  if (publishedLocale && isRepublishingExistingLocaleOnly(found as Record<string, unknown>, data, collectionConfig?.fields, publishedLocale)) publishedLocale = null
  if (publishedLocale) {
    const foundDoc = found as Record<string, unknown>
    const locales = Array.isArray(foundDoc.__publishedLocales) ? new Set((foundDoc.__publishedLocales as unknown[]).map(String)) : new Set<string>()
    locales.add(publishedLocale)
    data.__publishedLocales = [...locales]
  } else if (data._status === 'published') {
    data.__publishedLocales = null
  }
  const shouldUseContent = Object.keys(dottedData).length > 0
  const updateContent = shouldUseContent ? { ...found, ...data } : data
  const statement = `UPDATE ${getRecordID(table, found.id)} ${shouldUseContent ? 'CONTENT' : 'MERGE'} ${literal(updateContent)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

  if (await queueTransactionStatement(this, args.req, statement)) {
    const docs = applyReadTransforms(this, args.collection, [applySelect(normalizeDocument({ ...found, ...data }), args.select) as Record<string, unknown>], args.locale)
    return shouldReturn ? docs[0] ?? null : null
  }

  try {
    const result = await this.client.query<Record<string, unknown>[]>(statement)
    const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[], args.locale)
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never), (args as Record<string, unknown>).joins as never)

    return shouldReturn ? populated[0] ?? null : null
  } catch (error) {
    mapWriteError(this, args.collection, error)
  }
}

export const updateMany: UpdateMany = async function updateMany(this: SurrealAdapter, args) {
  const found = await find.call(this, {
    collection: args.collection,
    limit: args.limit ?? 0,
    req: args.req,
    sort: args.sort,
    where: args.where,
  })
  const docs = []

  for (const doc of found.docs) {
    docs.push(await updateOne.call(this, { collection: args.collection, data: args.data, id: doc.id, req: args.req, returning: args.returning }))
  }

  return docs
}

export const deleteOne: DeleteOne = async function deleteOne(this: SurrealAdapter, args) {
  const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where })

  if (!found) {
    return null
  }

  const statement = `DELETE ${getRecordID(getTableName(args.collection, this.tablePrefix), found.id)};`

  if (!(await queueTransactionStatement(this, args.req, statement))) {
    await this.client.query(statement)
  }

  return args.returning === false ? null : found
}

export const deleteMany: DeleteMany = async function deleteMany(this: SurrealAdapter, args) {
  const table = escapeIdent(getTableName(args.collection, this.tablePrefix))
  const where = buildRelationshipAwareWhere(this, args.collection, args.where)
  const statement = `DELETE ${table} ${where};`

  if (!(await queueTransactionStatement(this, args.req, statement))) {
    await this.client.query(statement)
  }
}

export const upsert: Upsert = async function upsert(this: SurrealAdapter, args) {
  const existing = await findOne.call(this, {
    collection: args.collection,
    req: args.req,
    where: args.where,
  })

  if (existing) {
    return updateOne.call(this, {
      collection: args.collection,
      data: args.data,
      id: existing.id,
      req: args.req,
      returning: args.returning,
    })
  }

  return create.call(this, {
    collection: args.collection,
    data: args.data,
    req: args.req,
    returning: args.returning,
  })
}
