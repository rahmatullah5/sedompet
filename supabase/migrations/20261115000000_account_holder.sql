-- Sedompet: account holders and members who haven't joined yet.
--
-- * accounts.holder_member_id: whose account it is ("Dipegang oleh").
--   The holder may edit the account (name/icon/colour/opening balance) and
--   edit or delete ANY transaction in it, including ones others logged on
--   their behalf before they joined. Owners/admins keep full control.
-- * Pending members: a Dompet admin can add someone by phone + name before
--   they join (placeholder dompet_members row, user_id NULL). The number is
--   activated so they can register; when they do, claim_phone_membership()
--   links the placeholder, so they inherit their accounts and history.
-- * assign_account(): hand an account to a member, shared with the family
--   or private to them, optionally moving "paid by" on past transactions.

alter table public.accounts
  add column if not exists holder_member_id uuid references public.dompet_members (id) on delete set null;
create index if not exists accounts_holder_idx on public.accounts (holder_member_id);

-- Holder (and private owner) must belong to the same Dompet.
create or replace function public.check_account_people()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.member_in_dompet(new.holder_member_id, new.dompet_id)
     or not public.member_in_dompet(new.owner_member_id, new.dompet_id) then
    raise exception 'member_not_in_dompet' using errcode = '22023';
  end if;
  -- A private account is always held by its owner.
  if new.visibility = 'private' then
    new.holder_member_id := new.owner_member_id;
  end if;
  return new;
end $$;
drop trigger if exists accounts_people_check on public.accounts;
create trigger accounts_people_check before insert or update on public.accounts
  for each row execute function public.check_account_people();

-- Does the caller hold this account?
create or replace function public.holds_account(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account_id
      and public.can_write_dompet(a.dompet_id)
      and coalesce(a.holder_member_id, a.owner_member_id) = public.my_member_id(a.dompet_id)
  )
$$;
revoke execute on function public.holds_account(uuid) from public, anon;
grant execute on function public.holds_account(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Holders may edit transactions in their account.
-- ---------------------------------------------------------------------------
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update to authenticated
  using (
    public.can_see_account(account_id)
    and (public.can_admin_dompet(dompet_id)
         or public.holds_account(account_id)
         or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id)))
  )
  with check (
    public.can_see_account(account_id)
    and updated_by = public.my_member_id(dompet_id)
    and public.tx_refs_ok(dompet_id, account_id, category_id, paid_by)
  );

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete to authenticated
  using (
    public.can_see_account(account_id)
    and (public.can_admin_dompet(dompet_id)
         or public.holds_account(account_id)
         or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id)))
  );

-- Holders may tidy up their shared account, but not change who holds it,
-- who can see it, or move it to another Dompet (trigger below).
drop policy if exists accounts_holder_update on public.accounts;
create policy accounts_holder_update on public.accounts for update to authenticated
  using (visibility = 'shared' and public.holds_account(id))
  with check (visibility = 'shared' and holder_member_id = public.my_member_id(dompet_id));

create or replace function public.accounts_holder_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.can_admin_dompet(old.dompet_id)
     and old.visibility = 'shared'
     and (new.visibility, new.owner_member_id, new.holder_member_id, new.dompet_id)
         is distinct from (old.visibility, old.owner_member_id, old.holder_member_id, old.dompet_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists accounts_holder_guard on public.accounts;
create trigger accounts_holder_guard before update on public.accounts
  for each row execute function public.accounts_holder_guard();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Hand an account to a member (or back to "the family" with p_member_id NULL).
--   shared: everyone sees it, the member is its holder.
--   private: only the member sees it (and its transactions).
-- Allowed for Dompet admins, and for the current private owner/holder.
create or replace function public.assign_account(
  p_account_id uuid,
  p_member_id uuid,
  p_visibility text default 'shared',
  p_reassign_paid_by boolean default false
) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  a public.accounts;
  v_me uuid;
  v_count int := 0;
begin
  select * into a from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  v_me := public.my_member_id(a.dompet_id);
  if v_me is null or not (
       public.can_admin_dompet(a.dompet_id)
       or (a.visibility = 'private' and a.owner_member_id = v_me)
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_visibility not in ('shared', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  -- Only owners/admins decide what the whole family sees.
  if p_visibility = 'shared' and not public.can_admin_dompet(a.dompet_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_visibility = 'private' and p_member_id is null then
    raise exception 'private_needs_member' using errcode = '22023';
  end if;
  if not public.member_in_dompet(p_member_id, a.dompet_id) then
    raise exception 'member_not_in_dompet' using errcode = '22023';
  end if;

  update public.accounts set
    visibility = p_visibility,
    owner_member_id = case when p_visibility = 'private' then p_member_id end,
    holder_member_id = p_member_id
  where id = p_account_id;

  if p_reassign_paid_by and p_member_id is not null then
    update public.transactions set paid_by = p_member_id, updated_by = v_me, updated_at = now()
    where account_id = p_account_id and paid_by is distinct from p_member_id and flag is null;
    get diagnostics v_count = row_count;
  end if;

  insert into public.activity (dompet_id, member_id, message)
  select a.dompet_id, v_me,
         format('menyerahkan akun %s kepada %s', a.name, coalesce(m.display_name, 'anggota'))
  from public.dompet_members m where m.id = p_member_id;
  return v_count;
end $$;

-- Add someone who hasn't joined yet (by phone). Their number is activated so
-- they can register; their seat (and anything assigned to it) waits for them.
create or replace function public.add_pending_member(
  p_dompet_id uuid,
  p_phone text,
  p_display_name text,
  p_role public.dompet_role default 'member'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_access public.phone_access;
  v_uid uuid;
  v_id uuid;
  v_caller public.dompet_role := public.dompet_role_of(p_dompet_id);
begin
  if v_caller is null or v_caller not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' or (p_role = 'admin' and v_caller <> 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'name_required' using errcode = '22023';
  end if;

  select * into v_access from public.phone_access where phone = v_phone for update;
  if v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
    raise exception 'phone_not_activated' using errcode = '42501';  -- blocked by the app admin
  end if;
  insert into public.phone_access (phone, activated, activated_at, note)
  values (v_phone, true, now(), 'ditambahkan ke Dompet')
  on conflict (phone) do update set activated = true,
    activated_at = coalesce(public.phone_access.activated_at, now());

  -- Already has an account? Link straight away.
  select id into v_uid from auth.users where email = v_phone || '@phone.sedompet.app';
  if exists (select 1 from public.dompet_members where dompet_id = p_dompet_id
             and (phone = v_phone or (v_uid is not null and user_id = v_uid))) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.dompet_members (dompet_id, phone, role, display_name, user_id)
  values (p_dompet_id, v_phone, p_role, left(trim(p_display_name), 60), v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- Remove someone who hasn't joined yet (joined members use remove_dompet_member).
create or replace function public.remove_pending_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.dompet_members;
begin
  select * into m from public.dompet_members where id = p_member_id;
  if not found then return; end if;
  if m.user_id is not null then
    raise exception 'use_remove_dompet_member' using errcode = '22023';
  end if;
  if not public.can_admin_dompet(m.dompet_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.dompet_members where id = p_member_id;
end $$;

revoke execute on function
  public.assign_account(uuid, uuid, text, boolean),
  public.add_pending_member(uuid, text, text, public.dompet_role),
  public.remove_pending_member(uuid)
from public, anon;
grant execute on function
  public.assign_account(uuid, uuid, text, boolean),
  public.add_pending_member(uuid, text, text, public.dompet_role),
  public.remove_pending_member(uuid)
to authenticated;
