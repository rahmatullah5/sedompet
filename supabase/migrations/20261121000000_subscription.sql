-- Sedompet: paid plans (Bulanan / Tahunan) with an expiry date.
--
-- * phone_access.plan / active_until say what a number has paid for.
--     plan NULL + active_until NULL  -> legacy / admin-activated: no expiry
--     'gratis'                       -> free, no expiry (set by admin)
--     'bulanan' / 'tahunan'          -> paid until active_until
--     'anggota'                      -> joined via invite: may use Dompets it
--                                       was invited to, not its own (until it buys)
-- * A Dompet is "active" while at least one of its owners has access.
--   Writes to finance tables of an inactive Dompet are rejected (read-only);
--   reading, exporting and deleting stay possible.
-- * Activation codes can carry a plan + months, applied when the code is used.
-- * Admins extend a number from the admin page (app_set_subscription).

alter table public.phone_access add column if not exists plan text;
alter table public.phone_access add column if not exists active_until timestamptz;
do $$ begin
  alter table public.phone_access add constraint phone_access_plan_check
    check (plan is null or plan in ('gratis', 'bulanan', 'tahunan', 'anggota'));
exception when duplicate_object then null; end $$;

alter table public.activation_codes add column if not exists plan text;
alter table public.activation_codes add column if not exists months int;
do $$ begin
  alter table public.activation_codes add constraint activation_codes_plan_check
    check ((plan is null and months is null)
        or (plan = 'gratis' and months is null)
        or (plan in ('bulanan', 'tahunan') and months between 1 and 36));
exception when duplicate_object then null; end $$;

-- Does this phone_access row pay for Dompets it owns?
create or replace function public.access_is_paid(a public.phone_access)
returns boolean
language sql immutable set search_path = ''
as $$
  select a.activated and (
    a.plan = 'gratis'
    or (a.plan is null and a.active_until is null)
    or a.active_until > now()
  )
$$;
revoke execute on function public.access_is_paid(public.phone_access) from public, anon, authenticated;

-- When does this Dompet's access end? NULL = never. Owners without a
-- phone_access row (older email accounts) count as unlimited.
create or replace function public.dompet_active_until(p_dompet_id uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  with owners as (
    select a as acc
    from public.dompet_members m
    left join auth.users u on u.id = m.user_id
    left join public.phone_access a
      on a.phone = coalesce(m.phone, public.phone_from_email(u.email))
    where m.dompet_id = p_dompet_id and m.role = 'owner'
  )
  select case
    when exists (select 1 from owners o where (o.acc).phone is null) then null
    when exists (select 1 from owners o where (o.acc).activated and ((o.acc).plan = 'gratis' or ((o.acc).plan is null and (o.acc).active_until is null))) then null
    else coalesce(
      (select max((o.acc).active_until) from owners o where (o.acc).activated),
      '-infinity'::timestamptz)
  end
$$;
revoke execute on function public.dompet_active_until(uuid) from public, anon, authenticated;

create or replace function public.dompet_is_active(p_dompet_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.dompet_active_until(p_dompet_id) > now(), true)
$$;
revoke execute on function public.dompet_is_active(uuid) from public, anon, authenticated;

-- Read-only guard for finance tables. Admin SQL (no JWT) is not affected.
create or replace function public.require_active_dompet()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.dompet_is_active(new.dompet_id) then
    raise exception 'subscription_expired' using errcode = '42501',
      hint = 'Langganan Dompet ini sudah berakhir. Perpanjang lewat admin untuk mencatat lagi.';
  end if;
  return new;
end $$;
revoke execute on function public.require_active_dompet() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','budgets','loans','recurring','goals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_active_dompet', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.require_active_dompet()', t || '_active_dompet', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- For the app: status of every Dompet I belong to, and my own plan.
-- ---------------------------------------------------------------------------
create or replace function public.my_subscription()
returns table (dompet_id uuid, active_until timestamptz, is_active boolean, my_plan text, my_active_until timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.dompet_id,
         nullif(public.dompet_active_until(m.dompet_id), '-infinity'::timestamptz),
         public.dompet_is_active(m.dompet_id),
         a.plan, a.active_until
  from public.dompet_members m
  left join public.phone_access a on a.phone = public.phone_from_email(auth.jwt() ->> 'email')
  where m.user_id = auth.uid()
$$;
revoke execute on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: set / extend a plan. Months are added to whatever is left, so
-- paying early never loses days. p_plan 'gratis' = no expiry,
-- 'berhenti' = end access now.
-- ---------------------------------------------------------------------------
create or replace function public.app_set_subscription(p_phone text, p_plan text, p_months int default null)
returns public.phone_access
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_row public.phone_access;
begin
  perform public.require_app_admin();
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if p_plan in ('bulanan', 'tahunan') and coalesce(p_months, 0) not between 1 and 36 then
    raise exception 'invalid_months' using errcode = '22023';
  end if;
  if p_plan not in ('bulanan', 'tahunan', 'gratis', 'berhenti') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  insert into public.phone_access (phone, activated, activated_at, note)
  values (v_phone, true, now(), 'admin')
  on conflict (phone) do nothing;

  update public.phone_access a set
    activated = case when p_plan = 'berhenti' then a.activated else true end,
    activated_at = coalesce(a.activated_at, now()),
    plan = case when p_plan = 'berhenti' then coalesce(a.plan, 'bulanan') else p_plan end,
    active_until = case
      when p_plan = 'gratis' then null
      when p_plan = 'berhenti' then now()
      else greatest(now(), coalesce(a.active_until, now())) + make_interval(months => p_months)
    end
  where a.phone = v_phone
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.app_set_subscription(text, text, int) from public, anon;
grant execute on function public.app_set_subscription(text, text, int) to authenticated;

-- Admin list: now with plan + expiry (return type changed, so drop first).
drop function if exists public.app_list_phones();
create function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint,
  plan text, active_until timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id)),
         a.plan, a.active_until
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;
revoke execute on function public.app_list_phones() from public, anon;
grant execute on function public.app_list_phones() to authenticated;

