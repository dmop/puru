/**
 * Example: Dashboard Aggregation
 *
 * The most common real-world bottleneck in SaaS apps: query the DB,
 * get back thousands of rows, then group/aggregate/rank on the server
 * before sending to the frontend.
 *
 * This example simulates:
 *   1. Concurrent DB queries (I/O-bound → concurrent mode)
 *   2. Heavy aggregation on the results (CPU-bound → task())
 *   3. Multi-tenant parallel aggregation
 *
 * The DB queries are simulated with setTimeout, but the aggregation
 * logic is real — swap the simulated query for your actual DB client
 * and it works the same way.
 *
 * Primitives used: task(), ErrGroup
 */

import { task, ErrGroup, configure } from '../dist/index.js'

configure({ adapter: 'auto' })

// ─── Types ───────────────────────────────────────────────────────────────────

type SalesRow = {
  id: number
  tenant: string
  product: string
  category: string
  amount: number
  quantity: number
  date: string
  region: string
}


// ─── Simulated DB ────────────────────────────────────────────────────────────
//
// In production, replace this with your actual DB client:
//   const rows = await db.query('SELECT * FROM sales WHERE tenant = ?', [tenantId])

function generateSalesData(tenant: string, rowCount: number): SalesRow[] {
  const products = ['Widget A', 'Widget B', 'Gadget X', 'Gadget Y', 'Service Pro', 'Service Basic']
  const categories = ['Hardware', 'Hardware', 'Electronics', 'Electronics', 'Services', 'Services']
  const regions = ['North', 'South', 'East', 'West']

  const rows: SalesRow[] = []
  for (let i = 0; i < rowCount; i++) {
    const productIdx = i % products.length
    const day = 1 + (i % 28)
    rows.push({
      id: i,
      tenant,
      product: products[productIdx],
      category: categories[productIdx],
      amount: Math.round((10 + Math.random() * 490) * 100) / 100,
      quantity: 1 + Math.floor(Math.random() * 20),
      date: `2025-01-${String(day).padStart(2, '0')}`,
      region: regions[i % regions.length],
    })
  }
  return rows
}

// Simulates a DB query with network latency
async function queryDB(tenant: string, rowCount: number): Promise<SalesRow[]> {
  await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30))
  return generateSalesData(tenant, rowCount)
}

// ─── Aggregation task (CPU-heavy, runs in worker thread) ─────────────────────
//
// This is the part that blocks the event loop in production.
// On 10K+ rows, reduce/sort/percentile is 10-50ms of pure CPU.

