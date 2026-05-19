create table if not exists public.stock_analyses (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  requested_symbol text,
  provider text,
  price numeric,
  change numeric,
  change_percent numeric,
  volume numeric,
  market_time text,
  raw_stock_data jsonb not null,
  summary text not null,
  sentiment text not null check (sentiment in ('Bullish', 'Neutral', 'Bearish')),
  risk_level text not null check (risk_level in ('Low', 'Medium', 'High')),
  llm_model text,
  created_at timestamptz not null default now()
);

create index if not exists stock_analyses_created_at_idx
  on public.stock_analyses (created_at desc);

create index if not exists stock_analyses_symbol_idx
  on public.stock_analyses (symbol);

alter table public.stock_analyses enable row level security;

create policy "Service role can manage stock analyses"
  on public.stock_analyses
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