-- Activation codes can carry a plan (replaces the 2-argument version).
drop function if exists public.app_create_activation_code(text, int);
create or replace function public.app_create_activation_code(
  p_note text default null, p_valid_days int default 30, p_plan text default null, p_months int default null
)
returns public.activation_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_row public.activation_codes;
  i int;
begin
  perform public.require_app_admin();
  if p_plan is not null and p_plan not in ('gratis', 'bulanan', 'tahunan') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, case when i < 6 then i else i + 3 end) % length(v_alphabet)), 1);
    end loop;
    begin
      insert into public.activation_codes (code, note, created_by, expires_at, plan, months)
      values (v_code, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
              now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 30), 365))),
              p_plan, case when p_plan in ('bulanan', 'tahunan') then p_months end)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
    end;
  end loop;
end $$;
revoke execute on function public.app_create_activation_code(text, int, text, int) from public, anon;
grant execute on function public.app_create_activation_code(text, int, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- register_phone: activation codes apply their plan; invitees get 'anggota'.
-- (Same signature, so create or replace.)
-- ---------------------------------------------------------------------------
create or replace function public.register_phone(
  p_phone text,
  p_pin text,
  p_invite_code text default null,
  p_display_name text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_email text;
  v_uid uuid := gen_random_uuid();
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invite public.dompet_invites;
  v_act public.activation_codes;
  v_access public.phone_access;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  v_email := v_phone || '@phone.sedompet.app';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  select * into v_access from public.phone_access where phone = v_phone for update;
  -- An explicit admin deactivation wins over any code.
  if v_code <> '' and v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  if length(v_code) = 8 then
    -- Single-use activation code: activates this number, nothing else.
    select * into v_act from public.activation_codes where code = v_code for update;
    if not found or v_act.revoked or v_act.used_at is not null or v_act.expires_at < now() then
      raise exception 'invalid_activation_code' using errcode = '22023';
    end if;
    update public.activation_codes set used_phone = v_phone, used_at = now() where code = v_code;
    insert into public.phone_access (phone, activated, activated_at, note, plan, active_until)
    values (v_phone, true, now(), coalesce('kode ' || v_code || coalesce(' · ' || v_act.note, ''), 'kode'),
            v_act.plan, case when v_act.months is not null then now() + make_interval(months => v_act.months) end)
    on conflict (phone) do update set activated = true,
      activated_at = coalesce(public.phone_access.activated_at, now()),
      plan = coalesce(excluded.plan, public.phone_access.plan),
      active_until = coalesce(excluded.active_until, public.phone_access.active_until);

  elsif v_code <> '' then
    -- Dompet invite: activates the number and reserves the seat.
    select * into v_invite from public.dompet_invites where code = v_code for update;
    if not found or v_invite.revoked or v_invite.expires_at < now() or v_invite.uses >= v_invite.max_uses then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    -- Joining someone's Dompet is free, but does not pay for Dompets of your own.
    insert into public.phone_access (phone, activated, activated_at, note, plan)
    values (v_phone, true, now(), 'invite ' || v_code, 'anggota')
    on conflict (phone) do update set activated = true,
      activated_at = coalesce(public.phone_access.activated_at, now()),
      note = coalesce(public.phone_access.note, excluded.note);
    insert into public.dompet_members (dompet_id, phone, role, display_name)
    values (v_invite.dompet_id, v_phone, v_invite.role, nullif(left(trim(coalesce(p_display_name, '')), 60), ''))
    on conflict do nothing;
    update public.dompet_invites set uses = uses + 1 where code = v_code;

  elsif not public.phone_is_activated(v_phone) then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('phone', v_phone, 'full_name', nullif(trim(coalesce(p_display_name, '')), '')),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );
end $$;

revoke execute on function public.register_phone(text, text, text, text) from public;
grant execute on function public.register_phone(text, text, text, text) to anon, authenticated;
