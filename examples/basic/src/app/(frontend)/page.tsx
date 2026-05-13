import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

export default async function HomePage() {
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  let posts: any[] = []
  let error: string | undefined

  try {
    const result = await payload.find({
      collection: 'posts',
      limit: 10,
      sort: '-createdAt',
    })
    posts = result.docs
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return (
    <main className="demo">
      <section className="hero">
        <p className="eyebrow">Payload + SurrealDB alpha demo</p>
        <h1>Payload is using <code>payload-db-surrealdb</code>.</h1>
        <p>
          Start SurrealDB, open the admin panel, create a user, then add a few posts. This page
          reads the <code>posts</code> collection through Payload using the SurrealDB adapter.
        </p>
        <div className="actions">
          <a href="/admin">Open Payload admin</a>
          <a href="/api/posts">Open REST API</a>
        </div>
      </section>

      <section className="panel">
        <h2>Latest posts</h2>
        {error ? <pre className="error">{error}</pre> : null}
        {!error && posts.length === 0 ? (
          <p>No posts yet. Create one in <a href="/admin/collections/posts">the admin UI</a>.</p>
        ) : null}
        <div className="grid">
          {posts.map((post) => (
            <article key={post.id} className="card">
              <h3>{post.title}</h3>
              <p>{post.description || 'No description yet.'}</p>
              <code>{post.id}</code>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
