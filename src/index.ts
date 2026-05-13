import type { BaseDatabaseAdapter, DatabaseAdapterObj, FindDistinct, Payload, UpdateJobs } from 'payload'

import type { SurrealClient } from './client.js'

import { createClient } from './client.js'
import { createGlobal, findGlobal, updateGlobal } from './globals.js'
import {
  createMigration,
  migrate,
  migrateDown,
  migrateFresh,
  migrateRefresh,
  migrateReset,
  migrateStatus,
} from './migrations.js'
import {
  count,
  create,
  deleteMany,
  deleteOne,
  find,
  findOne,
  updateMany,
  updateOne,
  upsert,
} from './operations.js'
import { beginTransaction, commitTransaction, rollbackTransaction } from './transactions/index.js'
import { getTableName } from './utilities/sql.js'
import {
  countGlobalVersions,
  countVersions,
  createGlobalVersion,
  createVersion,
  deleteVersions,
  findGlobalVersions,
  findVersions,
  queryDrafts,
  updateGlobalVersion,
  updateVersion,
} from './versions.js'

export type { MigrateDownArgs, MigrateUpArgs } from './migrations.js'

export type SurrealAdapterArgs = {
  auth?: {
    password: string
    username: string
  }
  database?: string
  migrationDir?: string
  namespace?: string
  tablePrefix?: string
  url?: string
}

export type SurrealAdapter = BaseDatabaseAdapter &
  Required<Pick<SurrealAdapterArgs, 'database' | 'namespace' | 'url'>> &
  Omit<SurrealAdapterArgs, 'database' | 'namespace' | 'url'> & {
    client: SurrealClient
  }

const createAdapter = <T extends Record<string, unknown>>(args: T): T => ({
  bulkOperationsSingleTransaction: false,
  migrationDir: 'migrations',
  ...args,
})

const resolveMigrationDir = (dir?: string): string => dir ?? 'migrations'

const init: NonNullable<BaseDatabaseAdapter['init']> = async function init(this: SurrealAdapter) {
  await connect.call(this)

  const statements: string[] = []

  for (const collection of this.payload.config.collections) {
    statements.push(`DEFINE TABLE IF NOT EXISTS ⟨${getTableName(collection.slug)}⟩ SCHEMALESS;`)
  }

  statements.push('DEFINE TABLE IF NOT EXISTS payload_globals SCHEMALESS;')
  statements.push('DEFINE TABLE IF NOT EXISTS payload_migrations SCHEMALESS;')

  await this.client.query(statements.join('\n'))
}

const connect: NonNullable<BaseDatabaseAdapter['connect']> = async function connect(this: SurrealAdapter) {
  const bootstrapEndpoint = `${this.url.replace(/\/$/, '')}/sql`
  const auth = this.auth
    ? `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`
    : undefined

  await fetch(bootstrapEndpoint, {
    body: `DEFINE NAMESPACE ${this.namespace}; USE NS ${this.namespace}; DEFINE DATABASE ${this.database};`,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/surrealql',
      ...(auth ? { Authorization: auth } : {}),
    },
    method: 'POST',
  })
}

const destroy: NonNullable<BaseDatabaseAdapter['destroy']> = async function destroy() {}

const findDistinct: FindDistinct = async function findDistinct(this: SurrealAdapter, args) {
  const result = await find.call(this, {
    collection: args.collection,
    limit: args.limit,
    page: args.page,
    req: args.req,
    sort: args.sort,
    where: args.where,
  })
  const values = [...new Set(result.docs.map((doc) => doc[args.field]))].map((value) => ({ [args.field]: value }))

  return {
    hasNextPage: false,
    hasPrevPage: false,
    limit: args.limit ?? values.length,
    page: args.page ?? 1,
    pagingCounter: 1,
    totalDocs: values.length,
    totalPages: 1,
    values,
  }
}

const updateJobs: UpdateJobs = async function updateJobs(this: SurrealAdapter, args) {
  return updateMany.call(this, {
    collection: 'payload-jobs',
    data: args.data,
    limit: 'limit' in args ? args.limit : undefined,
    req: args.req,
    sort: 'sort' in args ? args.sort : undefined,
    where: 'where' in args ? args.where : { id: { equals: args.id } },
  }) as never
}

export function surrealAdapter(args: SurrealAdapterArgs = {}): DatabaseAdapterObj<SurrealAdapter> {
  function adapter({ payload }: { payload: Payload }): SurrealAdapter {
    const migrationDir = resolveMigrationDir(args.migrationDir)
    const partial = {
      auth: args.auth ?? { password: 'root', username: 'root' },
      database: args.database ?? 'payload',
      namespace: args.namespace ?? 'payload',
      url: args.url ?? 'http://localhost:8000',
    }

    const dbAdapter = createAdapter<SurrealAdapter>({
      ...partial,
      name: 'surrealdb',
      packageName: 'payload-db-surrealdb',
      defaultIDType: 'text',
      migrationDir,
      payload,
      client: undefined as never,
      beginTransaction,
      commitTransaction,
      connect,
      count,
      countGlobalVersions,
      countVersions,
      create,
      createGlobal,
      createGlobalVersion,
      createMigration,
      createVersion,
      deleteMany,
      deleteOne,
      deleteVersions,
      destroy,
      find,
      findDistinct,
      findGlobal,
      findGlobalVersions,
      findOne,
      findVersions,
      init,
      migrate,
      migrateDown,
      migrateFresh,
      migrateRefresh,
      migrateReset,
      migrateStatus,
      queryDrafts,
      rollbackTransaction,
      updateGlobal,
      updateGlobalVersion,
      updateJobs,
      updateMany,
      updateOne,
      updateVersion,
      upsert,
    })

    dbAdapter.client = createClient(dbAdapter)

    return dbAdapter
  }

  return {
    name: 'surrealdb',
    defaultIDType: 'text',
    init: adapter,
  }
}
