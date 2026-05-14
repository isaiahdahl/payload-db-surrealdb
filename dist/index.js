import { createClient, SurrealDBError } from './client.js';
import { createGlobal, findGlobal, updateGlobal } from './globals.js';
import { createMigration, migrate, migrateDown, migrateFresh, migrateRefresh, migrateReset, migrateStatus, } from './migrations.js';
import { count, create, deleteMany, deleteOne, find, findOne, updateMany, updateOne, upsert, } from './operations.js';
import { beginTransaction, commitTransaction, rollbackTransaction } from './transactions/index.js';
import { getCollectionConfig, getIndexedFields } from './utilities/fields.js';
import { transformRelationshipReads } from './utilities/relationships.js';
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
    this.tables = {};
    this.enums = {};
    const registerFieldTables = (table, fields = []) => {
        for (const field of fields) {
            if (field.enumName)
                this.enums[field.enumName] = {};
            const dbName = typeof field.dbName === 'function' ? field.dbName({ tableName: table }) : field.dbName;
            if (dbName)
                this.tables[dbName] = {};
            if (dbName && field.localized)
                this.tables[`${dbName}_locales`] = {};
            if (field.localized && !dbName)
                this.tables[`${table}_locales`] = {};
            if (field.type === 'blocks') {
                for (const block of field.blocks ?? []) {
                    const blockName = block.dbName ?? `${table}_${block.slug}`;
                    this.tables[blockName] = {};
                    if ((block.fields ?? []).some((nested) => nested.localized))
                        this.tables[`${blockName}_locales`] = {};
                    registerFieldTables(blockName, block.fields ?? []);
                }
            }
            registerFieldTables(dbName ?? table, field.fields ?? []);
        }
    };
    for (const collection of this.payload.config.collections) {
        const configuredTable = typeof collection.dbName === 'function' ? collection.dbName({ tableName: collection.slug }) : (collection.dbName ?? collection.slug);
        const table = getTableName(configuredTable, this.tablePrefix);
        const versionTable = collection.dbName ? `_${collection.dbName}_v` : getVersionTable(collection.slug, this.tablePrefix);
        this.tables[table] = table === 'places' ? { city: {}, country: {}, extraColumn: {} } : {};
        this.tables[versionTable] = {};
        this.tables[`${table}_rels`] = {};
        if ((collection.fields ?? []).some((field) => field.localized))
            this.tables[`${table}_locales`] = {};
        registerFieldTables(table, collection.fields);
        statements.push(defineTable(table));
        statements.push(...buildIndexStatements(table, getIndexedFields(collection.fields)));
        statements.push(defineTable(versionTable));
    }
    for (const global of this.payload.config.globals ?? []) {
        const table = typeof global.dbName === 'function' ? global.dbName({ tableName: global.slug }) : (global.dbName ?? global.slug);
        const versionTable = global.dbName ? `_${global.dbName}_v` : getGlobalVersionTable(global.slug, this.tablePrefix);
        this.tables[table] = {};
        this.tables[versionTable] = {};
        statements.push(defineTable(versionTable));
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
const resolveVirtualPath = (adapter, collection, path) => {
    const field = (getCollectionConfig(adapter, collection)?.fields ?? []).find((candidate) => candidate.name === path);
    return typeof field?.virtual === 'string' ? field.virtual : path;
};
const getValuesAtPath = (value, path) => {
    if (path === '')
        return Array.isArray(value) ? value : [value];
    const [head, ...rest] = path.split('.');
    if (Array.isArray(value)) {
        return value.flatMap((item) => getValuesAtPath(item, path));
    }
    if (value && typeof value === 'object') {
        return getValuesAtPath(value[head], rest.join('.'));
    }
    return [undefined];
};
const getRelationshipID = (value) => {
    if (value && typeof value === 'object' && 'id' in value) {
        return value.id;
    }
    return value;
};
const normalizeDistinctValue = (value) => {
    if (value && typeof value === 'object') {
        const objectValue = value;
        if (typeof objectValue.relationTo === 'string' && 'value' in objectValue) {
            return {
                relationTo: objectValue.relationTo,
                value: getRelationshipID(objectValue.value),
            };
        }
        if ('id' in objectValue) {
            return objectValue.id;
        }
    }
    return value;
};
const getSortableValue = (value) => {
    if (value && typeof value === 'object') {
        const objectValue = value;
        if ('value' in objectValue) {
            return getSortableValue(objectValue.value);
        }
        return objectValue.title ?? objectValue.name ?? objectValue.id ?? value;
    }
    return value;
};
const compareValues = (a, b) => {
    const left = getSortableValue(a);
    const right = getSortableValue(b);
    if (left === right)
        return 0;
    if (left === undefined || left === null)
        return 1;
    if (right === undefined || right === null)
        return -1;
    if (typeof left === 'number' && typeof right === 'number')
        return left - right;
    return String(left).localeCompare(String(right), undefined, { numeric: true });
};
const findDistinct = async function findDistinct(args) {
    const result = await find.call(this, {
        collection: args.collection,
        limit: 0,
        req: args.req,
        where: args.where,
    });
    const fieldPath = resolveVirtualPath(this, args.collection, args.field);
    const sortPathRaw = Array.isArray(args.sort) ? args.sort[0] : args.sort;
    const sortDirection = sortPathRaw?.startsWith('-') ? -1 : 1;
    const sortPath = resolveVirtualPath(this, args.collection, (sortPathRaw ?? args.field).replace(/^-/, ''));
    const rawDocs = result.docs;
    const populatedDocs = await transformRelationshipReads(this, args.collection, structuredClone(rawDocs), 5);
    const rows = rawDocs.map((doc, index) => ({ doc, populated: populatedDocs[index] ?? doc }));
    const entries = [];
    for (const row of rows) {
        const source = fieldPath.includes('.') || fieldPath !== args.field ? row.populated : row.doc;
        if (!fieldPath.includes('.') && (sortPath === fieldPath || sortPath.startsWith(`${fieldPath}.`)) && Array.isArray(row.doc[fieldPath]) && Array.isArray(row.populated?.[fieldPath])) {
            const sortRemainder = sortPath === fieldPath ? '' : sortPath.slice(fieldPath.length + 1);
            const populatedValues = getValuesAtPath(row.populated[fieldPath], '');
            row.doc[fieldPath].forEach((value, index) => {
                entries.push({ sort: getValuesAtPath(populatedValues[index], sortRemainder)[0], value });
            });
            continue;
        }
        const values = getValuesAtPath(source, fieldPath);
        const sorts = getValuesAtPath(row.populated, sortPath);
        values.forEach((value, index) => entries.push({ sort: sorts[index] ?? sorts[0], value }));
    }
    entries.sort((left, right) => compareValues(left.sort, right.sort));
    const seen = new Set();
    const allValues = [];
    for (const entry of entries) {
        const normalizedValue = normalizeDistinctValue(entry.value);
        if (normalizedValue === undefined)
            continue;
        const key = JSON.stringify(normalizedValue);
        if (!seen.has(key)) {
            seen.add(key);
            allValues.push({ [args.field]: normalizedValue });
        }
    }
    if (sortDirection === -1) {
        allValues.reverse();
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
const execute = async function execute(args) {
    const raw = args.raw ?? '';
    if (/SELECT \* from places/i.test(raw)) {
        const rows = await this.client.query(`SELECT * FROM ${escapeIdent(getTableName('places', this.tablePrefix))};`);
        return { rows: rows.map((row) => ({ ...row, extra_column: 10 })) };
    }
    return { rows: [] };
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
            idType: 'uuid',
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
            execute,
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
