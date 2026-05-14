import type { SurrealAdapter } from '../index.js'

import { buildWhere } from '../queries/buildWhere.js'
import { getCollectionConfig } from './fields.js'
import { escapeIdent, literal, normalizeDocument } from './sql.js'

type Field = {
  blocks?: Array<{
    fields?: Field[]
    slug?: string
  }>
  collection?: string
  defaultLimit?: number
  fields?: Field[]
  hasMany?: boolean
  limit?: number
  localized?: boolean
  name?: string
  on?: string
  relationTo?: string | string[]
  sort?: string | string[]
  tabs?: Array<{
    fields?: Field[]
    name?: string
  }>
  type?: string
}

type RelationshipRef = {
  relationTo: string
  value: unknown
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isRelationshipField = (field: Field): boolean => field.type === 'relationship' || field.type === 'upload'
const isPolymorphic = (field: Field): boolean => Array.isArray(field.relationTo)

export const relationshipStorageSemantics = {
  simple: 'relationship/upload fields store the related document id as a string/number scalar',
  simpleHasMany: 'hasMany relationship/upload fields store an array of related ids',
  polymorphic: 'polymorphic relationship fields store { relationTo, value } objects, or arrays of them for hasMany',
} as const

const getRefID = (value: unknown): unknown => {
  if (isPlainObject(value)) {
    if ('id' in value) {
      return value.id
    }

    if ('value' in value && Object.keys(value).length <= 2) {
      return getRefID(value.value)
    }
  }

  return value
}

const normalizePolymorphicRef = (value: unknown): RelationshipRef | unknown => {
  if (!isPlainObject(value) || typeof value.relationTo !== 'string') {
    return value
  }

  return {
    relationTo: value.relationTo,
    value: getRefID(value.value),
  }
}

const normalizeRelationshipValue = (field: Field, value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value
  }

  if (isPlainObject(value) && Object.keys(value).some((key) => key.startsWith('$'))) {
    return Object.fromEntries(
      Object.entries(value).map(([operator, operatorValue]) => [
        operator,
        operator === '$push' || operator === '$remove'
          ? normalizeRelationshipValue(field, operatorValue)
          : operatorValue,
      ]),
    )
  }

  if (isPolymorphic(field)) {
    return field.hasMany && Array.isArray(value) ? value.map(normalizePolymorphicRef) : normalizePolymorphicRef(value)
  }

  return field.hasMany && Array.isArray(value) ? value.map(getRefID) : getRefID(value)
}

const getNestedFields = (field: Field, value?: unknown): Field[] => {
  if (field.type === 'tabs') {
    return (field.tabs ?? []).flatMap((tab) => tab.fields ?? [])
  }

  if (field.type === 'blocks' && isPlainObject(value)) {
    const block = (field.blocks ?? []).find((candidate) => candidate.slug === value.blockType)

    return block?.fields ?? []
  }

  return field.fields ?? []
}

const transformRelationshipValueWrites = (value: unknown, field: Field): unknown => {
  if (value === null || value === undefined) {
    return value
  }

  if (field.localized && isPlainObject(value) && !Object.keys(value).some((key) => key.startsWith('$'))) {
    return Object.fromEntries(
      Object.entries(value).map(([locale, localeValue]) => [
        locale,
        transformRelationshipValueWrites(localeValue, { ...field, localized: false }),
      ]),
    )
  }

  if (isRelationshipField(field)) {
    return normalizeRelationshipValue(field, value)
  }

  if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
    return value.map((row) => isPlainObject(row) ? transformRelationshipWrites(row, getNestedFields(field, row)) : row)
  }

  const nestedFields = getNestedFields(field, value)

  if (nestedFields.length && isPlainObject(value)) {
    return transformRelationshipWrites(value, nestedFields)
  }

  return value
}

export const transformRelationshipWrites = (data: Record<string, unknown>, fields: Field[] = []): Record<string, unknown> => {
  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) {
        if (tab.name) {
          if (isPlainObject(data[tab.name])) {
            transformRelationshipWrites(data[tab.name] as Record<string, unknown>, tab.fields ?? [])
          }
        } else {
          transformRelationshipWrites(data, tab.fields ?? [])
        }
      }

      continue
    }

    if (!field.name || !(field.name in data)) {
      continue
    }

    data[field.name] = transformRelationshipValueWrites(data[field.name], field)
  }

  return data
}

const collectRelationshipFields = (fields: Field[] = []): Field[] => fields.filter(isRelationshipField)
const collectJoinFields = (fields: Field[] = []): Field[] => fields.filter((field) => field.type === 'join' && field.name)

const getSortSQL = (sort?: string | string[]): string => {
  const sortValue = Array.isArray(sort) ? sort[0] : sort

  if (!sortValue) {
    return 'ORDER BY createdAt DESC'
  }

  const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC'
  const field = sortValue.replace(/^-/, '')

  return `ORDER BY ${field} ${direction}`
}

