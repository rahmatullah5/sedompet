-- Scenario walkthrough for 20261119000000_account_currency.sql.
\set ON_ERROR_STOP 0
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select id as did from create_dompet('Currency test') \gset

\echo == custom account type and a USD account
insert into accounts (dompet_id, name, type) values (:'did', 'Emas Antam', 'Emas') returning id as gold \gset
insert into accounts (dompet_id, name, type, currency, fx_rate, opening_balance)
values (:'did', 'Wise USD', 'bank', 'USD', 16250.5, 12050) returning id as usd \gset
select (select type = 'Emas' from accounts where id = :'gold') as ok_custom_type,
       (select currency = 'USD' and fx_rate = 16250.5 from accounts where id = :'usd') as ok_usd,
       (select currency = 'IDR' and fx_rate = 1 from accounts where dompet_id = :'did' and type = 'cash') as ok_default_idr;

\echo EXPECT ERROR: type too long
insert into accounts (dompet_id, name, type) values (:'did', 'X', repeat('a', 31));
\echo EXPECT ERROR: bad currency code
insert into accounts (dompet_id, name, type, currency) values (:'did', 'X', 'bank', 'usd');
\echo EXPECT ERROR: rate must be positive
insert into accounts (dompet_id, name, type, currency, fx_rate) values (:'did', 'X', 'bank', 'SGD', 0);
reset role;
