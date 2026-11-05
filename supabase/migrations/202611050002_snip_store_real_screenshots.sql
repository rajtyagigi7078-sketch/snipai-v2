-- Use actual captured application screens on the Snip Store product pages.
update public.store_products
set screenshot_urls = '["assets/snipai-01-video-import.png","assets/snipai-02-clip-setup.png","assets/snipai-04-generated-clips.png","assets/snipai-03-generation-progress.png"]'::jsonb,
    updated_at = now()
where slug = 'snip-ai';

update public.store_products
set screenshot_urls = '["assets/capsnip-editor-real.png","assets/capsnip-home-real.png","assets/capsnip-export-real.png"]'::jsonb,
    updated_at = now()
where slug = 'capsnip';
