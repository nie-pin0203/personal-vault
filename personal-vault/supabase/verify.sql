-- Read-only deployment checks. All four tables should have both RLS flags true.
select relname,relrowsecurity,relforcerowsecurity from pg_class
where relnamespace='public'::regnamespace and relname in ('vaults','credentials','categories','sync_metadata');
-- Expect 16 policies, four per table, each limited to authenticated.
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('vaults','credentials','categories','sync_metadata') order by tablename,cmd;
-- Expect false for anon direct SELECT privileges.
select t,has_table_privilege('anon','public.'||t,'SELECT') as anon_select
from unnest(array['vaults','credentials','categories','sync_metadata']) t;
-- RPC must be invoker, and anon must not have execute permission.
select prosecdef as security_definer,has_function_privilege('anon',oid,'EXECUTE') as anon_execute
from pg_proc where oid='public.apply_mutation(text,uuid,integer,text,text)'::regprocedure;
