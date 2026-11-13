-- Scenario walkthrough for 20261120000000_goals.sql.
\set ON_ERROR_STOP 0
\set AYAH '11111111-1111-1111-1111-111111111111'
\set KAKAK '33333333-3333-3333-3333-333333333333'
\set STRANGER '44444444-4444-4444-4444-444444444444'
\set ADIK '55555555-5555-5555-5555-555555555555'
set role authenticated;

\echo == setup: ayah owner, kakak member, adik viewer
set request.jwt.claim.sub = :'AYAH';
select id as did from create_dompet('Goals test') \gset
select code as c_member from create_dompet_invite(:'did', 'member') \gset
select code as c_viewer from create_dompet_invite(:'did', 'viewer') \gset
set request.jwt.claim.sub = :'KAKAK'; select redeem_dompet_invite(:'c_member') is not null as ok_kakak_joined;
set request.jwt.claim.sub = :'ADIK';  select redeem_dompet_invite(:'c_viewer') is not null as ok_adik_joined;
reset role;
select id as m_ayah from dompet_members where user_id = :'AYAH' and dompet_id = :'did' \gset
set role authenticated;

\echo == ayah creates a manual goal and one linked to his private account
set request.jwt.claim.sub = :'AYAH';
insert into goals (dompet_id, name, target, target_date, saved, created_by)
values (:'did', 'Umroh', 60000000, '2028-06-01', 5000000, :'m_ayah') returning id as g_umroh \gset
insert into accounts (dompet_id, name, type, visibility, owner_member_id) values (:'did', 'Tabungan Ayah', 'savings', 'private', :'m_ayah') returning id as acc_priv \gset
insert into goals (dompet_id, name, target, account_id, created_by) values (:'did', 'Kejutan', 2000000, :'acc_priv', :'m_ayah') returning id as g_secret \gset
select count(*) = 2 as ok_ayah_sees_both from goals where dompet_id = :'did';

\echo == kakak (member) sees only the shared goal and can top it up
set request.jwt.claim.sub = :'KAKAK';
select count(*) = 1 as ok_private_goal_hidden from goals where dompet_id = :'did';
with u as (update goals set saved = saved + 250000 where id = :'g_umroh' returning saved) select saved = 5250000 as ok_member_tops_up from u;
\echo EXPECT ERROR: member cannot create a goal
insert into goals (dompet_id, name, target) values (:'did', 'Motor', 20000000);
with d as (delete from goals where id = :'g_umroh' returning 1) select count(*) = 0 as ok_member_cannot_delete from d;

\echo == adik (viewer) and a stranger cannot change anything
set request.jwt.claim.sub = :'ADIK';
with u as (update goals set saved = 0 where id = :'g_umroh' returning 1) select count(*) = 0 as ok_viewer_cannot_update from u;
set request.jwt.claim.sub = :'STRANGER';
select count(*) = 0 as ok_stranger_blind from goals where dompet_id = :'did';

\echo == linking an account from another Dompet fails
set request.jwt.claim.sub = :'AYAH';
select id as did2 from create_dompet('Other') \gset
select id as acc_other from accounts where dompet_id = :'did2' limit 1 \gset
\echo EXPECT ERROR: account from another Dompet
insert into goals (dompet_id, name, target, account_id) values (:'did', 'Salah', 1000, :'acc_other');
reset role;
