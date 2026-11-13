-- Sedompet: shared / split expenses ("patungan").
--
-- transactions.split_with = who an expense is for, as a JSON array of
--   {"m": <dompet_members.id>, "a": <share in the account's minor units>}
-- The payer is paid_by as before. Shares must add up to the amount.
-- Balances: the payer is owed the amount, each member owes their share.
-- Settling up is a transfer whose outgoing side is paid by the debtor and
-- split entirely to the creditor (same maths, no extra table).

alter table public.transactions add column if not exists split_with jsonb;

create or replace function public.check_transaction_split()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_sum bigint;
  v_count int;
  v_bad int;
begin
  if new.split_with is null then
    return new;
  end if;
  if jsonb_typeof(new.split_with) <> 'array' or new.kind <> 'expense' then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  select count(*), coalesce(sum((e ->> 'a')::bigint), 0),
         count(*) filter (where
           (e ->> 'a') is null or (e ->> 'a') !~ '^[0-9]+$' or (e ->> 'a')::bigint <= 0
           or (e ->> 'm') is null
           or not exists (select 1 from public.dompet_members m where m.id::text = e ->> 'm' and m.dompet_id = new.dompet_id))
    into v_count, v_sum, v_bad
  from jsonb_array_elements(new.split_with) e;
  if v_count < 1 or v_count > 30 or v_bad > 0 or v_sum <> new.amount then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  if (select count(distinct e ->> 'm') from jsonb_array_elements(new.split_with) e) <> v_count then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.check_transaction_split() from public, anon, authenticated;

drop trigger if exists transactions_split_check on public.transactions;
create trigger transactions_split_check before insert or update of split_with, amount, kind on public.transactions
  for each row execute function public.check_transaction_split();

notify pgrst, 'reload schema';
