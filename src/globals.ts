import type { CreateGlobal, FindGlobal, UpdateGlobal } from 'payload'

import type { SurrealAdapter } from './index.js'

import { buildWhere } from './queries/buildWhere.js'
import { queueTransactionStatement } from './transactions/index.js'
import { getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js'

const getGlobalsTable = (adapter: SurrealAdapter) => getTableName('payload_globals', adapter.tablePrefix)

const getGlobalConfig = (adapter: SurrealAdapter, slug: string) => adapter.payload.config.globals?.find((global) => global.slug === slug)

const pruneLocales = (doc: Record<string, unknown>, fields: any[] = [], locales?: Set<string>): void => {
  if (!locales) return

  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) pruneLocales(tab.name && doc[tab.name] && typeof doc[tab.name] === 'object' ? doc[tab.name] as Record<string, unknown> : doc, tab.fields ?? [], locales)
      continue
    }

    if (!field.name) {
      pruneLocales(doc, field.fields ?? [], locales)
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

const applyGlobalReadTransforms = (adapter: SurrealAdapter, slug: string, doc: Record<string, unknown>): Record<string, unknown> => {
  const publishedLocales = Array.isArray(doc.__publishedLocales) ? new Set((doc.__publishedLocales as unknown[]).map(String)) : null
  if (publishedLocales) pruneLocales(doc, getGlobalConfig(adapter, slug)?.fields, publishedLocales)
  delete doc.__publishedLocales
  return doc
}

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
  const where = buildWhere(args.where as never)
  const result = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(getGlobalsTable(this), args.slug)} ${where};`)

  return applyGlobalReadTransforms(this, args.slug, (normalizeDocument(result[0]) ?? {}) as Record<string, unknown>) as never
}

export const updateGlobal: UpdateGlobal = async function updateGlobal(this: SurrealAdapter, args) {
  const now = new Date().toISOString()
  const table = getGlobalsTable(this)
  const existingResult = await this.client.query<Record<string, unknown>[]>(`SELECT * FROM ${getRecordID(table, args.slug)};`)
  const existing = (normalizeDocument(existingResult[0]) ?? {}) as Record<string, unknown>
  const fields = (getGlobalConfig(this, args.slug)?.fields ?? []) as any[]
  const data: Record<string, unknown> = { ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now }
  const isEmptyObjectReset = data._status === undefined && Object.values(args.data).some((value) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)
  if (isEmptyObjectReset) {
    data.__publishedLocales = null
  }
  const runtimeArgs = args as Record<string, unknown>
  let publishSpecificLocale = typeof runtimeArgs.publishSpecificLocale === 'string' ? runtimeArgs.publishSpecificLocale : (typeof runtimeArgs.locale === 'string' ? runtimeArgs.locale : undefined)
  if (!publishSpecificLocale) {
    const localeCandidates = new Set<string>()
    for (const field of fields) {
      const value = field.localized && field.name ? data[field.name] : undefined
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const locale of Object.keys(value as Record<string, unknown>)) localeCandidates.add(locale)
      }
    }
    const changedLocales = [...localeCandidates].filter((locale) => fields.some((field: any) => {
      const next = field.localized && field.name && data[field.name] && typeof data[field.name] === 'object' ? (data[field.name] as Record<string, unknown>)[locale] : undefined
      const prev = field.localized && field.name && existing[field.name] && typeof existing[field.name] === 'object' ? (existing[field.name] as Record<string, unknown>)[locale] : undefined
      return next !== undefined && JSON.stringify(next) !== JSON.stringify(prev)
    }))
    if (changedLocales.length === 1) publishSpecificLocale = changedLocales[0]
    else if (localeCandidates.size === 1) publishSpecificLocale = [...localeCandidates][0]
  }
  if (publishSpecificLocale && Array.isArray(existing.__publishedLocales) && (existing.__publishedLocales as unknown[]).map(String).includes(publishSpecificLocale)) {
    const hasChangedLocaleValue = fields.some((field: any) => {
      const next = field.localized && field.name && data[field.name] && typeof data[field.name] === 'object' ? (data[field.name] as Record<string, unknown>)[publishSpecificLocale!] : undefined
      const prev = field.localized && field.name && existing[field.name] && typeof existing[field.name] === 'object' ? (existing[field.name] as Record<string, unknown>)[publishSpecificLocale!] : undefined
      return next !== undefined && JSON.stringify(next) !== JSON.stringify(prev)
    })
    if (!hasChangedLocaleValue) publishSpecificLocale = undefined
  }
  if (data._status === 'published') {
    for (const field of fields) {
      if (field.localized && field.name && data[field.name] && typeof data[field.name] === 'object' && !Array.isArray(data[field.name]) && existing[field.name] && typeof existing[field.name] === 'object' && !Array.isArray(existing[field.name])) {
        data[field.name] = { ...(existing[field.name] as Record<string, unknown>), ...(data[field.name] as Record<string, unknown>) }
      }
    }
  }
  if (data._status === 'published' && typeof publishSpecificLocale === 'string') {
    const locales = Array.isArray(existing.__publishedLocales) ? new Set((existing.__publishedLocales as unknown[]).map(String)) : new Set<string>()
    locales.add(publishSpecificLocale)
    data.__publishedLocales = [...locales]
  } else if (data._status === 'published') {
    data.__publishedLocales = null
    const versionTable = getTableName(`global_${args.slug}_versions`, this.tablePrefix)
    const versions = await this.client.query<Record<string, unknown>[]>(`SELECT version, updatedAt FROM ${versionTable} ORDER BY updatedAt DESC;`)
    for (const row of versions) {
      const version = row.version as Record<string, unknown> | undefined
      if (!version) continue
      for (const field of fields) {
        if (field.localized && field.name && version[field.name] && typeof version[field.name] === 'object' && !Array.isArray(version[field.name])) {
          data[field.name] = { ...(version[field.name] as Record<string, unknown>), ...((data[field.name] && typeof data[field.name] === 'object' && !Array.isArray(data[field.name])) ? data[field.name] as Record<string, unknown> : {}) }
        }
      }
    }
  }
  const statement = `UPSERT ${getRecordID(table, args.slug)} ${isEmptyObjectReset ? 'CONTENT' : 'MERGE'} ${literal(data)} RETURN AFTER;`

  if (await queueTransactionStatement(this, args.req, statement)) {
    return (normalizeDocument({ ...existing, ...data, id: args.slug }) ?? args.data) as never
  }

  const result = await this.client.query<Record<string, unknown>[]>(statement)

  return applyGlobalReadTransforms(this, args.slug, (normalizeDocument(result[0]) ?? args.data) as Record<string, unknown>) as never
}
