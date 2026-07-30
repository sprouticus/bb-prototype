/**
 * BB Engineering — Pre-Order Intake & Order Numbering
 * ---------------------------------------------------
 * Google Apps Script web app. Receives pre-order form posts from
 * bbengineering.us, assigns a sequential order number, logs the row to a
 * Google Sheet, emails the customer, emails BB internally, and (optionally)
 * forwards the lead to HubSpot.
 *
 * SETUP — see RUNBOOK.md, Day 2. Short version:
 *   1. Create a Google Sheet. Extensions > Apps Script. Paste this file.
 *   2. Fill in CONFIG below.
 *   3. Run setupSheet() once (authorize when prompted).
 *   4. Deploy > New deployment > Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the /exec URL into pre-order.html (ORDER_ENDPOINT).
 *
 * IMPORTANT: after ANY edit to this file you must Deploy > Manage deployments
 * > edit > Version: New version. Saving alone does not update the live URL.
 */

// ============================================================
// CONFIG — the only part you should need to edit
// ============================================================

var CONFIG = {
  // Order numbers look like BBE-0001. Change the prefix if you want.
  ORDER_PREFIX: 'BBE-',
  ORDER_PAD: 4,
  START_NUMBER: 1,

  // Internal notification recipients (comma-separated).
  // Swap to orders@bbengineering.us once Google Workspace is live.
  NOTIFY_INTERNAL: 'thethirtyninesteps@gmail.com',

  // Display name on the customer's confirmation email.
  FROM_NAME: 'BB Engineering',

  // Reply-to on the customer email. Swap to info@bbengineering.us when live.
  REPLY_TO: 'thethirtyninesteps@gmail.com',

  // Send the customer a confirmation? Set false to go silent while testing.
  EMAIL_CUSTOMER: true,

  // HubSpot forward. Leave both blank to skip entirely — everything else
  // still works. Fill in once the HubSpot portal exists.
  HUBSPOT_PORTAL_ID: '',
  HUBSPOT_FORM_GUID: '',

  SHEET_NAME: 'Pre-Orders'
};

// Column order for the sheet. Changing this changes the sheet layout.
var COLUMNS = [
  'Timestamp', 'Order Number', 'Status', 'Name', 'Email', 'Phone',
  'Location', 'Ordering For', 'Organization', 'Role', 'Quantity',
  'Primary Use', 'Timeline', 'Accessories', 'Implements',
  'Reference Subtotal', 'Notes', 'How They Heard'
];

// ============================================================
// Web app entry points
// ============================================================

function doPost(e) {
  try {
    var p = (e && e.parameters) ? e.parameters : {};

    // Honeypot: real users never fill this. Bots do. Pretend success.
    if (first(p, 'company_website')) {
      return json({ ok: true, orderNumber: 'BBE-0000' });
    }

    var email = first(p, 'email');
    var name = first(p, 'name');
    if (!email || !name) {
      return json({ ok: false, error: 'Name and email are required.' });
    }

    var order = assignOrderNumber();
    var record = {
      orderNumber: order,
      timestamp: new Date(),
      name: name,
      email: email,
      phone: first(p, 'phone'),
      location: first(p, 'location'),
      orderingFor: first(p, 'pre-order-for'),
      organization: first(p, 'organization'),
      role: first(p, 'role'),
      quantity: first(p, 'quantity'),
      primaryUse: first(p, 'primary-use'),
      timeline: first(p, 'timeline'),
      accessories: all(p, 'accessories'),
      implements: all(p, 'implements'),
      subtotal: first(p, 'reference-subtotal'),
      notes: first(p, 'notes'),
      source: first(p, 'source')
    };

    appendRow(record);

    // Emails and HubSpot must never break the submission. If the customer
    // got a number and we stored the row, the submission succeeded.
    try { if (CONFIG.EMAIL_CUSTOMER) emailCustomer(record); } catch (err) { logError('emailCustomer', err); }
    try { emailInternal(record); } catch (err) { logError('emailInternal', err); }
    try { forwardToHubSpot(record); } catch (err) { logError('forwardToHubSpot', err); }

    return json({ ok: true, orderNumber: order });

  } catch (err) {
    logError('doPost', err);
    return json({ ok: false, error: 'Something went wrong on our end.' });
  }
}

