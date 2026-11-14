-- Scenario walkthrough for 20261126000000_admin_activity.sql.
\set ON_ERROR_STOP 0
reset role;
\echo == seed: Ayah (1111) signed up long ago, session refreshed today
update auth.users set last_sign_in_at = now() - interval '30 days' where id = '11111111-1111-1111-1111-111111111111';
insert into auth.sessions (user_id, created_at, updated_at, refreshed_at)
values ('11111111-1111-1111-1111-111111111111', now() - interval '30 days', now() - interval '2 days',
        (now() - interval '1 hour') at time zone 'UTC');

set role authenticated;
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
\echo == last_active_at follows the session refresh, not sign-in
select last_active_at > now() - interval '2 hours' as ok_active_from_session,
       last_sign_in_at < now() - interval '29 days' as ok_signin_untouched
from app_list_phones() where phone = '6281100000001';
reset role;
\echo == last_tx_at = newest transaction each person created (at least one has some)
select bool_and(l.last_tx_at is not distinct from (
         select max(t.created_at) from transactions t join dompet_members m on m.id = t.created_by
         join auth.users u on u.id = m.user_id where u.email = l.phone || '@phone.sedompet.app')) as ok_last_tx,
       count(l.last_tx_at) > 0 as ok_some_tx
from app_list_phones() l;
\echo == user with no sessions falls back to last_sign_in_at
select last_active_at is not distinct from last_sign_in_at as ok_fallback
from app_list_phones() where phone = '6281100000004';
reset role;

\echo == touch_last_seen: Kakak (3333) opens the app now
update auth.users set last_sign_in_at = now() - interval '10 days' where id = '33333333-3333-3333-3333-333333333333';
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select touch_last_seen();
reset role;
select last_seen_at > now() - interval '1 minute' as ok_touched from phone_access where phone = '6281100000003';
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select last_active_at > now() - interval '1 minute' as ok_active_now from app_list_phones() where phone = '6281100000003';
\echo == anon cannot call it
set role anon;
\echo EXPECT ERROR
select touch_last_seen();
reset role;
