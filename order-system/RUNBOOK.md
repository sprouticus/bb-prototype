# BB Engineering — One-Week Launch Runbook

**Goal:** bbengineering.us serving the new static site, with a working pre-order form that issues sequential order numbers, emails the customer, and logs to a Google Sheet.

**Total new cost: $0.** Hosting is free (GitHub Pages), the order system is free (Google Apps Script + Sheets). The only spend is Google Workspace at $6/user/month, which is already planned and independent of this.

---

## The one thing that can blow the deadline

DNS. GitHub takes **24–48 hours after DNS propagates** to issue the SSL certificate. Until it does, the site loads with a browser security warning.

**So DNS happens Monday, not Friday.** Everything else on this list can slip a day; this cannot. If you get GoDaddy access on Wednesday, the realistic launch is the following Monday — plan around that honestly rather than launching without HTTPS.

---

## Day 1 (Mon) — DNS, low-risk order

Do `www` first. It does not touch the live Wix site, so you can verify the whole hosting path with zero downtime, then flip the apex last.

**1. Add a CNAME file to the repo root** (a file literally named `CNAME`, no extension), containing one line:

```
www.bbengineering.us
```

Commit and push. Then in the repo: Settings → Pages → Custom domain → `www.bbengineering.us`.

**2. At GoDaddy, add only this record:**

| Type | Host | Points to | TTL |
|---|---|---|---|
| CNAME | `www` | `sprouticus.github.io` | 600 |

**3. Check for CAA records.** If any CAA record exists on the domain, at least one must permit `letsencrypt.org` or GitHub cannot issue the certificate. If there are no CAA records at all, you're fine — that's the common case.

**4. Wait, then verify** `https://www.bbengineering.us` loads with a valid padlock. This is the moment of truth. The Wix site is still live at the apex the entire time, so nothing is broken for visitors.

**5. Only after www works, flip the apex.** Replace the Wix A record with all four:

| Type | Host | Points to |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Then set the repo's custom domain to `bbengineering.us` and update the `CNAME` file to match. GitHub automatically secures the other of the apex/www pair. Tick **Enforce HTTPS** in repo settings once it becomes available.

> Coordinate with Google Workspace: MX, SPF, DKIM, and DMARC records are all in the Technology Infrastructure Plan §2. Do them in the same GoDaddy session — one login, one propagation wait.

---

## Day 2 (Tue) — Order system

You're at the Berlin photo shoot at 1:00 PM, so do this in the morning.

1. Create a Google Sheet named **BB Engineering — Pre-Orders**.
2. **Extensions → Apps Script.** Delete the placeholder, paste in `order-system/Code.gs`.
3. Edit the `CONFIG` block at the top — mainly `NOTIFY_INTERNAL` and `REPLY_TO`. Leave the HubSpot fields blank for now; the script skips HubSpot entirely when they're empty.
4. Run `setupSheet()` once. Google will prompt for authorization — you'll hit an "unverified app" screen, which is expected for your own script: click **Advanced → Go to (project name)**.
5. Run `testSubmission()`. Confirm a row appears, you get the internal email, and the numbering starts at `BBE-0001`.
6. **Deploy → New deployment → Web app.** Execute as **Me**, Who has access **Anyone**. Copy the `/exec` URL.
7. Paste that URL into `pre-order.html` as `ORDER_ENDPOINT` (near the bottom, in the submission block). Push.

> **After any future edit to `Code.gs`:** Deploy → Manage deployments → edit → Version: **New version**. Saving the file alone does *not* update the live URL. This trips up everyone once.

**Known limitation while Workspace is pending:** confirmation emails will send from your personal Gmail address, and consumer Gmail caps at ~100 recipients/day. Both are fine at your volume. Once `orders@bbengineering.us` exists, change two lines in `CONFIG` and redeploy.

---

## Day 3 (Wed) — Content blockers

These are already flagged in Notion and are genuinely launch-blocking:

- **Implement checkboxes are placeholders.** `pre-order.html` currently offers `"Demco: Implement Name 1"`, `"Wolf Creek: Implement Name 2"`, and so on, all priced `TBD`. If you launch as-is, customers will select these and they will appear verbatim in their confirmation email. **Either populate real names and prices, or hide the implements step for v1.** Hiding it is the faster call and costs nothing — it's a nice-to-have on a reservation form.
- **Catch and Release copy is known-inaccurate** (July 25 notes — it described the page layout rather than the mechanism). Your own plan has the rewrite landing late next week, after Tuesday's photos. Launching without that page is fine; launching with wrong copy about your differentiating feature is not.
- **Price display is unresolved** ($32,500 vs ~$40,000, open since June 30). The PRD's own fallback applies: show no price, use "schedule a conversation for pricing."
- **`pre-order.html` meta description says "Enabler 2.1."** Decide whether the public site uses version numbers at all before this gets indexed.

---

## Day 4 (Thu) — QA

- Submit the real form end to end on a phone. Confirm: sequential number, Sheet row, customer email, internal email.
- Submit twice in quick succession from two devices — numbers must not collide. (The script uses a lock; this verifies it under real conditions.)
- Submit with the honeypot filled via devtools — should silently succeed and record nothing.
- Every page: no horizontal scroll at 375px, hamburger nav opens, one `<h1>`.
- Padlock on every page, no mixed-content warnings.
- Custom 404.

---

## Day 5 (Fri) — Go live

- Confirm the apex resolves to GitHub Pages and **Enforce HTTPS** is on.
- Retire the Wix site so it can't be reached or indexed.
- Google Search Console: add the property, submit `sitemap.xml`.
- Add GA4 if the tag exists; don't block launch on it.
- Tell David the order numbers start at `BBE-0001` and live in the Sheet, and send him the Sheet link.

---

## Deliberately not in this week

Astro, Sanity, Netlify, n8n, Stripe, and HubSpot automation are all still the right medium-term plan — they're just not what gets you live in five days. Nothing here blocks any of them:

- **HubSpot** — when the portal exists, fill in two IDs in `CONFIG` and the script starts forwarding every lead automatically. No site change.
- **Astro** — the migration is mechanical whenever there's time; `styles.css` carries over unchanged.
- **Netlify** — if you later want preview URLs, moving from GitHub Pages is a DNS change and nothing else.
- **Stripe** — when deposits start, the order number becomes the human-readable key linking a Stripe payment to a Sheet row.

The one thing worth doing early, outside this week: move the repo from your personal GitHub profile to a **BB Engineering organization** (free). Right now the company's website lives in a personal account, which is a real continuity risk and an awkward conversation later. Transferring is a few clicks and preserves history.
