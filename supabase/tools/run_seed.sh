#!/usr/bin/env bash
# Runs the Sedompet phone-login migration (if missing) and the private seed
# parts against your Supabase database, then prints a verification summary.
#
# Usage (from the repo root, in YOUR terminal):
#   SEDOMPET_PHONE=62812xxxxxxxx supabase/tools/run_seed.sh
# It asks for the Session pooler connection string (Supabase > Connect).
# Nothing is saved to disk.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
seed_dir="$root/supabase/seed_private"
phone="${SEDOMPET_PHONE:-}"
if [[ -z "$phone" ]]; then
  echo "Set SEDOMPET_PHONE to the seeded number (62...), e.g. SEDOMPET_PHONE=62812xxxx $0" >&2
  exit 1
fi

if ! command -v psql >/dev/null; then
  echo "psql not found. Install with: brew install postgresql@17" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  read -r -s -p "Paste Supabase Session pooler connection string (input hidden): " DATABASE_URL
  echo
fi
if [[ ! "$DATABASE_URL" =~ ^postgres(ql)?://[^:]+:[^@]+@[^/]+/.+ ]]; then
  echo "That is not a connection string. It must look like:" >&2
  echo "  postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" >&2
  echo "Copy it from Supabase > Connect > Session pooler, and put your password in place of [YOUR-PASSWORD]." >&2
  exit 1
fi
if [[ "$DATABASE_URL" == *"[YOUR-PASSWORD]"* ]]; then
  echo "Replace [YOUR-PASSWORD] in the connection string with your database password." >&2
  exit 1
fi
export DATABASE_URL

run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }

echo "→ Checking connection…"
run -c "select 1" >/dev/null && echo "  connected"

installed=$(run -tA -c "select to_regproc('public.admin_activate_phone') is not null")
if [[ "$installed" != "t" ]]; then
  echo "→ Installing phone-login SQL…"
  run -f "$root/supabase/migrations/20261113000000_phone_login.sql" >/dev/null
fi
echo "  phone login installed"
echo "→ Installing phone registration function…"
run -f "$root/supabase/migrations/20261113010000_phone_register.sql" >/dev/null

parts=("$seed_dir"/seed_part*_of_*.sql)
if [[ ! -e "${parts[0]}" ]]; then
  echo "No seed parts in $seed_dir" >&2
  exit 1
fi
for f in $(printf '%s\n' "${parts[@]}" | sort -V); do
  echo "→ Running $(basename "$f")…"
  run -f "$f" >/dev/null
done

echo "→ Verifying…"
run -c "
select a.activated,
       (select count(*) from public.transactions t join public.dompet_members m on m.dompet_id = t.dompet_id where m.phone = a.phone) as transactions,
       (select count(*) from public.accounts x join public.dompet_members m on m.dompet_id = x.dompet_id where m.phone = a.phone) as accounts,
       (select sum(case t.kind when 'income' then t.amount else -t.amount end)
          from public.transactions t join public.dompet_members m on m.dompet_id = t.dompet_id where m.phone = a.phone) as balance,
       (select d.name from public.dompets d join public.dompet_members m on m.dompet_id = d.id where m.phone = a.phone limit 1) as dompet
from public.phone_access a where a.phone = '$phone';"
echo "Done. Now sign up in the app with your number (Daftar pertama kali)."
