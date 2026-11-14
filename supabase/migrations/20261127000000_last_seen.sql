-- Admin "Terakhir buka": exact, app-reported last open.
--
-- 20261126 used auth.sessions refresh times, but Supabase only refreshes a
-- token when it is about to expire, so someone using the app right now could
-- still show "kemarin". The app now calls touch_last_seen() when it opens and
-- whenever it comes back to the foreground.

alter table public.phone_access add column if not exists last_seen_at timestamptz;

create or replace function public.touch_last_seen()
returns void
language sql volatile security definer set search_path = ''
as $$
  -- At most one write per minute per number.
  update public.phone_access a set last_seen_at = now()
  where a.phone = public.phone_from_email(auth.jwt() ->> 'email')
    and (a.last_seen_at is null or a.last_seen_at < now() - interval '1 minute');
$$;
revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

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
           a.last_seen_at,
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
