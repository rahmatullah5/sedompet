-- Admin "Nomor terdaftar": real last activity + last transaction.
--
-- auth.users.last_sign_in_at only moves on a PIN login. Sessions persist for
-- weeks via refresh tokens, so for most people it stays at their sign-up
-- time. Supabase bumps auth.sessions.updated_at / refreshed_at on every token
-- refresh (about hourly while the app is open), so the newest of those is a
-- much better "last active" signal.
--
-- last_tx_at = newest transaction this person created (any Dompet), so the
-- admin can tell who is actually recording.

drop function if exists public.app_list_phones();
create function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint,
  plan text, active_until timestamptz,
  last_active_at timestamptz, last_tx_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id)),
         a.plan, a.active_until,
         greatest(
           u.last_sign_in_at,
           (select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC'))
              from auth.sessions s where s.user_id = u.id)
         ),
         (select max(t.created_at)
            from public.transactions t
            join public.dompet_members m on m.id = t.created_by
           where u.id is not null and m.user_id = u.id)
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;
revoke execute on function public.app_list_phones() from public, anon;
grant execute on function public.app_list_phones() to authenticated;

notify pgrst, 'reload schema';
