# ADR-013: Monorepo, Web Runtime and Build Orchestration

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Admin and Portal are mostly authenticated applications deployed in hundreds/thousands of potential CTs. Per-instance processes, patch surface and customer-specific builds must be minimized. The backend needs separate security roots without multiple codebases.

## Decision

Use React + Vite static SPAs for Admin and Portal. Serve them through Caddy and fetch authenticated/runtime branding data from dedicated APIs. Use two NestJS API composition roots (Admin and restricted Portal) plus optional Worker from one monorepo/release.

Use pnpm workspaces and TypeScript project/package boundaries. Do not add Turborepo initially; `pnpm --filter/-r` and CI caching are adequate until measured task-graph/remote-cache value exists. Tailwind plus owned accessible source components forms UI implementation. No customer-specific frontend build.

## Consequences

- Removes two Next.js Node runtimes/server caches from every CT and keeps static delivery simple.
- No SSR/React Server Components/Next server actions; all privileged behaviour is API-based.
- Browser shell cannot carry secrets and runtime configuration needs a safe published endpoint.
- Some routing/metadata conveniences are assembled explicitly.

## Rejected

- Next.js servers: authenticated surfaces do not justify recurring fleet runtime cost.
- Next static export: technically possible but adds conventions without useful server features.
- Separate repositories: increases contract/version drift.
- Turborepo by popularity.

## Revisit trigger

Measured CI task graph justifies Turbo, or a new public/SEO/SSR surface has validated requirements. Prefer adding a narrowly scoped public surface over converting privileged SPAs without need.
