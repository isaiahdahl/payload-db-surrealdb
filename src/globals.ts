import type { CreateGlobal, FindGlobal, UpdateGlobal } from 'payload'

import type { SurrealAdapter } from './index.js'

import { getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js'

const getGlobalsTable = (adapter: SurrealAdapter) => getTableName('payload_globals', adapter.tablePrefix)

export const createGlobal: CreateGlobal = async function createGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const result = await this.client.query<Record<string, unknown>[]>(
    `CREATE ${getRecordID(getGlobalsTable(this), args.slug)} CONTENT ${literal({ ...args.data, createdAt: args.data.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now })} RETURN AFTER;`,
  )

  return (normalizeDocument(result[0]) ?? args.data) as never
}

export const findGlobal: FindGlobal = async function findGlobal(this: SurrealAdapter, args) {
  const result = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(getGlobalsTable(this), args.slug)};`)

  return (normalizeDocument(result[0]) ?? {}) as never
}

export const updateGlobal: UpdateGlobal = async function updateGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const existing = await findGlobal.call(this, { slug: args.slug })
  const result = await this.client.query<Record<string, unknown>[]>(
    `UPSERT ${getRecordID(getGlobalsTable(this), args.slug)} MERGE ${literal({ ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now })} RETURN AFTER;`,
  )

  return (normalizeDocument(result[0]) ?? args.data) as never
}
