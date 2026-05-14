import type {
  CountGlobalVersions,
  CountVersions,
  CreateGlobalVersion,
  CreateVersion,
  DeleteVersions,
  FindGlobalVersions,
  FindVersions,
  QueryDrafts,
  UpdateGlobalVersion,
  UpdateVersion,
} from 'payload'

import type { SurrealAdapter } from './index.js'

import { count, create, deleteMany, find, updateOne } from './operations.js'
import { queueTransactionStatement } from './transactions/index.js'
import { escapeIdent, getTableName, literal } from './utilities/sql.js'

const versionCollection = (slug: string): string => `${slug}_versions`
const globalVersionCollection = (slug: string): string => `global_${slug}_versions`

const latestVersionStatement = (collection: string, id: unknown, parent?: number | string, updatedAt?: string): null | string => {
  if (parent === undefined || updatedAt === undefined) {
    return null
  }

  return `UPDATE ${escapeIdent(getTableName(collection))} SET latest = false WHERE meta::id(id) != ${literal(String(id))} AND parent = ${literal(parent)} AND latest = true AND updatedAt < ${literal(updatedAt)}`
}

const draftWhere = (where: Record<string, unknown> = {}): Record<string, unknown> => {
  const reserved = new Set(['and', 'or', 'latest', 'parent', 'autosave', 'snapshot', 'publishedLocale', 'createdAt', 'updatedAt'])

  return Object.fromEntries(
    Object.entries(where).map(([key, value]) => {
      if ((key === 'and' || key === 'or') && Array.isArray(value)) {
        return [key, value.map((entry) => draftWhere(entry as Record<string, unknown>))]
      }

      if (key === 'id') {
        return ['parent', value]
      }

      return [reserved.has(key) || key.startsWith('version.') ? key : `version.${key}`, value]
    }),
  )
}

const toDraftDoc = (doc: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!doc) {
    return null
  }

  const version = doc.version && typeof doc.version === 'object' ? (doc.version as Record<string, unknown>) : {}

  return {
    ...version,
    id: doc.parent,
  }
}

export const createVersion: CreateVersion = async function createVersion(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const version = { ...args.versionData }

  delete version.id

  const doc = await create.call(this, {
    collection: versionCollection(args.collectionSlug),
    data: {
      autosave: args.autosave,
      createdAt: args.createdAt ?? now,
      latest: true,
      parent: args.parent,
      publishedLocale: args.publishedLocale,
      snapshot: args.snapshot,
      updatedAt: args.updatedAt ?? now,
      version,
    },
    req: args.req,
  }) as Record<string, unknown>

  const statement = latestVersionStatement(versionCollection(args.collectionSlug), doc.id, args.parent, doc.updatedAt as string)

  if (statement) {
    if (!(await queueTransactionStatement(this, args.req, statement))) {
      await this.client.query(`${statement};`)
    }
  }

  return args.returning === false ? null : (doc as never)
}

export const createGlobalVersion: CreateGlobalVersion = async function createGlobalVersion(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const version = { ...args.versionData }

  delete version.id

  const doc = await create.call(this, {
    collection: globalVersionCollection(args.globalSlug),
    data: {
      autosave: args.autosave,
      createdAt: args.createdAt ?? now,
      latest: true,
      publishedLocale: args.publishedLocale,
      snapshot: args.snapshot,
      updatedAt: args.updatedAt ?? now,
      version,
    },
    req: args.req,
  }) as Record<string, unknown>

  const statement = `UPDATE ${escapeIdent(getTableName(globalVersionCollection(args.globalSlug)))} SET latest = false WHERE meta::id(id) != ${literal(String(doc.id))} AND latest = true AND updatedAt < ${literal(doc.updatedAt)}`

  if (!(await queueTransactionStatement(this, args.req, statement))) {
    await this.client.query(`${statement};`)
  }

  return args.returning === false ? null : (doc as never)
}

export const findVersions: FindVersions = async function findVersions(this: SurrealAdapter, args) {
  return find.call(this, { ...args, collection: versionCollection(args.collection) }) as never
}

export const findGlobalVersions: FindGlobalVersions = async function findGlobalVersions(this: SurrealAdapter, args) {
  return find.call(this, { ...args, collection: globalVersionCollection(args.global) }) as never
}

export const countVersions: CountVersions = async function countVersions(this: SurrealAdapter, args) {
  return count.call(this, { ...args, collection: versionCollection(args.collection) })
}

export const countGlobalVersions: CountGlobalVersions = async function countGlobalVersions(this: SurrealAdapter, args) {
  return count.call(this, { ...args, collection: globalVersionCollection(args.global) })
}

export const deleteVersions: DeleteVersions = async function deleteVersions(this: SurrealAdapter, args) {
  await deleteMany.call(this, {
    collection: args.collection ? versionCollection(args.collection) : globalVersionCollection(args.globalSlug!),
    req: args.req,
    where: args.where,
  })
}

export const updateVersion: UpdateVersion = async function updateVersion(this: SurrealAdapter, args) {
  const version = { ...args.versionData }
  const data: Record<string, unknown> = { version }

  if ('createdAt' in version) {
    data.createdAt = version.createdAt
    delete version.createdAt
  }

  if ('updatedAt' in version) {
    data.updatedAt = version.updatedAt
    delete version.updatedAt
  }

  const result = await updateOne.call(this, {
    collection: versionCollection(args.collection),
    data,
    id: args.id,
    req: args.req,
    where: args.where,
  }) as Record<string, unknown> | null

  return args.returning === false ? null : (result as never)
}

export const updateGlobalVersion: UpdateGlobalVersion = async function updateGlobalVersion(this: SurrealAdapter, args) {
  const version = { ...args.versionData }
  const data: Record<string, unknown> = { version }

  if ('createdAt' in version) {
    data.createdAt = version.createdAt
    delete version.createdAt
  }

  if ('updatedAt' in version) {
    data.updatedAt = version.updatedAt
    delete version.updatedAt
  }

  const result = await updateOne.call(this, {
    collection: globalVersionCollection(args.global),
    data,
    id: args.id,
    req: args.req,
    where: args.where,
  }) as Record<string, unknown> | null

  return args.returning === false ? null : (result as never)
}

export const queryDrafts: QueryDrafts = async function queryDrafts(this: SurrealAdapter, args) {
  const result = await find.call(this, {
    collection: versionCollection(args.collection),
    joins: args.joins,
    limit: args.limit,
    locale: args.locale,
    page: args.page,
    pagination: args.pagination,
    req: args.req,
    select: args.select,
    sort: args.sort,
    where: { and: [{ latest: { equals: true } }, draftWhere(args.where ?? {})] },
  })

  return {
    ...result,
    docs: result.docs.map((doc) => toDraftDoc(doc as Record<string, unknown>)).filter(Boolean),
  } as never
}
