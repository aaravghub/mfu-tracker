# MFU Tracker

Mallakhamb Federation USA management system starter, designed for Cloudflare Pages + Pages Functions + D1. The interface is responsive and uses the MFU orange, blue, and white palette.

## What's new
- **Parent portal**: parents sign in with their email and see only their own children — levels, skill progress, attendance, routines, upcoming evaluations/competitions (with sign-up links), forms & links, and the shop list.
- **Parents page (admin)**: create accounts from the parent emails already on student records in one click, link/unlink children, send invites or password-reset links.
- **Competitions & evaluations**: time, location, details and a sign-up link per event; one-click "Email parents".
- **Links & forms** and **Shop**: admin-managed lists parents see in their portal (liability form, registration, gear to buy, etc.).
- **Email parents**: send a message plus any events, links and shop items to everyone, one center, or specific students. Preview, test send and a send history are built in.
- **Skill progress**: mark each student's skills not started / learning / mastered from the Students page.
- Mobile-friendly menu, nicer cards, and dark mode throughout.

Database changes apply automatically on the first request after deploy — nothing to run by hand.

## Email setup (one time)
Email uses [Resend](https://resend.com) over plain HTTPS (no packages). In Cloudflare Pages → Settings → Variables and Secrets add:
- `RESEND_API_KEY` (secret) — from your Resend account
- `MAIL_FROM` — e.g. `MFU <notifications@yourdomain.org>` (the domain must be verified in Resend)
- optional `MAIL_REPLY_TO` — where parent replies go
- optional `SITE_URL` — e.g. `https://mfu-tracker.pages.dev`, used for links in emails

Until these are set, the Email page still lets you build and preview messages, and parent invites give you links to share manually.

## Included modules
- Four centers: Edison, Princeton, Virginia, Connecticut
- Students and coaches
- Batches and attendance
- Pole, rope, and yoga skill library (levels 1–5)
- Competitions and evaluations
- Student routines
- 1-minute repetition counter and 1:30 routine timer
- Download link for the MFU Common Minimum Program PDF (add the supplied PDF as `public/mfu-common-minimum-program.pdf`)

## Deploy outline
1. Connect this repository to Cloudflare Pages. Build output directory: `public`.
2. Create a D1 database and run `schema.sql` against it.
3. Add the D1 binding named `DB` in Pages settings.
4. Set `ADMIN_PASSWORD` as a Pages secret.
5. Deploy.

## Important
The admin password is still shared. Parent accounts use individual passwords (PBKDF2-hashed), login attempts are rate-limited, and parents can only read data for children linked to their account. Photos are still plain links, and the app has not had an independent security review — review it before storing real children's data.