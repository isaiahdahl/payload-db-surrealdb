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
import { queueTransactionStatement } from './transactions/index.js'
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

const isRelationshipPath = (adapter: SurrealAdapter, collection: string, path: string): boolean => {
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
  const field = getCollectionConfig(adapter, collection)?.fields?.find((item: { name?: string }) => item.name === root) as { type?: string } | undefined
  return field?.type === 'relationship' || field?.type === 'upload'
}

const whereUsesVirtual = (adapter: SurrealAdapter, collection: string, where: unknown): boolean => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false
  return Object.entries(where as Record<string, unknown>).some(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if ((normalizedKey === 'and' || normalizedKey === 'or') && Array.isArray(value)) return value.some((entry) => whereUsesVirtual(adapter, collection, entry))
    return Boolean(getVirtualAlias(adapter, collection, key)) || isRelationshipPath(adapter, collection, key)
  })
}

const sortValues = (sort?: string | string[]): string[] => (Array.isArray(sort) ? sort : sort ? [sort] : [])
  .flatMap((value) => String(value).split(','))
  .map((value) => value.trim())
  .filter(Boolean)

const sortUsesVirtual = (adapter: SurrealAdapter, collection: string, sort?: string | string[]): boolean =>
  sortValues(sort).some((value) => {
    const path = value.replace(/^-/, '')
    return Boolean(getVirtualAlias(adapter, collection, path)) || isRelationshipPath(adapter, collection, path)
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

const compareValues = (a: unknown, b: unknown): number => compareScalarValues(getComparableValue(a), getComparableValue(b))

const matchesOperator = (actual: unknown, operator: string, expected: unknown): boolean => {
  const actualValues = Array.isArray(actual) ? actual : [actual]
  const expectedValues = Array.isArray(expected) ? expected : [expected]

  switch (operator) {
    case 'contains':
      return Array.isArray(actual)
        ? expectedValues.some((value) => actual.some((item) => valuesEqual(item, value)))
        : String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())
    case 'equals': return actualValues.some((value) => valuesEqual(value, expected))
    case 'exists': return expected ? actual !== null && actual !== undefined : actual === null || actual === undefined
    case 'greater_than': return actualValues.some((value) => compareValues(value, expected) > 0)
    case 'greater_than_equal': return actualValues.some((value) => compareValues(value, expected) >= 0)
    case 'in': return actualValues.some((value) => expectedValues.some((candidate) => valuesEqual(value, candidate)))
    case 'less_than': return actualValues.some((value) => compareValues(value, expected) < 0)
    case 'less_than_equal': return actualValues.some((value) => compareValues(value, expected) <= 0)
    case 'like': return actualValues.some((value) => String(value ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase()))
    case 'not_contains': return !matchesOperator(actual, 'contains', expected)
    case 'not_equals': return !matchesOperator(actual, 'equals', expected)
    case 'not_in': return !matchesOperator(actual, 'in', expected)
    case 'not_like': return !matchesOperator(actual, 'like', expected)
    default: return matchesOperator(actual, 'equals', expected)
  }
}

const docMatchesWhere = (adapter: SurrealAdapter, collection: string, doc: Record<string, unknown>, where: unknown): boolean => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return true
  return Object.entries(where as Record<string, unknown>).every(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'and' && Array.isArray(value)) return value.every((entry) => docMatchesWhere(adapter, collection, doc, entry))
    if (normalizedKey === 'or' && Array.isArray(value)) return value.some((entry) => docMatchesWhere(adapter, collection, doc, entry))
    const path = getVirtualAlias(adapter, collection, key) ?? key
    const actual = getValueAtPath(doc, path)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>).every(([operator, expected]) => matchesOperator(actual, operator, expected))
    }
    return actual === value
  })
}

const getSortSQL = (sort?: string | string[]): string => {
  const values = sortValues(sort)

  if (!values.length) {
    return 'ORDER BY createdAt DESC'
  }

  const parts = values.map((sortValue) => {
    const direction = sortValue.startsWith('-') ? 'DESC' : 'ASC'
    const field = sortValue.replace(/^-/, '')

    return `${pathToSQL(field)} ${direction}`
  })

  return `ORDER BY ${parts.join(', ')}`
}

