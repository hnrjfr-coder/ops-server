# OPS Backend

Standalone Node.js backend for the OPS application.

## Setup

```powershell
cd server
npm install
Copy-Item .env.example .env
# Replace DATABASE_URL in .env with the Supabase Postgres connection URI
npx prisma generate
npx prisma db push
npm run dev
```

The API runs at `http://localhost:4000` by default.

## Database changes

Edit `server/prisma/schema.prisma`, then apply the schema to Supabase Postgres with:

```powershell
cd server
npx prisma db push
```

Use `npx prisma studio` to inspect the Supabase database. OPS tables are
created under the dedicated `ops` schema, leaving other schemas untouched.

## Endpoints

- `GET /api/health`
- `GET /api/auth/options`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/funding-requests/summary`
- `GET /api/funding-requests?page=1&pageSize=20`
- `POST /api/funding-requests`
- `GET /api/funder/summary`
- `GET /api/funder/requests?page=1&pageSize=20`
- `PATCH /api/funder/requests/:requestId`
- `GET /api/works`
- `POST /api/works` with an approved `fundingRequestId`
- `GET /api/payments`
- `GET /api/payments/earnings` (legacy payment history)
- `GET /api/supervisor/works`
- `GET /api/supervisor/funding-summary`
- `GET /api/supervisor/funding-requests?page=1&pageSize=20`
- `GET /api/supervisor/employees`
- `PATCH /api/supervisor/works/:workId/status`

## Funding and work flow

Employees create a funding request before starting the work. The backend routes
it to the funder assigned to the employee's supervisor. Funder approval reserves
the requested amount; it does not transfer money. The employee can then submit
the completed work against that approved request. Supervisor approval marks
both the work and funding request `COMPLETED`. A funder rejection is
`FUNDER_REJECTED`; a supervisor rejection is `SUPERVISOR_REJECTED`.

Funding request states are `PENDING_FUNDER_APPROVAL`, `APPROVED`,
`FUNDER_REJECTED`, `UNDER_SUPERVISOR_REVIEW`, `SUPERVISOR_REJECTED`, and
`COMPLETED`. `APPROVED` means funds are reserved and work is awaited. Funding
request list endpoints return `{ items, pagination }`, default to 20 records,
and cap `pageSize` at 50. Summary endpoints group counts and amounts by status
without returning all request rows.

Create an employee funding request with:

```json
{
	"amount": 25000,
	"purpose": "Materials and labor for the office network installation"
}
```

A funder approves or rejects it with `PATCH /api/funder/requests/:requestId`:

```json
{ "decision": "APPROVED" }
```

After approval, the employee submits the work with:

```json
{
	"fundingRequestId": "approved-request-id",
	"accountName": "Office network subscription",
	"accountCategory": "SUBSCRIPTION",
	"completedAt": "2026-09-29T12:00:00.000Z",
	"notes": "Optional completion notes"
}
```

`accountCategory` must be `SUBSCRIPTION` or `RENEWAL`. The request amount and
assigned supervisor are derived by the backend. Do not send `amount`,
`employeeId`, `supervisorId`, or `funderId` from an authenticated frontend. A
funding request can be linked to only one work submission. Historical work
records keep their original category values; only new submissions use the two
current account categories.

Registration options include active `supervisors` and `funders`. Employees
choose a supervisor; new supervisors choose their funder. Funder accounts are
provisioned by an administrator and cannot be created through public signup.
Set Blessing and Queen up as `FUNDER` profiles, then create Peace and Willis as
`SUPERVISOR` profiles. Assign Peace to Blessing and Willis to Queen. Existing
employee profiles must have their `managerId` updated to Peace or Willis as
appropriate.

After backing up the database, apply the additive schema with:

```powershell
npm run db:generate
npm run db:push
```

Existing `PaymentRequest` and work records are retained as legacy history and
are not automatically converted into funding requests. Set existing
Blessing/Queen profile account types to `FUNDER` and Peace/Willis to
`SUPERVISOR`, then link the supervisor profiles to their funders before using
the new flow. New requests and work submissions use
the `FundingRequest` model; legacy payment endpoints remain for old records.

## Frontend restructure prompt

Use the following prompt in the frontend repository's coding assistant:

```text
Restructure the OPS frontend around the backend's funding-first workflow. Use
the existing API client and Supabase access token for authenticated calls. Do
not mock records or send employeeId, supervisorId, or funderId when the backend
can derive them from the authenticated user.

