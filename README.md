# Streaking Sports

No rulebook when you're streaking.

Owned by Connor Haley — proprietary, see [LICENSE](LICENSE).

## Stack

Vite/React PWA, Vercel functions, Neon Postgres.

## Local setup

```sh
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

## Scripts

- `npm run dev` — start the local app and API (serves `api/*` through Vite).
- `npm run build` — typecheck and build for production.
- `npm run lint` — lint the project.
- `npm run typecheck` — typecheck the app, functions, and shared code.
- `npm test` — run tests.
- `npm run db:migrate` — apply database migrations.
- Phase 3 moves question content behind the server.
