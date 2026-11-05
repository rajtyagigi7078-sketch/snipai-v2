-- Point Snip AI purchases at the verified Windows installer in snipai-v2.
-- Capsnip remains unavailable for checkout until its Windows installer is published.
update public.store_products
set download_url = 'https://github.com/rajtyagigi7078-sketch/snipai-v2/releases/download/v0.1.4-windows-ffmpeg-fix/Snip.AI_0.1.4_x64-setup.exe',
    release_label = 'Snip AI v0.1.4 · Windows installer',
    updated_at = now()
where slug = 'snip-ai';

update public.store_products
set download_url = null,
    release_label = 'Capsnip Windows installer in preparation',
    updated_at = now()
where slug = 'capsnip';
