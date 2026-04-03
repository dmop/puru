/**
 * Example: JSON Processing at Scale
 *
 * Large JSON payloads block the event loop during parse, validate,
 * and transform. This example offloads that CPU work to worker threads
 * so the main thread stays responsive.
 *
 * Simulates an API server that receives bulk JSON payloads,
 * validates each record, transforms fields, and returns aggregated results.
 *
 * Primitives used: task(), WaitGroup, ErrGroup
 */

import { task, ErrGroup, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Types ───────────────────────────────────────────────────────────────────

type RawOrder = {
  id: string
  customer: string
  items: { sku: string; qty: number; price: number }[]
  created_at: string
  discount_code?: string
}

// ─── Define tasks ────────────────────────────────────────────────────────────

// Parse and validate a JSON payload (simulates a large request body)
const parseAndValidate = task((raw: string) => {
  const data = JSON.parse(raw) as Array<{
    id: string
    customer: string
    items: { sku: string; qty: number; price: number }[]
    created_at: string
    discount_code?: string
  }>

  const errors: string[] = []
  const valid: typeof data = []

  for (const order of data) {
    if (!order.id || !order.customer || !Array.isArray(order.items)) {
      errors.push(`Invalid order: missing required fields`)
      continue
    }
    if (order.items.length === 0) {
      errors.push(`Order ${order.id}: no items`)
      continue
    }
    for (const item of order.items) {
      if (item.qty <= 0 || item.price < 0) {
        errors.push(`Order ${order.id}: invalid item ${item.sku}`)
        continue
      }
    }
    valid.push(order)
  }

  return { valid, errors }
})

// Transform validated orders into processed results
const transformOrders = task(
  (
    orders: Array<{
      id: string
      customer: string
      items: { sku: string; qty: number; price: number }[]
      created_at: string
      discount_code?: string
    }>,
  ) => {
    const discountRates: Record<string, number> = {
      SAVE10: 0.1,
      SAVE20: 0.2,
      VIP: 0.15,
    }

    return orders.map((order) => {
      const subtotal = order.items.reduce((sum, item) => sum + item.qty * item.price, 0)
      const discountRate = order.discount_code ? (discountRates[order.discount_code] ?? 0) : 0
      const discount = subtotal * discountRate

      return {
        id: order.id,
        customer: order.customer,
        itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        total: Math.round((subtotal - discount) * 100) / 100,
        createdAt: order.created_at,
      }
    })
  },
)

// Aggregate results across all chunks
const aggregateResults = task(
  (
    orders: Array<{
      id: string
      customer: string
      itemCount: number
      subtotal: number
      discount: number
      total: number
    }>,
  ) => {
    const byCustomer: Record<string, { orders: number; total: number }> = {}
    let totalRevenue = 0
    let totalDiscount = 0
    let totalItems = 0

    for (const order of orders) {
      totalRevenue += order.total
      totalDiscount += order.discount
      totalItems += order.itemCount

      if (!byCustomer[order.customer]) {
        byCustomer[order.customer] = { orders: 0, total: 0 }
      }
      byCustomer[order.customer].orders++
      byCustomer[order.customer].total += order.total
    }

    return {
      orderCount: orders.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalItems,
      topCustomers: Object.entries(byCustomer)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .map(([name, stats]) => ({ name, ...stats })),
    }
  },
)

// ─── Generate test data ──────────────────────────────────────────────────────

function generatePayload(orderCount: number): string {
  const customers = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi']
  const skus = ['SKU-001', 'SKU-002', 'SKU-003', 'SKU-004', 'SKU-005']
  const discounts = [undefined, 'SAVE10', 'SAVE20', 'VIP']

  const orders: RawOrder[] = []
  for (let i = 0; i < orderCount; i++) {
    const itemCount = 1 + Math.floor(Math.random() * 5)
    orders.push({
      id: `ORD-${String(i).padStart(6, '0')}`,
      customer: customers[i % customers.length],
      items: Array.from({ length: itemCount }, (_, j) => ({
        sku: skus[(i + j) % skus.length],
        qty: 1 + Math.floor(Math.random() * 10),
        price: Math.round((5 + Math.random() * 95) * 100) / 100,
      })),
      created_at: `2025-01-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00Z`,
      discount_code: discounts[i % discounts.length],
    })
  }
  return JSON.stringify(orders)
}

// ─── Single large payload ────────────────────────────────────────────────────

{
  console.log('--- Single payload: 1,000 orders ---')
  const start = performance.now()

  const payload = generatePayload(1_000)
  console.log(`  Payload size: ${(payload.length / 1024).toFixed(1)} KB`)

  const { valid, errors } = await parseAndValidate(payload)
  const processed = await transformOrders(valid)
  const summary = await aggregateResults(processed)

  const elapsed = (performance.now() - start).toFixed(1)

  console.log(`  Valid: ${valid.length}, Errors: ${errors.length}`)
  console.log(`  Revenue: $${summary.totalRevenue.toLocaleString()}`)
  console.log(`  Discounts: $${summary.totalDiscount.toLocaleString()}`)
  console.log(`  Items sold: ${summary.totalItems}`)
  console.log(`  Top customers:`)
  for (const c of summary.topCustomers) {
    console.log(`    ${c.name.padEnd(10)} ${c.orders} orders, $${c.total.toFixed(2)}`)
  }
  console.log(`  Done in ${elapsed}ms`)
}

// ─── Parallel chunks with WaitGroup ──────────────────────────────────────────
//
// Simulates multiple API requests arriving simultaneously,
// each with a chunk of orders to process.

{
  console.log('\n--- Parallel: 4 chunks x 500 orders ---')
  const start = performance.now()

  const chunks = Array.from({ length: 4 }, () => generatePayload(500))

  // task() passes data as arguments — no closure capture
  const processChunk = task((raw: string) => {
    const parsed = JSON.parse(raw) as Array<{
      items: { qty: number; price: number }[]
    }>
    const subtotal = parsed.reduce(
      (sum, order) =>
        sum + order.items.reduce((s, item) => s + item.qty * item.price, 0),
      0,
    )
    return { count: parsed.length, subtotal: Math.round(subtotal * 100) / 100 }
  })

  const results = await Promise.all(chunks.map((chunk) => processChunk(chunk)))
  const elapsed = (performance.now() - start).toFixed(1)

  let totalOrders = 0
  let totalSubtotal = 0
  for (const r of results) {
    totalOrders += r.count
    totalSubtotal += r.subtotal
  }

  console.log(`  Processed ${totalOrders} orders across ${chunks.length} chunks`)
  console.log(`  Combined subtotal: $${totalSubtotal.toLocaleString()}`)
  console.log(`  Done in ${elapsed}ms`)
}

// ─── Fail-fast with ErrGroup ─────────────────────────────────────────────────
//
// If one chunk has invalid JSON, cancel the rest immediately.

{
  console.log('\n--- ErrGroup: fail-fast on bad payload ---')

  const eg = new ErrGroup()

  eg.spawn(() => {
    const data = JSON.parse('[{"id":"1","ok":true}]') as unknown[]
    return data.length
  })
  eg.spawn(() => {
    JSON.parse('{ invalid json !!!') // will throw
    return 0
  })
  eg.spawn(() => {
    const data = JSON.parse('[{"id":"3","ok":true}]') as unknown[]
    return data.length
  })

  try {
    await eg.wait()
  } catch (err) {
    console.log(`  Caught error (remaining tasks cancelled): ${(err as Error).message}`)
  }
}
