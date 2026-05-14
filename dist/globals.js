import { queueTransactionStatement } from './transactions/index.js';
import { getRecordID, getTableName, literal, normalizeDocument } from './utilities/sql.js';
const getGlobalsTable = (adapter) => getTableName('payload_globals', adapter.tablePrefix);
export const createGlobal = async function createGlobal(args) {
    const now = new Date().toISOString();
    const table = getGlobalsTable(this);
    const data = { ...args.data, createdAt: args.data.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now };
    const statement = `CREATE ${getRecordID(table, args.slug)} CONTENT ${literal(data)} RETURN AFTER;`;
    if (await queueTransactionStatement(this, args.req, statement)) {
        return (normalizeDocument({ ...data, id: args.slug }) ?? args.data);
    }
    const result = await this.client.query(statement);
    return (normalizeDocument(result[0]) ?? args.data);
};
export const findGlobal = async function findGlobal(args) {
    const result = await this.client.query(`SELECT * FROM ${getRecordID(getGlobalsTable(this), args.slug)};`);
    return (normalizeDocument(result[0]) ?? {});
};
export const updateGlobal = async function updateGlobal(args) {
    const now = new Date().toISOString();
    const table = getGlobalsTable(this);
    const existing = await findGlobal.call(this, { slug: args.slug });
    const data = { ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now };
    const statement = `UPSERT ${getRecordID(table, args.slug)} MERGE ${literal(data)} RETURN AFTER;`;
    if (await queueTransactionStatement(this, args.req, statement)) {
        return (normalizeDocument({ ...existing, ...data, id: args.slug }) ?? args.data);
    }
    const result = await this.client.query(statement);
    return (normalizeDocument(result[0]) ?? args.data);
};
