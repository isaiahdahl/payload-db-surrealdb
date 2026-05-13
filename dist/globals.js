import { getRecordID, literal, normalizeDocument } from './utilities/sql.js';
const table = 'payload_globals';
export const createGlobal = async function createGlobal(args) {
    const now = new Date().toISOString();
    const result = await this.client.query(`CREATE ${getRecordID(table, args.slug)} CONTENT ${literal({ ...args.data, createdAt: args.data.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now })} RETURN AFTER;`);
    return normalizeDocument(result[0]) ?? args.data;
};
export const findGlobal = async function findGlobal(args) {
    const result = await this.client.query(`SELECT * FROM ${getRecordID(table, args.slug)};`);
    return normalizeDocument(result[0]) ?? {};
};
export const updateGlobal = async function updateGlobal(args) {
    const now = new Date().toISOString();
    const existing = await findGlobal.call(this, { slug: args.slug });
    const result = await this.client.query(`UPSERT ${getRecordID(table, args.slug)} MERGE ${literal({ ...args.data, createdAt: args.data.createdAt ?? existing.createdAt ?? now, globalType: args.slug, updatedAt: args.data.updatedAt ?? now })} RETURN AFTER;`);
    return normalizeDocument(result[0]) ?? args.data;
};
