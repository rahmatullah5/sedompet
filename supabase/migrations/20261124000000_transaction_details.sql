-- Sedompet: richer transactions.
--   need          'need' (kebutuhan) / 'want' (keinginan), optional
--   merchant      where it was bought, optional
--   receipt_path  receipt photo in the private 'receipts' storage bucket,
--                 stored as '<dompet_id>/<uuid>.jpg'
-- Only members of that Dompet can read/upload/delete its receipt photos.

alter table public.transactions add column if not exists need text;
alter table public.transactions add column if not exists merchant text;
alter table public.transactions add column if not exists receipt_path text;
do $$ begin
  alter table public.transactions add constraint transactions_need_check check (need is null or need in ('need', 'want'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transactions add constraint transactions_merchant_check check (merchant is null or char_length(merchant) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transactions add constraint transactions_receipt_path_check
    check (receipt_path is null or (receipt_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and split_part(receipt_path, '/', 1) = dompet_id::text));
exception when duplicate_object then null; end $$;

-- Receipt photos (Supabase Storage). Skipped where there is no storage schema (local tests).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 2097152, array['image/jpeg'])
    on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

    execute 'drop policy if exists receipts_select on storage.objects';
    execute 'drop policy if exists receipts_insert on storage.objects';
    execute 'drop policy if exists receipts_delete on storage.objects';
    execute $p$create policy receipts_select on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and public.is_dompet_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts'
        and public.is_dompet_member(((storage.foldername(name))[1])::uuid,
                                    array['owner','admin','member']::public.dompet_role[]))$p$;
    execute $p$create policy receipts_delete on storage.objects for delete to authenticated
      using (bucket_id = 'receipts'
        and public.is_dompet_member(((storage.foldername(name))[1])::uuid,
                                    array['owner','admin','member']::public.dompet_role[]))$p$;
  end if;
end $$;

notify pgrst, 'reload schema';
