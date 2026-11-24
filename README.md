# Strapi example

This example deploys self-hosted version of [Strapi](https://strapi.io/). Internally it uses a PostgreSQL database to store the data.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/strapi?referralCode=milo)

## ✨ Features

- Strapi
- Postgres

## 💁‍♀️ How to use

- Click the Railway button 👆
- Add the environment variables
- Media will automatically be persisted between deploys!

## 💻 Developing locally

When developing locally this Strapi template will connect to the Postgres server from its public [TCP Proxy](https://docs.railway.app/deploy/exposing-your-app#tcp-proxying)

- Enable the feature flag `Template Service Eject` in the [Feature Flags](https://railway.app/account/feature-flags) menu
- Within the service settings of the Strapi service click the `Eject` button on the upstream repository
- Clone that newly created repository locally
- Install Strapi's dependencies with `yarn install` or `npm install`
- Install the Railway CLI
    - Instructions for that can be found [here](https://docs.railway.app/develop/cli#installation)
    - If this is your first time using the CLI make sure to login with `railway login`
- Within the local repository run `railway link` to link the local repository to the Strapi service on Railway
- Start Strapi for development with `railway run yarn run develop` or `railway run npm run develop`
    - This command will run Strapi in development mode with the service variables available locally
- Open your browser to `http://127.0.0.1:1337/admin`

## 📝 Notes

- After your app is deployed, visit the `/admin` endpoint to create your admin user.
- If you want to use npm with this project make sure you delete the `yarn.lock` file after you have ran `npm install`
## eBook download counts

The site's eBook redirect (`/api/track-click?type=ebook` in `ccr-frontend`) counts each download with
`POST /api/analytics/ebook-downloads` and `{ "documentId": "..." }`. Strapi's own auth applies, so
only the site's full-access API token can call it. One transaction adds the download to the
resource's lifetime `eBookDownloads` field (draft and published rows alike) and to that resource's
count for the day in Cambodia (`ebook_download_days`). It does not publish the resource or fire
webhooks. The first counted download is stored in `ebook_download_tracking`.

PlovPit Insights reads the counts with
`GET /api/analytics/ebook-downloads?from=YYYY-MM-DD&to=YYYY-MM-DD` and
`Authorization: Bearer <INSIGHTS_EXPORT_TOKEN>`. Set `INSIGHTS_EXPORT_TOKEN` on this service to a
random value of at least 32 characters (`openssl rand -hex 32`). Without it the route answers 404,
and no Strapi role or API token can open it. Both dates are required and inclusive, at most 31 days
apart. It returns 400 for invalid dates, 401 for a wrong token and 429 when called too often.

```json
{
  "timeZone": "Asia/Phnom_Penh",
  "days": [
    { "date": "2026-11-25", "books": [{ "id": "<documentId>", "title": "<Khmer title>", "count": 3 }] },
    { "date": "2026-11-26", "books": [] }
  ]
}
```

Only complete days are listed: from the first full Cambodia day after counting began through
yesterday. A listed day without downloads has an empty `books` list. Titles are the Khmer title,
or the English title when there is none, as the PlovPit app and Shop use Khmer titles.

Tests: `npm test`. The SQL tests need a Postgres database:
`TEST_DATABASE_URL=postgres://... npm test` (each run uses and drops its own schema).
