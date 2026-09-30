begin;

-- Keep the storage-level limits aligned with Edge Function validation for
-- signature uploads.  The bucket remains private and browser-inaccessible.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificate-signatures',
  'certificate-signatures',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
