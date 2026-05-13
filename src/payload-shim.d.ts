declare module 'payload' {
  export type BaseDatabaseAdapter = any
  export type DatabaseAdapterObj<T = any> = any
  export type Payload = any
  export type Where = any
  export type Count = any
  export type Create = any
  export type DeleteMany = any
  export type DeleteOne = any
  export type Find = any
  export type FindOne = any
  export type UpdateMany = any
  export type UpdateOne = any
  export type Upsert = any
  export type CreateGlobal = any
  export type FindGlobal = any
  export type UpdateGlobal = any
  export type CreateMigration = any
  export type FindDistinct = any
  export type UpdateJobs = any
  export type CountGlobalVersions = any
  export type CountVersions = any
  export type CreateGlobalVersion = any
  export type CreateVersion = any
  export type DeleteVersions = any
  export type FindGlobalVersions = any
  export type FindVersions = any
  export type QueryDrafts = any
  export type UpdateGlobalVersion = any
  export type UpdateVersion = any
  export type BeginTransaction = any
  export type CommitTransaction = any
  export type RollbackTransaction = any
  export function createDatabaseAdapter<T = any>(args: any): T
  export function findMigrationDir(dir?: string): string
}

declare const Buffer: any
