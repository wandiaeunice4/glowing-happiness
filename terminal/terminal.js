/**
 * EVIE — the terminal's screens.
 *
 * MetaTrader 5 mobile's own layout: five tabs along the bottom, Trade in the
 * middle, the account block above the positions, a "+" in the toolbar for a
 * new order, and a bottom sheet for the order ticket. Tapping a position opens
 * the same short menu the phone app opens.
 *
 * Everything here reads from engine.js and writes back through it. This file
 * owns no money and no prices — only what is on screen.
 *
 * Quotes, Chart and Messages are tabs without screens yet, deliberately: the
 * bar has to carry all five or the shape is wrong, and the two that need a
 * price chart are worth building properly rather than sketching.
 */

(function (global) {
  "use strict";

  var T = global.EvieTerminal;
  if (!T) return;

  var $ = function (id) { return document.getElementById(id); };
  var tab = "trade";
  var menuFor = null;

  /* ── formatting ─────────────────────────────────────────────────────────
     Money always to two places with a thousands separator, prices to the
     instrument's own digits. A terminal that rounds inconsistently reads as
     broken even when the arithmetic is right. */

  function money(n) {
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (n < 0 ? "-" : "") + s;
  }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "-" : "") + money(Math.abs(n)); }
  function px(sym, v) { return Number(v).toFixed(sym.digits); }
  function cls(n) { return n > 0 ? "up" : n < 0 ? "down" : ""; }

  function when(ms) {
    var d = new Date(ms);
    var p = function (x) { return String(x).padStart(2, "0"); };
    return d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ── the Trade tab ─────────────────────────────────────────────────────── */

  function drawAccount() {
    var s = T.summary();
    $("tm-eq").innerHTML = money(s.equity) + "<small>USD</small>";
    var pl = $("tm-pl");
    pl.textContent = s.floating ? signed(s.floating) : "";
    pl.className = "tm-pl num " + cls(s.floating);

    $("tm-bal").textContent = money(s.balance);
    $("tm-mar").textContent = money(s.margin);
    $("tm-free").textContent = money(s.free);
    /* Blank, not "0.00%" and not Infinity: MT5 shows nothing when there is no
       margin in use, because a level with no denominator is not a number. */
    $("tm-lvl").textContent = s.level == null ? "—" : money(s.level) + "%";
  }

  function drawPositions() {
    var ps = T.positions();
    var total = 0;
    ps.forEach(function (p) { total += T.profitOf(p); });

    $("tm-postotal").textContent = ps.length ? signed(Math.round(total * 100) / 100) : "";
    $("tm-postotal").className = "num " + cls(total);

    if (!ps.length) {
      $("tm-pos").innerHTML = '<p class="tm-empty">No open positions</p>';
      return;
    }

    $("tm-pos").innerHTML = ps.map(function (p) {
      var sym = T.symbol(p.symbol);
      var now = p.type === "buy" ? T.bid(sym) : T.ask(sym);
      var profit = T.profitOf(p);
      return '<div class="tm-row" data-ticket="' + p.ticket + '">' +
        '<div class="tm-row-h">' +
          '<span class="tm-sym">' + esc(p.symbol) + "</span>" +
          '<span class="tm-side tm-side--' + p.type + '">' + p.type + " " +
            p.volume.toFixed(2) + "</span>" +
        "</div>" +
        '<div class="tm-sub num">' + px(sym, p.open) + " → " + px(sym, now) + "</div>" +
        '<div class="tm-money num ' + cls(profit) + '">' + signed(profit) + "</div>" +
      "</div>";
    }).join("");
  }

  /* ── the History tab ───────────────────────────────────────────────────── */

  function drawHistory() {
    var ds = T.deals();
    var total = 0;
    ds.forEach(function (d) { total += d.profit; });
    $("tm-histotal").textContent = ds.length ? signed(Math.round(total * 100) / 100) : "";
    $("tm-histotal").className = "num " + cls(total);

    if (!ds.length) {
      $("tm-hist").innerHTML = '<p class="tm-empty">No history</p>';
      return;
    }

    $("tm-hist").innerHTML = ds.map(function (d) {
      /* A deposit has no symbol and no direction, and MT5 lists it in the same
         column as the trades with the word "balance" where the volume goes. */
      if (d.type === "balance") {
        return '<div class="tm-row">' +
          '<div class="tm-row-h"><span class="tm-sym">Balance</span></div>' +
          '<div class="tm-sub num">' + when(d.closeTime) + "</div>" +
          '<div class="tm-money num ' + cls(d.profit) + '">' + signed(d.profit) + "</div>" +
        "</div>";
      }
      var sym = T.symbol(d.symbol) || { digits: 2 };
      return '<div class="tm-row">' +
        '<div class="tm-row-h">' +
          '<span class="tm-sym">' + esc(d.symbol) + "</span>" +
          '<span class="tm-side tm-side--' + d.type + '">' + d.type + " " +
            d.volume.toFixed(2) + "</span>" +
        "</div>" +
        '<div class="tm-sub num">' + px(sym, d.open) + " → " + px(sym, d.close) +
          "  ·  " + when(d.closeTime) + "</div>" +
        '<div class="tm-money num ' + cls(d.profit) + '">' + signed(d.profit) + "</div>" +
      "</div>";
    }).join("");
  }

  /* ── the order ticket ──────────────────────────────────────────────────── */

  function ticketSymbol() { return T.symbol($("tm-osym").value); }

  function drawTicket() {
    if ($("tm-order").hidden) return;
    var s = ticketSymbol();
    if (!s) return;
    $("tm-obid").textContent = px(s, T.bid(s));
    $("tm-oask").textContent = px(s, T.ask(s));
    $("tm-ospread").textContent = s.spread;
  }

  function send(type) {
    var s = ticketSymbol();
    var out = T.open(s.name, type, $("tm-ovol").value, $("tm-osl").value, $("tm-otp").value);
    if (typeof out === "string") return toast(out);

    closeSheet("tm-order");
    /* The wording the terminal uses on a fill, and the same amount of it. */
    toast(type + " " + out.volume.toFixed(2) + " " + s.name + " at " + px(s, out.open));
    go("trade");
    draw();
  }

  function fillSymbols() {
    $("tm-osym").innerHTML = T.symbols().map(function (s) {
      return '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>";
    }).join("");
  }

  /* ── sheets ────────────────────────────────────────────────────────────── */

  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }

  function openMenu(ticket) {
    menuFor = ticket;
    var p = T.positions().filter(function (x) { return x.ticket === ticket; })[0];
    if (!p) return;
    var s = T.symbol(p.symbol);
    $("tm-menu-h").textContent = p.symbol + ", " + p.type + " " + p.volume.toFixed(2) +
      ", #" + p.ticket;
    $("tm-msl").value = p.sl ? px(s, p.sl) : "";
    $("tm-mtp").value = p.tp ? px(s, p.tp) : "";
    openSheet("tm-posmenu");
  }

  /* ── the toast ─────────────────────────────────────────────────────────── */

  var toastTimer = null;
  function toast(text) {
    var el = $("tm-toast");
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("on"); }, 2600);
  }

  /* ── tabs ──────────────────────────────────────────────────────────────── */

  function go(name) {
    tab = name;
    ["quotes", "chart", "trade", "history", "messages"].forEach(function (n) {
      var pane = $("tm-pane-" + n);
      var btn = document.querySelector('.tm-tab[data-tab="' + n + '"]');
      if (pane) pane.classList.toggle("on", n === name);
      if (btn) btn.classList.toggle("on", n === name);
    });
    /* The "+" belongs to Trade. On History it would place an order from a
       screen about orders that are finished. */
    $("tm-new").hidden = name !== "trade";
    $("tm-heading").textContent =
      name === "trade" ? "Trade" :
      name === "history" ? "History" :
      name === "quotes" ? "Quotes" :
      name === "chart" ? "Chart" : "Messages";
    draw();
  }

  function draw() {
    drawAccount();
    if (tab === "trade") drawPositions();
    if (tab === "history") drawHistory();
    drawTicket();
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */

  function bind() {
    fillSymbols();

    document.querySelectorAll(".tm-tab").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-tab")); });
    });

    $("tm-new").addEventListener("click", function () {
      $("tm-osl").value = "";
      $("tm-otp").value = "";
      /* Shown BEFORE it is drawn. drawTicket() declines to work on a hidden
         sheet — that is what keeps the 700ms tick from doing pointless work —
         so drawing first left the pair reading 0 until the next tick. */
      openSheet("tm-order");
      drawTicket();
    });

    $("tm-osym").addEventListener("change", drawTicket);

    /* The stepper works in the instrument's own increments: 0.01 lots is the
       smallest trade anywhere, so that is the step. */
    $("tm-vminus").addEventListener("click", function () {
      var v = Math.max(0.01, Math.round((Number($("tm-ovol").value) - 0.01) * 100) / 100);
      $("tm-ovol").value = v.toFixed(2);
    });
    $("tm-vplus").addEventListener("click", function () {
      var v = Math.round((Number($("tm-ovol").value) + 0.01) * 100) / 100;
      $("tm-ovol").value = v.toFixed(2);
    });

    $("tm-sell").addEventListener("click", function () { send("sell"); });
    $("tm-buy").addEventListener("click", function () { send("buy"); });

    $("tm-pos").addEventListener("click", function (e) {
      var row = e.target.closest(".tm-row");
      if (row) openMenu(Number(row.getAttribute("data-ticket")));
    });

    $("tm-close").addEventListener("click", function () {
      var p = T.positions().filter(function (x) { return x.ticket === menuFor; })[0];
      var profit = T.close(menuFor);
      closeSheet("tm-posmenu");
      if (profit != null && p) toast("Closed " + p.symbol + "  " + signed(profit));
      draw();
    });

    $("tm-save").addEventListener("click", function () {
      T.modify(menuFor, $("tm-msl").value, $("tm-mtp").value);
      closeSheet("tm-posmenu");
      toast("Position modified");
      draw();
    });

    /* Every sheet closes on its own backdrop and on its Cancel, which is the
       two ways a phone user expects to get out of one. */
    document.querySelectorAll(".tm-sheet").forEach(function (sh) {
      sh.addEventListener("click", function (e) { if (e.target === sh) sh.hidden = true; });
    });
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { closeSheet(b.getAttribute("data-close")); });
    });

    $("tm-drawer").addEventListener("click", function () { openSheet("tm-side"); });

    $("tm-deposit").addEventListener("click", function () {
      var v = prompt("Deposit", "1000");
      if (v == null) return;
      T.deposit(v);
      closeSheet("tm-side");
      toast("Balance updated");
      draw();
    });

    $("tm-reset").addEventListener("click", function () {
      T.reset();
      closeSheet("tm-side");
      toast("Account reset");
      draw();
    });

    $("tm-exit").addEventListener("click", function () { global.location.href = "/mt5.html"; });

    go("trade");

    /* The tape. Fast enough that a position's profit visibly moves, slow
       enough that the numbers can be read while they do. */
    setInterval(function () { T.step(); draw(); }, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})(window);
