/**
 * The support bot, and the way back to the person who asked.
 *
 * Support messages arrive in Telegram. To answer one, swipe-reply to it: the
 * reply is delivered to that visitor in the support bubble on the site, usually
 * within seconds. Telegram tells us which message was replied to, and that id
 * is what identifies the visitor — so the swipe is not a nicety, it IS the
 * addressing. A message typed into the chat without replying to anything has no
 * recipient, and the bot says so rather than swallowing it.
 *
 * Telegram posts here from the open internet, so the shared secret it was
 * registered with is checked on every call, and only the owner's own chat is
 * listened to at all.
 */

const {
  readBody, json, supportVisitorFor, supportVisitorById, recordSupportReply, listPeople,
  isBanned, banPerson, unbanPerson, listBans, clearBans,
} = require("./_lib/db");
const { saveTelegramFile } = require("./_lib/files");

const API = "https://api.telegram.org";

async function say(chatId, text, replyTo) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyTo) { payload.reply_to_message_id = replyTo; payload.allow_sending_without_reply = true; }
  await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => { /* nothing useful to do about it here */ });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // 200, not 401: a wrong caller should learn nothing, and Telegram must not
  // start retrying a delivery that was never ours.
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) return json(res, 200, { ok: true });

  const update = await readBody(req);
  const msg = (update && update.message) || null;
  const chatId = msg && msg.chat ? msg.chat.id : null;
  // A photo or a document arrives with `caption` instead of `text`.
  const text = String((msg && (msg.text || msg.caption)) || "").trim();

  if (typeof chatId !== "number") return json(res, 200, { ok: true });
  // A stranger who finds the bot is not someone we want putting words in front
  // of our visitors.
  if (String(chatId) !== process.env.TELEGRAM_CHAT_ID) return json(res, 200, { ok: true });

  const repliedTo = msg.reply_to_message && msg.reply_to_message.message_id;

  /* Who a swipe-reply is for. The visitor's own message (words or picture)
     is the normal target. But a thread on a phone quickly fills with the
     bot's own lines — "Delivered to 3A8ACC6A", the original header with its
     "Person:" id — and swiping on one of those is a reasonable thing to do
     mid-conversation. Every bot message about a person carries their id, so
     it is read back out. */
  async function personBehind(replied) {
    if (!replied) return null;
    const direct = await supportVisitorFor(replied.message_id);
    if (direct) return direct;
    if (!(replied.from && replied.from.is_bot)) return null;
    const m = /\b([0-9A-F]{8})\b/.exec(String(replied.text || replied.caption || ""));
    return m ? supportVisitorById(m[1]) : null;
  }

  /* Telegram gives several sizes of a photo, smallest first; the last is the
     full one. A document keeps its own name and mime type. */
  const photoId = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : null;
  const docId = msg.document && msg.document.file_id;
  const hasFile = !!(photoId || docId);

  // ── a reply to a support message: deliver it, with whatever came attached ──
  if (repliedTo && (text || hasFile) && text[0] !== "/") {
    const who = await personBehind(msg.reply_to_message);

    if (!who) {
      await say(chatId, "That is not a support message, so there is nobody to send it to. Swipe-reply to the message from the person you want to answer.", msg.message_id);
      return json(res, 200, { ok: true });
    }

    /* Fetched and re-hosted before the message is recorded, because a link to
       Telegram's own copy carries our bot token in the URL. A file that would
       not store must not take the words down with it. */
    let file = null;
    if (photoId) file = await saveTelegramFile(photoId, "screenshot.jpg", "image/jpeg");
    else if (docId) file = await saveTelegramFile(docId, msg.document.file_name || "file", msg.document.mime_type);
    const fileFailed = hasFile && !file;

    const stored = (text || file) ? await recordSupportReply(who.visitorId, text, file) : false;
    await say(
      chatId,
      stored
        ? [
            `✅ Delivered to <code>${who.visitorId}</code>. They will see it in the support window on the site${who.email ? ` — ${who.email}` : ""}.`,
            file ? `📎 ${file.name} went with it.` : "",
            fileFailed ? "⚠️ The attachment could not be stored, so only your text went. Try sending the file again." : "",
          ].filter(Boolean).join("\n")
        : fileFailed && !text
          ? "⚠️ That attachment could not be stored, so nothing was sent. Try again in a moment."
          : "⚠️ Could not deliver that just now. Nothing was sent — try again in a moment.",
      msg.message_id,
    );
    return json(res, 200, { ok: true });
  }

  // ── the door: /ban, /unban ──
  //
  // Swipe-reply to somebody's message to act on THEM, or name an email. The
  // swipe-reply is the safer of the two, because it cannot land on the wrong
  // person.
  const doorCmd = /^\/(ban|unban)(?:@[A-Za-z0-9_]+)?\b/i.exec(text);
  if (doorCmd) {
    const banning = /^ban$/i.test(doorCmd[1]);
    const rest = text.slice(doorCmd[0].length).trim();
    let visitorId = null, email = null, reason = rest;

    if (repliedTo) {
      const who = await personBehind(msg.reply_to_message);
      if (!who) {
        await say(chatId, `That is not a support message, so there is nobody to act on. Swipe-reply to a message from the person you mean, or send <code>/${banning ? "ban" : "unban"} their@email</code>.`, msg.message_id);
        return json(res, 200, { ok: true });
      }
      visitorId = who.visitorId; email = who.email;
    } else {
      const named = rest.match(/^(\S+@\S+\.\S+|[A-Za-z0-9-]{6,})\b/);
      if (!named) {
        await say(chatId, `Say who. Swipe-reply to their message, or send <code>/${banning ? "ban" : "unban"} their@email</code>.`, msg.message_id);
        return json(res, 200, { ok: true });
      }
      if (named[1].includes("@")) email = named[1]; else visitorId = named[1];
      reason = rest.slice(named[0].length).trim();
    }

    if (banning) {
      const done = await banPerson({ visitorId, email, reason: reason || null });
      await say(chatId, done
        ? [
            `Banned ${done.email || done.visitorId}.`,
            done.reason ? `Reason: ${done.reason}` : "",
            "",
            "Their messages stop reaching you. Nothing tells them so — the window just goes quiet.",
            `Undo with <code>/unban ${done.email || done.visitorId}</code>.`,
          ].filter(Boolean).join("\n")
        : "Could not record that ban.", msg.message_id);
      return json(res, 200, { ok: true });
    }

    const key = email || visitorId || "";
    const lifted = await unbanPerson(key);
    await say(chatId, lifted
      ? `Unbanned ${lifted.email || lifted.visitorId}. They can write in again. The row stays in <code>/bans</code> so the history is not lost.`
      : `No active ban found for <code>${key}</code>.`, msg.message_id);
    return json(res, 200, { ok: true });
  }

  // ── the list, and emptying it ──
  if (/^\/bans\b/i.test(text)) {
    const arg = text.replace(/^\/bans(?:@[A-Za-z0-9_]+)?/i, "").trim().toLowerCase();
    if (arg === "clear" || arg === "clear lifted" || arg === "clear all") {
      const which = arg === "clear all" ? "all" : "lifted";
      const gone = await clearBans(which);
      await say(chatId, which === "all"
        ? `Cleared the whole list — ${gone} row${gone === 1 ? "" : "s"} deleted. Everyone who was banned is unbanned.`
        : `Cleared ${gone} lifted ban${gone === 1 ? "" : "s"}. Active bans are untouched — <code>/bans clear all</code> removes those too.`, msg.message_id);
      return json(res, 200, { ok: true });
    }
    const rows = await listBans(40);
    if (!rows.length) {
      await say(chatId, "Nobody is banned, and nobody has been.", msg.message_id);
      return json(res, 200, { ok: true });
    }
    const live = rows.filter((r) => r.active);
    await say(chatId, [
      `<b>Bans</b> — ${live.length} active of ${rows.length}`,
      "",
      ...rows.slice(0, 25).map((r) => {
        const who = r.email || r.visitorId || "?";
        const day = String(r.bannedAt).slice(0, 10);
        return r.active
          ? `⛔ <code>${who}</code> — ${day}${r.reason ? ` — ${r.reason}` : ""}`
          : `✓ <code>${who}</code> — banned ${day}, lifted ${String(r.unbannedAt || "").slice(0, 10)}`;
      }),
      rows.length > 25 ? `\n…and ${rows.length - 25} more.` : "",
      "",
      "<code>/bans clear</code> removes the lifted ones, <code>/bans clear all</code> empties it entirely.",
    ].filter(Boolean).join("\n"), msg.message_id);
    return json(res, 200, { ok: true });
  }

  // ── who has written in ──
  if (/^\/users\b/i.test(text)) {
    const people = await listPeople(40);
    if (!people.length) {
      await say(chatId, "Nobody has written in yet.", msg.message_id);
      return json(res, 200, { ok: true });
    }
    // Banned people are marked rather than hidden.
    const marks = await Promise.all(people.map((u) => isBanned(u.visitorId, u.email)));
    await say(chatId, [
      `<b>People</b> — ${people.length}`,
      "",
      ...people.slice(0, 30).map((u, i) => {
        const when = String(u.last).slice(0, 10), since = String(u.first).slice(0, 10);
        return [
          `${marks[i] ? "⛔ " : ""}<b>${u.name || "(no name)"}</b>`,
          `  ${u.email || "(no email)"}`,
          `  ${since === when ? when : `${since} → ${when}`} · ${u.messages} msg${u.messages === 1 ? "" : "s"}`,
        ].join("\n");
      }),
      people.length > 30 ? `\n…and ${people.length - 30} more.` : "",
    ].filter(Boolean).join("\n"), msg.message_id);
    return json(res, 200, { ok: true });
  }

  // ── commands and stray messages ──
  if (/^\/start\b/.test(text)) {
    await say(chatId, [
      "<b>Evie Trader support is connected.</b>",
      "",
      "Messages from the support bubble on evietrader.site arrive here.",
      "",
      "<b>To answer someone, swipe-reply to their message.</b> Your reply appears in their support window on the site within seconds.",
      "",
      "Typing here without replying to a message sends it nowhere — there is no way to tell who it was meant for.",
      "",
      "<b>Screenshots and files:</b> swipe-reply with a photo or a document and it appears in their support window. People can send you both as well.",
      "",
      "<b>Keeping people out:</b> swipe-reply and send <code>/ban</code> (add a reason if you want one recorded), or <code>/ban their@email</code>. Their messages stop reaching you and they are told nothing. <code>/unban</code> lifts it. <code>/bans</code> is the list, <code>/bans clear</code> tidies the lifted ones and <code>/bans clear all</code> empties it.",
      "",
      "<b>Who has written in:</b> <code>/users</code> — names, emails and dates, banned ones marked.",
    ].join("\n"));
  } else if (/^\/(help|status)\b/.test(text)) {
    await say(chatId, "Swipe-reply to a support message to answer it — text, a photo or a document. /ban and /unban control who gets through, /bans is that list, /users is everyone who has written in. A message with no reply attached has no recipient.");
  } else if (hasFile) {
    await say(chatId, "That file went nowhere — I could not tell who it was for. <b>Swipe-reply</b> with it to the message from the person you are answering, and it will appear in their support window.");
  } else {
    await say(chatId, "Nothing was sent — I could not tell who that was for. <b>Swipe-reply</b> to someone's support message to answer them.");
  }

  return json(res, 200, { ok: true });
};
