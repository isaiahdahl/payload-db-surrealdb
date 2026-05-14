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

const getSortSQL = (sort?: string | string[]): string => {
  const sortValues = (Array.isArray(sort) ? sort : sort ? [sort] : [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  if (!sortValues.length) {
    return 'ORDER BY createdAt DESC'
  }

  const parts = sortValues.map((sortValue) => {
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

const mapWriteError = (error: unknown): never => {
  if (error instanceof SurrealDBError && error.duplicate) {
    error.code = error.code ?? 'DUPLICATE_KEY'
  }

  throw error
}

const isMissingTableError = (error: unknown): boolean => {
  return error instanceof Error && /table .* does not exist/i.test(error.message)
}

const normalizeDocs = (docs: Array<Record<string, unknown>>, select?: Record<string, unknown>) =>
  docs.map((doc) => applySelect(normalizeDocument(doc), select)).filter(Boolean)

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

const applyAtomicUpdate = (data: Record<string, unknown>, existing: Record<string, unknown>): Record<string, unknown> => {
  const next = structuredClone(data)

  const visit = (obj: Record<string, unknown>, prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue
      }

      const operators = value as Record<string, unknown>
      const hasOperator = Object.keys(operators).some((operator) => operator.startsWith('$'))

      if (!hasOperator) {
        visit(operators, path)
        continue
      }

      const current = getValueAtPath(existing, path)

      if ('$inc' in operators) {
        setValueAtPath(next, path, Number(current ?? 0) + Number(operators.$inc ?? 0))
      } else if ('$push' in operators) {
        setValueAtPath(next, path, appendUnique(Array.isArray(current) ? current : [], operators.$push))
      } else if ('$remove' in operators) {
        setValueAtPath(next, path, removeValues(Array.isArray(current) ? current : [], operators.$remove))
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
  let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields), collectionConfig?.fields)
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

  const target = getRecordID(table, resolvedID as string | number)
  const statement = `CREATE ${target} CONTENT ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return shouldReturn ? applySelect(normalizeDocument({ ...data, id: resolvedID }), args.select) : null
  }

  try {
    const result = await this.client.query<Record<string, unknown>[]>(statement)
    const docs = normalizeDocs(result, args.select) as Record<string, unknown>[]
    if (docs[0] && id !== undefined) docs[0].id = resolvedID
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

    return shouldReturn ? populated[0] ?? null : null
  } catch (error) {
    mapWriteError(error)
  }
}

export const findOne: FindOne = (async function findOne(this: SurrealAdapter, args) {
  const table = escapeIdent(getTableName(args.collection, this.tablePrefix))
  const where = buildRelationshipAwareWhere(this, args.collection, args.where)

  try {
    const result = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${table} ${where} LIMIT 1;`)
    const docs = normalizeDocs(result, args.select) as Record<string, unknown>[]
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
  const where = buildRelationshipAwareWhere(this, args.collection, args.where)
  const sort = getSortSQL(args.sort)
  const limitSQL = limit > 0 ? `LIMIT ${limit} START ${start}` : ''
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

  const totalDocs = await count.call(this, { collection: args.collection, req: args.req, where: args.where })
  const totalPages = limit > 0 ? Math.ceil(totalDocs.totalDocs / limit) : 1

  return {
    docs: await transformRelationshipReads(this, args.collection, normalizeDocs(docs, args.select) as Record<string, unknown>[], getDepth(args as never)),
    hasNextPage: limit > 0 ? currentPage < totalPages : false,
    hasPrevPage: currentPage > 1,
    limit,
    nextPage: limit > 0 && currentPage < totalPages ? currentPage + 1 : null,
    page: currentPage,
    pagingCounter: totalDocs.totalDocs > 0 ? start + 1 : 0,
    prevPage: currentPage > 1 ? currentPage - 1 : null,
    totalDocs: totalDocs.totalDocs,
    totalPages,
  } as never
}

export const count: Count = async function count(this: SurrealAdapter, args) {
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
  let data = transformRelationshipWrites(applyDefaults({ ...args.data }, collectionConfig?.fields), collectionConfig?.fields)
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

  if (args.id) {
    const existing = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(table, args.id)};`)
    const existingDoc = normalizeDocument(existing[0]) ?? { id: args.id }
    data = applyAtomicUpdate(data, existingDoc)

    const statement = `UPDATE ${getRecordID(table, args.id)} MERGE ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

    if (await queueTransactionStatement(this, args.req, statement)) {
      return shouldReturn ? applySelect(normalizeDocument({ ...existingDoc, ...data, id: args.id }), args.select) : null
    }

    try {
      const result = await this.client.query<Record<string, unknown>[]>(statement)
      const docs = normalizeDocs(result, args.select) as Record<string, unknown>[]
      const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

      return shouldReturn ? populated[0] ?? null : null
    } catch (error) {
      mapWriteError(error)
    }
  }

  const found = await findOne.call(this, { collection: args.collection, req: args.req, where: args.where })

  if (!found) {
    return null
  }

  data = applyAtomicUpdate(data, found)

  const statement = `UPDATE ${getRecordID(table, found.id)} MERGE ${literal(data)} RETURN ${shouldReturn ? 'AFTER' : 'NONE'};`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return shouldReturn ? applySelect(normalizeDocument({ ...found, ...data }), args.select) : null
  }

  try {
    const result = await this.client.query<Record<string, unknown>[]>(statement)
    const docs = normalizeDocs(result, args.select) as Record<string, unknown>[]
    const populated = await transformRelationshipReads(this, args.collection, docs, getDepth(args as never))

    return shouldReturn ? populated[0] ?? null : null
  } catch (error) {
    mapWriteError(error)
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
