# Working notes for Claude — bb-prototype

Read this before starting work in this folder.

## Git: never try to push from the sandbox

**Claude cannot commit or push. Lesley runs git in her own terminal.**

The sandbox mounts this folder but has no write access to `.git` (it can
create files there but not delete them — probing this leaves stray files
that Lesley then has to clean up by hand) and it has no GitHub
credentials.

When work is ready to ship, do not run `git add`, `git commit`, or
`git push`. Do not "test whether git works" first. Instead:

1. Run `git status --short` — reading is fine and is genuinely useful.
2. Check whether anything large or unrelated would get swept in.
3. Hand Lesley a ready-to-paste command block for her terminal, with the
   real absolute path and a simple commit message.

Repo: `https://github.com/sprouticus/bb-prototype`, branch `main`.

## Raw photo originals stay out of the repo

Camera originals are 3–33 MB each and there are ~100 MB of them. They
live in `Vehicle History/` and as space-named files in `images/`, and
they are gitignored. Every one has a web-sized JPEG committed in its
place.

When a new original lands: compress to ~1400px wide JPEG, quality 82,
progressive, into `images/` with a lowercase-hyphenated name. Leave the
original where it is — do not move it into `images/`.

## No browser in the sandbox

Chromium can't run here (no root to install its system libraries), so
visual verification has to be indirect:

- **jsdom** (`npm install jsdom` in `/tmp`) actually executes the page's
  scripts. Use it to click things and assert behavior. This is how the
  broken lightbox got caught.
- **PIL composites** are good for checking how a photo will crop at a
  given aspect ratio before committing to a layout.

Do not claim something renders correctly without one of these.

## Don't invent dates, names, or roles

This has bitten twice. Placeholder copy that *looks* factual gets read as
fact by David and Lesley has to walk it back.

- No years on the History page unless confirmed. Captions there are
  deliberately "Text TBD" — don't helpfully fill them in.
- Don't label a photo with a role or model the image doesn't show. If
  the only photos are welding, don't caption one "Quality Inspector."
- The site's convention for unfinished content is visible and
  deliberate: `.photo-pending` boxes, `Placeholder` tags, dashed
  borders. Use them rather than plausible-sounding filler.

## Claims that carry legal weight

"Built in the USA" is an FTC-regulated origin claim, and it now appears
in the homepage hero eyebrow and the Company Purpose H1. Sourcing
(battery cells especially) hasn't been confirmed against the "all or
virtually all" standard. Flag it before it spreads further.

Pre-order copy says "no payment required" and "no card to enter" — both
verified against the actual form, which collects no payment fields. If
the form changes, that copy has to change with it.

## House style

- Comments in HTML/CSS explain *why*, and note what was tried and
  rejected. Removed content gets parked in a comment, not deleted.
- Lesley wants plain, direct language — no marketing polish, no punchy
  contrast structures.
- Prefer a real rebuild over an incremental patch when something isn't
  working.
