import { surrealAdapter } from './dist/index.js'

const now = Date.now()
const collections = [
  {
    slug: 'authors',
    fields: [
      { name: 'name', type: 'text' },
      { name: 'posts', type: 'join', collection: 'posts', on: 'author', hasMany: true, limit: 5, sort: '-createdAt' },
    ],
  },
  { slug: 'categories', fields: [{ name: 'name', type: 'text' }] },
  { slug: 'media', fields: [{ name: 'alt', type: 'text' }] },
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
      { name: 'hero', type: 'upload', relationTo: 'media' },
      { name: 'related', type: 'relationship', relationTo: ['posts', 'media'], hasMany: true },
    ],
  },
]

const adapter = surrealAdapter({ database: 'payload_relationship_smoke', namespace: 'payload_relationship_smoke' }).init({
  payload: { config: { collections } },
})

await adapter.connect()
await adapter.init()

const author = await adapter.create({ collection: 'authors', data: { name: `Author ${now}` } })
const categoryA = await adapter.create({ collection: 'categories', data: { name: `Category A ${now}` } })
const categoryB = await adapter.create({ collection: 'categories', data: { name: `Category B ${now}` } })
const media = await adapter.create({ collection: 'media', data: { alt: `Hero ${now}` } })
const relatedPost = await adapter.create({ collection: 'posts', data: { title: `Related ${now}`, author: author.id } })
const post = await adapter.create({
  collection: 'posts',
  data: {
    title: `Post ${now}`,
    author,
    categories: [categoryA, categoryB.id],
    hero: media,
    related: [
      { relationTo: 'posts', value: relatedPost },
      { relationTo: 'media', value: media.id },
    ],
  },
})

const foundByAuthor = await adapter.find({ collection: 'posts', where: { author: { equals: author.id } }, limit: 10 })
const foundByCategory = await adapter.find({ collection: 'posts', where: { categories: { equals: categoryA.id } }, limit: 10 })
const populated = await adapter.findOne({ collection: 'posts', where: { id: { equals: post.id } }, depth: 1 })
const authorWithPosts = await adapter.findOne({ collection: 'authors', where: { id: { equals: author.id } }, depth: 1 })

if (!foundByAuthor.docs.some((doc) => doc.id === post.id)) throw new Error('relationship where by author failed')
if (!foundByCategory.docs.some((doc) => doc.id === post.id)) throw new Error('hasMany relationship where by category failed')
if (populated.author?.id !== author.id) throw new Error('author population failed')
if (!Array.isArray(populated.categories) || populated.categories[0]?.id !== categoryA.id) throw new Error('hasMany population failed')
if (populated.hero?.id !== media.id) throw new Error('upload relationship population failed')
if (populated.related?.[0]?.value?.id !== relatedPost.id) throw new Error('polymorphic population failed')
if (!authorWithPosts.posts?.docs?.some((doc) => doc.id === post.id)) throw new Error('join resolver failed')

console.log(JSON.stringify({
  postID: post.id,
  foundByAuthor: foundByAuthor.totalDocs,
  foundByCategory: foundByCategory.totalDocs,
  populatedAuthor: populated.author.id,
  joinTotal: authorWithPosts.posts.totalDocs,
}, null, 2))
