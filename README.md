# Scout

An AI-assisted shopping MVP built with Next.js 14. It ranks products by price, rating, review volume, sales, and a requested budget, then sends shoppers to the retailer.

## Run locally

```bash
npm install
npm run dev
```

The app runs with a curated demo catalog by default. Copy `.env.example` to `.env.local` and set `SERPAPI_API_KEY` to use live Google Shopping results.

## Production wiring

- Apply `db/schema.sql` to a PostgreSQL database.
- Add `DATABASE_URL` and replace the event boundary in `src/app/api/track/route.ts` with your preferred PostgreSQL client insert.
- Attach approved affiliate links in the product-normalization step in `src/lib/search.ts`. Do not append an affiliate ID until the relevant retailer/network has approved your account.
- Deploy to Vercel and configure the same environment variables in project settings.

## API

`POST /api/search`

```json
{ "query": "best workout shoes under $100" }
```

`POST /api/track` records an outbound retailer click event at the persistence boundary.
