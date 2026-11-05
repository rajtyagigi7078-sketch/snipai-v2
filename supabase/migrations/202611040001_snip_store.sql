-- Shared Snip Store catalog and one-time lifetime license records.
-- Existing Snip AI tables/functions are intentionally left intact.

create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  short_description text not null,
  description text not null,
  details text not null default '',
  price_inr integer not null check (price_inr > 0),
  icon text not null default '',
  platform text not null default 'Windows desktop',
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  screenshot_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(screenshot_urls) = 'array'),
  download_url text,
  release_label text not null default 'Latest release',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_orders (
  order_id text primary key,
  product_id uuid not null references public.store_products(id),
  customer_email text not null,
  customer_phone text not null,
  amount_inr integer not null check (amount_inr > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created' check (status in ('created','pending','paid','failed','refunded')),
  claim_token_hash text not null,
  payment_session_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_orders_email_created_idx on public.store_orders(customer_email, created_at desc);
create index if not exists store_orders_status_created_idx on public.store_orders(status, created_at desc);

create table if not exists public.store_licenses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.store_products(id),
  order_id text not null unique references public.store_orders(order_id),
  key_hash text not null unique,
  key_last4 text not null,
  status text not null default 'issued' check (status in ('issued','active','revoked')),
  device_hash text,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists store_licenses_product_status_idx on public.store_licenses(product_id, status);
create unique index if not exists store_licenses_single_device_idx on public.store_licenses(product_id, device_hash) where device_hash is not null;

-- Keep activation records for legacy Snip AI keys that predate the shared store.
create table if not exists public.store_legacy_license_devices (
  key_hash text primary key,
  device_hash text not null,
  activated_at timestamptz not null default now()
);

alter table public.store_products enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_licenses enable row level security;
alter table public.store_legacy_license_devices enable row level security;

revoke all on table public.store_products from anon, authenticated;
revoke all on table public.store_orders from anon, authenticated;
revoke all on table public.store_licenses from anon, authenticated;
revoke all on table public.store_legacy_license_devices from anon, authenticated;
grant select, insert, update, delete on table public.store_products to service_role;
grant select, insert, update, delete on table public.store_orders to service_role;
grant select, insert, update, delete on table public.store_licenses to service_role;
grant select, insert, update, delete on table public.store_legacy_license_devices to service_role;

insert into public.store_products
  (slug,name,short_description,description,details,price_inr,icon,platform,features,screenshot_urls,download_url,release_label,sort_order)
values
  ('snip-ai','Snip AI','Your auto clipping tool. Find the moments worth sharing and turn long videos into ready-to-post clips.','Snip AI helps you turn long videos into short, shareable clips. Import a video, let the local workflow find moments, then review your clip set and export.','A focused auto clipping desktop tool. Purchase once, activate with your key and keep using the app.','100','S','Windows desktop',
   '[{"title":"Find shareable moments","description":"Identify promising moments in a longer video and organize them into a clip set."},{"title":"Built for short-form","description":"Prepare clips for common vertical and landscape social formats."},{"title":"Review before export","description":"Preview your cuts and keep the final choices in your hands."},{"title":"Desktop workflow","description":"Run the Snip AI workflow from your Windows computer."}]'::jsonb,
   '["assets/snipai-workspace.svg","assets/snipai-results.svg"]'::jsonb,'https://github.com/rajtyagigi7078-sketch/snipai/releases/latest','Latest GitHub release',10),
  ('capsnip','Capsnip','Make your words pop. Create and style English or Hinglish captions for your videos.','Capsnip turns speech into editable, animated captions. Choose a style, correct the transcript, adjust the look, and export a finished MP4 from your desktop.','A local-first caption editor with typography, Snip AI, mixed and motion graphic caption themes. Purchase once, activate with your key and keep using the app.','250','C','Windows desktop',
   '[{"title":"English + Hinglish captions","description":"Transcribe speech locally and edit timestamped lines before export."},{"title":"62 caption styles","description":"Explore typography, Snip AI, mixed and motion graphic caption themes."},{"title":"Edit as you preview","description":"Change the caption style, font, colors, position and size in the editor."},{"title":"Export MP4","description":"Render a captioned video with your chosen frame and quality."}]'::jsonb,
   '["assets/capsnip-editor.svg","assets/capsnip-style.svg","assets/capsnip-export.svg"]'::jsonb,null,'Capsnip release link to be added',20)
on conflict (slug) do nothing;
