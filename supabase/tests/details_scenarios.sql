-- Scenario walkthrough for 20261124000000_transaction_details.sql (columns only;
-- storage policies need a real Supabase project).
\set ON_ERROR_STOP 0
reset role;
select id as rina from auth.users where email = '6285755556666@phone.sedompet.app' \gset
select id as rd from dompets where name = 'Keluarga Rina' \gset
select id as acc from accounts where dompet_id = :'rd' limit 1 \gset
select id as m_rina from dompet_members where dompet_id = :'rd' and user_id = :'rina' \gset
set role authenticated;
set request.jwt.claim.sub = :'rina';
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, need, merchant, receipt_path)
values (:'rd', :'acc', 'expense', 50000, current_date, :'m_rina', :'m_rina', 'want', 'Indomaret',
        :'rd' || '/0b0e8a3e-4b6f-4f43-9e1c-2b8c9a7d1e11.jpg');
select count(*) = 1 as ok_details from transactions where dompet_id = :'rd' and merchant = 'Indomaret' and need = 'want';
\echo EXPECT ERROR x4: bad need, bad path, merchant too long, photo of another Dompet
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, need)
values (:'rd', :'acc', 'expense', 1, current_date, :'m_rina', :'m_rina', 'luxury');
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, receipt_path)
values (:'rd', :'acc', 'expense', 1, current_date, :'m_rina', :'m_rina', '../etc/passwd');
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, merchant)
values (:'rd', :'acc', 'expense', 1, current_date, :'m_rina', :'m_rina', repeat('x', 61));
insert into transactions (dompet_id, account_id, kind, amount, date, paid_by, created_by, receipt_path)
values (:'rd', :'acc', 'expense', 1, current_date, :'m_rina', :'m_rina', '0b0e8a3e-4b6f-4f43-9e1c-2b8c9a7d1e11/0b0e8a3e-4b6f-4f43-9e1c-2b8c9a7d1e11.jpg');
