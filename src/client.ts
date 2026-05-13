import type { SurrealAdapter } from './index.js'

export type SurrealHTTPResult<T = unknown> = {
  result?: T
  status: 'ERR' | 'OK'
  time?: string
}

export type SurrealClient = {
  query: <T = unknown>(sql: string) => Promise<T>
}

export const createClient = (adapter: SurrealAdapter): SurrealClient => {
  const endpoint = `${adapter.url.replace(/\/$/, '')}/sql`
  const auth = adapter.auth
    ? `Basic ${Buffer.from(`${adapter.auth.username}:${adapter.auth.password}`).toString('base64')}`
    : undefined

  return {
    async query<T = unknown>(sql: string): Promise<T> {
      const response = await fetch(endpoint, {
        body: sql,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/surrealql',
          'Surreal-DB': adapter.database,
          'Surreal-NS': adapter.namespace,
          ...(auth ? { Authorization: auth } : {}),
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`SurrealDB HTTP ${response.status}: ${await response.text()}`)
      }

      const statements = (await response.json()) as SurrealHTTPResult[]
      const failed = statements.find((statement) => statement.status === 'ERR')

      if (failed) {
        throw new Error(`SurrealDB query failed: ${JSON.stringify(failed.result)}`)
      }

      return statements.at(-1)?.result as T
    },
  }
}
