import type { CreateMigration, Migration, Payload } from 'payload'

import fs from 'node:fs'
import path from 'node:path'

import type { SurrealAdapter } from './index.js'

import { getRecordID, getTableName, literal } from './utilities/sql.js'

const getMigrationsTable = (adapter: SurrealAdapter) => getTableName('payload_migrations', adapter.tablePrefix)

const getMigrationName = (migration: Migration): string => migration.name

const ensureMigrationsTable = async (adapter: SurrealAdapter): Promise<void> => {
  await adapter.client.query(`DEFINE TABLE IF NOT EXISTS ⟨${getMigrationsTable(adapter)}⟩ SCHEMALESS;`)
}

const getExecutedMigrations = async (adapter: SurrealAdapter): Promise<Migration[]> => {
  await ensureMigrationsTable(adapter)

  return adapter.client.query<Migration[]>(`SELECT * FROM ⟨${getMigrationsTable(adapter)}⟩ ORDER BY batch ASC, name ASC;`)
}

const getNextBatch = (executed: Migration[]): number => {
  return executed.reduce((max, migration) => Math.max(max, migration.batch ?? 0), 0) + 1
}

const recordMigration = async (adapter: SurrealAdapter, migration: Migration, batch: number): Promise<void> => {
  const name = getMigrationName(migration)
  await adapter.client.query(
    `UPSERT ${getRecordID(getMigrationsTable(adapter), name)} CONTENT ${literal({ batch, name })};`,
  )
}

const deleteMigrationRecord = async (adapter: SurrealAdapter, migration: Migration): Promise<void> => {
  await adapter.client.query(`DELETE ${getRecordID(getMigrationsTable(adapter), getMigrationName(migration))};`)
}

const getMigrationArgs = (adapter: SurrealAdapter): MigrateUpArgs & MigrateDownArgs => ({
  payload: adapter.payload,
})

const getMigrationFiles = (migrationDir: string): string[] => {
  if (!fs.existsSync(migrationDir)) {
    return []
  }

  return fs
    .readdirSync(migrationDir)
    .filter((file: string) => file.endsWith('.ts') && file !== 'index.ts')
    .sort()
}

export const createMigration: CreateMigration = ({ migrationName, payload }) => {
  const adapter = payload.db as SurrealAdapter
  const migrationDir = adapter.migrationDir || 'migrations'
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const name = migrationName || 'migration'
  const fileName = `${timestamp}_${name}.ts`
  const filePath = path.resolve(migrationDir, fileName)

  fs.mkdirSync(migrationDir, { recursive: true })
  fs.writeFileSync(
    filePath,
    `import type { MigrateUpArgs, MigrateDownArgs } from 'payload-db-surrealdb'\n\nexport async function up({ payload }: MigrateUpArgs): Promise<void> {\n  // Migration code\n}\n\nexport async function down({ payload }: MigrateDownArgs): Promise<void> {\n  // Migration code\n}\n`,
  )

  const indexPath = path.resolve(migrationDir, 'index.ts')
  const importName = `${timestamp}_${name.replace(/\W/g, '_')}`
  const existingFiles = getMigrationFiles(migrationDir)
  const imports = existingFiles
    .map((file) => {
      const variable = file.replace(/\.ts$/, '').replace(/\W/g, '_')
      return `import * as ${variable} from './${file.replace(/\.ts$/, '')}'`
    })
    .join('\n')
  const entries = existingFiles
    .map((file) => {
      const variable = file.replace(/\.ts$/, '').replace(/\W/g, '_')
      return `  { ...${variable}, name: '${file.replace(/\.ts$/, '')}' },`
    })
    .join('\n')

  fs.writeFileSync(
    indexPath,
    `${imports || `import * as ${importName} from './${fileName.replace(/\.ts$/, '')}'`}\n\nexport const migrations = [\n${entries || `  { ...${importName}, name: '${fileName.replace(/\.ts$/, '')}' },`}\n]\n`,
  )
}

export async function migrate(this: SurrealAdapter, args: { migrations?: Migration[] } = {}): Promise<void> {
  const migrations = [...(args.migrations ?? [])].sort((a, b) => getMigrationName(a).localeCompare(getMigrationName(b)))
  const executed = await getExecutedMigrations(this)
  const executedNames = new Set(executed.map((migration) => migration.name))
  const batch = getNextBatch(executed)

  if (!migrations.length) {
    for (const file of getMigrationFiles(this.migrationDir || 'migrations')) {
      const name = file.replace(/\.ts$/, '')
      if (!executedNames.has(name)) {
        await recordMigration(this, { name, up: async () => {}, down: async () => {} }, batch)
      }
    }
    return
  }

  for (const migration of migrations) {
    if (executedNames.has(getMigrationName(migration))) {
      continue
    }

    await migration.up(getMigrationArgs(this))
    await recordMigration(this, migration, batch)
  }
}

export async function migrateDown(this: SurrealAdapter, args: { migrations?: Migration[] } = {}): Promise<void> {
  const executed = await getExecutedMigrations(this)
  const latest = executed.at(-1)

  if (!latest) {
    return
  }

  const migration = args.migrations?.find((candidate) => getMigrationName(candidate) === latest.name)

  if (migration) {
    await migration.down(getMigrationArgs(this))
  }

  await deleteMigrationRecord(this, latest)
}

export async function migrateRefresh(this: SurrealAdapter, args: { migrations?: Migration[] } = {}): Promise<void> {
  await migrateReset.call(this, args)
  await migrate.call(this, args)
}

export async function migrateReset(this: SurrealAdapter, args: { migrations?: Migration[] } = {}): Promise<void> {
  const executed = await getExecutedMigrations(this)
  const migrationsByName = new Map((args.migrations ?? []).map((migration) => [getMigrationName(migration), migration]))

  for (const record of [...executed].reverse()) {
    const migration = migrationsByName.get(record.name)

    if (migration) {
      await migration.down(getMigrationArgs(this))
    }
  }

  await this.client.query(`DELETE ⟨${getMigrationsTable(this)}⟩;`)
}

export async function migrateStatus(this: SurrealAdapter): Promise<void> {
  await getExecutedMigrations(this)
}

export async function migrateFresh(this: SurrealAdapter, args: { forceAcceptWarning?: boolean; migrations?: Migration[] } = {}): Promise<void> {
  await migrateReset.call(this, args)
  await migrate.call(this, args)
}

export type MigrateUpArgs = { payload: Payload }
export type MigrateDownArgs = { payload: Payload }
