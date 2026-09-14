/**
 * MT5 EA ACCESS — the request, the decision, and the code.
 *
 * The Evie EA is free but not public: it runs on signals from our own
 * engine, and that goes to the Evie trading community rather than to
 * anyone who finds the page. So the download asks first, the owner checks the
 * ID against the partner list on Deriv, and an approval mints a code.
 *
 * A code is bound to the visitor it was issued to. That binding is the reason
 * it exists: an approved code that worked for anyone who was sent it would be a
 * public download again by the end of the week.
 *
 * Everything here degrades quietly when the database is unreachable, the same
 * way support does. The one exception is verification, which fails CLOSED: no
 * database means no way to prove a code, and an unprovable code is not valid.
 */

const { randomBytes } = require("crypto");
const { select, insert, update, configured } = require("./db");

const TABLE = "evie_ea_requests";

/** Deriv's partner id — the list an account has to appear under. */
const PARTNER_ID = "01a05725-5dec-7bfe-b602-76c3588bb0a6";
/** Where somebody without an account is sent to open one under us. */
const DERIV_SIGNUP = "https://t.deriv.link?t=72ZF9J9GSCF3";
/** Where the client ID is copied from. Plain: the token belongs on signup. */
const DERIV_PROFILE = "https://home.deriv.com/dashboard/profile";
/** What one looks like, so nobody has to guess which number we mean. */
const EXAMPLE_CLIENT_ID = "01a05725-5dec-7bfe-b602-76c3588bb0a6";
/** The file itself, bundled beside the function rather than served from /. */
const EA_FILE = "EvieTraderMT5.mq5";

/* No I, O, 1 or 0 — the alphabet for anything a human copies by eye. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function mintCode() {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `EVIE-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Codes are compared with the shape stripped, so spacing never decides it. */
const normaliseCode = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const row = (d) => d ? ({
  id: d.id, visitorId: d.visitor_id, mt5Login: d.mt5_login, name: d.name, email: d.email,
  status: d.status, code: d.code || null,
}) : null;

const FIELDS = "id,visitor_id,mt5_login,name,email,status,code";

/** Record a new request. Returns its id, or null if it could not be stored. */
async function createRequest(r) {
  if (!configured()) return null;
  const res = await insert(TABLE, {
    visitor_id: r.visitorId, mt5_login: r.mt5Login, name: r.name, email: r.email, page: r.page || null,
  });
  if (!res.ok) { console.error("[ea] could not record request:", res.error); return null; }
  return res.data && res.data[0] ? res.data[0].id : null;
}

/** Tie the request to the Telegram message it became, so a reply can find it. */
async function attachTelegramMessage(id, tgMessageId) {
  if (!configured()) return;
  const res = await update(TABLE, `id=eq.${id}`, { tg_message_id: tgMessageId });
  if (!res.ok) console.error("[ea] could not attach telegram id:", res.error);
}

/** The request a swipe-reply points at, or null if it points elsewhere. */
async function requestForTelegramMessage(tgMessageId) {
  if (!configured()) return null;
  const res = await select(TABLE, `select=${FIELDS}&tg_message_id=eq.${encodeURIComponent(tgMessageId)}&limit=1`);
  if (!res.ok) { console.error("[ea] request lookup failed:", res.error); return null; }
  return row(res.data && res.data[0]);
}

/**
 * This person's request, found from the PERSON rather than the message.
 *
 * A swipe-reply is addressed to one Telegram message, and only the request
 * message itself carries a request. Reply to anything else in the thread and
 * the pointer leads nowhere — so the sender is looked up instead, and their
 * oldest still-pending request is used; failing that, their most recent one
 * of any status, which is what makes re-deciding after the fact work.
 */
async function requestForVisitor(visitorId) {
  if (!configured() || !visitorId) return null;
  const v = encodeURIComponent(visitorId);
  let res = await select(TABLE, `select=${FIELDS}&visitor_id=eq.${v}&status=eq.pending&order=created_at.asc&limit=1`);
  if (res.ok && res.data && res.data[0]) return row(res.data[0]);
  res = await select(TABLE, `select=${FIELDS}&visitor_id=eq.${v}&order=created_at.desc&limit=1`);
  if (!res.ok) { console.error("[ea] visitor request lookup failed:", res.error); return null; }
  return row(res.data && res.data[0]);
}

/**
 * Everything still waiting for a decision, newest first.
 *
 * Needed because tapping the /approve shown in a request sends it as its OWN
 * message with no reply attached — so there is nothing pointing at the request.
 * With one waiting there is no ambiguity, and that is the ordinary case.
 *
 * Somebody who already holds a code is NOT waiting, whatever their newer rows
 * say: the form has no memory of having been answered, so returning to the
 * page fills it in again. Approved is a fact about the person; pending is a
 * fact about the row. Answered-by-hand rows are not waiting either.
 */