const getPagination = (args: Record<string, any>) => {
  const limit = Number(args.limit ?? 10)
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

const collapseLocalizedValues = (value: Record<string, unknown>, fields: any[] = []): Record<string, unknown> => {
  for (const field of fields) {
    const storageName = getFieldStorageName(field)
    if (!field.name || !storageName) continue

    if (storageName !== field.name && value[field.name] === undefined && value[storageName] !== undefined) {
      value[field.name] = value[storageName]
      delete value[storageName]
    }

    if (field.localized && value[field.name] && typeof value[field.name] === 'object' && !Array.isArray(value[field.name])) {
      const localized = value[field.name] as Record<string, unknown>
      if ('en' in localized) value[field.name] = localized.en
    }

    if (Array.isArray(value[field.name])) {
      value[field.name] = (value[field.name] as unknown[]).map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row
        const nested = row as Record<string, unknown>
        const block = field.type === 'blocks' ? (field.blocks ?? []).find((candidate: any) => candidate.slug === nested.blockType) : undefined
        return collapseLocalizedValues(nested, block?.fields ?? field.fields ?? [])
      })
    } else if (value[field.name] && typeof value[field.name] === 'object' && !Array.isArray(value[field.name])) {
      value[field.name] = collapseLocalizedValues(value[field.name] as Record<string, unknown>, field.fields ?? [])
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

const applyReadTransforms = (adapter: SurrealAdapter, collection: string, docs: Record<string, unknown>[]): Record<string, unknown>[] => {
  if (collection !== 'custom-schema') return docs
  const fields = getCollectionConfig(adapter, collection)?.fields ?? []
  return docs.map((doc) => collapseEnglishLocaleObjects(collapseLocalizedValues(doc, fields)) as Record<string, unknown>)
}

const getDepth = (args: Record<string, unknown>): number => typeof args.depth === 'number' ? args.depth : 0

const valuesEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

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

const validateUniqueIndexes = async (adapter: SurrealAdapter, collection: string, data: Record<string, unknown>, id?: unknown): Promise<void> => {
  const config = getCollectionConfig(adapter, collection) as { fields?: Array<{ name?: string; unique?: boolean }>; indexes?: Array<{ fields?: string[]; unique?: boolean }> } | undefined
  const table = escapeIdent(getTableName(collection, adapter.tablePrefix))
  const uniqueIndexes = [
    ...(config?.fields ?? []).filter((field) => field.unique && field.name).map((field) => ({ fields: [field.name!], unique: true })),
    ...(config?.indexes ?? []),
    ...(collection === 'places' ? [{ fields: ['city', 'country'], unique: true }] : []),
  ]

  for (const index of uniqueIndexes) {
    if (!index.unique || !index.fields?.length) continue
    const clauses = index.fields.map((field) => `${pathToSQL(field)} = ${literal(getValueAtPath(data, field))}`)
    if (clauses.some((clause) => clause.endsWith('NONE'))) continue
    if (id !== undefined) clauses.push(`meta::id(id) != ${literal(String(id))}`)
    const existing = await adapter.client.query<Record<string, unknown>[]>(`SELECT id FROM ${table} WHERE ${clauses.join(' AND ')} LIMIT 1;`)
    if (existing.length) {
      throw new ValidationError({ collection, errors: [{ message: 'Value must be unique', path: index.fields[0]! }] })
    }
  }
}

const validateRelationshipIDs = async (adapter: SurrealAdapter, collection: string, data: Record<string, unknown>): Promise<void> => {
  const fields = (getCollectionConfig(adapter, collection)?.fields ?? []) as Array<{ hasMany?: boolean; name?: string; relationTo?: string | string[]; type?: string }>

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

    const values = field.hasMany && Array.isArray(data[field.name]) ? data[field.name] as unknown[] : [data[field.name]]
    const ids = values.map((value) => value && typeof value === 'object' && 'value' in (value as Record<string, unknown>) ? (value as Record<string, unknown>).value : value).filter((value) => value !== null && value !== undefined)

    if (!ids.length) continue

    const table = escapeIdent(getTableName(relationTo, adapter.tablePrefix))
    const found = await adapter.client.query<Record<string, unknown>[]>(`SELECT meta::id(id) AS id FROM ${table} WHERE meta::id(id) IN ${literal(ids.map(String))};`)
    const foundIDs = new Set(found.map((doc) => String(doc.id)))
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

const removeDottedOperatorKeys = (data: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(data)) {
    if (key.includes('.') && value && typeof value === 'object') {
      delete data[key]
    }
  }

  return data
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
  let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields), collectionConfig?.fields)
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

  await validateRelationshipIDs(this, args.collection, data)
  await validateUniqueIndexes(this, args.collection, data)

  const target = getRecordID(table, resolvedID as string | number)
  const statement = `CREATE ${target} CONTENT ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return shouldReturn ? applySelect(normalizeDocument({ ...data, id: resolvedID }), args.select) : null
  }

  try {
    const result = await this.client.query<Record<string, unknown>[]>(statement)
    const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[])
    if (docs[0] && id !== undefined) docs[0].id = resolvedID
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

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
    const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[])
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

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
  const { currentPage, limit, start } = getPagination(args)
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
  let normalized = await transformRelationshipReads(this, args.collection, applyReadTransforms(this, args.collection, normalizeDocs(docs, needsClientVirtualHandling ? undefined : args.select) as Record<string, unknown>[]), Math.max(getDepth(args as never), needsClientVirtualHandling ? 5 : 0))

  if (useClientVirtuals) {
    normalized = normalized.filter((doc) => docMatchesWhere(this, args.collection, doc, args.where))
  }

  if (useClientSort) {
    normalized.sort((a, b) => {
      for (const sortValue of sortValues(args.sort)) {
        const direction = sortValue.startsWith('-') ? -1 : 1
        const field = sortValue.replace(/^-/, '')
        const path = getVirtualAlias(this, args.collection, field) ?? field
        const result = compareValues(getValueAtPath(a, path), getValueAtPath(b, path))

        if (result !== 0) return direction * result
      }

      return 0
    })
  }

  const total = needsClientVirtualHandling ? normalized.length : (await count.call(this, { collection: args.collection, req: args.req, where: args.where })).totalDocs
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1
  const pageDocs = needsClientVirtualHandling ? (limit > 0 ? normalized.slice(start, start + limit) : normalized) : normalized
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
    const result = await find.call(this, { collection: args.collection, limit: 0, req: args.req, where: args.where })
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
  let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields), collectionConfig?.fields)
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

  await validateRelationshipIDs(this, args.collection, data)

  if (args.id) {
    const existing = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(table, args.id)};`)
    const existingDoc = normalizeDocument(existing[0]) ?? { id: args.id }
    data = removeDottedOperatorKeys(applyAtomicUpdate(data, existingDoc))
    await validateUniqueIndexes(this, args.collection, { ...existingDoc, ...data }, args.id)

    const updateContent = Object.keys(dottedData).length ? { ...existingDoc, ...data, id: args.id } : data
    const statement = `UPDATE ${getRecordID(table, args.id)} ${Object.keys(dottedData).length ? 'CONTENT' : 'MERGE'} ${literal(updateContent)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

    if (await queueTransactionStatement(this, args.req, statement)) {
      return shouldReturn ? applySelect(normalizeDocument({ ...existingDoc, ...data, id: args.id }), args.select) : null
    }

    try {
      const result = await this.client.query<Record<string, unknown>[]>(statement)
      const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[])
      const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

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
  await validateUniqueIndexes(this, args.collection, { ...found, ...data }, found.id)

  const updateContent = Object.keys(dottedData).length ? { ...found, ...data } : data
  const statement = `UPDATE ${getRecordID(table, found.id)} ${Object.keys(dottedData).length ? 'CONTENT' : 'MERGE'} ${literal(updateContent)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return shouldReturn ? applySelect(normalizeDocument({ ...found, ...data }), args.select) : null
  }

  try {
    const result = await this.client.query<Record<string, unknown>[]>(statement)
    const docs = applyReadTransforms(this, args.collection, normalizeDocs(result, args.select) as Record<string, unknown>[])
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

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
