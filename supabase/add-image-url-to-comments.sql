-- Add image_url column to store Supabase Storage public URLs for feedback screenshots
alter table comments
  add column if not exists image_url text;

-- Storage bucket "feedback-images" must already exist (created via Supabase dashboard).
-- Policies: public can upload, authenticated can read.

-- Allow anyone to upload into feedback-images (widget runs as anon)
drop policy if exists "anon upload feedback images" on storage.objects;
create policy "anon upload feedback images"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'feedback-images');

-- Allow public read of feedback images
drop policy if exists "public read feedback images" on storage.objects;
create policy "public read feedback images"
  on storage.objects
  for select
  to public
  using (bucket_id = 'feedback-images');
