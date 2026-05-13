import { count, create, deleteMany, find, updateOne } from './operations.js';
const versionCollection = (slug) => `${slug}_versions`;
const globalVersionCollection = (slug) => `global_${slug}_versions`;
export const createVersion = async function createVersion(args) {
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
    });
};
export const createGlobalVersion = async function createGlobalVersion(args) {
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
    });
};
export const findVersions = async function findVersions(args) {
    return find.call(this, { ...args, collection: versionCollection(args.collection) });
};
export const findGlobalVersions = async function findGlobalVersions(args) {
    return find.call(this, { ...args, collection: globalVersionCollection(args.global) });
};
export const countVersions = async function countVersions(args) {
    return count.call(this, { ...args, collection: versionCollection(args.collection) });
};
export const countGlobalVersions = async function countGlobalVersions(args) {
    return count.call(this, { ...args, collection: globalVersionCollection(args.global) });
};
export const deleteVersions = async function deleteVersions(args) {
    await deleteMany.call(this, {
        collection: args.collection ? versionCollection(args.collection) : globalVersionCollection(args.globalSlug),
        req: args.req,
        where: args.where,
    });
};
export const updateVersion = async function updateVersion(args) {
    return updateOne.call(this, {
        collection: versionCollection(args.collection),
        data: args.versionData,
        id: args.id,
        req: args.req,
        where: args.where,
    });
};
export const updateGlobalVersion = async function updateGlobalVersion(args) {
    return updateOne.call(this, {
        collection: globalVersionCollection(args.global),
        data: args.versionData,
        id: args.id,
        req: args.req,
        where: args.where,
    });
};
export const queryDrafts = async function queryDrafts(args) {
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
    });
};
