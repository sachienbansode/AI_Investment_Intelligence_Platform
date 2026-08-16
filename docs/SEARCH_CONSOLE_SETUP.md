# Google Search Console — verify & index NIYTRI (dev-invest.niytri.com)

Goal: get the live site discovered by Google so "niytri" / "niytri ai" stop autocorrecting
and start showing NIYTRI. Do this once; it is the single biggest step. ~20–30 min.

Property to add now: **https://dev-invest.niytri.com** (the live host).
(When invest.niytri.com goes live, repeat for it and 301 dev -> prod.)

---

## A. Add the property
1. Go to https://search.google.com/search-console and sign in with the Google account you
   want to OWN this (use a company Google account you will keep — not a personal throwaway).
2. Click the property dropdown (top-left) -> **Add property**.
3. You get two choices:
   - **Domain** (niytri.com) — covers every subdomain, but verification is DNS-only.
   - **URL prefix** (https://dev-invest.niytri.com) — this one, simplest to verify.
   Choose **URL prefix**, type `https://dev-invest.niytri.com`, click **Continue**.

## B. Verify ownership — pick ONE method

### Method 1 — HTML file (recommended; you control the web server)
1. Search Console shows a file like `google1a2b3c4d5e.html` to download. Download it.
2. Put it in the site so it deploys at the root. Easiest: drop it in
   `frontend/public/` (Vite copies /public/* to the site root on build).
   -> **You can just paste me the file name + its contents and I'll add it to the repo
      for you**, then you deploy.
3. Deploy (build + copy dist — same commands we use). Confirm it loads:
   open `https://dev-invest.niytri.com/google1a2b3c4d5e.html` — it should show the token text.
4. Back in Search Console, click **Verify**.
   (Leave the file in place forever — do not delete it.)

### Method 2 — HTML meta tag (also easy)
1. Search Console gives a tag like
   `<meta name="google-site-verification" content="XXXXXXXX" />`.
2. Paste me the `content="..."` value and I'll add the tag to `index.html <head>`; deploy;
   click **Verify**.

### Method 3 — DNS TXT (needs access to niytri.com DNS)
1. Search Console gives a TXT record value.
2. In your domain registrar / DNS host for niytri.com, add a TXT record on the root
   (`@`) with that value. Wait a few minutes for propagation, then **Verify**.

## C. Submit the sitemap
1. In Search Console left menu -> **Sitemaps**.
2. Under "Add a new sitemap", type: `sitemap.xml`  (the full URL becomes
   https://dev-invest.niytri.com/sitemap.xml). Click **Submit**.
3. Status should become "Success" within minutes–hours.

## D. Force the homepage into the index
1. Top search bar in Search Console: paste `https://dev-invest.niytri.com/` and press Enter
   (this is **URL Inspection**).
2. Click **Request indexing**. This pushes Google to crawl it soon (hours–days) instead of
   waiting to discover it.

## E. Bing (5 min, free extra traffic)
1. https://www.bing.com/webmasters -> sign in -> **Import** from Google Search Console
   (one click brings the verified site + sitemap over). Done.

---

## What to expect
- Indexing starts within hours–days of "Request indexing".
- Once indexed, **"niytri" and "niytri ai" should climb to the top within ~1–2 weeks** —
  nobody else owns that exact spelling. The "did you mean naitri" note fades as people
  search "niytri" and click your result.
- Check back in Search Console -> **Performance** to watch impressions/clicks appear, and
  -> **Pages** to confirm it's indexed (not "Excluded").

## Next signals to speed brand recognition (after verification)
- Google Business Profile for NIYTRI Technologies.
- Official LinkedIn / X / YouTube pages -> send me the URLs, I'll add them to the site's
  `sameAs` schema so Google links the brand entity.
- A few backlinks (a launch/press post, fintech directories).
