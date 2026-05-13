import type { CreateGlobal, FindGlobal, UpdateGlobal } from 'payload'

import type { SurrealAdapter } from './index.js'

import { getRecordID, literal, normalizeDocument } from './utilities/sql.js'

const table = 'payload_globals'

export const createGlobal: CreateGlobal = async function createGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const result = await this.client.query(
    `CREATE ${getRecordID(table, args.slug)} CONTENT ${literal({ ...args.data, createdAt: args.data.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now })} RETURN AFTER;`,
  )

  return normalizeDocument(result[0]) ?? args.data
}

export const findGlobal: FindGlobal = async function findGlobal(this: SurrealAdapter, args) {
  const result = await this.client.query(`SELECT * FROM ${getRecordID(table, args.slug)};`)

  return normalizeDocument(result[0]) ?? {}
}

export const updateGlobal: UpdateGlobal = async function updateGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const existing = await findGlobal.call(this, { slug: args.slug })
  const result = await this.client.query(
    `UPSERT ${getRecordID(table, args.slug)} MERGE ${literal({ ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now })} RETURN AFTER;`,
  )

  return normalizeDocument(result[0]) ?? args.data
}
