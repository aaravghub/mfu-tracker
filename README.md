# MFU Tracker

Mallakhamb Federation USA management system starter, designed for Cloudflare Pages + Pages Functions + D1. The interface is responsive and uses the MFU orange, blue, and white palette.

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
This is an initial scaffold, not yet a production-ready system. The admin password is shared, and the parent portal, protected photo uploads, detailed attendance workflows, and curriculum import still require implementation and testing. Do not enter real children's data until security and privacy testing is complete.