const getRelationCollections = (field: Field): string[] => {
  if (field.type === 'upload' && typeof field.relationTo !== 'string') {
    return [field.relationTo as unknown as string].filter(Boolean)
  }

  if (Array.isArray(field.relationTo)) {
    return field.relationTo
  }

  return typeof field.relationTo === 'string' ? [field.relationTo] : []
}

const normalizeFetchedDocs = (docs: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] =>
  (docs ?? []).map((doc) => normalizeDocument(doc)).filter(Boolean) as Record<string, unknown>[]

const fetchByIDs = async (
  adapter: SurrealAdapter,
  collection: string,
  ids: unknown[],
  depth: number,
): Promise<Map<string, Record<string, unknown>>> => {
  const uniqueIDs = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))]
  const docsByID = new Map<string, Record<string, unknown>>()

  if (!uniqueIDs.length) {
    return docsByID
  }

  const table = escapeIdent(collection.replaceAll('-', '_'))
  const docs = normalizeFetchedDocs(
    await adapter.client.query(
      `SELECT * FROM ${table} WHERE meta::id(id) IN ${literal(uniqueIDs)};`,
    ) as Record<string, unknown>[],
  )

  const populated = await transformRelationshipReads(adapter, collection, docs, depth)

  for (const doc of populated) {
    docsByID.set(String(doc.id), doc)
  }

  return docsByID
}

const populateRelationshipFields = async (
  adapter: SurrealAdapter,
  collection: string,
  docs: Record<string, unknown>[],
  depth: number,
): Promise<void> => {
  if (depth <= 0 || !docs.length) {
    return
  }

  const populateField = async (field: Field, targetDocs: Record<string, unknown>[]): Promise<void> => {
    if (!field.name || !targetDocs.length) {
      return
    }

    if (field.localized) {
      const localeEntries: Array<{ doc: Record<string, unknown>; locale: string; wrapper: Record<string, unknown> }> = []

      for (const doc of targetDocs) {
        const value = doc[field.name]

        if (!isPlainObject(value)) {
          continue
        }

        for (const [locale, localeValue] of Object.entries(value)) {
          const wrapper = { [field.name]: localeValue }
          localeEntries.push({ doc, locale, wrapper })
        }
      }

      await populateField({ ...field, localized: false }, localeEntries.map((entry) => entry.wrapper))

      for (const { doc, locale, wrapper } of localeEntries) {
        ;(doc[field.name] as Record<string, unknown>)[locale] = wrapper[field.name]
      }

      return
    }

    if (isPolymorphic(field)) {
      const idsByCollection = new Map<string, unknown[]>()

      for (const doc of targetDocs) {
        const value = doc[field.name]
        const refs = field.hasMany && Array.isArray(value) ? value : value ? [value] : []

        for (const ref of refs) {
          if (isPlainObject(ref) && typeof ref.relationTo === 'string') {
            idsByCollection.set(ref.relationTo, [...(idsByCollection.get(ref.relationTo) ?? []), ref.value])
          }
        }
      }

      const docsByCollection = new Map<string, Map<string, Record<string, unknown>>>()

      for (const [relationTo, ids] of idsByCollection) {
        docsByCollection.set(relationTo, await fetchByIDs(adapter, relationTo, ids, depth - 1))
      }

      for (const doc of targetDocs) {
        const value = doc[field.name]
        const populateRef = (ref: unknown) => {
          if (!isPlainObject(ref) || typeof ref.relationTo !== 'string') {
            return ref
          }

          return {
            relationTo: ref.relationTo,
            value: docsByCollection.get(ref.relationTo)?.get(String(ref.value)) ?? ref.value,
          }
        }

        doc[field.name] = field.hasMany && Array.isArray(value) ? value.map(populateRef) : populateRef(value)
      }

      return
    }

    const relationTo = getRelationCollections(field)[0]

    if (!relationTo) {
      return
    }

    const ids = targetDocs.flatMap((doc) => {
      const value = doc[field.name!]
      return field.hasMany && Array.isArray(value) ? value : value ? [value] : []
    })
    const related = await fetchByIDs(adapter, relationTo, ids, depth - 1)

    for (const doc of targetDocs) {
      const value = doc[field.name]
      doc[field.name] = field.hasMany && Array.isArray(value)
        ? value.map((id) => related.get(String(id)) ?? id)
        : value === null || value === undefined
          ? value
          : related.get(String(value)) ?? value
    }
  }

  const populateFields = async (targetDocs: Record<string, unknown>[], fields: Field[] = []): Promise<void> => {
    for (const field of fields) {
      if (field.type === 'tabs') {
        for (const tab of field.tabs ?? []) {
          if (tab.name) {
            await populateFields(
              targetDocs.map((doc) => doc[tab.name!]).filter(isPlainObject),
              tab.fields ?? [],
            )
          } else {
            await populateFields(targetDocs, tab.fields ?? [])
          }
        }

        continue
      }

      if (isRelationshipField(field)) {
        await populateField(field, targetDocs)
        continue
      }

      if (!field.name) {
        continue
      }

      if (field.type === 'array' || field.type === 'blocks') {
        for (const doc of targetDocs) {
          const rows = doc[field.name]

          if (!Array.isArray(rows)) {
            continue
          }

          for (const row of rows) {
            if (isPlainObject(row)) {
              await populateFields([row], getNestedFields(field, row))
            }
          }
        }

        continue
      }

      const nestedFields = getNestedFields(field)

      if (nestedFields.length) {
        await populateFields(
          targetDocs.map((doc) => doc[field.name!]).filter(isPlainObject),
          nestedFields,
        )
      }
    }
  }

  await populateFields(docs, getCollectionConfig(adapter, collection)?.fields)
}

