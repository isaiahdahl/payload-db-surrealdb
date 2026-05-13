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

const versionCollection = (slug: string): string => `${slug}_versions`
const globalVersionCollection = (slug: string): string => `global_${slug}_versions`

export const createVersion: CreateVersion = async function createVersion(this: SurrealAdapter, args) {
  return create.call(this, {
    collection: versionCollection(args.collectionSlug),
    data: {
      autosave: args.autosave,
      createdAt: args.createdAt,
      latest: true,
      parent: args.parent,
      publishedLocale: args.publishedLocale,
      snapshot: args.snapshot,
      updatedAt: args.updatedAt,
      version: args.versionData,
    },
    req: args.req,
  }) as never
}

export const createGlobalVersion: CreateGlobalVersion = async function createGlobalVersion(this: SurrealAdapter, args) {
  return create.call(this, {
    collection: globalVersionCollection(args.globalSlug),
    data: {
      autosave: args.autosave,
      createdAt: args.createdAt,
      latest: true,
      publishedLocale: args.publishedLocale,
      snapshot: args.snapshot,
      updatedAt: args.updatedAt,
      version: args.versionData,
    },
    req: args.req,
  }) as never
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
  return updateOne.call(this, {
    collection: versionCollection(args.collection),
    data: args.versionData,
    id: args.id,
    req: args.req,
    where: args.where,
  }) as never
}

export const updateGlobalVersion: UpdateGlobalVersion = async function updateGlobalVersion(this: SurrealAdapter, args) {
  return updateOne.call(this, {
    collection: globalVersionCollection(args.global),
    data: args.versionData,
    id: args.id,
    req: args.req,
    where: args.where,
  }) as never
}

export const queryDrafts: QueryDrafts = async function queryDrafts(this: SurrealAdapter, args) {
  return find.call(this, {
    collection: versionCollection(args.collection),
    joins: args.joins,
    limit: args.limit,
    locale: args.locale,
    page: args.page,
    pagination: args.pagination,
    req: args.req,
    select: args.select,
    sort: args.sort,
    where: { and: [{ latest: { equals: true } }, args.where ?? {}] },
  }) as never
}
