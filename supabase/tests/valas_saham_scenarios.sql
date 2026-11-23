-- Scenario walkthrough for 20261128000000_valas_saham.sql.
\set ON_ERROR_STOP 0
\set AYAH '11111111-1111-1111-1111-111111111111'
\set KAKAK '33333333-3333-3333-3333-333333333333'
\set STRANGER '44444444-4444-4444-4444-444444444444'
\set ADIK '55555555-5555-5555-5555-555555555555'
set role authenticated;

\echo == setup: ayah owner, kakak member, adik viewer
set request.jwt.claim.sub = :'AYAH';
select id as did from create_dompet('Valas test') \gset
select code as c_member from create_dompet_invite(:'did', 'member') \gset
select code as c_viewer from create_dompet_invite(:'did', 'viewer') \gset
set request.jwt.claim.sub = :'KAKAK'; select redeem_dompet_invite(:'c_member') is not null as ok_kakak_joined;
set request.jwt.claim.sub = :'ADIK';  select redeem_dompet_invite(:'c_viewer') is not null as ok_adik_joined;
reset role;
select id as m_ayah from dompet_members where user_id = :'AYAH' and dompet_id = :'did' \gset
set role authenticated;

\echo == pocket: BCA Valas (USD main) with SGD and JPY inside
set request.jwt.claim.sub = :'AYAH';
insert into accounts (dompet_id, name, type, currency, fx_rate) values (:'did', 'BCA Valas', 'bank', 'USD', 16000) returning id as p_main \gset
insert into accounts (dompet_id, name, type, currency, parent_id) values (:'did', 'BCA Valas SGD', 'bank', 'SGD', :'p_main') returning id as p_sgd \gset
insert into accounts (dompet_id, name, type, currency, parent_id, fx_auto) values (:'did', 'BCA Valas JPY', 'bank', 'JPY', :'p_main', false) returning id as p_jpy \gset
select count(*) = 2 as ok_two_children from accounts where parent_id = :'p_main';
select fx_auto = true as ok_fx_auto_default from accounts where id = :'p_main';
\echo EXPECT ERROR: nested pocket (child of a child)
insert into accounts (dompet_id, name, type, currency, parent_id) values (:'did', 'Salah', 'bank', 'EUR', :'p_sgd');
select id as did2 from create_dompet('Other') \gset
\echo EXPECT ERROR: pocket main account from another Dompet
insert into accounts (dompet_id, name, type, currency, parent_id) values (:'did2', 'Salah', 'bank', 'EUR', :'p_main');

\echo == stocks: RDN account with holdings
insert into accounts (dompet_id, name, type) values (:'did', 'RDN Ajaib', 'investment') returning id as rdn \gset
insert into holdings (dompet_id, account_id, symbol, name, shares, avg_price, created_by)
values (:'did', :'rdn', 'BBCA', 'Bank Central Asia', 500, 9150.5, :'m_ayah') returning id as h_bbca \gset
\echo EXPECT ERROR: duplicate symbol in same account
insert into holdings (dompet_id, account_id, symbol, shares) values (:'did', :'rdn', 'BBCA', 100);
\echo EXPECT ERROR: bad ticker
insert into holdings (dompet_id, account_id, symbol, shares) values (:'did', :'rdn', 'bbca.jk', 100);

\echo == kakak (member) can trade, adik (viewer) cannot, stranger sees nothing
set request.jwt.claim.sub = :'KAKAK';
with u as (update holdings set shares = shares + 200 where id = :'h_bbca' returning shares) select shares = 700 as ok_member_trades from u;
insert into holdings (dompet_id, account_id, symbol, shares, avg_price) values (:'did', :'rdn', 'TLKM', 1000, 3000) returning id as h_tlkm \gset
select count(*) = 2 as ok_member_sees_holdings from holdings where dompet_id = :'did';
set request.jwt.claim.sub = :'ADIK';
select count(*) = 2 as ok_viewer_sees from holdings where dompet_id = :'did';
with u as (update holdings set shares = 0 where id = :'h_bbca' returning 1) select count(*) = 0 as ok_viewer_cannot_update from u;
set request.jwt.claim.sub = :'STRANGER';
select count(*) = 0 as ok_stranger_blind from holdings where dompet_id = :'did';

\echo == holdings in a private account stay private
set request.jwt.claim.sub = :'AYAH';
insert into accounts (dompet_id, name, type, visibility, owner_member_id) values (:'did', 'Saham Ayah', 'investment', 'private', :'m_ayah') returning id as priv \gset
insert into holdings (dompet_id, account_id, symbol, shares, avg_price) values (:'did', :'priv', 'ASII', 300, 5000);
set request.jwt.claim.sub = :'KAKAK';
select count(*) = 2 as ok_private_holding_hidden from holdings where dompet_id = :'did';
\echo EXPECT ERROR: kakak cannot add to the private account of ayah
insert into holdings (dompet_id, account_id, symbol, shares) values (:'did', :'priv', 'UNVR', 100);

\echo == deleting the pocket main account removes its currencies; account delete removes holdings
set request.jwt.claim.sub = :'AYAH';
delete from accounts where id = :'p_main';
select count(*) = 0 as ok_children_gone from accounts where parent_id = :'p_main' or id in (:'p_sgd', :'p_jpy');
delete from accounts where id = :'rdn';
select count(*) = 0 as ok_holdings_gone from holdings where account_id = :'rdn';
reset role;

\echo == assets: crypto, gold, US stocks (20261129)
set role authenticated;
set request.jwt.claim.sub = :'AYAH';
insert into accounts (dompet_id, name, type) values (:'did', 'Indodax', 'investment') returning id as inv \gset
insert into holdings (dompet_id, account_id, market, symbol, shares, avg_price) values (:'did', :'inv', 'CRYPTO', 'BTC', 0.0125, 1050000000);
insert into holdings (dompet_id, account_id, market, symbol, shares, avg_price) values (:'did', :'inv', 'GOLD', 'EMAS', 2.5, 1800000);
insert into holdings (dompet_id, account_id, market, symbol, shares, avg_price) values (:'did', :'inv', 'US', 'BRK-B', 1.5, 480.25);
insert into holdings (dompet_id, account_id, market, symbol, shares, avg_price) values (:'did', :'inv', 'IDX', 'BTC', 100, 500);
select count(*) = 4 as ok_four_asset_kinds from holdings where account_id = :'inv';
select shares = 0.0125 as ok_fractional from holdings where account_id = :'inv' and market = 'CRYPTO';
\echo EXPECT ERROR: unknown market
insert into holdings (dompet_id, account_id, market, symbol, shares) values (:'did', :'inv', 'FOREX', 'EUR', 1);
reset role;
