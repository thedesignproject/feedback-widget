-- Migration: change project_id from uuid to text
-- Run this if you already created the table with the original uuid schema
alter table comments drop constraint if exists comments_project_id_fkey;
alter table comments alter column project_id type text using project_id::text;
