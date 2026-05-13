import { createClient } from './client.js';
import { createGlobal, findGlobal, updateGlobal } from './globals.js';
import { createMigration, migrate, migrateDown, migrateFresh, migrateRefresh, migrateReset, migrateStatus, } from './migrations.js';
import { count, create, deleteMany, deleteOne, find, findOne, updateMany, updateOne, upsert, } from './operations.js';
import { beginTransaction, commitTransaction, rollbackTransaction } from './transactions/index.js';
import { getTableName } from './utilities/sql.js';
import { countGlobalVersions, countVersions, createGlobalVersion, createVersion, deleteVersions, findGlobalVersions, findVersions, queryDrafts, updateGlobalVersion, updateVersion, } from './versions.js';
const createAdapter = (args) => ({
    bulkOperationsSingleTransaction: false,
    migrationDir: 'migrations',
    ...args,
});
const resolveMigrationDir = (dir) => dir ?? 'migrations';
const init = async function init() {
    await connect.call(this);
    const statements = [];
    for (const collection of this.payload.config.collections) {
        statements.push(`DEFINE TABLE IF NOT EXISTS ⟨${getTableName(collection.slug)}⟩ SCHEMALESS;`);
    }
    statements.push('DEFINE TABLE IF NOT EXISTS payload_globals SCHEMALESS;');
    statements.push('DEFINE TABLE IF NOT EXISTS payload_migrations SCHEMALESS;');
    await this.client.query(statements.join('\n'));
};
const connect = async function connect() {
    const bootstrapEndpoint = `${this.url.replace(/\/$/, '')}/sql`;
    const auth = this.auth
        ? `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`
        : undefined;
    await fetch(bootstrapEndpoint, {
        body: `DEFINE NAMESPACE ${this.namespace}; USE NS ${this.namespace}; DEFINE DATABASE ${this.database};`,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/surrealql',
            ...(auth ? { Authorization: auth } : {}),
        },
        method: 'POST',
    });
};
const destroy = async function destroy() { };
const findDistinct = async function findDistinct(args) {
    const result = await find.call(this, {
        collection: args.collection,
        limit: args.limit,
        page: args.page,
        req: args.req,
        sort: args.sort,
        where: args.where,
    });
    const values = [...new Set(result.docs.map((doc) => doc[args.field]))].map((value) => ({ [args.field]: value }));
    return {
        hasNextPage: false,
        hasPrevPage: false,
        limit: args.limit ?? values.length,
        page: args.page ?? 1,
        pagingCounter: 1,
        totalDocs: values.length,
        totalPages: 1,
        values,
    };
};
const updateJobs = async function updateJobs(args) {
    return updateMany.call(this, {
        collection: 'payload-jobs',
        data: args.data,
        limit: 'limit' in args ? args.limit : undefined,
        req: args.req,
        sort: 'sort' in args ? args.sort : undefined,
        where: 'where' in args ? args.where : { id: { equals: args.id } },
    });
};
export function surrealAdapter(args = {}) {
    function adapter({ payload }) {
        const migrationDir = resolveMigrationDir(args.migrationDir);
        const partial = {
            auth: args.auth ?? { password: 'root', username: 'root' },
            database: args.database ?? 'payload',
            namespace: args.namespace ?? 'payload',
            url: args.url ?? 'http://localhost:8000',
        };
        const dbAdapter = createAdapter({
            ...partial,
            name: 'surrealdb',
            packageName: 'payload-db-surrealdb',
            defaultIDType: 'text',
            migrationDir,
            payload,
            client: undefined,
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
        });
        dbAdapter.client = createClient(dbAdapter);
        return dbAdapter;
    }
    return {
        name: 'surrealdb',
        defaultIDType: 'text',
        init: adapter,
    };
}
