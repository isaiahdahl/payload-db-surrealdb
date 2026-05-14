import assert from 'node:assert/strict'

import { surrealAdapter } from '../dist/index.js'

const slug = `tx_posts_${Date.now()}`
const globalSlug = `tx_global_${Date.now()}`
const adapter = surrealAdapter().init({
  payload: {
    config: {
      collections: [{ slug }],
      globals: [{ slug: globalSlug }],
    },
  },
})

await adapter.connect()
await adapter.init()

const rollbackID = await adapter.beginTransaction()
const rolledBack = await adapter.create({
  collection: slug,
  data: { title: 'rollback' },
  req: { transactionID: rollbackID },
})
await adapter.rollbackTransaction(rollbackID)
assert.equal(
  (await adapter.find({ collection: slug, where: { id: { equals: rolledBack.id } }, limit: 1 })).totalDocs,
  0,
)

const commitID = await adapter.beginTransaction()
const committed = await adapter.create({
  collection: slug,
  data: { title: 'commit' },
  req: { transactionID: commitID },
})
await adapter.commitTransaction(commitID)
assert.equal(
  (await adapter.find({ collection: slug, where: { id: { equals: committed.id } }, limit: 1 })).totalDocs,
  1,
)

const parent = committed.id
await adapter.createVersion({
  collectionSlug: slug,
  parent,
  updatedAt: '2024-01-01T00:00:00.000Z',
  versionData: { title: 'draft one' },
})
await adapter.createVersion({
  collectionSlug: slug,
  parent,
  updatedAt: '2024-01-02T00:00:00.000Z',
  versionData: { title: 'draft two' },
})
const versions = await adapter.findVersions({ collection: slug, where: { parent: { equals: parent } }, limit: 10 })
assert.equal(versions.docs.filter((doc) => doc.latest).length, 1)
assert.equal(versions.docs.find((doc) => doc.latest).version.title, 'draft two')

const drafts = await adapter.queryDrafts({ collection: slug, where: { title: { equals: 'draft two' } }, limit: 10 })
assert.equal(drafts.totalDocs, 1)
assert.equal(drafts.docs[0].id, parent)
assert.equal(drafts.docs[0].title, 'draft two')

await adapter.createGlobalVersion({
  globalSlug,
  updatedAt: '2024-01-01T00:00:00.000Z',
  versionData: { title: 'global one' },
})
await adapter.createGlobalVersion({
  globalSlug,
  updatedAt: '2024-01-02T00:00:00.000Z',
  versionData: { title: 'global two' },
})
const globalVersions = await adapter.findGlobalVersions({ global: globalSlug, limit: 10 })
assert.equal(globalVersions.docs.filter((doc) => doc.latest).length, 1)
assert.equal(globalVersions.docs.find((doc) => doc.latest).version.title, 'global two')

console.log(JSON.stringify({ committed: committed.id, drafts: drafts.totalDocs, versions: versions.totalDocs }, null, 2))
