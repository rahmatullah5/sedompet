-- Scenario walkthrough for 20261112010000_finance.sql.
-- Each check prints `ok_*` = t. A line labelled EXPECT ERROR must fail.
\set ON_ERROR_STOP 0
\set AYAH '11111111-1111-1111-1111-111111111111'
\set IBU '22222222-2222-2222-2222-222222222222'
\set KAKAK '33333333-3333-3333-3333-333333333333'
\set STRANGER '44444444-4444-4444-4444-444444444444'
reset role;
insert into auth.users values ('55555555-5555-5555-5555-555555555555','6281100000005@phone.sedompet.app','{}') on conflict do nothing;
insert into phone_access (phone, activated) values ('6281100000005', true) on conflict do nothing;
\set ADIK '55555555-5555-5555-5555-555555555555'
set role authenticated;

\echo == setup: ayah creates dompet; ibu admin, kakak member, adik viewer join
set request.jwt.claim.sub = :'AYAH';
select id as did from create_dompet('Keluarga Uji') \gset
select (select count(*) from categories where dompet_id = :'did') = 15 as ok_seed_categories,
       (select count(*) from accounts where dompet_id = :'did') = 1 as ok_seed_cash,
       (select count(*) from activity where dompet_id = :'did') = 1 as ok_seed_activity;
select code as c_admin from create_dompet_invite(:'did', 'admin') \gset
select code as c_member from create_dompet_invite(:'did', 'member') \gset
select code as c_viewer from create_dompet_invite(:'did', 'viewer') \gset
set request.jwt.claim.sub = :'IBU';    select redeem_dompet_invite(:'c_admin') is not null as ok_ibu;
set request.jwt.claim.sub = :'KAKAK';  select redeem_dompet_invite(:'c_member') is not null as ok_kakak;
set request.jwt.claim.sub = :'ADIK';   select redeem_dompet_invite(:'c_viewer') is not null as ok_adik;

reset role;
select id as m_ayah from dompet_members where user_id = :'AYAH' \gset
select id as m_ibu from dompet_members where user_id = :'IBU' \gset
select id as m_kakak from dompet_members where user_id = :'KAKAK' \gset
select id as m_adik from dompet_members where user_id = :'ADIK' \gset
select id as cash from accounts where dompet_id = :'did' \gset
select id as cat from categories where dompet_id = :'did' and name = 'Belanja Dapur' \gset
set role authenticated;

\echo == kakak (member) records own expense
set request.jwt.claim.sub = :'KAKAK';
insert into transactions (dompet_id, account_id, category_id, kind, amount, date, paid_by, created_by, updated_by)
values (:'did', :'cash', :'cat', 'expense', 32000, current_date, :'m_kakak', :'m_kakak', :'m_kakak') returning id as tx_kakak \gset
\echo EXPECT ERROR: kakak forges created_by = ibu
insert into transactions (dompet_id, account_id, kind, amount, date, created_by, updated_by)
values (:'did', :'cash', 'expense', 1, current_date, :'m_ibu', :'m_ibu');
\echo EXPECT ERROR: kakak creates a shared account
insert into accounts (dompet_id, name, type) values (:'did', 'Hack', 'bank');
insert into accounts (dompet_id, name, type, visibility, owner_member_id)
values (:'did', 'Celengan Kakak', 'savings', 'private', :'m_kakak') returning id as acc_kakak \gset

\echo == ibu (admin) records; kakak cannot edit it; ibu can edit any
set request.jwt.claim.sub = :'IBU';
insert into transactions (dompet_id, account_id, category_id, kind, amount, date, paid_by, created_by, updated_by)
values (:'did', :'cash', :'cat', 'expense', 186000, current_date, :'m_ibu', :'m_ibu', :'m_ibu') returning id as tx_ibu \gset
set request.jwt.claim.sub = :'KAKAK';
with u as (update transactions set amount = 1, updated_by = :'m_kakak' where id = :'tx_ibu' returning 1)
select count(*) = 0 as ok_member_cannot_edit_others from u;
with d as (delete from transactions where id = :'tx_ibu' returning 1)
select count(*) = 0 as ok_member_cannot_delete_others from d;
set request.jwt.claim.sub = :'IBU';
with u as (update transactions set amount = 35000, updated_by = :'m_ibu' where id = :'tx_kakak' returning 1)
select count(*) = 1 as ok_admin_edits_any from u;

\echo == adik (viewer) is read-only
set request.jwt.claim.sub = :'ADIK';
select count(*) = 2 as ok_viewer_reads from transactions;
\echo EXPECT ERROR: viewer inserts
insert into transactions (dompet_id, account_id, kind, amount, date, created_by, updated_by)
values (:'did', :'cash', 'expense', 1, current_date, :'m_adik', :'m_adik');
\echo EXPECT ERROR: viewer writes activity
insert into activity (dompet_id, member_id, message) values (:'did', :'m_adik', 'x');

