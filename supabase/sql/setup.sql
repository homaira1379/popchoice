-- supabase/sql/setup.sql
-- Recreate the minimal database objects PopChoice needs

-- 0) Extensions
create extension if not exists vector;

-- 1) Movies table (uncomment if you need to create it from scratch)
-- create table if not exists public.movies (
--   id uuid default gen_random_uuid() primary key,
--   title text not null unique,
--   release_year text,
--   description text,
--   embedding vector(1536)
-- );

-- 2) Similarity search function used by the app
drop function if exists public.match_movies(vector, integer);

create function public.match_movies(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  release_year text,
  description text,
  similarity float
)
language sql stable
as $$
  select
    id,
    title,
    release_year,
    description,
    1 - (embedding <=> query_embedding) as similarity
  from public.movies
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- 3) Index for fast vector search
create index if not exists movies_embedding_idx
  on public.movies using ivfflat (embedding vector_cosine_ops);

-- 4) Permissions for the anon client (frontend)
grant select on public.movies to anon;
grant execute on function public.match_movies(vector(1536), int) to anon;

-- (Optional) If Row Level Security is ON for public.movies, allow anon reads:
-- create policy if not exists movies_anon_read
--   on public.movies
--   for select
--   to anon
--   using (true);
