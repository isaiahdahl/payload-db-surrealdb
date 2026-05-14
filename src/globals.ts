import type { CreateGlobal, FindGlobal, UpdateGlobal } from 'payload'

import type { SurrealAdapter } from './index.js'

import { queueTransactionStatement } from './transactions/index.js'
import { getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js'

const getGlobalsTable = (adapter: SurrealAdapter) => getTableName('payload_globals', adapter.tablePrefix)

export const createGlobal: CreateGlobal = async function createGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const table = getGlobalsTable(this)
  const data = { ...args.data, createdAt: args.data.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now }
  const statement = `CREATE ${getRecordID(table, args.slug)} CONTENT ${literal(data)} RETURN AFTER;`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return (normalizeDocument({ ...data, id: args.slug }) ?? args.data) as never
  }

  const result = await this.client.query<Record<string, unknown>[]>(statement)

  return (normalizeDocument(result[0]) ?? args.data) as never
}

export const findGlobal: FindGlobal = async function findGlobal(this: SurrealAdapter, args) {
  const result = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(getGlobalsTable(this), args.slug)};`)

  return (normalizeDocument(result[0]) ?? {}) as never
}

export const updateGlobal: UpdateGlobal = async function updateGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const table = getGlobalsTable(this)
  const existing = await findGlobal.call(this, { slug: args.slug })
  const data = { ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now }
  const statement = `UPSERT ${getRecordID(table, args.slug)} MERGE ${literal(data)} RETURN AFTER;`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return (normalizeDocument({ ...existing, ...data, id: args.slug }) ?? args.data) as never
  }

  const result = await this.client.query<Record<string, unknown>[]>(statement)

  return (normalizeDocument(result[0]) ?? args.data) as never
}