\echo == private accounts: only the owner sees them and their transactions
set request.jwt.claim.sub = :'AYAH';
insert into accounts (dompet_id, name, type, visibility, owner_member_id)
values (:'did', 'Tabungan Ayah', 'savings', 'private', :'m_ayah') returning id as acc_ayah \gset
insert into transactions (dompet_id, account_id, kind, amount, date, created_by, updated_by, paid_by)
values (:'did', :'acc_ayah', 'income', 2000000, current_date, :'m_ayah', :'m_ayah', :'m_ayah');
select count(*) = 3 as ok_owner_sees_own_private from transactions;
set request.jwt.claim.sub = :'IBU';
select (select count(*) from accounts where id = :'acc_ayah') = 0 as ok_admin_cannot_see_private,
       (select count(*) from transactions) = 2 as ok_private_tx_hidden;
\echo EXPECT ERROR: admin records into another members private account
insert into transactions (dompet_id, account_id, kind, amount, date, created_by, updated_by)
values (:'did', :'acc_ayah', 'expense', 1, current_date, :'m_ibu', :'m_ibu');

\echo == strangers see nothing
set request.jwt.claim.sub = :'STRANGER';
select (select count(*) from accounts) + (select count(*) from transactions)
     + (select count(*) from categories) + (select count(*) from budgets)
     + (select count(*) from activity) = 0 as ok_stranger_blind;

\echo == cross-dompet references are rejected
set request.jwt.claim.sub = :'AYAH';
select id as did2 from create_dompet('Kos Bareng') \gset
reset role;
select id as cat2 from categories where dompet_id = :'did2' limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = :'AYAH';
\echo EXPECT ERROR: category from another Dompet
insert into transactions (dompet_id, account_id, category_id, kind, amount, date, created_by, updated_by)
values (:'did', :'cash', :'cat2', 'expense', 1, current_date, :'m_ayah', :'m_ayah');

\echo == budgets: admin only
set request.jwt.claim.sub = :'KAKAK';
\echo EXPECT ERROR: member creates budget
insert into budgets (dompet_id, name, amount) values (:'did', 'X', 100);
set request.jwt.claim.sub = :'IBU';
insert into budgets (dompet_id, name, amount, member_id) values (:'did', 'Uang saku Kakak', 800000, :'m_kakak');
select count(*) = 1 as ok_admin_budget from budgets;

\echo == removing kakak deletes his private account
set request.jwt.claim.sub = :'AYAH';
select remove_dompet_member(:'did', :'KAKAK');
reset role;
select (select count(*) from accounts where id = :'acc_kakak') = 0 as ok_private_account_removed,
       (select paid_by is null from transactions where id = :'tx_kakak') as ok_history_kept;

\echo == subcategories
set role authenticated;
set request.jwt.claim.sub = :'IBU';
insert into categories (dompet_id, name, icon, kind, parent_id) values (:'did', 'Sayur', '🥬', 'expense', :'cat') returning id as sub \gset
select (select parent_id from categories where id = :'sub') = :'cat' as ok_subcategory;
\echo EXPECT ERROR: sub of a sub
insert into categories (dompet_id, name, kind, parent_id) values (:'did', 'Bayam', 'expense', :'sub');
\echo EXPECT ERROR: income sub under expense parent
insert into categories (dompet_id, name, kind, parent_id) values (:'did', 'X', 'income', :'cat');
\echo EXPECT ERROR: parent from another Dompet
insert into categories (dompet_id, name, kind, parent_id) values (:'did', 'X', 'expense', :'cat2');

\echo == loans and recurring
set request.jwt.claim.sub = :'AYAH';
insert into loans (dompet_id, direction, counterparty, amount, account_id, created_by)
values (:'did', 'lent', 'Om Budi', 500000, :'cash', :'m_ayah') returning id as loan \gset
insert into transactions (dompet_id, account_id, kind, amount, date, flag, loan_id, created_by, updated_by, paid_by)
values (:'did', :'cash', 'expense', 500000, current_date, 'loan', :'loan', :'m_ayah', :'m_ayah', :'m_ayah');
insert into recurring (dompet_id, name, kind, amount, account_id, frequency, next_date, created_by)
values (:'did', 'Netflix', 'expense', 186000, :'cash', 'monthly', current_date, :'m_ayah') returning id as rec \gset
set request.jwt.claim.sub = :'IBU';
select count(*) = 1 as ok_loan_visible from loans;
reset role;
insert into dompet_members (dompet_id, user_id, role) values (:'did', :'KAKAK', 'member') returning id as m_kakak2 \gset
set role authenticated;
set request.jwt.claim.sub = :'KAKAK';
with u as (update recurring set next_date = next_date + 30 where id = :'rec' returning 1)
select count(*) = 1 as ok_member_advances_recurring from u;
\echo EXPECT ERROR: member changes recurring amount
update recurring set amount = 1 where id = :'rec';
\echo EXPECT ERROR: member deletes recurring (0 rows)
with d as (delete from recurring where id = :'rec' returning 1) select count(*) = 0 as ok_member_cannot_delete_recurring from d;
