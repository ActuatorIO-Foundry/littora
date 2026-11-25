-- Install once as administrator in an empty database, never in the catalogue.
begin;
do $$ begin
  if current_database() !~ '^littora_contact(_ci_[a-f0-9]{32})?$'
    or exists (select from pg_namespace where nspname not in ('public','information_schema') and nspname !~ '^pg_')
    or exists (select from pg_class where relnamespace='public'::regnamespace)
    or exists (select from pg_proc where pronamespace='public'::regnamespace) then
    raise exception 'Expected an empty dedicated contact database';
  end if;
  execute format('revoke all on database %I from public',current_database());
  execute format('alter database %I set log_parameter_max_length = 0',current_database());
  execute format('alter database %I set log_parameter_max_length_on_error = 0',current_database());
end $$;
create role littora_contact_owner nologin;
create role littora_contact_submit nologin;
create role littora_contact_manage nologin;
do $$ begin
  execute format('grant connect on database %I to littora_contact_submit,littora_contact_manage',current_database());
end $$;
revoke all on schema public from public;
create schema inbox authorization littora_contact_owner;
set local role littora_contact_owner;
create table inbox.message (
  reference uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  email text not null check (length(email) between 3 and 254),
  topic text not null check (topic in ('question','correction','territory','partnership')),
  body text not null check (length(btrim(body)) between 1 and 5000)
);
create index inbox_received on inbox.message(received_at,reference);
create table inbox.quota (window_start timestamptz not null, bucket text not null, hits integer not null, primary key(window_start,bucket));
create table inbox.watch (id boolean primary key check(id), last_opened timestamptz not null);
create function inbox.available() returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select exists(select from inbox.watch where last_opened > now()-interval '72 hours')
$$;
create function inbox.submit(p_email text,p_topic text,p_body text,p_bucket text) returns uuid
language plpgsql strict security definer set search_path=pg_catalog,pg_temp as $$
declare ref uuid; k text; n int; slot timestamptz:=date_bin('1 hour',now(),'2000-01-01 UTC');
begin
  if not inbox.available() then raise exception using errcode='P0503', message='Inbox unavailable'; end if;
  if p_bucket !~ '^[a-f0-9]{64}$' then raise exception 'Invalid bucket'; end if;
  -- One transaction: a refusal consumes neither quota nor an acknowledgement.
  foreach k in array array['global',p_bucket] loop
    insert into inbox.quota values(slot,k,1) on conflict(window_start,bucket) do update
      set hits=inbox.quota.hits+1 returning hits into n;
    if n > (case when k='global' then 120 else 5 end) then
      raise exception using errcode='P0429',message='Quota exceeded';
    end if;
  end loop;
  insert into inbox.message(email,topic,body) values(p_email,p_topic,p_body) returning reference into ref;
  return ref;
end $$;
create function inbox.open_mail() returns table(reference uuid,received_at timestamptz,topic text)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  insert into inbox.watch values(true,now()) on conflict(id) do update set last_opened=excluded.last_opened;
  return query select m.reference,m.received_at,m.topic from inbox.message m
    where m.received_at > now()-interval '30 days' order by m.received_at,m.reference limit 50;
end $$;
create function inbox.read_mail(p_ref uuid) returns setof inbox.message
language sql stable strict security definer set search_path=pg_catalog,pg_temp as $$
  select * from inbox.message where reference=p_ref and received_at > now()-interval '30 days'
$$;
create function inbox.resolve(p_ref uuid) returns boolean language sql strict security definer set search_path=pg_catalog,pg_temp as $$
  with gone as (delete from inbox.message where reference=p_ref returning 1) select exists(select from gone)
$$;
create function inbox.purge() returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  delete from inbox.message where received_at <= now()-interval '30 days';
  delete from inbox.quota where window_start <= now()-interval '2 hours';
end $$;
revoke all on all functions in schema inbox from public;
grant usage on schema inbox to littora_contact_submit,littora_contact_manage;
grant execute on function inbox.available(),inbox.submit(text,text,text,text),inbox.purge() to littora_contact_submit;
grant execute on function inbox.open_mail(),inbox.read_mail(uuid),inbox.resolve(uuid) to littora_contact_manage;
commit;
