-- Scenario walkthrough for 20261113000000_phone_login.sql.
\set ON_ERROR_STOP 0
reset role;
select normalize_phone('081234567890') = '6281234567890' as ok_norm_08,
       normalize_phone('+62 812-3456-7890') = '6281234567890' as ok_norm_plus,
       phone_from_email('6281234567890@phone.sedompet.app') = '6281234567890' as ok_phone_email,
       phone_from_email('someone@gmail.com') is null as ok_other_email;

\echo == hook rejects non-activated and non-phone sign-ups
select (hook_before_user_created('{"user":{"email":"6281999999999@phone.sedompet.app"}}') -> 'error' ->> 'http_code') = '403' as ok_hook_blocks_inactive,
       (hook_before_user_created('{"user":{"email":"x@gmail.com"}}') -> 'error') is not null as ok_hook_blocks_email;
select admin_activate_phone('081999999999') = '6281999999999' as ok_activate;
select hook_before_user_created('{"user":{"email":"6281999999999@phone.sedompet.app"}}') = '{}'::jsonb as ok_hook_allows_active;

\echo == admin pre-creates a Dompet with a placeholder owner (like the Cashew seed)
insert into dompets (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Dompet Seed');
insert into dompet_members (id, dompet_id, phone, role, display_name)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '6281999999999', 'owner', 'Saya');
insert into accounts (id, dompet_id, name, type, created_by) values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'BCA', 'bank', 'bbbbbbbb-0000-0000-0000-000000000001');
insert into auth.users values ('99999999-9999-9999-9999-999999999999', '6281999999999@phone.sedompet.app', '{}');
insert into auth.users values ('88888888-8888-8888-8888-888888888888', '6281888888888@phone.sedompet.app', '{}');

set role authenticated;
\echo == new user signs in and claims; sees the seeded Dompet as owner
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select count(*) = 0 as ok_nothing_before_claim from dompets;
select claim_phone_membership() = 1 as ok_claimed;
select count(*) = 1 as ok_sees_dompet, (select role from dompet_members where user_id = auth.uid()) = 'owner' as ok_is_owner from dompets;
select count(*) = 1 as ok_sees_account from accounts;
select claim_phone_membership() = 0 as ok_claim_idempotent;

\echo EXPECT ERROR: non-activated user claims
set request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
select claim_phone_membership();
\echo EXPECT ERROR: non-activated user creates a Dompet
select create_dompet('Hack');

\echo == deactivation removes access immediately
reset role;
select admin_deactivate_phone('6281999999999');
set role authenticated;
set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select count(*) = 0 as ok_deactivated_sees_nothing from dompets;
reset role;
select admin_activate_phone('6281999999999');

\echo == clients cannot call admin helpers or the hook
set role authenticated;
\echo EXPECT ERROR x2
select admin_activate_phone('0811');
select hook_before_user_created('{}');

\echo == register_phone: creates a sign-in-able account for activated numbers only
reset role;
select admin_activate_phone('081277777777');
set role anon;
select register_phone('0812 7777 7777', '123456');
reset role;
select (select encrypted_password = extensions.crypt('123456', encrypted_password) from auth.users where email = '6281277777777@phone.sedompet.app') as ok_pin_hash_matches,
       (select email_confirmed_at is not null from auth.users where email = '6281277777777@phone.sedompet.app') as ok_confirmed,
       (select count(*) = 1 from auth.identities i join auth.users u on u.id = i.user_id where u.email = '6281277777777@phone.sedompet.app') as ok_identity;
set role anon;
\echo EXPECT ERROR: register twice
select register_phone('081277777777', '654321');
\echo EXPECT ERROR: not activated
select register_phone('081266666666', '123456');
\echo EXPECT ERROR: bad pin
select register_phone('081277777777', '12ab');

\echo == invite code activates a brand-new number and joins the Dompet
reset role;
insert into dompet_invites (code, dompet_id, role, max_uses) values ('INVT01', 'aaaaaaaa-0000-0000-0000-000000000001', 'member', 2);
set role anon;
select register_phone('0813 5555 5555', '111111', 'invt01', 'Ibu');
reset role;
select (select activated from phone_access where phone = '6281355555555') as ok_invite_activates,
       (select uses = 1 from dompet_invites where code = 'INVT01') as ok_invite_use_counted,
       (select role = 'member' and display_name = 'Ibu' and user_id is null from dompet_members where phone = '6281355555555') as ok_placeholder_member;
select id as ibu_uid from auth.users where email = '6281355555555@phone.sedompet.app' \gset
set role authenticated;
set request.jwt.claim.sub = :'ibu_uid';
select claim_phone_membership() = 1 as ok_ibu_claims;
select count(*) = 1 as ok_ibu_sees_dompet from dompets;
set role anon;
\echo EXPECT ERROR: bad invite code
select register_phone('081366666666', '111111', 'NOPE99', 'X');
reset role;
select admin_deactivate_phone('081277777777');
delete from auth.identities where user_id in (select id from auth.users where email = '6281277777777@phone.sedompet.app');
delete from auth.users where email = '6281277777777@phone.sedompet.app';
set role anon;
\echo EXPECT ERROR: deactivated number cannot self-activate with an invite
select register_phone('081277777777', '111111', 'INVT01', 'X');
