-- Scenario walkthrough for 20261122000000_period_start.sql.
\set ON_ERROR_STOP 0
reset role;
select id as rina from auth.users where email = '6285755556666@phone.sedompet.app' \gset
select id as dimas from auth.users where email = '6285777778888@phone.sedompet.app' \gset
select id as rd from dompets where name = 'Keluarga Rina' \gset
select period_start_day = 1 as ok_default from dompets where id = :'rd';

set role authenticated;
\echo == owner sets payday 25
set request.jwt.claim.sub = :'rina';
update dompets set period_start_day = 25 where id = :'rd';
select period_start_day = 25 as ok_owner_set from dompets where id = :'rd';
\echo EXPECT ERROR: out of range
update dompets set period_start_day = 31 where id = :'rd';
\echo == admin member (Dimas) may change it too
set request.jwt.claim.sub = :'dimas';
update dompets set period_start_day = 1 where id = :'rd';
reset role;
select period_start_day = 1 as ok_admin_set from dompets where id = :'rd';
