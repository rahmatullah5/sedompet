-- Scenario walkthrough for 20261114000000_app_admin.sql.
\set ON_ERROR_STOP 0
reset role;
\echo == grant app admin to the seeded owner (6281999999999 registered in phone tests)
select admin_grant_app_admin('081999999999') = 'ok' as ok_grant;
\echo EXPECT ERROR: unregistered number
select admin_grant_app_admin('081000000000');

set role authenticated;
\echo == non-admin is blocked
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is_app_admin() = false as ok_not_admin;
\echo EXPECT ERROR x2
select app_create_activation_code('x');
select * from app_list_phones();
\echo EXPECT ERROR: direct table access
select * from activation_codes;

\echo == admin creates codes
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select is_app_admin() as ok_is_admin;
select code as c1 from app_create_activation_code('Budi', 30) \gset
select code as c2 from app_create_activation_code('Siti', 30) \gset
select :'c1' ~ '^[A-HJKMNP-Z2-9]{8}$' as ok_format, :'c1' <> :'c2' as ok_unique;
select count(*) >= 2 as ok_listed from app_list_activation_codes();
select app_revoke_activation_code(:'c2');

\echo == new person registers with the code (no manual activation)
set role anon;
select register_phone('0857 1111 2222', '222222', :'c1', 'Budi');
reset role;
select (select activated from phone_access where phone = '6285711112222') as ok_activated,
       (select used_phone = '6285711112222' and used_at is not null from activation_codes where code = :'c1') as ok_code_used,
       (select count(*) = 0 from dompet_members where phone = '6285711112222') as ok_no_dompet_yet;
set role anon;
\echo EXPECT ERROR: code is single-use
select register_phone('0857 3333 4444', '222222', :'c1', 'X');
\echo EXPECT ERROR: revoked code
select register_phone('0857 3333 4444', '222222', :'c2', 'X');
reset role;
update activation_codes set expires_at = now() - interval '1 day' where code = :'c2';
insert into activation_codes (code, expires_at) values ('EXPIRED2', now() - interval '1 day');
set role anon;
\echo EXPECT ERROR: expired code
select register_phone('0857 3333 4444', '222222', 'EXPIRED2', 'X');

\echo == the new user can create their own Dompet after login
reset role;
select id as budi from auth.users where email = '6285711112222@phone.sedompet.app' \gset
set role authenticated;
set request.jwt.claim.sub = :'budi';
select claim_phone_membership() = 0 as ok_nothing_to_claim;
select name = 'Dompet Budi' as ok_create_dompet from create_dompet('Dompet Budi');

\echo == admin toggles a number
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select app_set_phone_active('085711112222', false);
select activated = false as ok_deactivated from app_list_phones() where phone = '6285711112222';
\echo EXPECT ERROR: admin cannot deactivate self
select app_set_phone_active('081999999999', false);
select app_set_phone_active('085711112222', true);
