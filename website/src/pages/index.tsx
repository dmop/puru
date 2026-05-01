import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import styles from './index.module.css'

const features = [
  {
    icon: '⚡',
    title: 'True CPU Parallelism',
    desc: 'Worker threads run CPU-heavy code on separate cores simultaneously. No blocking the main event loop.',
  },
  {
    icon: '🔀',
    title: 'Go-Style Channels',
    desc: 'Cross-thread communication with buffered channels, select(), and producer/consumer pipelines.',
  },
  {
    icon: '🏗️',
    title: 'Structured Concurrency',
    desc: 'WaitGroup, ErrGroup, context propagation, timeouts, and cancellation — all Go-inspired.',
  },
  {
    icon: '📦',
    title: 'Zero Dependencies',
    desc: 'Under 15 kB. No worker files to maintain. Node.js 20+ and Bun. Drop it in and go.',
  },
]

const benchmarks = [
  { label: 'Fibonacci (fib(38) ×8)', single: '4,345 ms', puru: '2,131 ms', speedup: '2.0×' },
  { label: 'Prime counting (2M range)', single: '335 ms', puru: '77 ms', speedup: '4.4×' },
  { label: '100 concurrent async tasks', single: '1,140 ms', puru: '16 ms', speedup: '73×' },
  { label: 'Fan-out pipeline (4 workers)', single: '176 ms', puru: '51 ms', speedup: '3.4×' },
]

function Hero() {
  return (
    <header className={styles.hero}>
      <div className="container">
        <h1 className={styles.heroTitle}>puru (プール)</h1>
        <p className={styles.heroSubtitle}>
          Worker-thread <strong>parallelism</strong> and Go-style <strong>concurrency</strong> for JavaScript.
          No worker files. No boilerplate. Zero dependencies.
        </p>
        <div className={styles.heroButtons}>
          <Link className="button button--primary button--lg" to="/docs/intro">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/guides/choosing-primitives">
            Choose a Primitive
          </Link>
          <Link
            className="button button--secondary button--lg"
            href="https://github.com/dmop/puru"
          >
            GitHub
          </Link>
        </div>
        <div className={styles.installBlock}>
          <span>$</span>npm install @dmop/puru
        </div>
      </div>
    </header>
  )
}

function Features() {
  return (
    <section className={styles.features}>
      <div className="container">
        <h2 className={styles.sectionTitle}>What puru gives you</h2>
        <p className={styles.sectionSubtitle}>
          Worker threads for CPU work. Go primitives for coordination.
        </p>
        <div className={styles.featuresGrid}>
          {features.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <div className={styles.featureTitle}>{f.title}</div>
              <p className={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Perf() {
  return (
    <section className={styles.perf}>
      <div className="container">
        <h2 className={styles.sectionTitle}>Performance</h2>
        <p className={styles.sectionSubtitle}>Apple M1 Pro · Node.js</p>
        <div className={styles.perfTable}>
          <table>
            <thead>
              <tr>
                <th>Benchmark</th>
                <th>Single-threaded</th>
                <th>puru</th>
                <th>Speedup</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td>{b.single}</td>
                  <td>{b.puru}</td>
                  <td><strong>{b.speedup}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link to="/docs/benchmarks">Full benchmark results →</Link>
        </p>
      </div>
    </section>
  )
}

export default function Home(): JSX.Element {
  return (
    <Layout
      title="Go-style concurrency and parallelism for JavaScript"
      description="puru — Worker-thread parallelism and Go-style concurrency for JavaScript. No worker files, zero dependencies."
    >
      <Hero />
      <main>
        <Features />
        <Perf />
      </main>
    </Layout>
  )
}
