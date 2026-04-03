# Contributing to puru

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/dmop/puru.git
cd puru
npm install
npm run build
npm test
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build with tsup (ESM + CJS) |
| `npm run lint` | Lint with oxlint |
| `npm run typecheck` | Type-check with tsc |
| `npm test` | Run tests with vitest |
| `npm run bench` | Run benchmarks |
| `npm run size` | Check bundle size |

## Pull Requests

1. Fork the repo and create a branch from `main`
2. If you added functionality, add tests
3. Ensure `npm run lint`, `npm run typecheck`, and `npm test` all pass
4. Add a changeset: `npx changeset` — describe what changed and pick the semver bump
5. Open a PR against `main`

## Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning. Every user-facing change needs a changeset. Run `npx changeset`, select the package, choose the bump type, and write a short summary.

## Reporting Bugs

Open an issue with:

- Steps to reproduce
- Expected vs actual behavior
- Node/Bun version and OS

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
