-- Scenario walkthrough for 20261125000000_push.sql.
\set ON_ERROR_STOP 0
reset role;
select id as rina from auth.users where email = '6285755556666@phone.sedompet.app' \gset
select id as dimas from auth.users where email = '6285777778888@phone.sedompet.app' \gset
select id as rd from dompets where name = 'Keluarga Rina' \gset
select id as acc from accounts where dompet_id = :'rd' and visibility = 'shared' limit 1 \gset
select id as m_rina from dompet_members where dompet_id = :'rd' and user_id = :'rina' \gset
select id as m_dimas from dompet_members where dompet_id = :'rd' and user_id = :'dimas' \gset
-- clean slate from earlier scenario files
delete from push_queue; delete from push_sent; delete from recurring where dompet_id = :'rd'; delete from budgets where dompet_id = :'rd';
delete from transactions where dompet_id = :'rd';
update phone_access set plan = 'gratis', active_until = null where phone = '6285755556666';

\echo == both register a device
set role authenticated;
set request.jwt.claim.sub = :'rina';
select claim_phone_membership() >= 0 as ok_rina_claimed;
select push_subscribe('https://push.example/rina', 'pk-r', 'au-r', null, 'test');
set request.jwt.claim.sub = :'dimas';
select push_subscribe('https://push.example/dimas', 'pk-d', 'au-d', null, 'test');
\echo EXPECT ERROR: not a https endpoint
select push_subscribe('http://evil/x', 'a', 'b');
select count(*) = 1 as ok_sees_only_own from push_subscriptions;
\echo EXPECT ERROR: clients cannot collect
select * from push_collect();

\echo == Dimas records a shared expense -> only Rina is told
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, note)
values (:'rd', :'acc', 'expense', 85000, current_date, :'m_dimas', :'m_dimas', 'Belanja pasar');
reset role;
-- Entries are queued with the real clock, so collect "now"; forget daily messages it may have sent.
create temp table got as select * from push_collect(now() + interval '1 minute');
delete from push_sent;
select count(*) = 1 and bool_and(endpoint like '%rina') and bool_and(title like '%mencatat pengeluaran') and bool_and(body like 'Belanja pasar · Rp 85.000%') as ok_entry
from got where tag like 'entry-%';
select count(*) = 0 as ok_queue_emptied from push_queue;

\echo == bill due tomorrow, total budget at 80%: to both, once
insert into recurring (dompet_id, name, kind, amount, account_id, frequency, next_date)
values (:'rd', 'Internet', 'expense', 350000, :'acc', 'monthly', date '2026-11-14');
insert into budgets (dompet_id, name, amount) values (:'rd', 'Total bulanan', 100000);
drop table got;
create temp table got as select * from push_collect('2026-11-13 03:00+00');
select count(*) = 2 and bool_and(title = 'Besok jatuh tempo: Internet') as ok_bill from got where tag like 'bill-%';
select count(*) = 2 and bool_and(title like '%sudah 80%%') and bool_and(body like 'Terpakai Rp 85.000 dari Rp 100.000%') as ok_budget from got where tag like 'budget-%';
select count(*) = 0 as ok_once from push_collect('2026-11-13 04:00+00');
\echo == before 07:00 WIB no daily messages
delete from push_sent;
select count(*) = 0 as ok_quiet_morning from push_collect('2026-11-12 22:00+00');  -- 05:00 WIB

\echo == preferences: Dimas turns budget alerts off; going over 100% reaches Rina only
update push_subscriptions set prefs = prefs || '{"budget": false}' where endpoint like '%dimas';
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, note)
values (:'rd', :'acc', 'expense', 20000, current_date, :'m_rina', :'m_rina', 'Bensin');
drop table got;
create temp table got as select * from push_collect(now() + interval '1 minute');
select count(*) = 1 and bool_and(endpoint like '%dimas') as ok_rina_entry_to_dimas from got where tag like 'entry-%';
delete from push_sent where key not like 'budget:%:80:%';
drop table got;
create temp table got as select * from push_collect('2026-11-13 05:00+00');
select count(*) = 1 and bool_and(endpoint like '%rina') and bool_and(title like '%terlewati') as ok_budget_100 from got where tag like 'budget-%';

\echo == Monday 09:00 WIB weekly recap
update transactions set date = date '2026-11-10' where dompet_id = :'rd';
select count(*) = 2 and bool_and(body like 'Keluar Rp 105.000%') as ok_weekly
from push_collect('2026-11-16 02:00+00') where tag like 'weekly-%';

\echo == plan ending in 7 days: Rina only
update phone_access set plan = 'tahunan', active_until = '2026-11-20 10:00+00' where phone = '6285755556666';
select count(*) = 1 and bool_and(endpoint like '%rina') and bool_and(title like '%7 hari lagi') as ok_plan
from push_collect('2026-11-13 03:00+00') where tag = 'plan';

\echo == dead devices are removed; unsubscribe works
select push_drop(array['https://push.example/dimas']);
select count(*) = 1 as ok_dropped from push_subscriptions;
set role authenticated;
set request.jwt.claim.sub = :'rina';
select push_unsubscribe('https://push.example/rina');
reset role;
select count(*) = 0 as ok_unsubscribed from push_subscriptions;
update phone_access set plan = 'gratis', active_until = null where phone = '6285755556666';
