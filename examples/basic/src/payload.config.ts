import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { surrealAdapter } from '../../../dist/index.js'

import { Users } from './collections/Users'
import { Posts } from './collections/Posts'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Posts],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret-change-me',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: surrealAdapter({
    url: process.env.SURREALDB_URL || 'http://localhost:8000',
    namespace: process.env.SURREALDB_NAMESPACE || 'payload_demo',
    database: process.env.SURREALDB_DATABASE || 'payload_demo',
    auth: {
      username: process.env.SURREALDB_USER || 'root',
      password: process.env.SURREALDB_PASS || 'root',
    },
  }),
  sharp,
  plugins: [],
})
