#!/usr/bin/env bash
# Runs the Dompet SQL against a throwaway local Postgres (no Docker/Supabase
# CLI needed). auth_stub.sql fakes Supabase's auth schema and roles.
# Usage: supabase/tests/run_local.sh   (needs initdb/pg_ctl/psql on PATH)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
port="${PGPORT_TEST:-55433}"
trap 'pg_ctl -D "$tmp/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
initdb -D "$tmp/data" -U postgres -A trust >/dev/null
pg_ctl -D "$tmp/data" -o "-p $port -k '' -c listen_addresses=127.0.0.1" -l "$tmp/log" -w start >/dev/null
p() { psql -h 127.0.0.1 -p "$port" -U postgres -q "$@"; }
p -v ON_ERROR_STOP=1 -f "$here/auth_stub.sql"
for f in "$here"/../migrations/*.sql; do p -v ON_ERROR_STOP=1 -f "$f" 2>/dev/null; done
# Migrations must be re-runnable.
for f in "$here"/../migrations/*.sql; do p -v ON_ERROR_STOP=1 -f "$f" 2>/dev/null; done
# Phone-login migration gates everything on activation: activate test users.
p -v ON_ERROR_STOP=1 -c "insert into phone_access (phone, activated) select public.phone_from_email(email), true from auth.users on conflict do nothing"
p -f "$here/dompet_core_scenarios.sql"
echo "===== finance ====="
p -f "$here/finance_scenarios.sql"
echo "===== phone ====="
p -f "$here/phone_scenarios.sql"
echo "===== admin ====="
p -f "$here/admin_scenarios.sql"
echo "===== holder ====="
p -f "$here/holder_scenarios.sql"
echo "===== currency ====="
p -f "$here/currency_scenarios.sql"
echo "===== goals ====="
p -f "$here/goals_scenarios.sql"
echo "===== subscription ====="
p -f "$here/subscription_scenarios.sql"
echo "===== period ====="
p -f "$here/period_scenarios.sql"
echo "===== split ====="
p -f "$here/split_scenarios.sql"
echo "===== details ====="
p -f "$here/details_scenarios.sql"
