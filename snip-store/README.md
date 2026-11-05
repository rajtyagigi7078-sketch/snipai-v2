# Snip Store

Static Netlify storefront for Capsnip and Snip AI. The site uses the dedicated `snip-store` Supabase project for the public catalog, Cashfree checkout and lifetime license functions. No app password or OTP login is part of this store flow.

## Netlify

Connect the Snip AI GitHub repository and set Netlify's **base directory** to `snip-store`. No build command is needed; publish directory is `.`. The config is in this folder. Do not expose any Cashfree secret or Supabase service-role key in `store-config.js`.

## Supabase setup

1. Apply `../supabase/migrations/202611040001_snip_store.sql` to the dedicated `snip-store` project (`lhwvxzumettopbydrysl`, ap-south-1). This migration has already been applied there.
2. Deploy `store-catalog`, `store-create-order`, `store-verify-order`, and `store-activate-license` Edge Functions with JWT verification disabled. Also deploy `store-cashfree-webhook` and register its URL in Cashfree. The catalog and checkout are public; key activation binds a key to one device.
3. Configure `STORE_SITE_URL=https://sinpai1.netlify.app`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENVIRONMENT=sandbox`, and a stable random `STORE_LICENSE_SECRET` in the new project's Edge Function secrets. `SUPABASE_URL` and the server-side secret key are provided to Edge Functions by Supabase. Orders set their own signed Cashfree webhook URL; payment success returns to `/payment-success.html` on the same site.
4. Keep `store-config.js` limited to the Supabase project URL and publishable key. The publishable key is intentionally public; database writes and payment confirmation are server-side only.
5. In Supabase Table Editor, update `store_products.price_inr`, descriptions, screenshot URLs and `download_url` whenever needed. Prices are read from the catalog at runtime; changing a price does not require a site code edit or redeploy.

## Product downloads and preview images

Snip AI points to the latest GitHub release page. Set the Capsnip product's `download_url` to its GitHub release after publishing the installer. The purchase page only reveals that URL after payment confirmation. GitHub release URLs are public once copied, so the activation key—not obscurity of the download link—is the actual product gate.

The included interface previews are clean product mockups. Replace their URLs in `store_products.screenshot_urls` with real, brand-safe app screenshots before the public launch.

Before building the next Snip AI installer, set `VITE_LICENSE_WEBSITE_URL` in its `.env` to `https://sinpai1.netlify.app/product.html?product=snip-ai`. The local `.env` has been updated for the new project and target domain.

## Local preview

Open `index.html` directly for the static layout. Checkout and paid confirmation require the deployed Supabase Functions, a Cashfree sandbox/live configuration, and the corresponding Edge Function secrets. Set `cashfreeMode` to `sandbox` while testing with Cashfree test credentials. Desktop key activation also needs the migration and `store-activate-license` function deployed.
