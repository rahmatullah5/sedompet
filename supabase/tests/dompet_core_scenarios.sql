-- Scenario walkthrough for 20261112000000_dompet_core.sql.
-- Lines that should fail are preceded by an \echo saying so; read the output.
\set ON_ERROR_STOP 0
\set AYAH '11111111-1111-1111-1111-111111111111'
\set IBU '22222222-2222-2222-2222-222222222222'
\set KAKAK '33333333-3333-3333-3333-333333333333'
\set STRANGER '44444444-4444-4444-4444-444444444444'
set role authenticated;

\echo == ayah creates dompet
set request.jwt.claim.sub = :'AYAH';
select id as did from create_dompet('Keluarga Rahmat') \gset
select name, currency from dompets;
select role, display_name from dompet_members;

\echo == ayah creates member + admin invites
select code as code_member from create_dompet_invite(:'did') \gset
select code as code_admin from create_dompet_invite(:'did', 'admin', 1) \gset
select :'code_member' ~ '^[A-HJKMNP-Z2-9]{6}$' as code_format_ok;

\echo == owner invite must fail
select create_dompet_invite(:'did', 'owner');

\echo == stranger sees nothing
set request.jwt.claim.sub = :'STRANGER';
select count(*) as stranger_dompets from dompets;
select count(*) as stranger_members from dompet_members;
select count(*) as stranger_invites from dompet_invites;
\echo == stranger cannot invite / insert directly / read emails
select create_dompet_invite(:'did');
insert into dompet_members(dompet_id,user_id,role) values (:'did', :'STRANGER', 'owner');
select default_display_name(:'AYAH');

\echo == ibu joins as admin (lowercase, spaces), kakak joins as member
set request.jwt.claim.sub = :'IBU';
select redeem_dompet_invite(lower(:'code_admin') || ' ') = :'did' as ibu_joined;
set request.jwt.claim.sub = :'KAKAK';
select redeem_dompet_invite(:'code_member') = :'did' as kakak_joined;
select redeem_dompet_invite(:'code_member') = :'did' as kakak_rejoin_noop;
\echo == admin invite single-use is exhausted
set request.jwt.claim.sub = :'STRANGER';
select redeem_dompet_invite(:'code_admin');
select redeem_dompet_invite('ZZZZZZ');

reset role;
select m.role, m.display_name from dompet_members m order by joined_at;
select code, role, uses from dompet_invites order by role;
set role authenticated;

\echo == member kakak cannot change role or self-promote via update
set request.jwt.claim.sub = :'KAKAK';
select set_dompet_member_role(:'did', :'KAKAK', 'admin');
update dompet_members set role='owner' where user_id = :'KAKAK';
update dompet_members set display_name='Kakak' where user_id = :'KAKAK';
select count(*) as kakak_can_see_invites from dompet_invites;
update dompets set name='hacked';

\echo == admin ibu: demote kakak to viewer ok, promote to admin forbidden, touch owner forbidden
set request.jwt.claim.sub = :'IBU';
select set_dompet_member_role(:'did', :'KAKAK', 'viewer');
select set_dompet_member_role(:'did', :'KAKAK', 'admin');
select set_dompet_member_role(:'did', :'AYAH', 'member');
select remove_dompet_member(:'did', :'AYAH');
select create_dompet_invite(:'did', 'admin');
update dompets set name='Keluarga R' returning name;

\echo == last owner cannot demote self or leave
set request.jwt.claim.sub = :'AYAH';
select set_dompet_member_role(:'did', :'AYAH', 'admin');
select leave_dompet(:'did');
\echo == promote ibu to owner, then ayah can leave
select set_dompet_member_role(:'did', :'IBU', 'owner');
select leave_dompet(:'did');
select count(*) as ayah_sees_after_leave from dompets;

\echo == ibu removes kakak, then leaves as last member -> dompet deleted
set request.jwt.claim.sub = :'IBU';
select remove_dompet_member(:'did', :'KAKAK');
select leave_dompet(:'did');
reset role;
select count(*) as dompets_left, (select count(*) from dompet_invites) as invites_left from dompets;

\echo == anon cannot call RPCs
set role anon;
select create_dompet('x');
