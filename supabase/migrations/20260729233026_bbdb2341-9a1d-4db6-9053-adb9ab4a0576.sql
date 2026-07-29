-- Idempotency ledger for server-granted rewards
create table if not exists public.reward_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  grant_key text not null,
  coins integer not null default 0,
  gems integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists reward_grants_user_key_idx on public.reward_grants (user_id, grant_key);

alter table public.reward_grants enable row level security;

create policy "Users read own reward grants"
  on public.reward_grants for select to authenticated
  using (auth.uid() = user_id);

create policy "Admins manage reward grants"
  on public.reward_grants for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

-- Currency may only change via service role (edge functions) or an admin
create or replace function public.enforce_currency_server_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  jwt_role := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');

  -- service_role (edge functions) and direct SQL are always allowed
  if jwt_role = 'service_role' or jwt_role = '' then
    return new;
  end if;

  -- admins may adjust balances from the admin console
  if auth.uid() is not null and has_role(auth.uid(), 'admin'::app_role) then
    return new;
  end if;

  if new.coins is distinct from old.coins or new.gems is distinct from old.gems then
    raise exception 'Coins and gems can only be changed by the server';
  end if;

  new.user_id := old.user_id;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_currency on public.profiles;
create trigger profiles_enforce_currency
  before update on public.profiles
  for each row execute function public.enforce_currency_server_only();

-- Cards are granted by the server only
drop policy if exists "Users insert own collection" on public.user_collections;

-- Reward claim records are written by the server only
drop policy if exists "Users insert own collection claims" on public.user_collection_claims;
drop policy if exists "Users insert own rank claims" on public.user_rank_claims;
drop policy if exists "Users insert own challenge completions" on public.challenge_completions;

-- Progress may be tracked client-side, but claiming is server-only
drop policy if exists "Users update own evo progress" on public.user_evo_progress;
create policy "Users update own evo progress"
  on public.user_evo_progress for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and claimed = false);