function doGet() {
  return ContentService
    .createTextOutput('BB Engineering order intake is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
// Order numbering
// ============================================================

/**
 * Returns the next sequential order number, e.g. "BBE-0007".
 *
 * LockService serializes this across concurrent submissions. Without it,
 * two people submitting in the same second could both read counter=6 and
 * both be issued BBE-0007. The lock makes read-increment-write atomic.
 */
function assignOrderNumber() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // ms; throws if it can't acquire
  try {
    var props = PropertiesService.getScriptProperties();
    var last = parseInt(props.getProperty('lastOrderNumber'), 10);
    if (isNaN(last)) last = CONFIG.START_NUMBER - 1;

    var next = last + 1;
    props.setProperty('lastOrderNumber', String(next));

    return CONFIG.ORDER_PREFIX + padLeft(next, CONFIG.ORDER_PAD);
  } finally {
    lock.releaseLock();
  }
}

function padLeft(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

// ============================================================
// Sheet
// ============================================================

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  return sheet;
}

/** Run once from the editor to create headers and formatting. */
function setupSheet() {
  var sheet = getSheet();
  sheet.clear();
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  sheet.getRange(1, 1, 1, COLUMNS.length)
    .setFontWeight('bold')
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150); // Timestamp
  sheet.setColumnWidth(2, 100); // Order Number
  sheet.setColumnWidth(3, 110); // Status

  // Status dropdown so David can work the list without typing.
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['New', 'Contacted', 'In Conversation', 'Deposit Paid', 'Closed', 'Withdrawn'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 3, 1000, 1).setDataValidation(statusRule);

  SpreadsheetApp.getActiveSpreadsheet().toast('Sheet ready.', 'BB Engineering', 5);
}

function appendRow(r) {
  var sheet = getSheet();
  if (sheet.getLastRow() === 0) setupSheet();

  sheet.appendRow([
    r.timestamp,
    r.orderNumber,
    'New',
    r.name,
    r.email,
    r.phone,
    r.location,
    prettyOrderingFor(r.orderingFor),
    r.organization,
    r.role,
    r.quantity,
    r.primaryUse,
    r.timeline,
    r.accessories.join('\n'),
    r.implements.join('\n'),
    r.subtotal,
    r.notes,
    r.source
  ]);
}

function prettyOrderingFor(v) {
  if (v === 'myself') return 'Themselves';
  if (v === 'family') return 'A family member';
  if (v === 'organization') return 'An organization';
  return v || '';
}

// ============================================================
// Email
// ============================================================

function emailCustomer(r) {
  var lines = [];
  lines.push('Thank you for reserving an Enabler.');
  lines.push('');
  lines.push('Your reference number is ' + r.orderNumber + '. Please keep it for');
  lines.push('your records and quote it in any correspondence with us.');
  lines.push('');
  lines.push('This reservation does not require payment and does not commit you');
  lines.push('to a purchase. Someone from BB Engineering will follow up to talk');
  lines.push('through configuration, pricing, and timing.');
  lines.push('');
  lines.push('WHAT WE RECEIVED');
  lines.push('----------------');
  lines.push('Reference number:  ' + r.orderNumber);
  lines.push('Name:              ' + r.name);
  if (r.organization) lines.push('Organization:      ' + r.organization);
  if (r.location) lines.push('Location:          ' + r.location);
  if (r.quantity) lines.push('Quantity:          ' + r.quantity);
  if (r.timeline) lines.push('Timeline:          ' + r.timeline);
  if (r.primaryUse) lines.push('Primary use:       ' + r.primaryUse);

  if (r.accessories.length) {
    lines.push('');
    lines.push('Accessories of interest:');
    r.accessories.forEach(function (a) { lines.push('  - ' + a); });
  }
  if (r.implements.length) {
    lines.push('');
    lines.push('Implements of interest:');
    r.implements.forEach(function (i) { lines.push('  - ' + i); });
  }
  if (r.notes) {
    lines.push('');
    lines.push('Your notes:');
    lines.push('  ' + r.notes);
  }

  lines.push('');
  lines.push('Any accessory figures shown are for reference only and are not a quote.');
  lines.push('');
  lines.push('— BB Engineering');
  lines.push('bbengineering.us');

  MailApp.sendEmail({
    to: r.email,
    subject: 'Your Enabler reservation — ' + r.orderNumber,
    body: lines.join('\n'),
    name: CONFIG.FROM_NAME,
    replyTo: CONFIG.REPLY_TO
  });
}

