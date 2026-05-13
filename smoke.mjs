import { surrealAdapter } from './dist/index.js'

const adapter = surrealAdapter().init({ payload: { config: { collections: [{ slug: 'posts' }] } } })
await adapter.connect()
await adapter.init()
const title = `Smoke test ${Date.now()}`
const created = await adapter.create({ collection: 'posts', data: { title } })
const found = await adapter.find({ collection: 'posts', where: { title: { equals: title } }, limit: 10 })
await adapter.updateOne({ collection: 'posts', id: created.id, data: { title: `${title} updated` } })
const updated = await adapter.findOne({ collection: 'posts', where: { id: { equals: created.id } } })
await adapter.deleteOne({ collection: 'posts', where: { id: { equals: created.id } } })
console.log(JSON.stringify({ created, found: found.totalDocs, updated }, null, 2))
