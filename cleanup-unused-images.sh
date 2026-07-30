#!/bin/bash
# Removes unreferenced/duplicate image files (~46MB) that were accidentally
# staged in the last commit, then amends that commit so it doesn't get pushed.
# Safe to run: this commit has not been pushed to GitHub yet.
set -e
cd "$(dirname "$0")"

FILES=(
  "images/20251021_134918.jpg"
  "images/20260227_134013.jpg"
  "images/20260714_112739.jpg"
  "images/20260721_125300.jpg"
  "images/Accessories/Driver Seat.png"
  "images/Accessories/Split Windshield.png"
  "images/Accessories/Utility Trailer.png"
  "images/Accessories/west-coast-mirrors-260.png"
  "images/Implements/Demco/Demco Sprayer - 40 gal.png"
  "images/Implements/Demco/Demco Sprayer - 60 gal.png"
  "images/Implements/Demco/Demco Sprayer - 80 gal.png"
  "images/Implements/Demco/demco-logo.png"
  "images/Implements/Kunz/Kunz Rough Cut Mower.png"
  "images/Implements/Kunz/kunz logo.jpg"
  "images/Implements/Rammy/Rammy Brush cutter 120 ATV PRO.png"
  "images/Implements/Rammy/Rammy Flail mower 120 ATV.png"
  "images/Implements/Rammy/Rammy Lawn mower.png"
  "images/Implements/Rammy/Rammy Plow-W165-ATV-PRO.png"
  "images/Implements/Rammy/Rammy Snowblower 155UTV Pro.png"
  "images/Implements/Rammy/rammy_logo.png"
  "images/black buzz buggy.png"
  "images/enabler-build-chassis.jpg"
  "images/enabler-warehouse-bright.png"
  "images/rammy-brush-cutter-120-atv-pro.png"
  "images/rammy-flail-mower-120-atv.png"
  "images/split-windshield-reference.png"
  "images/west-coast-mirrors-260.png"
)

for f in "${FILES[@]}"; do
  git rm --cached --ignore-unmatch -q -- "$f"
  rm -f -- "$f"
  echo "removed: $f"
done

# clean up now-empty subfolders
rmdir "images/Implements/Demco" "images/Implements/Kunz" "images/Implements/Rammy" 2>/dev/null || true

git commit --amend --no-edit
echo ""
echo "Done. New commit size:"
git show --stat HEAD | tail -3
echo ""
echo "Now push with: git push origin main"