function emailInternal(r) {
  var lines = [];
  lines.push(r.orderNumber + ' — ' + r.name);
  lines.push('');
  lines.push('Email:         ' + r.email);
  lines.push('Phone:         ' + (r.phone || '—'));
  lines.push('Location:      ' + (r.location || '—'));
  lines.push('Ordering for:  ' + prettyOrderingFor(r.orderingFor));
  lines.push('Organization:  ' + (r.organization || '—'));
  lines.push('Role:          ' + (r.role || '—'));
  lines.push('Quantity:      ' + (r.quantity || '—'));
  lines.push('Primary use:   ' + (r.primaryUse || '—'));
  lines.push('Timeline:      ' + (r.timeline || '—'));
  lines.push('How heard:     ' + (r.source || '—'));
  lines.push('');
  lines.push('Accessories:   ' + (r.accessories.join(', ') || '—'));
  lines.push('Implements:    ' + (r.implements.join(', ') || '—'));
  lines.push('Ref subtotal:  ' + (r.subtotal || '—'));
  lines.push('');
  lines.push('Notes:');
  lines.push(r.notes || '—');
  lines.push('');
  lines.push('Sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_INTERNAL,
    subject: '[Pre-Order] ' + r.orderNumber + ' — ' + r.name + (r.organization ? ' (' + r.organization + ')' : ''),
    body: lines.join('\n'),
    name: 'BB Engineering Website',
    replyTo: r.email
  });
}

// ============================================================
// HubSpot (optional — skipped entirely if unconfigured)
// ============================================================

function forwardToHubSpot(r) {
  if (!CONFIG.HUBSPOT_PORTAL_ID || !CONFIG.HUBSPOT_FORM_GUID) return;

  var nameParts = String(r.name).trim().split(/\s+/);
  var firstName = nameParts.shift() || '';
  var lastName = nameParts.join(' ');

  var fields = [
    { name: 'email', value: r.email },
    { name: 'firstname', value: firstName },
    { name: 'lastname', value: lastName }
  ];
  if (r.phone) fields.push({ name: 'phone', value: r.phone });
  if (r.organization) fields.push({ name: 'company', value: r.organization });

  // Order number goes into a custom property if you've created one, and is
  // also duplicated into the standard "message" field as a fallback so it is
  // never lost regardless of HubSpot tier limits.
  fields.push({ name: 'bb_order_number', value: r.orderNumber });

  var summary = [
    'Order number: ' + r.orderNumber,
    'Ordering for: ' + prettyOrderingFor(r.orderingFor),
    'Location: ' + (r.location || '—'),
    'Quantity: ' + (r.quantity || '—'),
    'Timeline: ' + (r.timeline || '—'),
    'Primary use: ' + (r.primaryUse || '—'),
    'Accessories: ' + (r.accessories.join(', ') || '—'),
    'Implements: ' + (r.implements.join(', ') || '—'),
    'Notes: ' + (r.notes || '—')
  ].join('\n');
  fields.push({ name: 'message', value: summary });

  var url = 'https://api.hsforms.com/submissions/v3/integration/submit/' +
    CONFIG.HUBSPOT_PORTAL_ID + '/' + CONFIG.HUBSPOT_FORM_GUID;

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    // If a field doesn't exist in HubSpot yet, HubSpot rejects the whole
    // submission. The row is already safe in the Sheet, so just log it.
    logError('hubspot:' + code, res.getContentText());
  }
}

// ============================================================
// Helpers
// ============================================================

function first(params, key) {
  var v = params[key];
  if (!v || !v.length) return '';
  return String(v[0]).trim();
}

function all(params, key) {
  var v = params[key];
  if (!v) return [];
  return v.map(function (x) { return String(x).trim(); }).filter(String);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError(where, err) {
  console.error('[' + where + '] ' + (err && err.stack ? err.stack : err));
}

// ============================================================
// Test helper — run from the editor, no website needed
// ============================================================

function testSubmission() {
  var fake = {
    parameters: {
      'name': ['Test Person'],
      'email': [CONFIG.NOTIFY_INTERNAL],
      'phone': ['505-555-0142'],
      'location': ['Albuquerque, NM'],
      'pre-order-for': ['organization'],
      'organization': ['Test Parks Department'],
      'role': ['Parks Director'],
      'quantity': ['2'],
      'primary-use': ['Grounds maintenance'],
      'timeline': ['3-6 months'],
      'accessories': ['2" Trailer Hitch Receiver', 'Cargo Lights'],
      'implements': ['Demco: Implement Name 1'],
      'notes': ['This is a test submission.'],
      'source': ['Test']
    }
  };
  var out = doPost(fake);
  Logger.log(out.getContent());
}
