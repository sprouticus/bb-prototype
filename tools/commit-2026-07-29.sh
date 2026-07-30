#!/usr/bin/env bash
#
# Run this from a normal Terminal, in the repo root — NOT from Cowork.
#
#   cd "/Users/lesley/Claude/Projects/BB Engineering - Website & Marketing"
#   bash tools/commit-2026-07-29.sh
#
# WHY THIS SCRIPT EXISTS
# Git cannot run against this folder from inside the Cowork sandbox. The
# folder is mounted over FUSE, which permits creating and modifying files
# but denies unlink. Git writes .git/index.lock on every operation and
# then removes it; the removal fails, the lock is stranded, and every
# later git command aborts with "Another git process seems to be running".
# Running it locally has none of that problem.
#
# This script stages only the 2026-07-29 work. It deliberately does NOT
# stage several unrelated untracked items — see the end of the file.

set -euo pipefail

# 1. Clear the stale lock left behind by the sandbox, if it is still there.
if [ -f .git/index.lock ]; then
  echo "Removing stale .git/index.lock"
  rm -f .git/index.lock
fi

# 2. Remove scratch files created while testing sandbox write access.
#    The sandbox can create files but not delete them, which is why these
#    were left behind rather than cleaned up in place.
rm -f .writetest tools/ztest

# 3. Stage the edited pages and the stylesheet.
git add \
  accessories.html implements.html pre-order.html enabler-2-0.html \
  index.html contact.html company-purpose.html \
  careers.html catch-and-release.html history.html photos.html \
  schedule-conversation.html specs.html videos.html \
  styles.css

# 4. Stage the new directories and art.
git add tools/ _parked/
git add images/Accessories/ images/Implements/

git status --short

git commit -m "Replace Wix-hosted product art with local normalized thumbnails" -m "\
Removes the last of the static.wixstatic.com hotlinks, which would have
broken the moment the Wix site was taken down.

Catalog
- Accessories: retire 7 Wix-hotlinked cards, add 5 products sourced from
  the accessories sheet. Product links deliberately not published.
- Move the Utility Trailer to Implements under a new B.B. Engineering
  section; it tows behind the vehicle rather than mounting to it.
- Verify Rammy prices against the 11/24/25 dealer sheet. Snowblower 155
  corrected to \$6,399: it is the 120 base plus the 155 wing set, and the
  previous figure had dropped the cents. Lawn Mower and Plow W165 stay as
  Contact us; the sheet prices the plow only as a package with the ST30.

Imagery
- Normalize all 19 product photos to a uniform 700x700 canvas with the
  subject's longest side at 644px, so products read at the same size
  inside the square tiles. Adds tools/make-product-thumbs.py.
- Supersedes make-accessory-thumbs.py, whose bounding box could be
  defeated by a single stray pixel. That bug made the light bar measure
  its own halo, and left the Demco and trailer art untrimmed entirely.
- Replace 5 hotlinked placehold.co images on the company page with local
  Photo Pending boxes; they were captioned with the exact shot intended
  for each slot and depended on a third-party service.

Pre-order form
- Sync step 2 to the Accessories page. West Coast Mirrors had never been
  offered here at all.
- Rebuild step 3, which was entirely placeholder: 13 cards reading
  'Implement Name 1..4' under two brands that do not exist, 'Wolf Creek'
  and 'Kurtz Engineering'.
- Add data-price-label so the review step echoes card prices verbatim
  rather than re-deriving them; fixes missing thousands separators and
  non-numeric prices.

Interaction
- Show price on Implements cards; drop the DETAILS / SPECS & PRICE
  captions and the now-unused .product-note rule.
- Hover-reveal labels on the Enabler accessories carousel and on the
  In the Field and shop photo captions, gated on (hover:hover) so touch
  devices keep them visible.

Content
- Reorder the homepage: Hero, In the Field, Under the Hood, Workhorse,
  Why Now, CTA. Park Trusted Partners in _parked/ rather than deleting.
- Real address on the contact page and in all 14 footers, replacing a
  placeholder.
- Fix the .tag pill on the contact info card, which was styled only for
  .form-card and rendered unstyled."

echo
echo "Committed. Push with:  git push origin main"
echo
echo "NOT staged — these were already untracked and are not part of this work:"
echo "  order-system/                     (deploy runbook, unclear if it should be public)"
echo "  cleanup-unused-images.sh"
echo "  images/Brett with Sparks 7-28-26.jpg"
echo "  images/Guys with sparks.jpg"
echo "  images/Mask and gloves.jpg"
echo "  images/Ramon close up sparks.jpg"
echo
echo "Check order-system/ for credentials or deploy URLs before committing it."
