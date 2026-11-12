-- Sedompet: register phone accounts inside the database.
--
-- Supabase Auth's public sign-up rejects the synthetic login address
-- (6281...@phone.sedompet.app) because that domain has no mail server.
-- Sign-in with a password does not do that check, so we create the auth user
-- here and the app then signs in normally with number + PIN.
--
-- Who may register:
--   * numbers the admin activated (admin_activate_phone), or
--   * anyone with a valid invite code: the code activates the number and
--     reserves their place in that Dompet (consumes one use of the code).
-- A number the admin deactivated cannot re-activate itself with a code.

drop function if exists public.register_phone(text, text);

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

  if v_code <> '' then
    select * into v_invite from public.dompet_invites where code = v_code for update;
    if not found or v_invite.revoked or v_invite.expires_at < now() or v_invite.uses >= v_invite.max_uses then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    -- An explicit admin deactivation wins over an invite.
    if v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
      raise exception 'phone_not_activated' using errcode = '42501';
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
