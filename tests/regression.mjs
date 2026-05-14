import assert from 'node:assert/strict'

import { buildWhere, pathToSQL } from '../dist/queries/buildWhere.js'
import { applyDefaults, applySelect } from '../dist/utilities/fields.js'
import { normalizeID } from '../dist/utilities/sql.js'

assert.equal(pathToSQL('group.weird-field'), 'group.⟨weird-field⟩')
assert.equal(buildWhere({ and: [], or: [] }), '')
assert.equal(
  buildWhere({ or: [{ title: { equals: 'A' } }, { title: { like: 'b' } }] }),
  'WHERE (title = "A" OR string::lowercase(<string>title) CONTAINS string::lowercase("b"))',
)
assert.equal(normalizeID('posts:123'), '123')
assert.equal(normalizeID({ id: '00123', tb: 'posts' }), '00123')

const fields = [
  { name: 'title', type: 'text', defaultValue: 'Untitled' },
  { name: 'publishedAt', type: 'date' },
  { name: 'location', type: 'point' },
  {
    name: 'meta',
    type: 'group',
    fields: [{ name: 'description', type: 'text', defaultValue: 'Default description' }],
  },
  {
    type: 'tabs',
    tabs: [
      {
        fields: [{ name: 'tabText', type: 'text', defaultValue: 'Tab default' }],
      },
    ],
  },
  {
    name: 'rows',
    type: 'array',
    fields: [{ name: 'label', type: 'text', defaultValue: 'Row' }],
  },
  {
    name: 'layout',
    type: 'blocks',
    blocks: [{ slug: 'hero', fields: [{ name: 'heading', type: 'text', defaultValue: 'Hero' }] }],
  },
]

const data = applyDefaults(
  {
    publishedAt: 1700000000000,
    location: [1, 2],
    meta: {},
    rows: [{}],
    layout: [{ blockType: 'hero' }],
  },
  fields,
)

assert.equal(data.title, 'Untitled')
assert.equal(data.publishedAt, '2023-11-14T22:13:20.000Z')
assert.deepEqual(data.location, [1, 2])
assert.deepEqual(data.meta, { description: 'Default description' })
assert.equal(data.tabText, 'Tab default')
assert.deepEqual(data.rows, [{ label: 'Row' }])
assert.deepEqual(data.layout, [{ blockType: 'hero', heading: 'Hero' }])
assert.deepEqual(applySelect({ id: 'a', title: 'Title', meta: { description: 'Desc', extra: true } }, { title: true, 'meta.description': true }), {
  id: 'a',
  meta: { description: 'Desc' },
  title: 'Title',
})

console.log('local regression tests passed')
