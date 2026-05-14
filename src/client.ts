import type { SurrealAdapter } from './index.js'

export type SurrealHTTPResult<T = unknown> = {
  result?: T
  status: 'ERR' | 'OK'
  time?: string
}

export type SurrealClient = {
  query: <T = unknown>(sql: string, options?: { timeoutMs?: number }) => Promise<T>
}

export class SurrealDBError extends Error {
  cause?: unknown
  code?: string
  duplicate = false
  status?: number

  constructor(message: string, options: { cause?: unknown; code?: string; duplicate?: boolean; status?: number } = {}) {
    super(message)
    this.name = 'SurrealDBError'
    this.cause = options.cause
    this.code = options.code
    this.duplicate = Boolean(options.duplicate)
    this.status = options.status
  }
}

const isDuplicateError = (value: unknown): boolean => {
  const message = typeof value === 'string' ? value : JSON.stringify(value)

  return /already exists|duplicate|unique|index/i.test(message)
}

const isRetryableConflict = (value: unknown): boolean => {
  const message = typeof value === 'string' ? value : JSON.stringify(value)

  return /transaction conflict|write conflict|can be retried/i.test(message)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const nativeFetch = globalThis.fetch.bind(globalThis)

const parseJSON = async (response: Response): Promise<SurrealHTTPResult[]> => {
  const text = await response.text()

  try {
    return JSON.parse(text) as SurrealHTTPResult[]
  } catch (error) {
    throw new SurrealDBError(`SurrealDB returned invalid JSON: ${text.slice(0, 500)}`, {
      cause: error,
      status: response.status,
    })
  }
}

export const createClient = (adapter: SurrealAdapter): SurrealClient => {
  const endpoint = `${adapter.url.replace(/\/$/, '')}/sql`
  const auth = adapter.auth
    ? `Basic ${Buffer.from(`${adapter.auth.username}:${adapter.auth.password}`).toString('base64')}`
    : undefined

  return {
    async query<T = unknown>(sql: string, options: { timeoutMs?: number } = {}): Promise<T> {
      const maxAttempts = 5

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? adapter.requestTimeoutMs ?? 30_000)

        let response: Response
        try {
          response = await nativeFetch(endpoint, {
            body: sql,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/surrealql',
              'Surreal-DB': adapter.database,
              'Surreal-NS': adapter.namespace,
              ...(auth ? { Authorization: auth } : {}),
            },
            method: 'POST',
            signal: controller.signal,
          })
        } catch (error) {
          throw new SurrealDBError(`Failed to connect to SurrealDB at ${endpoint}`, { cause: error })
        } finally {
          clearTimeout(timeout)
        }

        if (!response.ok) {
          const body = await response.text()
          throw new SurrealDBError(`SurrealDB HTTP ${response.status}: ${body}`, {
            duplicate: isDuplicateError(body),
            status: response.status,
          })
        }

        const statements = await parseJSON(response)
        const failed = statements.find((statement) => statement.status === 'ERR')

        if (failed) {
          if (attempt < maxAttempts && isRetryableConflict(failed.result)) {
            await sleep(10 * attempt)
            continue
          }

          throw new SurrealDBError(`SurrealDB query failed: ${JSON.stringify(failed.result)}`, {
            cause: failed.result,
            duplicate: isDuplicateError(failed.result),
          })
        }

        return statements.at(-1)?.result as T
      }

      throw new SurrealDBError('SurrealDB query failed after retrying transaction conflicts')
    },
  }
}
