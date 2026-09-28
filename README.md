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
- `GET /api/works`
- `POST /api/works` with JSON work and payment fields
- `GET /api/payments`
- `GET /api/supervisor/works`
- `PATCH /api/supervisor/works/:workId/status`

Registration request body:

```json
{
	"name": "Employee Name",
	"phone": "+234 800 000 0000",
	"email": "employee@ops.ng",
	"password": "at-least-8-characters",
	"supervisor": "supervisor-1",
	"accountType": "EMPLOYEE"
}
```

Available account types are `EMPLOYEE`, `SUPERVISOR`, `ADMIN`, and `INVESTOR`.
Only `EMPLOYEE` registrations include a supervisor; the other account types
must omit that field.

The frontend sends this through `src/lib/api.js` to `POST http://localhost:4000/api/auth/register`.

Employees are linked through `User.managerId`. New work submissions copy that
manager ID into both `WorkSubmission.supervisorId` and
`PaymentRequest.supervisorId`, so supervisor dashboards can query their own
team without relying on free-text names.

When `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are present in `server/.env`,
registration creates the account in Supabase Auth and mirrors the profile in
Prisma. The secret key must stay server-side and must never be added to the
frontend or committed to git. Without those variables, local development uses
the existing Prisma fallback.
