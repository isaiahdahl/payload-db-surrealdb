import fs from 'node:fs';
import path from 'node:path';
export const createMigration = ({ migrationName, payload }) => {
    const adapter = payload.db;
    const migrationDir = adapter.migrationDir || 'migrations';
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const name = migrationName || 'migration';
    const fileName = `${timestamp}_${name}.ts`;
    const filePath = path.resolve(migrationDir, fileName);
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(filePath, `import type { MigrateUpArgs, MigrateDownArgs } from 'payload-db-surrealdb'\n\nexport async function up({ payload }: MigrateUpArgs): Promise<void> {\n  // Migration code\n}\n\nexport async function down({ payload }: MigrateDownArgs): Promise<void> {\n  // Migration code\n}\n`);
    const indexPath = path.resolve(migrationDir, 'index.ts');
    const importName = `${timestamp}_${name.replace(/\W/g, '_')}`;
    fs.writeFileSync(indexPath, `import * as ${importName} from './${fileName.replace(/\.ts$/, '')}'\n\nexport const migrations = [\n  { ...${importName}, name: '${fileName.replace(/\.ts$/, '')}' },\n]\n`);
};
export async function migrate() {
    await this.client.query('DEFINE TABLE IF NOT EXISTS payload_migrations SCHEMALESS;');
    const migrationDir = this.migrationDir || 'migrations';
    if (!fs.existsSync(migrationDir)) {
        return;
    }
    const files = fs.readdirSync(migrationDir).filter((file) => file.endsWith('.ts') && file !== 'index.ts');
    let batch = 1;
    for (const file of files) {
        const name = file.replace(/\.ts$/, '');
        await this.client.query(`UPSERT type::record("payload_migrations", ${JSON.stringify(name)}) CONTENT ${JSON.stringify({ batch, name })};`);
    }
}
export async function migrateDown() { }
export async function migrateRefresh() {
    await migrate.call(this);
}
export async function migrateReset() {
    await this.client.query('DELETE payload_migrations;');
}
export async function migrateStatus() { }
export async function migrateFresh() {
    await this.client.query('DELETE payload_migrations;');
    await migrate.call(this);
}
