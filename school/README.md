# Safe Swimming School app

Installable lesson app for private 30 minute lessons at each family's pool in Palm Beach County. It is a separate app from the marketing site in the repo root. The Astro site does not build or publish this folder.

This pull request does not deploy anything.

## What is running

- **Front end:** static files in `public/`, ready for a separate Cloudflare Pages project. The app is a PWA (web manifest, service worker, home screen name).
- **API:** Cloudflare Worker in `src/`.
- **Database:** Cloudflare D1. Local development uses a local database only.
- **Local preview:** Wrangler serves `public/` and the Worker together on one origin, with `/api/*` handled by the Worker. That matches a later production setup where Pages serves the site and a Worker route serves `/api/*` on the same hostname.

## Beta accounts

Practice data, not live customer data.

| Who | Email | Roles |
| --- | --- | --- |
| Anson Ainsworth | `anson@example.com` | Instructor and admin |
| Henry's family | `henry.family@example.com` | Parent |

The second family is not in this build. Henry is stored by first name only. The family shares one lesson count.

While email delivery is still a stub, the sign in screen shows preview accounts and a preview link. Turn `EXPOSE_DEV_MAGIC_LINK` off before any public URL.

## Run it locally

Node 20.

```bash
cd school
npm ci
npm test
npm run dev
```

Open `http://127.0.0.1:8787`.

`npm run dev` applies the D1 migrations to the local database, then starts Wrangler. Nothing is deployed.

Optional API check, with the dev server already running:

```bash
npm run smoke
```

## Screens

- **Parent:** upcoming lessons and the shared lessons left count. Only this family's instructor is shown.
- **Instructor:** today's lessons, the pool address, and clock in / clock out. The phone location must be within the radius. On this preview build, "Use the pool location for this preview" stands in for GPS. Turn `ALLOW_PREVIEW_LOCATION` off before any public URL.
- **Admin:** on time report (actual start and end against the schedule) and an undo for the lesson count. Settings for the radius, the late threshold, automatic subtraction, and the later 10 minute text are on this screen.

A lesson is late when the actual time is more than 5 minutes after the scheduled time. Clock in radius defaults to 100 yards. Clock out subtracts one lesson from the family count and writes that count through the lesson tracker adapter. Undo adds it back and writes again.

## Defaults

| Setting | Default |
| --- | --- |
| App name | Safe Swimming School |
| Clock in radius | 100 yards |
| Late threshold | 5 minutes |
| Subtract a lesson at clock out | On |
| Text when the instructor is about 10 minutes away | On, sent in the live location phase |
| Time zone | America/New_York |
| Raw location retention | 24 hours, fixed |

Admin can change the first four choices in the app after the first boot. Those values are stored in D1. The env vars below are the values used when the local database is first created.

## Data sources

`DATA_SOURCE=mock` is the working path. Lessons and the opening balance are practice data:

- Calendar name: **Anson Ainsworth Swim** (`CALENDAR_NAME`, `CALENDAR_ID` empty until the real calendar id is known).
- Lesson tracker sheet: `LESSON_TRACKER_SPREADSHEET_ID` empty. Expected columns from row 2, range `Lesson Tracker!A2:F`: family id, lessons remaining, parent email, child first name, phone, instructor email.
- Yesterday's practice lesson is already clocked and 12 minutes late, so the report has something to show. Its subtraction is already included in the opening count of 8.

Set `DATA_SOURCE` to `google` only after the Calendar and Sheets clients are implemented. The adapters already build the API URLs and refuse to run when config is missing. They do not invent a successful sync.

### Secrets

Never commit secrets. Names only, set later with Wrangler (not in `wrangler.jsonc`):

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put SMS_ACCOUNT_SID
npx wrangler secret put SMS_AUTH_TOKEN
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill those in when they exist. `.dev.vars` is gitignored.

Non secret placeholders live in `wrangler.jsonc` `vars`: service account email, calendar id, spreadsheet id, SMS from number, `SMS_PROVIDER` (`stub` or `twilio`).

## Texts and live location (designed, not built)

The next phase adds:

- An **On my way** action for one lesson and that one family.
- Location points only while the instructor is on the way or on shift.
- Clock out sets the share phase to stopped.
- A parent map with ETA for their instructor only, and an admin map of active shares.
- One text when ETA first drops to the configured minutes (default 10), through `SmsAdapter`. `SMS_PROVIDER=stub` records the text and does not send it. `twilio` is a placeholder that errors until credentials exist.

Tables `en_route_sessions` and `location_points` are already in D1. A scheduled job and each API request delete location points older than 24 hours. Clock in and clock out already update a share session if one exists.

## Production later (do not run for this PR)

1. Create a D1 database: `npx wrangler d1 create safe-swimming-school-app`.
2. Replace `database_id` in `wrangler.jsonc` with the id it prints. The placeholder id is only for local dev.
3. Apply migrations remotely when you are ready: `npx wrangler d1 migrations apply safe-swimming-school-app --remote`.
4. Deploy the Worker from `school/` when you mean to. Do not point it at the marketing site.
5. Create a **new** Pages project for `school/public` (build command can be empty, output directory `school/public` if the root is the repo). Do not change the existing marketing Pages project.
6. Put Pages and the Worker on one hostname so the session cookie stays same origin. A Worker route for `/api/*` on that hostname leaves the rest of the paths to Pages.

Preview location and the preview sign in link must be off on any public hostname.

## Privacy

Plain language page: `/privacy/`.

- Children are first name only.
- Parents see only their own instructor and their own lessons.
- Location is for the trip and the lesson, and it stops at clock out.
- Raw location points are deleted within 24 hours.
- The app does not describe lessons as lifesaving.