const aggregateSales = task(
  (
    rows: Array<{
      product: string
      category: string
      amount: number
      quantity: number
      date: string
      region: string
    }>,
  ) => {
    let totalRevenue = 0
    let totalOrders = rows.length
    const amounts: number[] = []

    const productMap: Record<string, { revenue: number; quantity: number }> = {}
    const categoryMap: Record<string, number> = {}
    const regionMap: Record<string, number> = {}
    const dailyMap: Record<string, { revenue: number; orders: number }> = {}

    for (const row of rows) {
      totalRevenue += row.amount
      amounts.push(row.amount)

      // By product
      if (!productMap[row.product]) productMap[row.product] = { revenue: 0, quantity: 0 }
      productMap[row.product].revenue += row.amount
      productMap[row.product].quantity += row.quantity

      // By category
      categoryMap[row.category] = (categoryMap[row.category] ?? 0) + row.amount

      // By region
      regionMap[row.region] = (regionMap[row.region] ?? 0) + row.amount

      // Daily time series
      if (!dailyMap[row.date]) dailyMap[row.date] = { revenue: 0, orders: 0 }
      dailyMap[row.date].revenue += row.amount
      dailyMap[row.date].orders++
    }

    // Top products by revenue
    const topProducts = Object.entries(productMap)
      .map(([product, stats]) => ({
        product,
        revenue: Math.round(stats.revenue * 100) / 100,
        quantity: stats.quantity,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // Percentiles (sorting is the expensive part)
    amounts.sort((a, b) => a - b)
    const p50 = amounts[Math.floor(amounts.length * 0.5)]
    const p95 = amounts[Math.floor(amounts.length * 0.95)]

    // Round category/region totals
    for (const key of Object.keys(categoryMap)) {
      categoryMap[key] = Math.round(categoryMap[key] * 100) / 100
    }
    for (const key of Object.keys(regionMap)) {
      regionMap[key] = Math.round(regionMap[key] * 100) / 100
    }

    // Sort time series by date
    const dailyTimeSeries = Object.entries(dailyMap)
      .map(([date, stats]) => ({
        date,
        revenue: Math.round(stats.revenue * 100) / 100,
        orders: stats.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      avgOrderValue: Math.round((totalRevenue / totalOrders) * 100) / 100,
      topProducts,
      revenueByCategory: categoryMap,
      revenueByRegion: regionMap,
      dailyTimeSeries,
      p50OrderValue: Math.round(p50 * 100) / 100,
      p95OrderValue: Math.round(p95 * 100) / 100,
    }
  },
)

// ─── Scenario 1: Single tenant dashboard ─────────────────────────────────────

{
  console.log('--- Single tenant: 10,000 sales rows ---')
  const start = performance.now()

  // Step 1: Query DB (I/O — doesn't block event loop)
  const rows = await queryDB('acme-corp', 10_000)

  // Step 2: Aggregate (CPU — offloaded to worker thread)
  const dashboard = await aggregateSales(rows)

  const elapsed = (performance.now() - start).toFixed(1)

  console.log(`  Revenue: $${dashboard.totalRevenue.toLocaleString()}`)
  console.log(`  Orders: ${dashboard.totalOrders}`)
  console.log(`  Avg order: $${dashboard.avgOrderValue}`)
  console.log(`  P50: $${dashboard.p50OrderValue} | P95: $${dashboard.p95OrderValue}`)
  console.log(`  Top products:`)
  for (const p of dashboard.topProducts) {
    console.log(`    ${p.product.padEnd(16)} $${p.revenue.toLocaleString()} (${p.quantity} units)`)
  }
  console.log(`  By region:`)
  for (const [region, rev] of Object.entries(dashboard.revenueByRegion)) {
    console.log(`    ${region.padEnd(8)} $${rev.toLocaleString()}`)
  }
  console.log(`  Done in ${elapsed}ms`)
}

// ─── Scenario 2: Multi-tenant parallel aggregation ───────────────────────────
//
// A real SaaS pattern: admin dashboard that shows stats for multiple tenants.
// Query all tenants in parallel, aggregate each in its own worker thread.

{
  console.log('\n--- Multi-tenant: 6 tenants x 5,000 rows each ---')
  const start = performance.now()

  const tenants = ['acme-corp', 'globex', 'initech', 'umbrella', 'cyberdyne', 'weyland']

  // Fan out: query + aggregate per tenant, all in parallel
  const results = await Promise.all(
    tenants.map(async (tenant) => {
      const rows = await queryDB(tenant, 5_000)
      const dashboard = await aggregateSales(rows)
      return { tenant, dashboard }
    }),
  )

  const elapsed = (performance.now() - start).toFixed(1)

  console.log(`  ${'Tenant'.padEnd(14)} ${'Revenue'.padStart(12)}  ${'Orders'.padStart(8)}  ${'Avg'.padStart(8)}`)
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(12)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}`)
  for (const { tenant, dashboard } of results) {
    console.log(
      `  ${tenant.padEnd(14)} ${'$' + dashboard.totalRevenue.toLocaleString().padStart(11)}  ${String(dashboard.totalOrders).padStart(8)}  ${'$' + String(dashboard.avgOrderValue).padStart(7)}`,
    )
  }
  console.log(`  Done in ${elapsed}ms (queries + aggregation in parallel)`)
}

// ─── Scenario 3: Dashboard with multiple data sources (ErrGroup) ─────────────
//
// Real dashboards often hit multiple tables/services.
// ErrGroup: if one query fails, cancel the rest and return an error fast.

{
  console.log('\n--- Multi-source dashboard with fail-fast ---')
  const start = performance.now()

  const eg = new ErrGroup()

  // Sales summary — query + aggregate off main thread
  eg.spawn(
    async () => {
      // Simulated DB query inside worker
      const rows: Array<{ amount: number; date: string }> = []
      for (let i = 0; i < 5000; i++) {
        rows.push({
          amount: Math.round((10 + Math.random() * 490) * 100) / 100,
          date: `2025-01-${String(1 + (i % 28)).padStart(2, '0')}`,
        })
      }
      return {
        type: 'sales',
        total: rows.reduce((s, r) => s + r.amount, 0),
        count: rows.length,
      }
    },
    { concurrent: true },
  )

  // Active users — simulated analytics query
  eg.spawn(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return {
        type: 'users',
        daily: 1_245,
        weekly: 8_932,
        monthly: 34_567,
      }
    },
    { concurrent: true },
  )

  // System health — simulated metrics query
  eg.spawn(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        type: 'health',
        uptime: 99.97,
        avgLatency: 42,
        errorRate: 0.03,
      }
    },
    { concurrent: true },
  )

  try {
    const [sales, users, health] = await eg.wait()
    const elapsed = (performance.now() - start).toFixed(1)

    console.log(`  Sales:  ${(sales as { count: number }).count} orders`)
    console.log(`  Users:  ${(users as { daily: number }).daily} DAU / ${(users as { monthly: number }).monthly} MAU`)
    console.log(`  Health: ${(health as { uptime: number }).uptime}% uptime, ${(health as { avgLatency: number }).avgLatency}ms avg latency`)
    console.log(`  All 3 data sources loaded in ${elapsed}ms`)
  } catch (err) {
    console.log(`  Dashboard failed fast: ${(err as Error).message}`)
  }
}
