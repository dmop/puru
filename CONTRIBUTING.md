# Contributing to puru

Thanks for helping improve `puru`.

This guide covers the local workflow, quality checks, and release notes we expect for user-facing changes.

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
2. Add or update tests for behavior changes
3. Ensure `npm run lint`, `npm run typecheck`, and `npm test` all pass
4. Add a changeset with `npx changeset` for user-facing changes
5. Open a PR against `main`

## Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning. Every user-facing change should include a changeset with a short, release-note-ready summary.

## Reporting Bugs

Open an issue with:

- Steps to reproduce
- Expected vs actual behavior
- Node/Bun version and OS

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
