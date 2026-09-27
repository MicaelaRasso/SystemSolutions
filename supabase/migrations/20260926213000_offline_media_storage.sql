begin;

-- Offline media is uploaded by the offline-sync Edge Function before its
-- operation reaches the service-role RPC. Both buckets are private.
insert into storage.buckets(id, name, public)
values ('certificate-evidence', 'certificate-evidence', false)
on conflict (id) do update set public = false;

insert into storage.buckets(id, name, public)
values ('certificate-signatures', 'certificate-signatures', false)
on conflict (id) do update set public = false;

commit;
