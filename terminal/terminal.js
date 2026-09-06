/**
 * EVIE — the terminal's screens.
 *
 * Rebuilt against screenshots of the app. The details that were wrong the
 * first time and are the whole character of the thing:
 *
 *   · Trade is three dotted-leader figures, not a headline and a stat grid.
 *     Margin and Level join them only once margin is in use, which is what
 *     the app does — an empty account shows three lines, not five.
 *   · A price reads 1.16 **13** ², the last two significant digits large and
 *     the final one raised. Every price on every screen is written that way.
 *   · The tab bar's middle item has no word: it carries the balance in a pill,
 *     and only the icon turns blue when Trade is the screen you are on.
 *   · Each screen brings its own toolbar actions, so the bar is rebuilt on
 *     every change rather than hiding one button.
 *
 * Reads from engine.js and writes back through it; owns no money and no
 * prices, only what is on screen.
 */

(function (global) {
  "use strict";

  var T = global.EvieTerminal;
  if (!T) return;

  var $ = function (id) { return document.getElementById(id); };
  var tab = "trade";
  var seg = "positions";
  var chartSym = "EURUSD";
  var menuFor = null;

  /* ── formatting ─────────────────────────────────────────────────────────
     Money with a space for thousands, the way the app writes 100 000.00. */

  function money(n) {
    var s = Math.abs(Number(n)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (n < 0 ? "-" : "") + s;
  }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "-" : "") + money(Math.abs(n)); }
  function cls(n) { return n > 0 ? "up" : n < 0 ? "down" : ""; }

  /** The balance pill: 100 000 becomes 100K, 2 500 becomes 2.5K. */
  function short(n) {
    var a = Math.abs(n);
    if (a >= 1000000) return Math.round(n / 100000) / 10 + "M";
    if (a >= 10000) return Math.round(n / 1000) + "K";
    if (a >= 1000) return Math.round(n / 100) / 10 + "K";
    return String(Math.round(n));
  }

  /**
   * A price, in the app's own typography: everything but the last three
   * characters at reading size, the next two large, the final one raised.
   * 1.16132 → 1.16 · 13 · 2.
   */
  function priceHtml(v, digits) {
    var s = Number(v).toFixed(digits);
    /* The raised digit is the FRACTIONAL pip, so it only exists where the
       instrument quotes one — three decimals or more. On a two-decimal index
       there is no fractional pip, and taking the last three characters anyway
       drags the decimal point into the large pair: 9214.6 came out as 921 4. 6.
       Two decimals or fewer: the last two digits are large and nothing is
       raised, which is how the app prints them. */
    /* One decimal or none leaves nothing sensible to split — the last two
       characters would straddle the point — so the whole figure is set large. */
    if (digits < 2) return '<span class="px"><b>' + s + "</b></span>";
    if (digits < 3) {
      return '<span class="px">' + s.slice(0, -2) + "<b>" + s.slice(-2) + "</b></span>";
    }
    return '<span class="px">' + s.slice(0, -3) +
      "<b>" + s.slice(-3, -1) + "</b><sup>" + s.slice(-1) + "</sup></span>";
  }

  function clock(ms) {
    var d = new Date(ms);
    var p = function (x) { return String(x).padStart(2, "0"); };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function stamp(ms) {
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

  /** One dotted-leader line. */
  function lead(label, value, klass) {
    return '<div class="tm-lead"><dt>' + esc(label) + "</dt><i></i>" +
      '<dd class="num ' + (klass || "") + '">' + value + "</dd></div>";
  }

  /* ── the toolbars ───────────────────────────────────────────────────────
     Each screen carries its own, so the bar is rebuilt rather than having
     buttons hidden inside it. */

  var ICON = {
    sort: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20V5M5 8l3-3 3 3M16 4v15M13 16l3 3 3-3"/></svg>',
    newOrder: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/></svg>',
    currency: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.4 9.2a2.7 2.7 0 0 0-4.6 1.7c0 2.6 4.8 1.6 4.8 4a2.7 2.7 0 0 1-4.7 1.6"/><path d="M12 6.4v11.2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/><circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="13.5" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>',
    mqid: '<svg viewBox="0 0 34 20" width="34" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="32" height="16" rx="3"/><text x="17" y="13.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="Roboto, Arial, sans-serif">MQID</text></svg>',
    search: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v18M3 12h18"/></svg>',
    indicator: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-7 6-7"/></svg>'
  };

  var BARS = {
    trade:    { title: "Trade",    sub: "",            acts: ["sort", "newOrder"] },
    quotes:   { title: "Quotes",   sub: "",            acts: ["plus", "pencil"] },
    charts:   { title: "",         sub: "",            acts: [] },
    history:  { title: "History",  sub: "All symbols", acts: ["currency", "sort", "calendar"] },
    messages: { title: "Messages", sub: "",            acts: ["mqid", "search"] }
  };

  function drawBar() {
    var b = BARS[tab];
    $("tm-title").textContent = b.title;
    $("tm-sub").textContent = b.sub;
    $("tm-actions").innerHTML = b.acts.map(function (k) {
      return '<button class="tm-ico" type="button" data-act="' + k + '">' + ICON[k] + "</button>";
    }).join("");
    /* The chart's toolbar is its own — a crosshair, an indicator and the
       timeframe where the title would be. */
    if (tab === "charts") {
      $("tm-title").textContent = "";
      $("tm-actions").innerHTML =
        '<button class="tm-ico" type="button">' + ICON.cross + "</button>" +
        '<button class="tm-ico" type="button">' + ICON.indicator + "</button>" +
        '<button class="tm-ico" type="button" style="width:auto;padding:0 10px;font-size:16px;font-weight:500">M5</button>';
    }
  }

  /* ── Trade ─────────────────────────────────────────────────────────────── */

  function drawTrade() {
    var s = T.summary();
    var rows = lead("Balance:", money(s.balance)) +
               lead("Equity:", money(s.equity)) +
               lead("Free margin:", money(s.free));
    /* Margin and Level appear only once there is margin in use — an untouched
       account shows three lines in the app, not five. */
    if (s.margin > 0) {
      rows += lead("Margin:", money(s.margin)) +
              lead("Level:", money(s.level) + "%");
    }
    $("tm-figures").innerHTML = rows;

    var ps = T.positions();
    if (!ps.length) { $("tm-pos").innerHTML = ""; return; }

    $("tm-pos").innerHTML = ps.map(function (p) {
      var sym = T.symbol(p.symbol);
      var now = p.type === "buy" ? T.bid(sym) : T.ask(sym);
      var profit = T.profitOf(p);
      return '<div class="tm-row" data-ticket="' + p.ticket + '">' +
        '<div class="tm-row-h"><b>' + esc(p.symbol) + "</b>" +
          '<span class="' + (p.type === "buy" ? "up" : "down") + '">' +
          p.type + " " + p.volume.toFixed(2) + "</span></div>" +
        '<div class="tm-row-sub num">' + Number(p.open).toFixed(sym.digits) +
          " &rarr; " + Number(now).toFixed(sym.digits) + "</div>" +
        '<div class="tm-row-v num ' + cls(profit) + '">' + signed(profit) + "</div>" +
      "</div>";
    }).join("");
  }

  /* ── Quotes ────────────────────────────────────────────────────────────── */

  function drawQuotes() {
    $("tm-quotes").innerHTML = T.quotes().map(function (q) {
      var dir = cls(q.points);
      return '<div class="tm-q" data-sym="' + esc(q.name) + '">' +
        '<div class="tm-q-chg num"><b>' + (q.points > 0 ? "+" : "") + q.points + "</b> " +
          '<span class="' + dir + '">' + (q.percent > 0 ? "+" : "") +
          q.percent.toFixed(2) + "%</span></div>" +
        '<div class="tm-q-name">' + esc(q.name) + "</div>" +
        '<div class="tm-q-meta num">' + clock(q.time) +
          '<i>&#8866;</i>' + q.spread + "</div>" +
        '<div class="tm-q-px">' + priceHtml(q.bid, q.digits) + priceHtml(q.ask, q.digits) + "</div>" +
        '<div class="tm-q-lh num"><span>L: ' + Number(q.low).toFixed(q.digits) +
          "</span><span>H: " + Number(q.high).toFixed(q.digits) + "</span></div>" +
      "</div>";
    }).join("");
  }

  /* ── Charts ────────────────────────────────────────────────────────────── */

  function drawChart() {
    var bars = T.bars(chartSym);
    var s = T.symbol(chartSym);
    if (!bars.length || !s) return;

    var W = 360, H = 420, padR = 62, padB = 22;
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; });
    var span = (hi - lo) || 1;
    lo -= span * 0.08; hi += span * 0.08; span = hi - lo;

    var plotW = W - padR, plotH = H - padB;
    var step = plotW / bars.length;
    var y = function (v) { return plotH - (v - lo) / span * plotH; };

    var grid = "";
    for (var g = 0; g <= 6; g++) {
      var gy = (plotH / 6) * g;
      grid += '<line x1="0" y1="' + gy + '" x2="' + plotW + '" y2="' + gy +
        '" stroke="currentColor" stroke-opacity="0.16" stroke-dasharray="2 4"/>';
      var label = (hi - (span / 6) * g).toFixed(s.digits);
      grid += '<text x="' + (plotW + 6) + '" y="' + (gy + 4) +
        '" font-size="11" fill="currentColor" fill-opacity="0.75">' + label + "</text>";
    }

    var candles = bars.map(function (b, i) {
      var x = i * step + step / 2;
      var up = b.c >= b.o;
      var col = up ? "#26a69a" : "#ef5350";
      var top = y(Math.max(b.o, b.c));
      var bot = y(Math.min(b.o, b.c));
      var w = Math.max(1.4, step * 0.62);
      return '<line x1="' + x + '" y1="' + y(b.h) + '" x2="' + x + '" y2="' + y(b.l) +
          '" stroke="' + col + '" stroke-width="1"/>' +
        '<rect x="' + (x - w / 2) + '" y="' + top + '" width="' + w +
          '" height="' + Math.max(1, bot - top) + '" fill="' + col + '"/>';
    }).join("");

    /* The two price lines the app draws across the chart, with their labels
       boxed against the axis: red for the ask, teal for the bid. */
    var bidY = y(T.bid(s)), askY = y(T.ask(s));
    var lines =
      '<line x1="0" y1="' + askY + '" x2="' + plotW + '" y2="' + askY + '" stroke="#ef5350" stroke-width="1"/>' +
      '<rect x="' + plotW + '" y="' + (askY - 9) + '" width="' + padR + '" height="18" fill="#ef5350"/>' +
      '<text x="' + (plotW + 4) + '" y="' + (askY + 4) + '" font-size="11" fill="#fff">' + T.ask(s).toFixed(s.digits) + "</text>" +
      '<line x1="0" y1="' + bidY + '" x2="' + plotW + '" y2="' + bidY + '" stroke="#26a69a" stroke-width="1"/>' +
      '<rect x="' + plotW + '" y="' + (bidY - 9) + '" width="' + padR + '" height="18" fill="#26a69a"/>' +
      '<text x="' + (plotW + 4) + '" y="' + (bidY + 4) + '" font-size="11" fill="#fff">' + T.bid(s).toFixed(s.digits) + "</text>";

    $("tm-chart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" style="height:' + H + 'px">' +
        grid + candles + lines +
      "</svg>" +
      '<div class="tm-chart-tag"><b>' + esc(chartSym) + " &#9662; M5</b><span>" +
        esc(chartSym) + "</span></div>";
  }

  /* ── History ───────────────────────────────────────────────────────────── */

  function drawHistory() {
    var ds = T.deals();
    var trades = ds.filter(function (d) { return d.type !== "balance"; });
    var deposits = ds.filter(function (d) { return d.type === "balance"; });

    var profit = 0; trades.forEach(function (d) { profit += d.profit; });
    var dep = 0; deposits.forEach(function (d) { dep += d.profit; });

    $("tm-hfigures").innerHTML =
      lead("Profit:", signed(Math.round(profit * 100) / 100), profit ? cls(profit) : "up") +
      lead("Deposit", money(dep)) +
      lead("Swap:", money(0)) +
      lead("Commission:", money(0)) +
      lead("Balance:", money(T.summary().balance));

    var list = seg === "orders" ? [] : (seg === "deals" ? ds : ds);
    if (!list.length) { $("tm-hist").innerHTML = ""; return; }

    $("tm-hist").innerHTML = list.map(function (d) {
      if (d.type === "balance") {
        return '<div class="tm-hrow"><b>Balance</b>' +
          '<div class="t num">' + stamp(d.closeTime) + "</div>" +
          '<div class="v num up">' + money(d.profit) + "</div>" +
        "</div>";
      }
      var sym = T.symbol(d.symbol) || { digits: 2 };
      return '<div class="tm-hrow">' +
        "<b>" + esc(d.symbol) + "</b>" +
        '<div class="t num">' + stamp(d.closeTime) + "</div>" +
        '<div class="s num">' + d.type + " " + d.volume.toFixed(2) + "  " +
          Number(d.open).toFixed(sym.digits) + " &rarr; " + Number(d.close).toFixed(sym.digits) + "</div>" +
        '<div class="v num ' + cls(d.profit) + '">' + signed(d.profit) + "</div>" +
      "</div>";
    }).join("");
  }

  /* ── the ticket ────────────────────────────────────────────────────────── */

  function ticketSymbol() { return T.symbol($("tm-osym").value); }

  function drawTicket() {
    if ($("tm-order").hidden) return;
    var s = ticketSymbol();
    if (!s) return;
    $("tm-obid").innerHTML = priceHtml(T.bid(s), s.digits);
    $("tm-oask").innerHTML = priceHtml(T.ask(s), s.digits);
    $("tm-ospread").textContent = s.spread;
  }

  function send(type) {
    var s = ticketSymbol();
    var out = T.open(s.name, type, $("tm-ovol").value, $("tm-osl").value, $("tm-otp").value);
    if (typeof out === "string") return toast(out);
    closeSheet("tm-order");
    toast(type + " " + out.volume.toFixed(2) + " " + s.name + " at " + Number(out.open).toFixed(s.digits));
    go("trade");
  }

  /* ── sheets and the toast ──────────────────────────────────────────────── */

  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }

  function openMenu(ticket) {
    menuFor = ticket;
    var p = T.positions().filter(function (x) { return x.ticket === ticket; })[0];
    if (!p) return;
    var s = T.symbol(p.symbol);
    $("tm-menu-h").textContent = p.symbol + ", " + p.type + " " + p.volume.toFixed(2) + ", #" + p.ticket;
    $("tm-msl").value = p.sl ? Number(p.sl).toFixed(s.digits) : "";
    $("tm-mtp").value = p.tp ? Number(p.tp).toFixed(s.digits) : "";
    openSheet("tm-posmenu");
  }

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
    ["quotes", "charts", "trade", "history", "messages"].forEach(function (n) {
      var pane = $("tm-pane-" + n);
      var btn = document.querySelector('.tm-tab[data-tab="' + n + '"]');
      if (pane) pane.classList.toggle("on", n === name);
      if (btn) btn.classList.toggle("on", n === name);
    });
    drawBar();
    draw();
  }

  function draw() {
    $("tm-bal").textContent = short(T.summary().balance);
    if (tab === "trade") drawTrade();
    else if (tab === "quotes") drawQuotes();
    else if (tab === "charts") drawChart();
    else if (tab === "history") drawHistory();
    drawTicket();
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */

  function bind() {
    $("tm-osym").innerHTML = T.symbols().map(function (s) {
      return '<option value="' + esc(s.name) + '">' + esc(s.name) + "</option>";
    }).join("");

    document.querySelectorAll(".tm-tab").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-tab")); });
    });

    /* The toolbar is rebuilt per screen, so its buttons are caught by
       delegation rather than bound once and lost on the next redraw. */
    $("tm-actions").addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "newOrder" || act === "plus") {
        $("tm-osl").value = "";
        $("tm-otp").value = "";
        openSheet("tm-order");
        drawTicket();
      }
    });

    document.querySelectorAll(".tm-seg button").forEach(function (b) {
      b.addEventListener("click", function () {
        seg = b.getAttribute("data-seg");
        document.querySelectorAll(".tm-seg button").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        drawHistory();
      });
    });

    $("tm-vminus").addEventListener("click", function () {
      $("tm-ovol").value = Math.max(0.01, Math.round((Number($("tm-ovol").value) - 0.01) * 100) / 100).toFixed(2);
    });
    $("tm-vplus").addEventListener("click", function () {
      $("tm-ovol").value = (Math.round((Number($("tm-ovol").value) + 0.01) * 100) / 100).toFixed(2);
    });
    $("tm-osym").addEventListener("change", drawTicket);
    $("tm-sell").addEventListener("click", function () { send("sell"); });
    $("tm-buy").addEventListener("click", function () { send("buy"); });

    $("tm-pos").addEventListener("click", function (e) {
      var row = e.target.closest(".tm-row");
      if (row) openMenu(Number(row.getAttribute("data-ticket")));
    });

    /* Tapping a quote opens its chart, which is what the app does. */
    $("tm-quotes").addEventListener("click", function (e) {
      var row = e.target.closest(".tm-q");
      if (!row) return;
      chartSym = row.getAttribute("data-sym");
      go("charts");
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

    document.querySelectorAll(".tm-sheet").forEach(function (sh) {
      sh.addEventListener("click", function (e) { if (e.target === sh) sh.hidden = true; });
    });
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { closeSheet(b.getAttribute("data-close")); });
    });

    /* The drawer: the burger opens it, the strip of screen beside it closes
       it, and the items that lead somewhere lead there. */
    $("tm-burger").addEventListener("click", function () { $("tm-scrim").hidden = false; });
    $("tm-scrim").addEventListener("click", function (e) {
      if (e.target === $("tm-scrim")) $("tm-scrim").hidden = true;
    });
    document.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () {
        $("tm-scrim").hidden = true;
        go(b.getAttribute("data-go"));
      });
    });
    $("tm-manage").addEventListener("click", function () {
      $("tm-scrim").hidden = true;
      openSheet("tm-accts");
    });
    $("tm-add").addEventListener("click", function () {
      $("tm-scrim").hidden = true;
      openSheet("tm-accts");
    });

    $("tm-deposit").addEventListener("click", function () {
      var v = prompt("Deposit", "1000");
      if (v == null) return;
      T.deposit(v);
      closeSheet("tm-accts");
      toast("Balance updated");
      draw();
    });
    $("tm-reset").addEventListener("click", function () {
      T.reset();
      closeSheet("tm-accts");
      toast("Account reset");
      draw();
    });
    $("tm-exit").addEventListener("click", function () { global.location.href = "/mt5.html"; });

    go("trade");
    setInterval(function () { T.step(); draw(); }, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})(window);