async function pendingRequests(limit) {
  if (!configured()) return [];
  const res = await select(TABLE, `select=${FIELDS}&status=eq.pending&answered_at=is.null&order=created_at.desc&limit=${(limit || 20) * 3}`);
  if (!res.ok) { console.error("[ea] pending lookup failed:", res.error); return []; }
  const rows = res.data || [];
  const visitors = [...new Set(rows.map((d) => d.visitor_id).filter(Boolean))];

  const settled = new Set();
  if (visitors.length) {
    const done = await select(TABLE, `select=visitor_id&status=eq.approved&code=not.is.null&visitor_id=in.(${visitors.map(encodeURIComponent).join(",")})`);
    for (const d of (done.ok && done.data) || []) settled.add(d.visitor_id);
  }
  return rows.filter((d) => !settled.has(d.visitor_id)).slice(0, limit || 20).map(row);
}

/** The live code this browser already holds, if any. */
async function approvedCodeFor(visitorId) {
  if (!configured() || !visitorId) return null;
  const res = await select(TABLE, `select=code&visitor_id=eq.${encodeURIComponent(visitorId)}&status=eq.approved&code=not.is.null&order=decided_at.desc&limit=1`);
  if (!res.ok) { console.error("[ea] approved lookup failed:", res.error); return null; }
  return (res.data && res.data[0] && res.data[0].code) || null;
}

/**
 * Take this person's open requests out of the decision queue.
 *
 * Called when the owner answers somebody by hand, or decides about them — a
 * decision is about the person, so it settles every row of theirs. It decides
 * nothing itself: status is untouched. Returns how many rows it covered.
 */
async function markAnswered(visitorId) {
  if (!configured() || !visitorId) return 0;
  const res = await update(TABLE, `visitor_id=eq.${encodeURIComponent(visitorId)}&status=eq.pending&answered_at=is.null`, { answered_at: new Date().toISOString() });
  if (!res.ok) { console.error("[ea] could not mark answered:", res.error); return 0; }
  return (res.data || []).length;
}

/**
 * Approve a request and mint its code. Approving one that already has a code
 * returns the SAME code: the owner tapping /approve twice is not a decision to
 * invalidate what the person was already told.
 */
async function approveRequest(id) {
  if (!configured()) return null;
  const existing = await select(TABLE, `select=code&id=eq.${id}&limit=1`);
  const had = existing.ok && existing.data && existing.data[0] && existing.data[0].code;
  if (had) return had;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mintCode();
    const res = await update(TABLE, `id=eq.${id}`, { code, status: "approved", decided_at: new Date().toISOString() });
    if (res.ok) return code;
    if (!/duplicate|unique|23505/i.test(JSON.stringify(res.error))) { console.error("[ea] approve failed:", res.error); return null; }
  }
  return null;
}

async function declineRequest(id) {
  if (!configured()) return false;
  const res = await update(TABLE, `id=eq.${id}`, { status: "declined", decided_at: new Date().toISOString() });
  if (!res.ok) console.error("[ea] decline failed:", res.error);
  return res.ok;
}

/** How many times this browser has been declined, this decision included. */
async function declineCount(visitorId) {
  if (!configured()) return 0;
  const res = await select(TABLE, `select=id&visitor_id=eq.${encodeURIComponent(visitorId)}&status=eq.declined`);
  return res.ok ? (res.data || []).length : 0;
}

/**
 * Is this code good, and does it belong to the person holding it?
 *
 * Fails closed. "unknown" covers both a code that does not exist and one that
 * was issued to somebody else's browser — telling them apart would let somebody
 * test codes until one answered differently. "not-yours" is only reached when
 * the code matches a request whose visitor is known AND different.
 */
async function checkCode(code, visitorId) {
  if (!configured()) return { ok: false, why: "unavailable" };
  const wanted = normaliseCode(code);
  if (wanted.length < 8) return { ok: false, why: "unknown" };

  const res = await select(TABLE, `select=id,visitor_id,name,code,code_used_at&status=eq.approved&code=not.is.null&limit=500`);
  if (!res.ok) { console.error("[ea] code check failed:", res.error); return { ok: false, why: "unavailable" }; }

  const hit = (res.data || []).find((r) => normaliseCode(r.code) === wanted);
  if (!hit) return { ok: false, why: "unknown" };
  if (hit.visitor_id !== visitorId) return { ok: false, why: "not-yours" };

  if (!hit.code_used_at) {
    const mark = await update(TABLE, `id=eq.${hit.id}`, { code_used_at: new Date().toISOString() });
    if (!mark.ok) console.error("[ea] could not mark code used:", mark.error);
  }
  return { ok: true, name: hit.name || "" };
}

/** How many times this browser has asked recently — a spam brake, not a rule. */
async function recentRequestCount(visitorId, withinMinutes) {
  if (!configured()) return 0;
  const since = new Date(Date.now() - (withinMinutes || 60) * 60000).toISOString();
  const res = await select(TABLE, `select=id&visitor_id=eq.${encodeURIComponent(visitorId)}&created_at=gte.${encodeURIComponent(since)}`);
  return res.ok ? (res.data || []).length : 0;
}

module.exports = {
  PARTNER_ID, DERIV_SIGNUP, DERIV_PROFILE, EXAMPLE_CLIENT_ID, EA_FILE,
  createRequest, attachTelegramMessage, requestForTelegramMessage, requestForVisitor,
  pendingRequests, approvedCodeFor, markAnswered, approveRequest, declineRequest,
  declineCount, checkCode, recentRequestCount, normaliseCode,
};
