<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project guide: School Fees Management & Analytics

Next.js 16 (App Router, Turbopack, `src/`), plain PostgreSQL 13+ through `pg`, Tailwind v4, Recharts, SWR.

## Golden rules
- **Money is integer paise everywhere** (DB, API JSON, props). Convert only at the edges:
  `rupees()` / `rupeesShort()` for display, `parseRupees()` for user input (`src/lib/format.ts`). Form handlers
  parse what was typed; API request bodies already carry paise.
- **All numbers come from SQL functions** in `db/migrations/*` (expected = `student_charges`,
  received = `allocations`). Never recompute fee maths in TypeScript; add or extend an SQL function instead.
- Payments are append-only. Corrections are reversals (`cancel_payment`). Allocations are derived
  and rebuilt automatically by triggers (`reallocate_student`).
- Writes that touch several tables go through SECURITY DEFINER SQL functions with a role check. Simple
  master-data edits (classes, fee heads, installments, students, fee structure) may be plain SQL in a service.
- **The browser never talks to the database.** Pages and components get data only from `/api/*`.
- Plain PostgreSQL only: no Supabase objects (`auth` schema, `anon` / `authenticated` roles, `auth.uid()`).
  The signed-in user is `public.current_user_id()` (the `app.user_id` setting of the transaction).

## Layout
- `src/app/(app)/…` signed-in screens. Each `page.tsx` is a thin server component (metadata, params, search
  params) that renders a client view (`*-view.tsx`). `layout.tsx` renders `AppShell` (sidebar, search,
  session switcher), which loads `/api/bootstrap` once.
- `src/app/api/**/route.ts` the REST API. Handlers are thin: `api(access, fn)` from `src/server/http.ts`
  (session + role check: `signed-in | staff | writer | admin`, same-origin check for writes, errors → JSON
  `{ error }`), zod validation with `readBody` / `readQuery` / `pathParam` and helpers in `src/server/validate.ts`,
  then a service call. Route files export only HTTP handlers; shared schemas live in `src/server/schemas`.
- `src/server/` backend only (`import "server-only"`):
  - `db.ts` pool (`DATABASE_URL`), type parsers (bigint/numeric → number, dates stay `YYYY-MM-DD`),
    `withUser(userId, db => …)` runs one transaction as that user; `db.rpc()` / `db.rpcRows()` call SQL functions.
  - `data.ts` `read(viewer, name, args, load)` = cached read; `write(viewer, run)` = transaction, then drops the
    cache. `audit()` writes an audit row.
  - `cache.ts` in-process cache: TTL `CACHE_TTL_SECONDS` (30 s), tags `data` / `staff`, in-flight de-duplication.
    Every data write invalidates every data read, so screens never show stale figures after a write.
  - `services/*` one module per area (analytics, students, payments, setup, imports, admin, context, targets, parents,
    recovery).
  - `auth/` scrypt passwords (`password.mjs`, shared with `scripts/db.mjs`), DB-backed sessions in `app_sessions`
    (httpOnly cookie `fms_auth`), login rate limit.
- `src/lib/` shared by both sides: `types.ts` (RPC and API shapes), `format.ts`, `roles.ts` (`isStaff / canWrite /
  isAdmin`), `context.ts` (`flag()` / `param()` for search params), `dates.ts`, `text.ts`, `import-columns.ts`,
  `action-state.ts` (`ActionState`, `friendlyError()` used by the API), `recovery.ts` (fee recovery keys used by zod
  and the screens, with their labels; `phoneDigits()` / `fmtPhone()`).
