-- Scenario walkthrough for 20261115000000_account_holder.sql.
\set ON_ERROR_STOP 0
reset role;
insert into auth.users values ('66666666-6666-6666-6666-666666666666', '6281300000006@phone.sedompet.app', '{}') on conflict do nothing;
set role authenticated;

\echo == owner sets up a Dompet with an account meant for Rizka (not joined yet)
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select id as did from create_dompet('Holder test') \gset
select add_pending_member(:'did', '0813 1111 0001', 'Rizka', 'member') as m_rizka \gset
reset role;
select (select activated from phone_access where phone = '6281311110001') as ok_pending_phone_activated,
       (select user_id is null from dompet_members where id = :'m_rizka') as ok_placeholder;
select id as m_owner from dompet_members where dompet_id = :'did' and role = 'owner' \gset
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into accounts (dompet_id, name, type) values (:'did', 'Pluang Rizka', 'savings') returning id as acc \gset
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, updated_by)
values (:'did', :'acc', 'expense', 50000, current_date, :'m_owner', :'m_owner', :'m_owner') returning id as tx \gset
select assign_account(:'acc', :'m_rizka', 'shared', true) = 1 as ok_reassigned_paid_by;
select (select holder_member_id = :'m_rizka' from accounts where id = :'acc') as ok_holder_set,
       (select paid_by = :'m_rizka' from transactions where id = :'tx') as ok_paid_by_moved;
\echo EXPECT ERROR: adding the same phone twice
select add_pending_member(:'did', '081311110001', 'Rizka lagi');

\echo == Rizka registers, claims, and continues by herself
set role anon;
select register_phone('081311110001', '123456');
reset role;
select id as rizka_uid from auth.users where email = '6281311110001@phone.sedompet.app' \gset
set role authenticated;
set request.jwt.claim.sub = :'rizka_uid';
select claim_phone_membership() = 1 as ok_claimed;
with u as (update transactions set amount = 55000, updated_by = :'m_rizka' where id = :'tx' returning 1)
select count(*) = 1 as ok_holder_edits_owner_logged_tx from u;
with u as (update accounts set name = 'Pluang' where id = :'acc' returning 1)
select count(*) = 1 as ok_holder_renames from u;
\echo EXPECT ERROR: holder cannot make it private / change holder
update accounts set visibility = 'private', owner_member_id = :'m_rizka' where id = :'acc';
\echo EXPECT ERROR: member cannot reassign a shared account
select assign_account(:'acc', :'m_owner', 'shared', false);

\echo == another member cannot edit transactions in Rizka account
reset role;
insert into dompet_members (dompet_id, user_id, role, display_name) values (:'did', '33333333-3333-3333-3333-333333333333', 'member', 'Kakak') returning id as m_kakak \gset
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
with u as (update transactions set amount = 1, updated_by = :'m_kakak' where id = :'tx' returning 1)
select count(*) = 0 as ok_non_holder_blocked from u;

\echo == owner hands over a PRIVATE account; owner loses sight of it
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into accounts (dompet_id, name, type, visibility, owner_member_id) values (:'did', 'Celengan', 'savings', 'private', :'m_owner') returning id as acc2 \gset
select assign_account(:'acc2', :'m_rizka', 'private', false) = 0 as ok_private_handover;
select count(*) = 0 as ok_owner_no_longer_sees from accounts where id = :'acc2';
set request.jwt.claim.sub = :'rizka_uid';
select count(*) = 1 as ok_rizka_sees_private from accounts where id = :'acc2';
\echo EXPECT ERROR: non-admin private owner cannot publish to family
select assign_account(:'acc2', :'m_rizka', 'shared', false);

\echo == removing a pending member
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select add_pending_member(:'did', '081322220002', 'Om Budi') as m_budi \gset
select remove_pending_member(:'m_budi');
select count(*) = 0 as ok_pending_removed from dompet_members where id = :'m_budi';
\echo EXPECT ERROR: holder from another Dompet
reset role;
insert into accounts (dompet_id, name, type, holder_member_id) values (:'did', 'X', 'bank', (select id from dompet_members where dompet_id <> :'did' limit 1));
