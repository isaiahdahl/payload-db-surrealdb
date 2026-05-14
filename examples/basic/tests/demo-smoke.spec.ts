import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const adminEmail = process.env.PAYLOAD_SMOKE_EMAIL || 'demo-admin@example.com'
const adminPassword = process.env.PAYLOAD_SMOKE_PASSWORD || 'demo-password-123456'
const surrealUrl = process.env.SURREALDB_URL || 'http://127.0.0.1:8000'
const surrealNamespace = process.env.SURREALDB_NAMESPACE || 'payload_demo'
const surrealDatabase = process.env.SURREALDB_DATABASE || 'payload_demo'
const surrealUser = process.env.SURREALDB_USER || 'root'
const surrealPass = process.env.SURREALDB_PASS || 'root'

type LoginResponse = {
  token?: string
  user?: { id?: string; email?: string }
}

async function ensureFirstAdmin(request: APIRequestContext): Promise<string> {
  const login = await request.post('/api/users/login', {
    data: { email: adminEmail, password: adminPassword },
  })

  if (login.ok()) {
    const body = (await login.json()) as LoginResponse
    if (!body.token) throw new Error('Payload login response did not include a token')
    return body.token
  }

  const firstRegister = await request.post('/api/users/first-register', {
    data: { email: adminEmail, password: adminPassword },
  })

  if (!firstRegister.ok()) {
    throw new Error(
      `Unable to create or login smoke admin. login=${login.status()} first-register=${firstRegister.status()} ${await firstRegister.text()}`,
    )
  }

  const body = (await firstRegister.json()) as LoginResponse
  if (!body.token) throw new Error('Payload first-register response did not include a token')
  return body.token
}

async function loginThroughAdmin(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    {
      name: 'payload-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

  await page.goto('/admin')

  const emailInput = page.locator('input[name="email"], input[type="email"]').first()
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(adminEmail)
    await page.locator('input[name="password"], input[type="password"]').first().fill(adminPassword)
    await page.getByRole('button', { name: /login|log in|sign in/i }).click()
    await expect(emailInput).toBeHidden({ timeout: 30_000 })
  }

  await expect(page).toHaveURL(/\/admin(\/|$)/)
}

async function expectAdminList(page: Page, slug: string): Promise<void> {
  await page.goto(`/admin/collections/${slug}`)
  await expect(page).toHaveURL(new RegExp(`/admin/collections/${slug}`))
  await expect(page.locator('body')).toContainText(new RegExp(slug, 'i'))
}

async function querySurrealForPost(slug: string): Promise<unknown[]> {
  const response = await fetch(`${surrealUrl.replace(/\/$/, '')}/sql`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${surrealUser}:${surrealPass}`).toString('base64')}`,
      'Content-Type': 'application/surrealql',
      NS: surrealNamespace,
      DB: surrealDatabase,
    },
    body: `SELECT * FROM posts WHERE slug = '${slug}';`,
  })

  if (!response.ok) {
    throw new Error(`SurrealDB query failed: ${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as Array<{ result?: unknown[] }>
  return body.flatMap((entry) => entry.result ?? [])
}

test('basic demo admin, REST API, and SurrealDB smoke', async ({ page, request }) => {
  const token = await ensureFirstAdmin(request)
  await loginThroughAdmin(page, token)

  await expectAdminList(page, 'users')
  await expectAdminList(page, 'posts')

  const slug = `playwright-smoke-${Date.now()}`
  const title = `Playwright Smoke ${new Date().toISOString()}`

  const created = await request.post('/api/posts', {
    headers: { Authorization: `JWT ${token}` },
    data: {
      title,
      slug,
      description: 'Created by the payload-db-surrealdb demo smoke harness.',
      featured: true,
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const createdBody = (await created.json()) as { doc?: { id?: string; title?: string }; id?: string; title?: string }
  expect(createdBody.doc?.title ?? createdBody.title).toBe(title)

  await page.goto('/admin/collections/posts')
  await expect(page.locator('body')).toContainText(title)

  const rest = await request.get(`/api/posts?where[slug][equals]=${encodeURIComponent(slug)}`)
  expect(rest.ok(), await rest.text()).toBeTruthy()
  const restBody = (await rest.json()) as { docs?: Array<{ slug?: string; title?: string }>; totalDocs?: number }
  expect(restBody.totalDocs).toBeGreaterThan(0)
  expect(restBody.docs?.some((doc) => doc.slug === slug && doc.title === title)).toBeTruthy()

  const surrealRows = await querySurrealForPost(slug)
  expect(surrealRows.length).toBeGreaterThan(0)
})