- Fee recovery: families are `parents` keyed by phone (the `students_link_parent` trigger links students). Calls
  have a purpose (fees, performance, ptm, query, other); promises come from fee calls and student notes
  (`parent_promises`). The daily call list (`call_list`, rules in `school_settings.call_*`), the families each
  caller takes (`call_assignments`, `take_calls` / `take_call` / `release_calls`), the calling page (`call_board`),
  the dashboard (`recovery_dashboard(from, to)`), activities (`recovery_activities`, `activities_overview`,
  `activity_detail`) and what brought a receipt in (`recovery_credits`: a call or an activity participation, set by
  `set_payment_source`) are SQL in `db/migrations/*_recovery.sql` and `*_daily_calls.sql`. Calls are open to all
  staff (`log_parent_call`, taking families); everything else needs a writer. Shared badges live in
  `src/components/recovery.tsx`; the call form and call history in `src/app/(app)/parents/`; pages: `/recovery`
  (dashboard), `/calls`, `/activities`.
- `src/lib/api/` browser side: `useApi(url)` (SWR; pass `null` to wait), `api.get/post/put/patch/delete`, `apiUrl()`,
  `submit()` for form handlers, `refreshAll()`. A 401 sends the browser to `/login`, a missing role to `/no-access`.
- In client views: `useApp()` gives `viewer`, `writer`, `admin`, `session` (picked in the top bar, cookie
  `fms_session`), `sessions`, `classes`, `settings`. Wrap writer/admin screens in `<RequireRole role="writer|admin">`.
  Render `<Pending queries={[…]} />` until every query has data (skeleton, 404 card or error with retry).
- UI kit `src/components/ui/*`: `Card` (`description` renders as an ⓘ `InfoTip`), `Kpi/KpiGrid/IconTile`,
  `PageHeader` (`description` = one short line, longer text in `info`), `Segmented` + `withParams` (URL
  toggles), `Button/LinkButton` (pills), `Badge`, `FeeStatusBadge`, `Field/Input/Select/Textarea/
  FormError/FormSuccess`, `BarList/StackedBar/Legend/Meter`, `Ring/Donut`, `Avatar`, `AllocLines`, `Empty`,
  `DataTable` (client; declarative columns with `type: person|action|money|pct|date|status|alloc|…`, link
  templates like `/students/{student_id}`, search, filters, totals, CSV export with filter notes), `page-state`.
- Design language (Apple-style, `src/app/globals.css`): `#F5F5F7` canvas, white borderless cards with soft
  shadow, Inter Variable with the type scale `text-display/large/title1/title2/title3/headline/body/
  subhead/footnote/caption`. Lead each page with a visual (figure, ring, bar), not paragraphs; put
  explanations behind ⓘ. Merge classes with `cn()` (tailwind-merge, so a caller's class wins); new
  `@theme` font-size or shadow tokens must also be registered in `src/lib/cn.ts`.
- Charts (`src/components/charts/charts.tsx`): validated palette `--series-1/2/3` (blue current-year,
  orange previous dues, aqua advance), neutral `--series-track` for scheduled amounts. Orange always
  means old dues. Status colours are reserved for fee status and always come with an icon + label.

## Reads and writes
- Read: add a service function using `read()`, expose it with a `GET` route, fetch it in the view with `useApi()`.
- Write: service function using `write()` (returns `{ message }` worded for the user when useful), a
  `POST/PUT/PATCH/DELETE` route, and a form handler in the page's `actions.ts` (a plain client module, not a
  server action) that checks the input, calls `api.*` inside `submit()` and returns `ActionState`. Forms use
  `useActionState` / the local `useFormAction` hooks; an `ActionState.redirect` opens another page after success.
- Database changes: a new file in `db/migrations` (never edit an applied one), applied by `npm run db:migrate`.
  New SQL functions are reachable by a least-privilege app role through `grant_app_access()`; add internal
  helpers to its exclusion list. pgTAP tests live in `db/tests` (`npm run db:test`).

## Local dev
Any PostgreSQL 13+ (pgTAP only for `db:test`) → copy `.env.example` to `.env.local` and set `DATABASE_URL` →
`npm run db:reset` (migrations + demo seed, login `admin@school.test` / `admin12345`) → `npm run dev`.
Checks: `npm run typecheck`, `npm run lint`, `npm run db:test`.
