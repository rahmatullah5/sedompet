-- Scenario walkthrough for 20261123000000_split_expenses.sql.
\set ON_ERROR_STOP 0
reset role;
select id as rina from auth.users where email = '6285755556666@phone.sedompet.app' \gset
select id as rd from dompets where name = 'Keluarga Rina' \gset
select id as acc from accounts where dompet_id = :'rd' limit 1 \gset
select id as m_rina from dompet_members where dompet_id = :'rd' and user_id = :'rina' \gset
select id as m_dimas from dompet_members where dompet_id = :'rd' and user_id <> :'rina' limit 1 \gset
select id as m_other from dompet_members where dompet_id <> :'rd' limit 1 \gset

set role authenticated;
set request.jwt.claim.sub = :'rina';
\echo == a valid split
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, split_with)
values (:'rd', :'acc', 'expense', 300000, current_date, :'m_rina', :'m_rina',
        jsonb_build_array(jsonb_build_object('m', :'m_rina', 'a', 150000), jsonb_build_object('m', :'m_dimas', 'a', 150000)));
select count(*) = 1 as ok_split_saved from transactions where dompet_id = :'rd' and split_with is not null;
\echo EXPECT ERROR x5: invalid_split (sum, income, other Dompet member, duplicate, zero share)
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, split_with)
values (:'rd', :'acc', 'expense', 300000, current_date, :'m_rina', jsonb_build_array(jsonb_build_object('m', :'m_rina', 'a', 100000)));
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, split_with)
values (:'rd', :'acc', 'income', 100000, current_date, :'m_rina', jsonb_build_array(jsonb_build_object('m', :'m_rina', 'a', 100000)));
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, split_with)
values (:'rd', :'acc', 'expense', 100000, current_date, :'m_rina', jsonb_build_array(jsonb_build_object('m', :'m_other', 'a', 100000)));
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, split_with)
values (:'rd', :'acc', 'expense', 200000, current_date, :'m_rina',
        jsonb_build_array(jsonb_build_object('m', :'m_rina', 'a', 100000), jsonb_build_object('m', :'m_rina', 'a', 100000)));
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, split_with)
values (:'rd', :'acc', 'expense', 100000, current_date, :'m_rina',
        jsonb_build_array(jsonb_build_object('m', :'m_rina', 'a', 100000), jsonb_build_object('m', :'m_dimas', 'a', 0)));
\echo EXPECT ERROR: changing the amount without the shares
update transactions set amount = 200000, updated_by = :'m_rina' where dompet_id = :'rd' and split_with is not null;
\echo == clearing a split is fine
update transactions set split_with = null, updated_by = :'m_rina' where dompet_id = :'rd' and split_with is not null;
select count(*) = 0 as ok_cleared from transactions where dompet_id = :'rd' and split_with is not null;
