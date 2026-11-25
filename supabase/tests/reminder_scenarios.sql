-- Scenario walkthrough for 20261130000000_carry_reminder.sql.
\set ON_ERROR_STOP 0
reset role;
select id as rina from auth.users where email = '6285755556666@phone.sedompet.app' \gset
select id as dimas from auth.users where email = '6285777778888@phone.sedompet.app' \gset
select id as rd from dompets where name = 'Keluarga Rina' \gset
select id as acc from accounts where dompet_id = :'rd' and visibility = 'shared' limit 1 \gset
select id as m_rina from dompet_members where dompet_id = :'rd' and user_id = :'rina' \gset
select id as m_dimas from dompet_members where dompet_id = :'rd' and user_id = :'dimas' \gset
delete from push_queue; delete from push_sent; delete from transactions where dompet_id = :'rd';
-- Members joined 3 days ago, so they are "quiet" but within the 7-day window.
update dompet_members set joined_at = ((current_date + time '06:00') at time zone 'UTC') - interval '3 days' where dompet_id = :'rd';

\echo == both have a device (earlier files may have removed them)
set role authenticated;
set request.jwt.claim.sub = :'dimas';
select push_subscribe('https://push.example/dimas2', 'pk-d', 'au-d', null, 'test');
set request.jwt.claim.sub = :'rina';
select push_subscribe('https://push.example/rina2', 'pk-r', 'au-r', null, 'test');

\echo == budgets accept carry_from
insert into budgets (dompet_id, name, amount, period, carry_from) values (:'rd', 'Hiburan', 400000, 'weekly', current_date - 7);
select carry_from = current_date - 7 as ok_carry_saved from budgets where name = 'Hiburan';
reset role;

\echo == Rina recorded 2 hours ago, Dimas 30 hours ago: only Dimas reminded (13:00 Jakarta)
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, created_at)
values (:'rd', :'acc', 'expense', 10000, current_date, :'m_rina', :'m_rina', ((current_date + time '06:00') at time zone 'UTC') - interval '2 hours'),
       (:'rd', :'acc', 'expense', 20000, current_date - 1, :'m_dimas', :'m_dimas', ((current_date + time '06:00') at time zone 'UTC') - interval '30 hours');
delete from push_queue;
create temp table got as select * from push_collect((current_date + time '06:00') at time zone 'UTC');
select count(*) = 1 and bool_and(endpoint like '%dimas%') and bool_and(url = '/app#/catat') and bool_and(body like 'Terakhir mencatat%') as ok_only_dimas
from got where tag = 'reminder';

\echo == once a day
select count(*) = 0 as ok_once from push_collect((current_date + time '07:00') at time zone 'UTC') where tag = 'reminder';

\echo == not at night (23:00 Jakarta)
delete from push_sent;
select count(*) = 0 as ok_quiet_night from push_collect((current_date + time '16:00') at time zone 'UTC') where tag = 'reminder';

\echo == turned off in prefs
delete from push_sent;
update push_subscriptions set prefs = prefs || '{"reminder": false}' where endpoint like '%dimas%';
select count(*) = 0 as ok_pref_off from push_collect((current_date + time '06:00') at time zone 'UTC') where tag = 'reminder';
update push_subscriptions set prefs = prefs - 'reminder' where endpoint like '%dimas%';

\echo == stops after 8 quiet days
delete from push_sent;
update transactions set created_at = now() - interval '9 days' where created_by = :'m_dimas';
update dompet_members set joined_at = now() - interval '30 days' where dompet_id = :'rd';
select count(*) = 0 as ok_gives_up from push_collect((current_date + time '06:00') at time zone 'UTC') where tag = 'reminder';

reset role;
delete from push_sent; delete from budgets where name = 'Hiburan';