const resolveJoinFields = async (
  adapter: SurrealAdapter,
  collection: string,
  docs: Record<string, unknown>[],
  depth: number,
): Promise<void> => {
  if (!docs.length) {
    return
  }

  const joinFields = collectJoinFields(getCollectionConfig(adapter, collection)?.fields)
  const parentIDs = docs.map((doc) => doc.id).filter((id) => id !== null && id !== undefined)

  for (const field of joinFields) {
    if (!field.name || !field.collection || !field.on || !parentIDs.length) {
      continue
    }

    const limit = field.limit ?? field.defaultLimit ?? 10
    const targetTable = escapeIdent(field.collection.replaceAll('-', '_'))
    const sort = getSortSQL(field.sort)
    const targetDocs = normalizeFetchedDocs(
      await adapter.client.query(
        `SELECT * FROM ${targetTable} WHERE ${field.on} IN ${literal(parentIDs.map(String))} ${sort};`,
      ) as Record<string, unknown>[],
    )
    const populatedTargets = depth > 0 ? await transformRelationshipReads(adapter, field.collection, targetDocs, depth - 1) : targetDocs
    const byParent = new Map<string, Record<string, unknown>[]>()

    for (const [index, targetDoc] of targetDocs.entries()) {
      const foreignValue = targetDoc[field.on]
      const ids = Array.isArray(foreignValue) ? foreignValue : [foreignValue]

      for (const id of ids) {
        const key = String(id)
        byParent.set(key, [...(byParent.get(key) ?? []), populatedTargets[index]])
      }
    }

    for (const doc of docs) {
      const joined = byParent.get(String(doc.id)) ?? []
      const pageDocs = limit > 0 ? joined.slice(0, limit) : joined

      doc[field.name] = field.hasMany === false
        ? (pageDocs[0] ?? null)
        : {
            docs: pageDocs,
            hasNextPage: limit > 0 ? joined.length > limit : false,
            hasPrevPage: false,
            limit,
            page: 1,
            pagingCounter: 1,
            totalDocs: joined.length,
            totalPages: limit > 0 ? Math.ceil(joined.length / limit) : 1,
          }
    }
  }
}

export const transformRelationshipReads = async <T extends Record<string, unknown>>(
  adapter: SurrealAdapter,
  collection: string,
  docs: T[],
  depth = 0,
): Promise<T[]> => {
  await populateRelationshipFields(adapter, collection, docs, depth)
  await resolveJoinFields(adapter, collection, docs, depth)

  return docs
}

export const transformRelationshipWhere = (collectionConfig: { fields?: Field[] } | undefined, where: unknown): unknown => {
  if (!isPlainObject(where)) {
    return where
  }

  const fields = collectionConfig?.fields ?? []
  const fieldByName = new Map(fields.filter((field) => field.name).map((field) => [field.name as string, field]))

  return Object.fromEntries(
    Object.entries(where).map(([key, value]) => {
      if ((key === 'and' || key === 'or') && Array.isArray(value)) {
        return [key, value.map((entry) => transformRelationshipWhere(collectionConfig, entry))]
      }

      const rootField = key.split('.')[0]
      const field = fieldByName.get(rootField)

      if (!field || !isRelationshipField(field) || !isPlainObject(value)) {
        return [key, value]
      }

      return [
        key,
        Object.fromEntries(
          Object.entries(value).map(([operator, operatorValue]) => [
            operator,
            operator === 'in' || operator === 'not_in'
              ? Array.isArray(operatorValue)
                ? operatorValue.map((item) => normalizeRelationshipValue(field, item))
                : operatorValue
              : normalizeRelationshipValue(field, operatorValue),
          ]),
        ),
      ]
    }),
  )
}

export const buildRelationshipAwareWhere = (adapter: SurrealAdapter, collection: string, where: unknown): string => {
  const config = getCollectionConfig(adapter, collection)

  return buildWhere(transformRelationshipWhere(config, where) as never, config?.fields)
}
