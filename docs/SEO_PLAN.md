# NIYTRI — SEO Plan & Action List

Canonical / indexed domain: **https://invest.niytri.com** (production).
Dev host **dev-invest.niytri.com** must be kept OUT of the index (see step 1).

## What was shipped in code
- `frontend/index.html` — keyword-rich title, meta description, keywords, canonical
  (invest.niytri.com), Open Graph + Twitter cards, and JSON-LD structured data
  (Organization + WebSite + SoftwareApplication). Brand terms covered: **NIYTRI**,
  **NIYTRI AI**, **NIYTRI AI Score**, **NIYTRI Investment Intelligence**,
  **NIYTRI AI Investment Intelligence**.
- `frontend/public/robots.txt` — allows crawl, disallows /api, points to the sitemap.
- `frontend/public/sitemap.xml` — lists the homepage (add more URLs once real routes exist).

## IMPORTANT caveat — this is a JavaScript SPA
The site renders in the browser (React/Vite). Google *can* render JS, but it is slower and
less reliable than real HTML, and Bing/social scrapers are worse at it. The static tags above
are read by everyone, but the page *body* (hero copy, About, spotlight) is only in JS. For
brand searches ("NIYTRI") this is fine; to compete on generic terms you'll want the landing
+ About + a few content pages pre-rendered as static HTML. See "Bigger wins" below.

## Step 1 — keep the dev site out of Google (do this first)
On the **dev-invest** nginx server block only, add a noindex header so the dev copy never
competes with prod for the NIYTRI brand:

```
# in the dev-invest.niytri.com server { } block
add_header X-Robots-Tag "noindex, nofollow" always;
```
Then `sudo nginx -t && sudo systemctl reload nginx`. (Do NOT add this on the prod block.)

## Step 2 — verify ownership & submit (free, ~30 min, biggest early lever)
1. **Google Search Console** (search.google.com/search-console): add invest.niytri.com,
   verify (DNS TXT is easiest), then submit `https://invest.niytri.com/sitemap.xml` and use
   "URL Inspection → Request indexing" on the homepage.
2. **Bing Webmaster Tools**: add the site, import from GSC, submit the sitemap.
3. Watch the "Coverage" and "Performance" reports weekly.

## Step 3 — own the brand ("NIYTRI", "NIYTRI AI Score")
Brand terms are easy to rank #1 for because nobody else competes. To lock it in:
- **Google Business Profile** for NIYTRI Technologies (if you have a registered address) —
  this powers the right-side brand panel.
- Create consistent official profiles (LinkedIn company page, X/Twitter, YouTube) and add
  their URLs to the Organization JSON-LD `sameAs` array in index.html (currently omitted).
- Keep the exact brand string consistent everywhere: "NIYTRI AI Investment Intelligence".
- A short **About/Company** page with the NIYTRI name, what the NIYTRI AI Score is, and
  contact info helps Google form a brand entity.

## Step 4 — compete on generic terms ("stock broking score", "AI stock score India")
These are competitive and won't rank from tags alone — they need content + links + time:
- Publish a small **/learn or /blog** section (real HTML pages, one URL each) answering the
  questions people search: "What is a stock score?", "How AI scores NSE stocks",
  "How to read an AI investment score", "NSE vs BSE explained". Target one phrase per page,
  put it in the H1 and title, 800–1500 words, link to the app.
- Add each new page to sitemap.xml.
- Earn a few **backlinks** — fintech directories, startup/press listings, product-launch
  sites (e.g. a launch post), guest articles. Links from finance/tech sites move generic
  rankings more than anything else.
- Stay **compliant**: never phrase content as buy/sell advice or guaranteed returns; keep
  the "information only, not investment advice" framing. Misleading finance content is both a
  SEBI risk and a Google "Your Money or Your Life" quality risk.

## Step 5 — technical hygiene (helps every keyword)
- **Speed & mobile**: run PageSpeed Insights; the mobile UI fixes already help. Aim for good
  Core Web Vitals (LCP < 2.5s). Compress the big PNGs in /public (NIYTRI-Rupee-Square.png is
  ~1 MB — export a 512px version for the favicon/OG use).
- **Proper OG image**: 1200×630 banner (the current square works but a banner previews better
  on LinkedIn/WhatsApp). Swap the og:image/twitter:image URLs when ready.
- **HTTPS + one canonical host**: 301-redirect the non-canonical variants
  (http→https, and if you keep dev, don't let it serve prod content publicly).
- Validate the structured data at search.google.com/test/rich-results after deploy.

## Bigger wins (when you have time)
- **Pre-render / SSR** the public pages (landing, about, blog). Options: Vite + a prerender
  plugin (vite-plugin-prerender / react-snap) to emit static HTML at build time, or move the
  marketing pages to a static generator. This is the single biggest SEO upgrade for an SPA
  and makes the body text crawlable by everyone, not just Googlebot.
- Real client-side **routes** for /about, /learn/... so each has its own indexable URL,
  its own <title>/description (react-helmet or similar), and a sitemap entry.

## Realistic expectations
- "NIYTRI" / "NIYTRI AI Score" → should reach #1 within days–weeks of indexing (no competition).
- "AI stock score India" / "stock broking score" → weeks–months; needs the content + links above.
- SEO compounds; the tags are the foundation, Search Console + content + links are the engine.
