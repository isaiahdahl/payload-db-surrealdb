import { createClient, SurrealDBError } from './client.js';
import { createGlobal, findGlobal, updateGlobal } from './globals.js';
import { createMigration, migrate, migrateDown, migrateFresh, migrateRefresh, migrateReset, migrateStatus, } from './migrations.js';
import { count, create, deleteMany, deleteOne, find, findOne, updateMany, updateOne, upsert, } from './operations.js';
import { beginTransaction, commitTransaction, rollbackTransaction } from './transactions/index.js';
import { getIndexedFields, getValueAtPath } from './utilities/fields.js';
import { escapeIdent, getTableName } from './utilities/sql.js';
import { countGlobalVersions, countVersions, createGlobalVersion, createVersion, deleteVersions, findGlobalVersions, findVersions, queryDrafts, updateGlobalVersion, updateVersion, } from './versions.js';
const createAdapter = (args) => ({
    bulkOperationsSingleTransaction: false,
    migrationDir: 'migrations',
    ...args,
});
const resolveMigrationDir = (dir) => dir ?? 'migrations';
const systemTables = [
    'payload_globals',
    'payload_migrations',
    'payload_jobs',
    'payload_preferences',
    'payload_locked_documents',
    'payload_trash',
];
const defineTable = (name) => `DEFINE TABLE IF NOT EXISTS ${escapeIdent(name)} SCHEMALESS;`;
const getVersionTable = (slug, tablePrefix) => getTableName(`${slug}_versions`, tablePrefix);
const getGlobalVersionTable = (slug, tablePrefix) => getTableName(`global_${slug}_versions`, tablePrefix);
const getIndexName = (table, field, unique) => {
    const suffix = unique ? 'unique' : 'idx';
    return `${table}_${field.replace(/\W+/g, '_')}_${suffix}`;
};
const buildIndexStatements = (table, fields) => {
    return fields.map((field) => {
        const unique = field.unique ? ' UNIQUE' : '';
        return `DEFINE INDEX IF NOT EXISTS ${escapeIdent(getIndexName(table, field.name, field.unique))} ON TABLE ${escapeIdent(table)} FIELDS ${escapeIdent(field.name)}${unique};`;
    });
};
const init = async function init() {
    await connect.call(this);
    const statements = [];
    for (const collection of this.payload.config.collections) {
        const table = getTableName(collection.slug, this.tablePrefix);
        statements.push(defineTable(table));
        statements.push(...buildIndexStatements(table, getIndexedFields(collection.fields)));
        statements.push(defineTable(getVersionTable(collection.slug, this.tablePrefix)));
    }
    for (const global of this.payload.config.globals ?? []) {
        statements.push(defineTable(getGlobalVersionTable(global.slug, this.tablePrefix)));
    }
    for (const table of systemTables) {
        statements.push(defineTable(getTableName(table, this.tablePrefix)));
    }
    await this.client.query(statements.join('\n'));
};
const parseBootstrapStatements = async (response) => {
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new SurrealDBError(`SurrealDB bootstrap returned invalid JSON: ${text.slice(0, 500)}`, {
            cause: error,
            status: response.status,
        });
    }
};
const connect = async function connect() {
    const bootstrapEndpoint = `${this.url.replace(/\/$/, '')}/sql`;
    const auth = this.auth
        ? `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`
        : undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs ?? 30_000);
    let response;
    try {
        response = await fetch(bootstrapEndpoint, {
            body: `DEFINE NAMESPACE IF NOT EXISTS ${escapeIdent(this.namespace)}; USE NS ${escapeIdent(this.namespace)}; DEFINE DATABASE IF NOT EXISTS ${escapeIdent(this.database)};`,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/surrealql',
                ...(auth ? { Authorization: auth } : {}),
            },
            method: 'POST',
            signal: controller.signal,
        });
    }
    catch (error) {
        throw new SurrealDBError(`Failed to bootstrap SurrealDB at ${bootstrapEndpoint}`, { cause: error });
    }
    finally {
        clearTimeout(timeout);
    }
    if (!response.ok) {
        throw new SurrealDBError(`SurrealDB bootstrap HTTP ${response.status}: ${await response.text()}`, {
            status: response.status,
        });
    }
    const statements = await parseBootstrapStatements(response);
    const failed = statements.find((statement) => statement.status === 'ERR');
    if (failed) {
        throw new SurrealDBError(`SurrealDB bootstrap failed: ${JSON.stringify(failed.result)}`, {
            cause: failed.result,
        });
    }
    await this.client.query('RETURN true;', { timeoutMs: this.requestTimeoutMs });
};
const destroy = async function destroy() { };
const findDistinct = async function findDistinct(args) {
    const result = await find.call(this, {
        collection: args.collection,
        limit: 0,
        req: args.req,
        sort: args.sort ?? args.field,
        where: args.where,
    });
    const seen = new Set();
    const allValues = [];
    for (const doc of result.docs) {
        const value = getValueAtPath(doc, args.field);
        const key = JSON.stringify(value);
        if (!seen.has(key)) {
            seen.add(key);
            allValues.push({ [args.field]: value });
        }
    }
    const limit = args.limit ?? allValues.length;
    const page = args.page ?? 1;
    const skip = args.skip;
    const start = skip ?? Math.max(page - 1, 0) * (limit > 0 ? limit : 0);
    const values = limit > 0 ? allValues.slice(start, start + limit) : allValues;
    const totalPages = limit > 0 ? Math.ceil(allValues.length / limit) : 1;
    const currentPage = skip !== undefined && limit > 0 ? Math.floor(start / limit) + 1 : page;
    return {
        hasNextPage: limit > 0 ? currentPage < totalPages : false,
        hasPrevPage: currentPage > 1,
        limit,
        nextPage: limit > 0 && currentPage < totalPages ? currentPage + 1 : null,
        page: currentPage,
        pagingCounter: allValues.length > 0 ? start + 1 : 0,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
        totalDocs: allValues.length,
        totalPages,
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
            requestTimeoutMs: args.requestTimeoutMs,
            tablePrefix: args.tablePrefix,
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
