-- Weighted Blotto player strategies
create table if not exists public.players (
  username text primary key check (char_length(username) between 1 and 24),
  strategy text not null,
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;

drop policy if exists players_select on public.players;
create policy players_select on public.players
  for select using (true);

drop policy if exists players_insert on public.players;
create policy players_insert on public.players
  for insert with check (char_length(username) between 1 and 24);

drop policy if exists players_update on public.players;
create policy players_update on public.players
  for update using (true)
  with check (char_length(username) between 1 and 24);
