-- Dedicated private identity store. Never run among catalogue migrations.
begin;
do $$ begin
  if current_database() !~ '^littora_staff(_ci_[a-f0-9]{32})?$'
     or exists(select from pg_namespace where nspname not in ('public','information_schema') and nspname !~ '^pg_')
     or exists(select from pg_class where relnamespace='public'::regnamespace)
     or exists(select from pg_proc where pronamespace='public'::regnamespace) then
    raise exception 'Expected empty dedicated staff database';
  end if;
  execute format('revoke all on database %I from public',current_database());
end $$;
create role littora_staff_owner nologin;
create role littora_staff_runtime nologin;
do $$ begin
  execute format('grant connect on database %I to littora_staff_runtime',current_database());
end $$;
revoke all on schema public from public;
create schema staff authorization littora_staff_owner;
set local role littora_staff_owner;
create table staff.account (
  id uuid primary key default gen_random_uuid(),
  certificate text unique not null check(certificate ~ '^[0-9A-F]{64}$'),
  capability text not null check(capability in ('contact','moderation')),
  state text not null default 'enrolling' check(state in ('enrolling','active','revoked')),
  enroll_until timestamptz not null default (now()+interval '10 minutes'),
  epoch uuid not null default gen_random_uuid()
);
create table staff.credential (
  id text primary key check(length(id) between 1 and 1400),
  account_id uuid not null references staff.account(id),
  public_key bytea not null check(octet_length(public_key) between 32 and 4096),
  counter bigint not null check(counter between 0 and 4294967295)
);
create index on staff.credential(account_id);
create table staff.audit (
  id bigint generated always as identity primary key, occurred_at timestamptz not null default now(),
  account_id uuid not null, event text not null
);
create function staff.audit_change() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.certificate<>old.certificate or old.state='revoked' then
      raise exception 'Provision a new identity instead'; end if;
    new.epoch:=gen_random_uuid();
  end if;
  if new.state='active' and (select count(*) from staff.credential where account_id=new.id)<>2 then
    raise exception 'Two enrolled keys required';
  end if;
  insert into staff.audit(account_id,event) values(new.id,new.state||':'||new.capability);
  perform pg_notify('staff_access_changed','changed');
  return new;
end $$;
create trigger account_change before insert or update on staff.account for each row execute function staff.audit_change();
create function staff.add_key(a uuid,e uuid,k text,p bytea,c bigint) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform 1 from staff.account where id=a and epoch=e and state='enrolling' and enroll_until>clock_timestamp() for update;
  if not found or (select count(*) from staff.credential where account_id=a)>=2 then raise exception 'Enrollment unavailable'; end if;
  insert into staff.credential values(k,a,p,c);
end $$;
create function staff.advance(a uuid,e uuid,k text,previous bigint,new_counter bigint) returns boolean
language sql security definer set search_path=pg_catalog,pg_temp as $$
  with changed as (update staff.credential set counter=new_counter where id=k and account_id=a and counter=previous
    and (new_counter>previous or (previous=0 and new_counter=0))
    and exists(select from staff.account where id=a and epoch=e and state='active') returning 1)
  select exists(select from changed)
$$;
revoke all on all functions in schema staff from public;
grant usage on schema staff to littora_staff_runtime;
grant select on staff.account,staff.credential to littora_staff_runtime;
grant execute on function staff.add_key(uuid,uuid,text,bytea,bigint),staff.advance(uuid,uuid,text,bigint,bigint) to littora_staff_runtime;
commit;
