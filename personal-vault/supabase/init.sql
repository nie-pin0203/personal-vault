-- Run once in a new Supabase project. No secret keys are needed by this application.
create table public.vaults (
 id uuid primary key, user_id uuid not null unique references auth.users(id) on delete cascade,
 version integer not null default 1 check(version>0), salt text not null,
 iterations integer not null check(iterations between 600000 and 2000000),
 wrapped jsonb not null, recovery jsonb not null
);
create table public.credentials (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 version integer not null check(version>0), iv text not null, ciphertext text not null,
 updated_at timestamptz not null default now()
);
create table public.categories (like public.credentials including all);
alter table public.categories add foreign key(user_id) references auth.users(id) on delete cascade;
create table public.sync_metadata (
 user_id uuid primary key references auth.users(id) on delete cascade,
 version bigint not null default 0, updated_at timestamptz not null default now()
);
create index on public.credentials(user_id);
create index on public.categories(user_id);
do $$ declare t text; begin
 foreach t in array array['vaults','credentials','categories','sync_metadata'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from anon',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy own_select on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid())=user_id)',t);
 end loop;
end $$;
-- Atomic CAS, including retry detection. SECURITY INVOKER keeps all RLS checks active.
create or replace function public.apply_mutation(p_table text,p_id uuid,p_expected integer,p_iv text,p_ciphertext text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare existing record; affected integer;
begin
 if auth.uid() is null or p_table not in ('credentials','categories') or p_expected<0 then raise exception 'invalid mutation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 execute format('select * from public.%I where id=$1 and user_id=auth.uid() for update',p_table) into existing using p_id;
 if existing.id is not null and p_ciphertext is not null and existing.version=p_expected+1 and existing.ciphertext=p_ciphertext and existing.iv=p_iv then return true; end if;
 if p_ciphertext is null then
  if existing.id is null then return true; end if;
  if existing.version<>p_expected then return false; end if;
  execute format('delete from public.%I where id=$1 and user_id=auth.uid()',p_table) using p_id;
 elsif p_expected=0 then
  if existing.id is not null then return false; end if;
  execute format('insert into public.%I(id,user_id,version,iv,ciphertext) values($1,auth.uid(),1,$2,$3) on conflict do nothing',p_table) using p_id,p_iv,p_ciphertext;
  get diagnostics affected=row_count;
  if affected=0 then return false; end if;
 else
  if existing.id is null or existing.version<>p_expected then return false; end if;
  execute format('update public.%I set version=version+1,iv=$2,ciphertext=$3,updated_at=now() where id=$1 and user_id=auth.uid()',p_table) using p_id,p_iv,p_ciphertext;
 end if;
 insert into public.sync_metadata(user_id,version) values(auth.uid(),1) on conflict(user_id) do update set version=sync_metadata.version+1,updated_at=now();
 return true;
end $$;
revoke all on function public.apply_mutation(text,uuid,integer,text,text) from public,anon;
grant execute on function public.apply_mutation(text,uuid,integer,text,text) to authenticated;
