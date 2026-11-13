-- Sedompet: app admin + single-use activation codes.
--
-- An activation code lets ONE new person register with their phone number
-- (no manual activation needed). They then create their own Dompet.
-- Invite codes (6 chars, dompet_invites) still join an existing Dompet;
-- activation codes are 8 chars so the two never collide.
--
-- Make yourself app admin once, in the SQL Editor:
--   select admin_grant_app_admin('0812xxxxxxxx');

create table if not exists public.app_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create table if not exists public.activation_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{8}$'),
  note        text check (note is null or char_length(note) <= 80),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  revoked     boolean not null default false,
  used_phone  text,
  used_at     timestamptz
);
alter table public.activation_codes enable row level security;
revoke all on public.activation_codes from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid())
$$;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- SQL Editor only: make a registered phone account an app admin.
create or replace function public.admin_grant_app_admin(p_phone text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = public.normalize_phone(p_phone) || '@phone.sedompet.app';
  if v_uid is null then
    raise exception 'Nomor % belum terdaftar. Daftar dulu di aplikasi.', p_phone;
  end if;
  insert into public.app_admins (user_id) values (v_uid) on conflict do nothing;
  return 'ok';
end $$;
revoke execute on function public.admin_grant_app_admin(text) from public, anon, authenticated;

create or replace function public.require_app_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.require_app_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs (app admins only)
-- ---------------------------------------------------------------------------
create or replace function public.app_create_activation_code(p_note text default null, p_valid_days int default 30)
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
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      -- bytes 0..5 and 9..10 of a v4 uuid are fully random
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, case when i < 6 then i else i + 3 end) % length(v_alphabet)), 1);
    end loop;
    begin
      insert into public.activation_codes (code, note, created_by, expires_at)
      values (v_code, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
              now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 30), 365))))
      returning * into v_row;
      return v_row;
    exception when unique_violation then
    end;
  end loop;
end $$;

create or replace function public.app_list_activation_codes()
returns setof public.activation_codes
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query select * from public.activation_codes order by created_at desc limit 200;
end $$;

create or replace function public.app_revoke_activation_code(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  update public.activation_codes set revoked = true where code = upper(p_code) and used_at is null;
end $$;

-- Everyone who can log in (or was activated), for the admin page.
-- (Dropped first: a later migration adds columns, and re-running this file
-- must not fail on the changed return type.)
drop function if exists public.app_list_phones();
create or replace function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id))
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;

create or replace function public.app_set_phone_active(p_phone text, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_phone text := public.normalize_phone(p_phone);
begin
  perform public.require_app_admin();
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if not p_active and v_phone = public.phone_from_email(auth.jwt() ->> 'email') then
    raise exception 'cannot_deactivate_self' using errcode = '22023';
  end if;
  insert into public.phone_access (phone, activated, activated_at, note)
  values (v_phone, p_active, now(), 'admin')
  on conflict (phone) do update set activated = p_active, activated_at = now();
end $$;

revoke execute on function
  public.app_create_activation_code(text, int), public.app_list_activation_codes(),
  public.app_revoke_activation_code(text), public.app_list_phones(), public.app_set_phone_active(text, boolean)
from public, anon;
grant execute on function
  public.app_create_activation_code(text, int), public.app_list_activation_codes(),
  public.app_revoke_activation_code(text), public.app_list_phones(), public.app_set_phone_active(text, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- register_phone: now also accepts an 8-char activation code.
-- (Same signature as before, so no drop is needed.)
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
    insert into public.phone_access (phone, activated, activated_at, note)
    values (v_phone, true, now(), coalesce('kode ' || v_code || coalesce(' · ' || v_act.note, ''), 'kode'))
    on conflict (phone) do update set activated = true, activated_at = coalesce(public.phone_access.activated_at, now());

  elsif v_code <> '' then
    -- Dompet invite: activates the number and reserves the seat.
    select * into v_invite from public.dompet_invites where code = v_code for update;
    if not found or v_invite.revoked or v_invite.expires_at < now() or v_invite.uses >= v_invite.max_uses then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    insert into public.phone_access (phone, activated, activated_at, note)
    values (v_phone, true, now(), 'invite ' || v_code)
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

-- The admin page reads activation codes through RPCs only; no realtime needed.
