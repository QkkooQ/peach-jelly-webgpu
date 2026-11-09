import { expect, test } from '@playwright/test'

test('renders the material study and exercises the control workflow', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto('/')
  await expect(page).toHaveTitle('Peach Jelly — WebGPU Soft-Body Study')
  await expect(page.getByRole('heading', { name: /Peach/ })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.locator('.runtime-status')).toContainText(/WebGPU|WebGL2/)
  await expect(page.getByText('正在求解软质体')).toHaveCount(0, { timeout: 15_000 })

  await page.getByRole('button', { name: '暂停模拟' }).click()
  await expect(page.getByRole('button', { name: '继续模拟' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '1/4 速度' }).click()
  await expect(page.getByRole('button', { name: '1/4 速度' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '四面体网格' }).click()
  await expect(page.getByRole('button', { name: '四面体网格' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '弹出果核' }).click()
  await expect(page.getByRole('button', { name: '放回果核' })).toBeVisible()
  await page.getByRole('button', { name: '放回果核' }).click()
  await expect(page.getByRole('button', { name: '弹出果核' })).toBeVisible()
  await page.getByRole('button', { name: '重置样片' }).click()
  await expect(page.getByRole('button', { name: '暂停模拟' })).toHaveAttribute('aria-pressed', 'false')
  expect(consoleErrors).toEqual([])
})

test('soft body responds to a pointer drag and returns to rest', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('正在求解软质体')).toHaveCount(0, { timeout: 15_000 })
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  await page.waitForTimeout(2_500)

  const centerX = box.x + box.width * 0.49
  const centerY = box.y + box.height * 0.62
  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  await page.mouse.move(centerX + Math.min(120, box.width * 0.11), centerY - 95, { steps: 12 })
  await expect
    .poll(async () => page.locator('.live-metrics').innerText(), { timeout: 3_000 })
    .not.toContain('抓取区域\n0.0%')
  await page.mouse.up()
  await expect
    .poll(async () => page.locator('.live-metrics').innerText(), { timeout: 4_000 })
    .toContain('抓取区域\n0.0%')
})

test('recovers its volume after repeated alternating pulls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('正在求解软质体')).toHaveCount(0, { timeout: 15_000 })
  const canvas = page.locator('canvas')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  await page.waitForTimeout(2_000)

  const centerX = box.x + box.width * 0.49
  const centerY = box.y + box.height * 0.61
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + (index % 2 === 0 ? 85 : -75), centerY - 85, { steps: 6 })
    await page.waitForTimeout(90)
    await page.mouse.up()
    await page.waitForTimeout(130)
  }

  const metrics = await page.locator('.live-metrics').innerText()
  const volume = Number(metrics.match(/体积保持\n([\d.]+)%/)?.[1] ?? 0)
  expect(volume).toBeGreaterThan(90)
  await page.waitForTimeout(1_400)
  const recovered = await page.locator('.live-metrics').innerText()
  const recoveredVolume = Number(recovered.match(/体积保持\n([\d.]+)%/)?.[1] ?? 0)
  expect(recoveredVolume).toBeGreaterThan(97)
})

test('mobile layout has no horizontal overflow', async ({ page }) => {
  for (const width of [390, 744]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.getByText('正在求解软质体')).toHaveCount(0, { timeout: 15_000 })
    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }))
    expect(widths.document).toBeLessThanOrEqual(widths.viewport)
    await expect(page.getByRole('button', { name: '重置样片' })).toBeVisible()
  }
})

test('falls back to the WebGL2 backend when WebGPU is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })
  })
  await page.goto('/')
  await expect(page.getByText('正在求解软质体')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.runtime-status')).toContainText('WebGL2')
  await expect(page.locator('canvas')).toBeVisible()
})
