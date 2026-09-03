/**
 * EVIE — the transactions panel.
 *
 * The same account of a session Deriv's own run panel keeps, and now laid out
 * the way theirs is: a two-row grid per contract, with the type spanning both
 * rows on the left, the entry spot above the exit spot in the middle, and the
 * buy price above the profit on the right.
 *
 *     ┌──────────┬─────────────┬────────────┐
 *     │          │ entry spot  │  buy price │
 *     │   type   ├─────────────┼────────────┤
 *     │          │ exit spot   │     P/L    │
 *     └──────────┴─────────────┴────────────┘
 *
 * Runs are separated by a divider, so two sessions in the same list cannot be
 * read as one.
 *
 * Two of those totals are easy to get wrong.
 *
 *   Total payout is what came BACK, not what was staked plus profit. A losing
 *   contract returns nothing at all, so it contributes 0 — otherwise a run of
 *   losses would still show a growing payout, which is nonsense.
 *
 *   Total profit/loss is payout minus stake, and falls out of the other two
 *   rather than being summed separately, so the three can never disagree.
 *
 * On a wide screen it is a rail down the right. On a narrow one it becomes a
 * sheet that rises from the bottom, because the rail would eat half the width
 * a market card needs.
 */

(function (global) {
  "use strict";

  function Txn(opts) {
    this.root = opts.root;
    this.nameOf = opts.nameOf || function (s) { return s; };
    this.rows = [];
    this.bind();
  }

  Txn.prototype.q = function (sel) { return this.root.querySelector(sel); };

  Txn.prototype.bind = function () {
    var self = this;

    var reset = this.q("[data-reset]");
    if (reset) reset.addEventListener("click", function () { self.reset(); });

    // The handle only does anything on the narrow layout, where the panel is a
    // sheet; on the rail it is inert and hidden.
    var handle = this.q("[data-handle]");
    if (handle) {
      handle.addEventListener("click", function () {
        var open = self.root.classList.toggle("is-open");
        handle.setAttribute("aria-expanded", String(open));
      });
    }
  };

  /**
   * Raise the sheet, hold it long enough to read, then put it back.
   *
   * Only on the narrow layout, where the sheet is parked at the bottom and a
   * result would otherwise land out of sight. On the wide layout the rail is
   * already open and there is nothing to do. A second call while a peek is in
   * progress restarts the clock rather than stacking timers.
   */
  Txn.prototype.peek = function (ms) {
    var self = this;
    var handle = this.q("[data-handle]");
    // The handle is only shown on the narrow layout; on the rail it is hidden.
    if (!handle || !handle.offsetParent) return;

    var wasOpen = this.root.classList.contains("is-open");
    clearTimeout(this.peekTimer);
    if (wasOpen) return;            // already showing; nothing to reveal

    this.root.classList.add("is-open");
    handle.setAttribute("aria-expanded", "true");

    this.peekTimer = setTimeout(function () {
      self.root.classList.remove("is-open");
      handle.setAttribute("aria-expanded", "false");
    }, ms || 3800);
  };

  Txn.prototype.reset = function () {
    this.rows = [];
    this.render();
  };

  Txn.prototype.add = function (r) {
    this.rows.unshift(r);
    // A session can run long; the panel keeps what a person would scroll.
    if (this.rows.length > 200) this.rows.pop();
    /* Only this render paints the top row as arriving. render() rebuilds the
       whole list, so without the flag every row would slide in again each time
       a trade settled — a panel that jumps rather than one that receives. */
    this.arriving = true;
    this.render();
    this.arriving = false;
  };

  /**
   * Totals for one bot run, or for everything when no run is named.
   *
   * The bot reads its figures from here rather than keeping its own running
   * count. A separate tally is a tally that can drift — miss one result and it
   * reports a loss the ledger says was recovered.
   */
  Txn.prototype.totalsFor = function (run) {
    var stake = 0, payout = 0, won = 0, lost = 0, n = 0;
    this.rows.forEach(function (r) {
      if (r.run !== run) return;
      n++;
      stake += r.stake || 0;
      payout += r.payout || 0;
      if (r.win) won++; else lost++;
    });
    return { stake: stake, payout: payout, trades: n, won: won, lost: lost, profit: payout - stake };
  };

  Txn.prototype.totals = function () {
    var stake = 0, payout = 0, won = 0, lost = 0;
    this.rows.forEach(function (r) {
      stake += r.stake || 0;
      payout += r.payout || 0;
      if (r.win) won++; else lost++;
    });
    return {
      stake: stake,
      payout: payout,
      runs: this.rows.length,
      won: won,
      lost: lost,
      profit: payout - stake
    };
  };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function usd(n) {
    return Number(n || 0).toFixed(2) + " USD";
  }

  /* The two spot markers: a filled dot for where the contract came in, a ring
     for where it went out. Deriv's own run panel marks them the same way, and
     the pair is what tells the two lines apart at a glance without a label on
     either of them. */
  var DOT_IN =
    '<svg class="tx-mk" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">' +
    '<circle cx="5" cy="5" r="4" fill="currentColor"/></svg>';
  var DOT_OUT =
    '<svg class="tx-mk" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">' +
    '<circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

  /* The market tile carries the index's number — R_75 reads "75" — because
     that is the only part of the name that changes. */
  function marketMark(sym) {
    var m = /(\d+)/.exec(String(sym || ""));
    return m ? m[1] : "?";
  }

  /* The trade type's own two letters, in the type's own colour: the same
     colour language the cards and their buttons already use, so a row is
     recognisable as the trade it came from. */
  function typeMark(label) {
    return String(label || "?").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  }

  Txn.prototype.render = function () {
    var self = this;
    var body = this.q("[data-rows]");
    var t = this.totals();

    var html = "";
    if (this.rows.length) {
      var lastRun;
      this.rows.forEach(function (r, i) {
        /* A divider where the run changes, so a fresh session cannot be read
           as a continuation of the one above it. Never before the first row. */
        if (i > 0 && r.run !== lastRun) {
          html += '<li class="tx-div" aria-hidden="true"><span></span></li>';
        }
        lastRun = r.run;

        var cls = "tx" + (i === 0 && self.arriving ? " tx--in" : "");
        html +=
          '<li class="' + cls + '">' +
            '<span class="tx-type">' +
              '<span class="tx-tile tx-tile--mkt" title="' + esc(self.nameOf(r.market)) + '">' +
                esc(marketMark(r.market)) +
              "</span>" +
              '<span class="tx-tile tx-tile--' + esc(r.type || "even") + '" title="' + esc(r.label) + '">' +
                esc(typeMark(r.label)) +
              "</span>" +
            "</span>" +

            '<span class="tx-entry">' + DOT_IN +
              "<b>" + esc(r.entry == null ? "—" : r.entry) + "</b>" +
            "</span>" +
            '<span class="tx-exit">' + DOT_OUT +
              "<b>" + esc(r.exit == null ? "—" : r.exit) + "</b>" +
            "</span>" +

            '<span class="tx-stake">' + usd(r.stake) + "</span>" +
            /* The sign is the stylesheet's, off the win/loss class, so the
               figure itself is always the amount and never carries one. */
            '<span class="tx-pl ' + (r.win ? "tx-pl--win" : "tx-pl--loss") + '">' +
              usd(Math.abs(r.profit || 0)) +
            "</span>" +
          "</li>";
      });
    } else {
      html = '<li class="tx-none">No transactions yet.</li>';
    }
    body.innerHTML = html;

    this.q("[data-stake]").textContent = usd(t.stake);
    this.q("[data-payout]").textContent = usd(t.payout);
    this.q("[data-runs]").textContent = t.runs;
    this.q("[data-lost]").textContent = t.lost;
    this.q("[data-won]").textContent = t.won;

    var pl = this.q("[data-pl]");
    pl.textContent = (t.profit >= 0 ? "+" : "") + usd(t.profit);
    pl.className = "sum-v " + (t.profit > 0 ? "is-up" : t.profit < 0 ? "is-down" : "");

    var badge = this.q("[data-count]");
    if (badge) badge.textContent = t.runs ? t.runs : "";
  };

  global.EvieTxn = Txn;
})(window);
