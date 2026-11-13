-- Scenario walkthrough for 20261121000000_subscription.sql.
-- Runs after admin_scenarios (99999999-... is app admin there).
\set ON_ERROR_STOP 0
reset role;

\echo == admin makes a Tahunan code; a buyer registers with it
set role authenticated;
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select code as yc, plan = 'tahunan' and months = 12 as ok_code_plan from app_create_activation_code('Rina', 30, 'tahunan', 12) \gset
select :'ok_code_plan' = 't' as ok_code_plan;
\echo EXPECT ERROR: bad plan
select app_create_activation_code('x', 30, 'seumur-hidup', 12);
set role anon;
select register_phone('0857 5555 6666', '555555', :'yc', 'Rina');
reset role;
select plan = 'tahunan' and active_until between now() + interval '11 months 27 days' and now() + interval '12 months 1 day' as ok_buyer_plan
from phone_access where phone = '6285755556666';
select id as rina from auth.users where email = '6285755556666@phone.sedompet.app' \gset

\echo == paid owner creates a Dompet and can write
set role authenticated;
set request.jwt.claim.sub = :'rina';
select id as rd from create_dompet('Keluarga Rina') \gset
insert into categories (dompet_id, name, kind) values (:'rd', 'Jajan', 'expense');
select is_active and active_until > now() + interval '11 months' as ok_status, my_plan = 'tahunan' as ok_my_plan
from my_subscription() where dompet_id = :'rd';

\echo == a family member joins by invite: plan anggota, can write in the owner Dompet
select code as ic from create_dompet_invite(:'rd', 'admin', 5, 7) \gset
set role anon;
select register_phone('0857 7777 8888', '777777', :'ic', 'Dimas');
reset role;
select plan = 'anggota' and active_until is null as ok_invitee_plan from phone_access where phone = '6285777778888';
select id as dimas from auth.users where email = '6285777778888@phone.sedompet.app' \gset
set role authenticated;
set request.jwt.claim.sub = :'dimas';
select claim_phone_membership() = 1 as ok_claimed;
insert into categories (dompet_id, name, kind) values (:'rd', 'Bensin', 'expense');
select count(*) = 2 as ok_invitee_wrote from categories where dompet_id = :'rd' and name in ('Jajan', 'Bensin');
\echo EXPECT ERROR: invitee has no plan of their own
select create_dompet('Dompet Dimas');

\echo == plan runs out: Dompet turns read-only for everyone
reset role;
update phone_access set active_until = now() - interval '1 day' where phone = '6285755556666';
set role authenticated;
set request.jwt.claim.sub = :'rina';
select is_active = false and active_until < now() as ok_expired from my_subscription() where dompet_id = :'rd';
\echo EXPECT ERROR x3: subscription_expired (insert by owner, update by owner, insert by invitee)
insert into categories (dompet_id, name, kind) values (:'rd', 'Baru', 'expense');
update categories set name = 'Jajan anak' where dompet_id = :'rd' and name = 'Jajan';
set request.jwt.claim.sub = :'dimas';
insert into categories (dompet_id, name, kind) values (:'rd', 'Baru', 'expense');
\echo == reading and deleting still work
set request.jwt.claim.sub = :'rina';
select count(*) >= 2 as ok_can_read from categories where dompet_id = :'rd';
delete from categories where dompet_id = :'rd' and name = 'Bensin';
select count(*) = 0 as ok_can_delete from categories where dompet_id = :'rd' and name = 'Bensin';
\echo == admin SQL (no JWT) is never blocked
reset role;
reset request.jwt.claim.sub;
update categories set sort_order = 9 where dompet_id = :'rd' and name = 'Jajan';
select sort_order = 9 as ok_admin_sql from categories where dompet_id = :'rd' and name = 'Jajan';

\echo == admin extends 1 month: counted from today because it had already ended
set role authenticated;
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select active_until between now() + interval '27 days' and now() + interval '1 month 1 day' as ok_extended
from app_set_subscription('085755556666', 'bulanan', 1);
select plan = 'bulanan' as ok_listed from app_list_phones() where phone = '6285755556666';
\echo == paying early adds on top of what is left
select active_until > now() + interval '12 months' as ok_stacked from app_set_subscription('085755556666', 'tahunan', 12);
set request.jwt.claim.sub = :'rina';
insert into categories (dompet_id, name, kind) values (:'rd', 'Aktif lagi', 'expense');
select count(*) = 1 as ok_writes_again from categories where dompet_id = :'rd' and name = 'Aktif lagi';

\echo == berhenti ends access now; gratis means no expiry
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select active_until <= now() as ok_stopped from app_set_subscription('085755556666', 'berhenti');
set request.jwt.claim.sub = :'rina';
select is_active = false as ok_stopped_inactive from my_subscription() where dompet_id = :'rd';
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select plan = 'gratis' and active_until is null as ok_free from app_set_subscription('085755556666', 'gratis');
set request.jwt.claim.sub = :'rina';
select is_active and active_until is null as ok_free_active from my_subscription() where dompet_id = :'rd';
\echo EXPECT ERROR x2: invalid months / plan
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select app_set_subscription('085755556666', 'bulanan', 0);
select app_set_subscription('085755556666', 'lifetime', 1);
\echo EXPECT ERROR: non-admin cannot set plans
set request.jwt.claim.sub = :'rina';
select app_set_subscription('085755556666', 'gratis');

\echo == legacy accounts (no plan, no expiry) keep working
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select bool_and(is_active) as ok_legacy_active from my_subscription();