Registration: load GET /api/auth/options. Remove INVESTOR as a public account
type. FUNDER is a provisioned role, not a public signup choice. For EMPLOYEE
registration, require a supervisor selected from options.supervisors and
submit its ID as supervisor. For SUPERVISOR
registration, require a funder selected from options.funders and submit its ID
as funder. Hide both selectors for other account types. Funder-to-supervisor
setup is Blessing -> Peace and Queen -> Willis; the selectable values must
come from the API, not hard-coded IDs or names.

Employee funding: provide a request form with positive integer amount and a
clear purpose. POST { amount, purpose } to /api/funding-requests. Show request
history from GET /api/funding-requests?page=1&pageSize=20 and status totals
from GET /api/funding-requests/summary. Support pagination using the returned
pagination fields. Explain in the UI that funder approval reserves funds but
does not itself transfer money.

Funder dashboard: load GET /api/funder/summary and paginated
GET /api/funder/requests?page=1&pageSize=20. Show the requesting employee,
assigned supervisor, amount, purpose, linked work if present, and status. For
PENDING_FUNDER_APPROVAL requests, allow approve/reject using
PATCH /api/funder/requests/:requestId with { decision: "APPROVED" } or
{ decision: "REJECTED" }. Refresh the affected list and summary after a
successful decision.

Employee work submission: allow submission only for funding requests with
status APPROVED. POST to /api/works with fundingRequestId, accountName,
accountCategory (SUBSCRIPTION or RENEWAL), completedAt, and optional notes.
Do not ask for a description or amount; the amount comes from the approved
request. Display work and funding status separately where useful, and refresh
the employee's funding request history after submit.

Supervisor dashboard: load GET /api/supervisor/employees,
GET /api/supervisor/funding-summary,
GET /api/supervisor/funding-requests?page=1&pageSize=20, and
GET /api/supervisor/works using the supervisor session. The funding-request
list lets the supervisor track requests before and after work submission. Show
work linked to its funding request. For work UNDER_REVIEW, allow approve/reject by PATCHing
/api/supervisor/works/:workId/status with { status: "APPROVED" } or
{ status: "REJECTED" }. Approval completes the work and funding request;
rejection marks them SUPERVISOR_REJECTED / REJECTED. Refresh the dashboard
after decisions.

Implement loading, empty, error, retry, and pagination states using existing
frontend conventions. Never expose Supabase service keys. Treat approval as a
reserved amount, not proof that money was transferred.
```

`GET /api/supervisor/employees` returns employees assigned to the authenticated
supervisor as an array of safe profile fields: `id`, `name`, `email`, `phone`,
`department`, `status`, and `createdAt`.

Registration request body:

```json
{
	"name": "Employee Name",
	"phone": "+234 800 000 0000",
	"email": "employee@ops.ng",
	"password": "at-least-8-characters",
	"supervisor": "active-supervisor-id",
	"accountType": "EMPLOYEE"
}
```

Public registration account types are `EMPLOYEE`, `SUPERVISOR`, and `ADMIN`.
`FUNDER` profiles are provisioned by an administrator. Employee registrations
choose a supervisor. Supervisor registrations choose a funder. Other account
types omit both fields.

The frontend sends this through `src/lib/api.js` to `POST http://localhost:4000/api/auth/register`.

Employees are linked through `User.managerId`. Supervisors are linked to their
funder through `User.funderId`. Funding requests store employee, supervisor,
and funder IDs so each dashboard can query only its assigned records.

When `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are present in `server/.env`,
registration creates the account in Supabase Auth and mirrors the profile in
Prisma. The secret key must stay server-side and must never be added to the
frontend or committed to git. Without those variables, local development uses
the existing Prisma fallback.
