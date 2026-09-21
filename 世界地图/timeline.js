/* 世界历史时间轴 · 交互逻辑(球面版)
 * 投影与球面几何在 globe.js;这里只管事件、年份与渲染循环。
 */
(function () {
  "use strict";

  /* 词条.js 由 scripts/build-index.js 从 词条/<id>/meta.json 生成,是唯一真相。
     下面把它摊平成渲染代码原来吃的形状——这样既只剩一份清单,
     又不用把已经测过的渲染路径全部重写一遍。 */
  /* 只有带地点的"事件"能落在地球上。没地点的是"概念"(比如"肥尾效应"),
     它们在图谱和目录里占位,但地球上没有它们的位置。 */
  var TIMELINE_EVENTS = ENTRIES.filter(function (e) { return e.place && typeof e.year === "number"; }).map(function (e) {
    return {
      id: e.id, year: e.year, era: e.era, status: e.status || "点亮",
      city: e.place.city, country: e.place.country,
      lat: e.place.lat, lng: e.place.lng,
      cat: e.cat, title: e.title, summary: e.summary,
      /* note 存的是仓库根相对路径(路径的含义不该取决于谁在读),
         世界地图在子目录里,所以补一个 ../ */
      chapter: e.note ? "../" + e.note : null
    };
  });
  var byId = {};
  TIMELINE_EVENTS.forEach(function (e) { byId[e.id] = e; });

  /* 因果链现在长在词条自己身上,这里收成渲染代码用的年份索引形式 */
  var CAUSAL_LINKS = [];
  ENTRIES.forEach(function (e) {
    (e.links || []).forEach(function (l) {
      if (l.type !== "因果" || !byId[l.to]) return;
      CAUSAL_LINKS.push({ from: e.year, to: byId[l.to].year, strength: l.strength, note: l.note });
    });
  });

  /* 年份范围随时代走。2850 年拉成一根滑块,现代会被压成几个像素,
     所以先选时代、再在时代内细调。
     era 必须初始化为 null:否则首屏那次 applyEra 会被"同一个时代就跳过"挡掉,
     data-era、时代带高亮、时代说明全都设不上。 */
  var _e0 = eraOf(1720);
  var era = null, MIN_YEAR = _e0.from, MAX_YEAR = _e0.to;
  var NS = "http://www.w3.org/2000/svg";
  var CALM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 墨绘符号取代分类色。
     古地图本来就用图画符号标地物,而且靠形状区分对色盲完全免疫——
     比任何配色方案都稳。代价是纸上少了五种颜色,但那本来就是 dashboard 的遗产。
     全部描边不填充,才是墨线画的质感。 */
  var GLYPH = {
    /* 圆形方孔钱 */
    "经济": "M0,-4.3A4.3,4.3 0 1,1 -0.01,-4.3Z M-1.5,-1.5H1.5V1.5H-1.5Z",
    /* 王冠 */
    "政治": "M-4.2,3.2V-2.6L-2,-0.6L0,-3.6L2,-0.6L4.2,-2.6V3.2Z",
    /* 交叉双剑 */
    "战争": "M-3.6,-3.6L3.6,3.6 M3.6,-3.6L-3.6,3.6 M-4.8,-2.4L-2.4,-4.8 M4.8,-2.4L2.4,-4.8",
    /* 齿轮:圆 + 四根辐条伸出轮廓 */
    "科技": "M0,-2.8A2.8,2.8 0 1,1 -0.01,-2.8Z M0,-4.6V-2.8 M0,2.8V4.6 M-4.6,0H-2.8 M2.8,0H4.6",
    /* 翻开的书 */
    "文化": "M0,-2.6V3.4 M0,-2.6C-1.4,-3.8 -3,-3.8 -4.2,-3.2V2.8C-3,2.2 -1.4,2.2 0,3.4 M0,-2.6C1.4,-3.8 3,-3.8 4.2,-3.2V2.8C3,2.2 1.4,2.2 0,3.4"
  };


  var svg = document.getElementById("world-map");
  var slider = document.getElementById("tl-slider");
  var playBtn = document.getElementById("tl-play");
  var yearBadge = document.getElementById("tl-year");
  var nowYear = document.getElementById("tl-now-year");
  var nowList = document.getElementById("tl-now-list");
  var popup = document.getElementById("tl-popup");
  var filterWrap = document.getElementById("tl-filters");
  var markerLayer = document.getElementById("tl-markers");
  var waveLayer = document.getElementById("tl-waves");
  var flowLayer = document.getElementById("tl-flows");
  var partLayer = document.getElementById("tl-particles");
  var flowToggle = document.getElementById("tl-flow-toggle");
  var linkLayer = document.getElementById("tl-links");
  var linkToggle = document.getElementById("tl-link-toggle");
  var atmos = document.querySelector(".tl-atmos");
  var globeWrap = document.querySelector(".tl-globe-wrap");
  var rhumbLayer = document.getElementById("tl-rhumbs");
  var eraBand = document.getElementById("tl-eras");
  var eraNote = document.getElementById("tl-era-note");
  var ticks = document.getElementById("tl-ticks");
  var scrollEl = document.getElementById("tl-scroll");
  var cmapSvg = document.getElementById("tl-cmap");
  var cmapSea = document.getElementById("tl-cmap-sea");
  var cmapNb = document.getElementById("tl-cmap-neighbors");
  var cmapLand = document.getElementById("tl-cmap-land");
  var cmapMarks = document.getElementById("tl-cmap-marks");
  var backGlobe = document.getElementById("tl-back-globe");
  var view = "globe", countryNow = null, cmap = null, cmarks = [], enterTimer = 0;
  var morphCv = document.getElementById("tl-morph");
  var morphCx = morphCv.getContext("2d");
  var morphRAF = 0, zoomRAF = 0;

  /* 缩放要走过去,不能跳。setZoom 本身是瞬时的 —— 直接调用的话
     "推近"根本不是推近,是一帧之内换了个倍率。 */
  function tweenZoom(to, ms, then) {
    cancelAnimationFrame(zoomRAF);
    var from = Globe.zoom, t0 = 0;
    if (Math.abs(to - from) < 0.01) { if (then) then(); return; }
    zoomRAF = requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, (now - t0) / ms);
      Globe.setZoom(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) zoomRAF = requestAnimationFrame(step);
      else if (then) then();
    });
  }

  var currentYear = 1720;
  var activeCats = { "经济": true, "政治": true, "战争": true, "科技": true, "文化": true };
  var timer = null, waves = [], openIdx = null;
  var takeWaves, takeFlows, takeParts, takeLinks, takeRhumbs;
  var flowsOn = true, flowClock = 0, linksOn = true;

  /* 每帧 innerHTML 重建 DOM 会把帧率从 53 压到 23(实测)。
     改成节点池:建一次,之后只改属性,多余的隐藏起来。 */
  function pool(layer, tag, store) {
    return function (n) {
      while (store.length < n) {
        var el = document.createElementNS(NS, tag);
        layer.appendChild(el); store.push(el);
      }
      for (var i = 0; i < store.length; i++) {
        /* 防线:节点若被移出文档(例如误用 innerHTML 清空)就挂回去,
           否则池会握着一堆脱离文档的引用,静默失效 */
        if (store[i].parentNode !== layer) layer.appendChild(store[i]);
        if (i >= n) store[i].setAttribute("display", "none");
      }
      return store;
    };
  }
  var wavePool = [], flowPool = [], partPool = [], linkPool = [], rhumbPool = [];
  var FLOW_WINDOW = 4;      /* 一条流动在它发生年份的前后各 4 年内可见 */
  /* 抬升按角距缩放(见 flowPrep):纽约→雷克雅未克这种短程若和跨洋同高,
     会拱到北极上方去,看着像脱离了地球。0.05 起步,跨半个地球时到 0.26。 */

  takeWaves = pool(waveLayer, "path", wavePool);
  takeFlows = pool(flowLayer, "path", flowPool);
  takeParts = pool(partLayer, "circle", partPool);
  takeLinks = pool(linkLayer, "path", linkPool);
  takeRhumbs = pool(rhumbLayer, "path", rhumbPool);

  Globe.setWorld(WORLD_MAP);
  Globe.mountCanvas(document.getElementById("tl-canvas"));
  var drag = Globe.attachDrag(svg);

  /* ---------- 标记:建一次,之后每帧只改坐标 ---------- */
  /* 纽约有 4 个事件坐标完全相同(1837/1869/1929/2008),巴黎和伦敦各 2 个。
     不散开的话它们叠成一个点,底下的永远点不到。按组绕一个小圈错开,
     半径 1.6° 约合 180 公里,在全球尺度上只有几个像素,不影响地理准确性。 */
  var byLoc = {};
  TIMELINE_EVENTS.forEach(function (ev, i) {
    var k = ev.lat + "," + ev.lng;
    (byLoc[k] = byLoc[k] || []).push(i);
  });
  var offset = {};
  Object.keys(byLoc).forEach(function (k) {
    var group = byLoc[k];
    if (group.length < 2) return;
    group.forEach(function (idx, j) {
      var a = (j / group.length) * Math.PI * 2;
      offset[idx] = { dLat: Math.sin(a) * 1.6, dLng: Math.cos(a) * 1.6 };
    });
  });
  function at(ev, i) {
    var o = offset[i];
    return o ? [ev.lng + o.dLng, ev.lat + o.dLat] : [ev.lng, ev.lat];
  }

  var marks = TIMELINE_EVENTS.map(function (ev, i) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "tl-marker cat-" + ev.cat);
    /* 透明热区:圆点本身太小,手指点不中 */
    var hit = document.createElementNS(NS, "circle");
    hit.setAttribute("r", "6.5"); hit.setAttribute("class", "tl-hit");
    var halo = document.createElementNS(NS, "circle");
    halo.setAttribute("r", "4"); halo.setAttribute("class", "tl-halo");
    /* 辉光用一层大而透明的同色圆,不用 feGaussianBlur。
       滤镜要对每个移动元素逐帧重新求值,实测三处 bloom 吃掉 11fps。 */
    var glow = document.createElementNS(NS, "circle");
    glow.setAttribute("class", "tl-glow");
    var dot = document.createElementNS(NS, "path");
    dot.setAttribute("class", "tl-glyph");
    dot.setAttribute("d", GLYPH[ev.cat] || GLYPH["经济"]);
    g.appendChild(hit); g.appendChild(halo); g.appendChild(glow); g.appendChild(dot);
    g.addEventListener("click", function (e) {
      e.stopPropagation();
      if (drag.didDrag()) return;              /* 拖完球别误触发弹窗 */
      var c = at(ev, i);
      openIdx = i; fillPopup(ev); Globe.rotateTo(c[0], c[1]); paint();
    });
    markerLayer.appendChild(g);
    return { ev: ev, g: g, dot: dot, halo: halo, glow: glow };
  });
  svg.addEventListener("click", function () { openIdx = null; popup.hidden = true; });
  /* 注意:开卷宗的点击监听在下面单独注册,两者都会收到事件——
     先关弹窗再开卷宗,顺序无所谓,互不干扰。 */

  /* ---------- 弹窗 ---------- */
  function fillPopup(ev) {
    var link = ev.chapter
      ? '<a class="tl-popup-link" href="' + ev.chapter + '">📖 去看绘本章节 →</a>'
      : '<a class="tl-popup-link" href="../notes.html">📖 去读书笔记目录 →</a>';
    popup.innerHTML =
      '<span class="tag-pill tl-cat-' + ev.cat + '">' + ev.cat + '</span>' +
      '<h4>' + ev.year + ' · ' + ev.title + '</h4>' +
      '<p class="tl-popup-place">' + ev.city + '，' + ev.country + '</p>' +
      '<p>' + ev.summary + '</p>' + link;
  }
  /* 标记会随地球转动,弹窗得跟着走;转到背面就收起来 */
  function placePopup() {
    if (openIdx == null) { popup.hidden = true; return; }
    var ev = TIMELINE_EVENTS[openIdx];
    var c = at(ev, openIdx);
    var q = Globe.project(c[0], c[1], 0);
    if (!q || ev.year > currentYear || !activeCats[ev.cat]) { popup.hidden = true; return; }
    var px = (q[0] + 120) / 240 * 100, py = (q[1] + 120) / 240 * 100;
    popup.style.left = Math.min(Math.max(px + 3, 1), 62) + "%";
    popup.style.top = Math.min(Math.max(py - 6, 1), 64) + "%";
    popup.hidden = false;
  }

  /* ---------- 冲击波:危机顺着球面扩散出去 ---------- */
  function fire(ev, i) {
    if (CALM) return;
    var c = at(ev, i);
    /* 同一位置已有正在扩散的波就不再叠一道,否则重合的环会把亮度叠爆 */
    for (var k = 0; k < waves.length; k++) {
      if (waves[k].c[0] === c[0] && waves[k].c[1] === c[1] && waves[k].th < 12) return;
    }
    waves.push({ ev: ev, c: c, th: 0 });
  }

  /* ---------- 资金流动 ----------
   * 类型不靠色相区分(验证器实测:红绿在色盲下 ΔE 仅 4.9,而"救助"与"传染"
   * 意思正相反,靠颜色分辨是危险的)。统一用一个色相,类型交给线型和文字。
   */
  function activeFlows() {
    if (!flowsOn) return [];
    return MONEY_FLOWS.filter(function (f) {
      return Math.abs(f.year - currentYear) <= FLOW_WINDOW;
    });
  }
  /* 每条流动的端点向量与抬升在整个生命周期里都不变,建一次缓存 */
  var flowPrep = MONEY_FLOWS.map(function (f) {
    var a = FLOW_PLACES[f.from], b = FLOW_PLACES[f.to];
    var A = [a.lng, a.lat], B = [b.lng, b.lat];
    return { pr: Globe.prepArc(A, B), baseLift: 0.05 + 0.21 * (Globe.angleBetween(A, B) / 180) };
  });
  function paintFlows() {
    var list = activeFlows();
    if (!list.length) { takeFlows(0); takeParts(0); return; }
    /* 同一对城市可能有多条流动(纽约→法兰克福既有传染也有流动性注入),
       端点相同则弧线精确重叠,实线会把点线盖死。按序号加一点抬升错开。 */
    var dup = {};
    list.forEach(function (f) { var k = f.from + ">" + f.to; dup[k] = (dup[k] || 0); });
    var seen = {};

    var arcs = [], parts = [];
    list.forEach(function (f, fi) {
      var P = flowPrep[MONEY_FLOWS.indexOf(f)];
      var k = f.from + ">" + f.to;
      seen[k] = (seen[k] || 0) + 1;
      var lift = P.baseLift + (seen[k] - 1) * 0.055;
      var d = Globe.arcPathFrom(P.pr, { lift: lift, steps: 56 });
      if (!d) return;
      /* 离它的年份越远越淡 */
      var near = 1 - Math.abs(f.year - currentYear) / (FLOW_WINDOW + 1);
      arcs.push({ kind: f.kind, d: d, o: near });
      /* 粒子:沿弧线从起点流向终点,三颗错开相位 */
      for (var k = 0; k < 3; k++) {
        var t = (flowClock * 0.16 + k / 3 + fi * 0.11) % 1;
        var q = Globe.arcPointFrom(P.pr, t, lift);
        if (!q) continue;
        /* 两端渐隐,粒子像是从城市里长出来又落进去 */
        var fade = Math.sin(Math.PI * t);
        parts.push({ x: q[0], y: q[1], r: 1.5 + fade * 0.9, o: near * fade });
      }
    });
    var fp = takeFlows(arcs.length);
    arcs.forEach(function (a, i) {
      var el = fp[i];
      el.removeAttribute("display");
      el.setAttribute("class", "tl-flow kind-" + a.kind);
      el.setAttribute("d", a.d);
      el.setAttribute("opacity", a.o.toFixed(2));
    });
    var pp = takeParts(parts.length);
    parts.forEach(function (c, i) {
      var el = pp[i];
      el.removeAttribute("display");
      el.setAttribute("class", "tl-particle");
      el.setAttribute("cx", c.x.toFixed(1)); el.setAttribute("cy", c.y.toFixed(1));
      el.setAttribute("r", c.r.toFixed(2)); el.setAttribute("opacity", c.o.toFixed(2));
    });
  }

  /* ---------- 词条管理 ----------
   * 静态站没有后端。真正写入只有两条路:把 GitHub token 放进浏览器
   * (那个 token 能改你的整个仓库,放前端是真风险),或者加后端(就不 self-contained 了)。
   * 所以这里是"页内编辑 + 导出":草稿存 localStorage,导出给你粘回文件。
   */
  var DRAFT_KEY = "ti-entry-drafts";
  var drafts = (function () {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch (e) { return {}; }
  })();
  function saveDrafts() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (e) {}
  }
  function effective(id) {
    var base = ENTRIES.filter(function (e) { return e.id === id; })[0];
    return Object.assign({}, base, drafts[id] || {});
  }
  function allRows() {
    var rows = ENTRIES.map(function (e) { return effective(e.id); });
    /* 草稿里新增的词条在 ENTRIES 里还没有 */
    Object.keys(drafts).forEach(function (id) {
      if (!ENTRIES.some(function (e) { return e.id === id; })) rows.push(drafts[id]);
    });
    /* 概念词条没有年份,排在有年份的之后,按章节序 */
    return rows.sort(function (a, b) {
      var ay = typeof a.year === "number", by = typeof b.year === "number";
      if (ay && by) return a.year - b.year;
      if (ay !== by) return ay ? -1 : 1;
      return ((a.book && a.book.chapter) || 0) - ((b.book && b.book.chapter) || 0);
    });
  }

  var STATUSES = ["点亮", "在读", "想读"];
  var manage = document.getElementById("tl-manage");
  var tbody = document.getElementById("tl-tbl-body");

  function renderTable() {
    tbody.innerHTML = allRows().map(function (e) {
      var dirty = !!drafts[e.id];
      return '<tr class="' + (dirty ? "dirty" : "") + '" data-id="' + e.id + '">' +
        '<td class="y">' + (typeof e.year === "number" ? fmtYear(e.year) : "—") + '</td>' +
        '<td>' + e.title + (e.note ? ' <span style="opacity:.5">📖</span>' : "") + '</td>' +
        '<td style="color:var(--muted)">' + (ERAS.filter(function (x) { return x.id === e.era; })[0] || { name: e.book ? "书 · 第 " + e.book.chapter + " 章" : "—" }).name + '</td>' +
        '<td><span class="tag-pill tl-cat-' + e.cat + '">' + e.cat + '</span></td>' +
        '<td><button class="tl-st" data-v="' + (e.status || "点亮") + '">' + (e.status || "点亮") + '</button></td>' +
        '</tr>';
    }).join("");
    tbody.querySelectorAll(".tl-st").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.closest("tr").dataset.id;
        var cur = btn.dataset.v;
        var next = STATUSES[(STATUSES.indexOf(cur) + 1) % STATUSES.length];
        drafts[id] = Object.assign({}, effective(id), { status: next });
        saveDrafts(); renderTable(); refreshStatuses();
      });
    });
    var n = Object.keys(drafts).length;
    document.getElementById("tl-manage-hint").innerHTML = n
      ? "有 <b>" + n + "</b> 处未导出的改动（底色标出来了）。草稿存在浏览器里，换台机器就没了——导出粘回文件才算数。"
      : "还没有改动。";
  }
  /* 草稿里的状态要立刻反映到地球上,否则改了看不见 */
  function refreshStatuses() {
    marks.forEach(function (m) {
      var d = drafts[m.ev.id];
      if (d && d.status) m.ev.status = d.status;
    });
  }

  document.getElementById("tl-manage-open").addEventListener("click", function () {
    renderTable(); manage.hidden = false;
  });
  document.getElementById("tl-manage-close").addEventListener("click", function () { manage.hidden = true; });
  manage.addEventListener("click", function (e) { if (e.target === manage) manage.hidden = true; });

  document.getElementById("tl-new-toggle").addEventListener("click", function () {
    var box = document.getElementById("tl-new");
    box.classList.toggle("on");
    document.getElementById("tl-new-add").style.display = box.classList.contains("on") ? "" : "none";
  });
  document.getElementById("tl-new-add").addEventListener("click", function () {
    var v = function (id) { return document.getElementById(id).value.trim(); };
    var title = v("nf-title"), year = parseInt(v("nf-year"), 10);
    if (!title || isNaN(year)) { alert("标题和年份是必填的。"); return; }
    var id = year + "-" + title;
    drafts[id] = {
      id: id, title: title, year: year, era: eraOf(year).id,
      place: { city: v("nf-city"), country: v("nf-country"),
               lat: parseFloat(v("nf-lat")) || 0, lng: parseFloat(v("nf-lng")) || 0 },
      cat: v("nf-cat") || "经济",
      status: v("nf-status") || "想读",
      summary: v("nf-summary"), note: null, links: []
    };
    saveDrafts(); renderTable();
    ["nf-title","nf-year","nf-city","nf-country","nf-lat","nf-lng","nf-summary"].forEach(function (k) {
      document.getElementById(k).value = "";
    });
  });
  document.getElementById("tl-export").addEventListener("click", function () {
    var out = document.getElementById("tl-export-out");
    var ids = Object.keys(drafts);
    if (!ids.length) { out.hidden = false; out.textContent = "没有改动。"; return; }
    out.hidden = false;
    out.textContent = ids.map(function (id) {
      var e = Object.assign({}, drafts[id]);
      delete e.id;                       /* id 就是目录名,不重复写进文件 */
      return "# 词条/" + id + "/meta.json\n" + JSON.stringify(e, null, 2);
    }).join("\n\n");
  });
  document.getElementById("tl-reset").addEventListener("click", function () {
    if (!confirm("丢弃所有未导出的草稿？")) return;
    drafts = {}; saveDrafts(); renderTable();
    document.getElementById("tl-export-out").hidden = true;
  });

  /* ---------- 时代 ---------- */
  function eventsIn(e) {
    return TIMELINE_EVENTS.filter(function (ev) { return ev.year >= e.from && ev.year < e.to; });
  }
  function buildEraBand() {
    eraBand.innerHTML = ERAS.map(function (e) {
      var n = eventsIn(e).length;
      return '<button class="tl-era' + (n ? "" : " empty") + '" data-era="' + e.id + '">' +
        '<span class="n">' + e.name + '</span>' +
        '<span class="c">' + (n ? n + " 处" : "空白") + '</span></button>';
    }).join("");
    eraBand.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var e = ERAS.filter(function (x) { return x.id === b.dataset.era; })[0];
        var evs = eventsIn(e);
        /* 有内容就落到第一件事上,空白时代落到中点 */
        setYear(evs.length ? evs[0].year : Math.round((e.from + e.to) / 2), false);
      });
    });
  }
  /* 刻度按当前时代重算,并处理公元前的负年份 */
  function fmtYear(y) { return y < 0 ? "前" + (-y) : String(y); }
  function applyEra(e) {
    if (era && era.id === e.id) return;
    era = e; MIN_YEAR = e.from; MAX_YEAR = e.to;
    document.documentElement.setAttribute("data-era", e.id);
    slider.min = e.from; slider.max = e.to;
    eraNote.textContent = e.note;
    eraBand.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.era === e.id);
    });
    var span = e.to - e.from, out = [];
    for (var i = 0; i <= 5; i++) out.push("<span>" + fmtYear(Math.round(e.from + span * i / 5)) + "</span>");
    ticks.innerHTML = out.join("");
  }

  /* ---------- 国家卷宗 ----------
   * 不是"放大这个国家的地图"——数据里每个国家只有一个多边形,没有城市、
   * 没有行政区,放大之后没有新东西可看。展开的是它的档案。
   * 那个 54 顶点的轮廓当大地图不能看,缩成 60px 的封缄印章正好。
   */
  var cityCountry = {};
  Object.keys(FLOW_PLACES).forEach(function (k) {
    var p = FLOW_PLACES[k];
    cityCountry[k] = Globe.countryAt(p.lng, p.lat) || CITY_COUNTRY_FALLBACK[k] || null;
  });

  function gather(en) {
    var cities = Object.keys(FLOW_PLACES).filter(function (k) { return cityCountry[k] === en; });
    var evs = TIMELINE_EVENTS.filter(function (e) {
      return (COUNTRY_EN[e.country] || e.country) === en;
    });
    var years = evs.map(function (e) { return e.year; });
    return {
      en: en,
      cn: COUNTRY_CN[en] || en,
      events: evs.sort(function (a, b) { return a.year - b.year; }),
      out: MONEY_FLOWS.filter(function (f) { return cities.indexOf(f.from) >= 0; }),
      into: MONEY_FLOWS.filter(function (f) { return cities.indexOf(f.to) >= 0; }),
      links: CAUSAL_LINKS.filter(function (l) {
        return years.indexOf(l.from) >= 0 || years.indexOf(l.to) >= 0;
      }),
      cities: cities.map(function (k) { return FLOW_PLACES[k].name; })
    };
  }

  /* ---------- 国家视图 ----------
   * 点进一个国家不是弹一张纸,是换一个视图:地球缩到左上角当定位器,
   * 这张平面地图像卷轴一样铺开,右边那一列换成这个国家的卷宗。
   */

  /* 卷轴纸的像素尺寸随视口变,投影得按真实尺寸算,
     不然高瘦的国家在宽纸上会缩成中间一条 */
  function paperBox() {
    var r = document.getElementById("tl-scroll-paper").getBoundingClientRect();
    return [Math.max(320, Math.round(r.width)), Math.max(220, Math.round(r.height))];
  }

  function buildCountryMap(en) {
    var box = paperBox();
    cmapSvg.setAttribute("viewBox", "0 0 " + box[0] + " " + box[1]);
    cmap = Globe.countryMap(en, box[0], box[1]);
    cmapNb.innerHTML = "";
    cmapMarks.innerHTML = "";
    cmarks = [];
    if (!cmap) { cmapLand.removeAttribute("d"); return; }

    /* 海先铺满整张纸,陆地盖上去——反过来画的话,
       简化过的海岸线和纸之间会露出白边 */
    cmapSea.innerHTML = '<rect class="sea" x="0" y="0" width="' + box[0] + '" height="' + box[1] + '"/>';
    var nb = "";
    cmap.neighbors.forEach(function (c) { nb += '<path class="nb" d="' + c.d + '"/>'; });
    cmapNb.innerHTML = nb;
    cmapLand.setAttribute("d", cmap.d);

    /* 标记复用球面上那套错开偏移:纽约 4 个事件同坐标,
       在这张放大的纸上不错开会叠成一坨 */
    var idxOf = {};
    TIMELINE_EVENTS.forEach(function (ev, i) { idxOf[ev.id] = i; });
    gather(en).events.forEach(function (ev) {
      var i = idxOf[ev.id], c = at(ev, i), pos = cmap.project(c[0], c[1]);
      var g = document.createElementNS(NS, "g");
      g.setAttribute("class", "tl-cmark cat-" + ev.cat);
      g.setAttribute("transform", "translate(" + pos[0].toFixed(1) + "," + pos[1].toFixed(1) + ")");
      g.innerHTML =
        '<circle class="hit" r="20"/>' +
        '<circle class="ring" r="15"/>' +
        '<path class="g" transform="scale(2.4)" d="' + (GLYPH[ev.cat] || GLYPH["经济"]) + '"/>' +
        '<text x="0" y="30" text-anchor="middle">' + fmtYear(ev.year) + '</text>';
      g.addEventListener("click", function (e) {
        e.stopPropagation();
        setYear(ev.year, true);
      });
      cmapMarks.appendChild(g);
      cmarks.push({ ev: ev, g: g });
    });
    paintCountryMarks();
  }

  /* 拖时间轴时这张纸上的标记跟着亮灭——国家视图里年份依然有意义 */
  function paintCountryMarks() {
    cmarks.forEach(function (m) {
      var st = m.ev.year > currentYear ? "st-future"
             : m.ev.year === currentYear ? "st-now" : "st-past";
      m.g.setAttribute("class", "tl-cmark cat-" + m.ev.cat + " " + st +
                       " k-" + (m.ev.status || "点亮"));
    });
  }

  function dossierHTML(d) {
    var html = "";
    if (d.events.length) {
      html += '<h3>这里发生过什么</h3>';
      html += d.events.map(function (e) {
        return '<div class="tl-doss-row"><span class="tl-doss-year">' + e.year + '</span>' +
          '<span class="tag-pill tl-cat-' + e.cat + '">' + e.cat + '</span>' +
          '<strong>' + e.title + '</strong><p>' + e.summary + '</p></div>';
      }).join("");
    }
    if (d.out.length || d.into.length) {
      html += '<h3>钱从这里去了哪儿，又从哪儿来</h3>';
      html += d.out.map(function (f) {
        return '<div class="tl-doss-row flow"><span class="tl-doss-year">' + f.year + '</span>' +
          '<strong>→ ' + FLOW_PLACES[f.to].name + '</strong>' +
          '<span class="tl-flow-kind">' + f.kind + '</span><p>' + f.note + '</p></div>';
      }).join("");
      html += d.into.map(function (f) {
        return '<div class="tl-doss-row flow"><span class="tl-doss-year">' + f.year + '</span>' +
          '<strong>← ' + FLOW_PLACES[f.from].name + '</strong>' +
          '<span class="tl-flow-kind">' + f.kind + '</span><p>' + f.note + '</p></div>';
      }).join("");
    }
    if (d.links.length) {
      html += '<h3>它牵在哪条因果链上</h3>';
      html += d.links.map(function (l) {
        return '<div class="tl-doss-row link"><span class="tl-link-strength">' + l.strength + '</span>' +
          '<strong>' + l.from + ' → ' + l.to + '</strong><p>' + l.note + '</p></div>';
      }).join("");
    }
    if (!html) {
      /* 176 个国家里只有约 10 个有内容。空状态不该是一张白纸 */
      html = '<p class="tl-doss-empty">这一页还是空白的。<br>' +
             '《逃不开的经济周期》还没写到这里——也可能是它从没被卷进来过。<br>' +
             '<span>往 词条/ 里加一条，这张纸就有字了。</span></p>';
    }
    return html;
  }

  /* 球在视口里的圆:圆心和半径(像素)。摊平的起点就是它 */
  function globeDisc() {
    var r = document.querySelector(".tl-globe-wrap").getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2,
             r: r.width * Globe.zoom / 2.4 };     /* viewBox 240 单位里球半径 100 */
  }
  function paperRect() {
    var r = document.getElementById("tl-scroll-paper").getBoundingClientRect();
    return { x: r.left, y: r.top, w: Math.max(320, r.width), h: Math.max(200, r.height) };
  }
  function sizeMorphCanvas() {
    var d = Math.min(2, window.devicePixelRatio || 1);
    morphCv.width = Math.round(window.innerWidth * d);
    morphCv.height = Math.round(window.innerHeight * d);
    return d;
  }

  /* 球摊成纸(back=true 时反过来卷回球)。
     两头的几何都要在**目标视图的布局下**量,所以先切 data-view、
     把真球和纸藏起来,量完再放动画 —— 否则纸的尺寸是按旧版面算的。 */
  function runMorph(en, back, done) {
    cancelAnimationFrame(morphRAF);
    var disc, paper;
    if (back) {
      paper = paperRect();                       /* 纸还在当前视图里 */
      document.body.setAttribute("data-view", "globe");
      document.body.classList.add("morphing");
      disc = globeDisc();                        /* 球回中间之后的位置 */
    } else {
      disc = globeDisc();                        /* 球还在中间 */
      document.body.classList.add("morphing");
      document.body.setAttribute("data-view", "country");
      paper = paperRect();
    }
    var prep = Globe.morphPrep(en, disc, paper);
    if (!prep) { document.body.classList.remove("morphing"); done(); return; }

    var dpr = sizeMorphCanvas();
    morphCv.hidden = false;
    /* 说了要少动效就别摊了,直接给结果 */
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var DUR = reduce ? 1 : 900, t0 = 0;
    prep.draw(morphCx, back ? 1 : 0, dpr);
    morphRAF = requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, (now - t0) / DUR);
      prep.draw(morphCx, back ? 1 - k : k, dpr);
      if (k < 1) morphRAF = requestAnimationFrame(step);
      else done();
    });
    return prep;
  }

  function enterCountry(en) {
    var d = gather(en);
    document.getElementById("tl-seal-path").setAttribute("d", Globe.outlinePath(en, 60));
    document.getElementById("tl-country-name").textContent = d.cn;
    document.getElementById("tl-country-sub").textContent = d.cn === d.en ? "" : d.en;
    document.getElementById("tl-scroll-name").textContent = d.cn;
    document.getElementById("tl-scroll-sub").textContent = d.cn === d.en ? "" : d.en;
    document.getElementById("tl-dossier-body").innerHTML = dossierHTML(d);

    countryNow = en;
    popup.hidden = true; openIdx = null;
    Globe.setHover(null);
    svg.classList.remove("on-land");

    /* 先在球上推到这个国家跟前,再把平面图铺开 —— 镜头是连着的:
       放大 → 贴到地表 → 这块地摊成一张纸。直接切会断掉这口气 */
    var aim = Globe.aimOf(en);
    if (aim) Globe.rotateTo(aim[0], aim[1]);
    tweenZoom(2.6, 520);

    clearTimeout(enterTimer);
    enterTimer = setTimeout(function () {
      if (countryNow !== en) return;          /* 半路又点了别的国家 */
      view = "country";
      scrollEl.hidden = false;
      backGlobe.hidden = false;
      document.body.classList.add("globe-in");

      runMorph(en, false, function () {
        buildCountryMap(en);
        /* 画布还盖在上面,底下把纸和图亮出来,等它淡完再撤画布 */
        document.body.classList.remove("morphing");
        document.body.classList.remove("globe-in");
        setTimeout(function () { if (view === "country") morphCv.hidden = true; }, 300);
      });
      /* 角上那颗是"你在这儿"的定位器,要看得见整个世界。
         此刻真球已经藏起来了,换倍率看不见,不用补间 */
      cancelAnimationFrame(zoomRAF);
      Globe.setZoom(1);
    }, 560);
  }

  function exitCountry() {
    clearTimeout(enterTimer);
    if (view !== "country") { countryNow = null; Globe.setZoom(1); return; }
    var en = countryNow;
    countryNow = null;
    backGlobe.hidden = true;
    /* 纸卷回球:球要先站回中间、也回到摊开时那个 zoom,两头才接得上 */
    cancelAnimationFrame(zoomRAF);
    Globe.setZoom(2.6);
    runMorph(en, true, function () {
      view = "globe";
      scrollEl.hidden = true;
      document.body.classList.remove("morphing");
      requestAnimationFrame(function () {
        morphCv.hidden = true;
        /* 球是在 2.6 倍上接住的,再退回来 —— 直接设 1 会"啪"地跳一下 */
        tweenZoom(1, 620);
      });
    });
  }

  backGlobe.addEventListener("click", exitCountry);
  /* 点小球回全局视图 —— 用户想要的就是这个:地球一直在,点它就回去 */
  svg.addEventListener("click", function (e) {
    if (view !== "country") return;
    e.stopPropagation();
    exitCountry();
  }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && view === "country") exitCountry();
  });

  /* 缩放控件:滚轮和捏合都是藏着的,得有个看得见的入口。
     倍率同步写出来,"球能不能变大变小"这件事才是能发现的。 */
  (function () {
    var zin = document.getElementById("tl-zoom-in");
    var zout = document.getElementById("tl-zoom-out");
    var read = document.getElementById("tl-zoom-read");
    function sync() {
      var z = Globe.zoom;
      read.textContent = z.toFixed(1) + "×";
      zin.disabled = z >= Globe.ZOOM_MAX - 0.01;
      zout.disabled = z <= Globe.ZOOM_MIN + 0.01;
    }
    /* 等比步进,和滚轮一个手感 */
    zin.addEventListener("click", function () { tweenZoom(Math.min(Globe.ZOOM_MAX, Globe.zoom * 1.5), 260); });
    zout.addEventListener("click", function () { tweenZoom(Math.max(Globe.ZOOM_MIN, Globe.zoom / 1.5), 260); });
    Globe.onZoom(sync);
    sync();
  })();

  /* 鼠标落在哪个国家上:光标换成眼睛,那个国家也亮起来。
     countryAt 是逐环射线法,每次 pointermove 都跑太费;压到每帧一次。 */
  var hoverPend = null, hoverQueued = false;
  svg.addEventListener("pointermove", function (e) {
    if (view === "country") return;
    hoverPend = e;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(function () {
      hoverQueued = false;
      var ev = hoverPend; hoverPend = null;
      if (!ev) return;
      var box = svg.getBoundingClientRect();
      var X = (ev.clientX - box.left) / box.width * 240 - 120;
      var Y = (ev.clientY - box.top) / box.height * 240 - 120;
      var hit = Globe.pick(X, Y);
      var name = hit && hit.country ? hit.country : null;
      if (Globe.setHover(name)) {
        svg.classList.toggle("on-land", !!name);
        Globe.renderCanvas();
      }
    });
  });
  svg.addEventListener("pointerleave", function () {
    if (Globe.setHover(null)) { svg.classList.remove("on-land"); Globe.renderCanvas(); }
  });

  /* 点空白海面关弹窗,点陆地开卷宗 */
  svg.addEventListener("click", function (e) {
    if (drag.didDrag()) return;
    var box = svg.getBoundingClientRect();
    var X = (e.clientX - box.left) / box.width * 240 - 120;
    var Y = (e.clientY - box.top) / box.height * 240 - 120;
    var hit = Globe.pick(X, Y);
    if (hit && hit.country) enterCountry(hit.country);
  });

  /* ---------- 罗经线 ----------
   * 波特兰海图最标志性的东西:从罗盘中心放射出去的航向线。
   * 在球面上它们就是过同一点的大圆——正好复用 arcPath 的几何。
   */
  var RHUMB_HUBS = [
    { lng: -30, lat: 30 },   /* 北大西洋:1720-2008 的主战场 */
    { lng: 100, lat: 10 }    /* 东印度洋:香料与东印度公司的旧航路 */
  ];
  var rhumbPrep = [];
  RHUMB_HUBS.forEach(function (h, hi) {
    for (var a = 0; a < 360; a += 22.5) {              /* 十六个罗经方位 */
      var b = a * Math.PI / 180;
      /* 从中心沿方位角走 78°,取终点,两点定一条大圆 */
      var t = 78 * Math.PI / 180, p0 = h.lat * Math.PI / 180, l0 = h.lng * Math.PI / 180;
      var lat = Math.asin(Math.sin(p0) * Math.cos(t) + Math.cos(p0) * Math.sin(t) * Math.cos(b));
      var lng = l0 + Math.atan2(Math.sin(b) * Math.sin(t) * Math.cos(p0), Math.cos(t) - Math.sin(p0) * Math.sin(lat));
      var A = [h.lng, h.lat], B = [lng * 180 / Math.PI, lat * 180 / Math.PI];
      rhumbPrep.push({ pr: Globe.prepArc(A, B), major: (a % 90 === 0) && hi === 0 });
    }
  });
  function paintRhumbs() {
    var rp = takeRhumbs(rhumbPrep.length), n = 0;
    rhumbPrep.forEach(function (R) {
      var d = Globe.arcPathFrom(R.pr, { lift: 0, steps: 26 });
      if (!d) return;
      var el = rp[n++];
      el.removeAttribute("display");
      el.setAttribute("class", "tl-rhumb" + (R.major ? " major" : ""));
      el.setAttribute("d", d);
    });
    for (var i = n; i < rp.length; i++) rp[i].setAttribute("display", "none");
  }

  /* ---------- 因果链 ----------
   * 视觉上刻意用中性色:因果是一种"关系",不是又一个并列的分类。
   * 再加第七个色相只会把已经验证过的六色体系挤坏。
   */
  var byYear = {};
  TIMELINE_EVENTS.forEach(function (ev, i) { byYear[ev.year] = i; });
  var linkPrep = CAUSAL_LINKS.map(function (l) {
    var ia = byYear[l.from], ib = byYear[l.to];
    if (ia == null || ib == null) return null;     /* 指向不存在的事件就跳过 */
    var A = at(TIMELINE_EVENTS[ia], ia), B = at(TIMELINE_EVENTS[ib], ib);
    return { l: l, a: A, b: B, pr: Globe.prepArc(A, B),
             lift: 0.10 + 0.26 * (Globe.angleBetween(A, B) / 180) };
  }).filter(Boolean);

  function activeLinks() {
    if (!linksOn) return [];
    /* 结果已经发生的链条才显示。往后拖,因果之网一条条织起来 */
    return linkPrep.filter(function (P) { return P.l.to <= currentYear; });
  }
  function paintLinks() {
    var list = activeLinks();
    var lp = takeLinks(list.length);
    var drawn = 0;
    list.forEach(function (P) {
      var d = Globe.arcPathFrom(P.pr, { lift: P.lift, steps: 48 });
      if (!d) return;
      var el = lp[drawn++];
      el.removeAttribute("display");
      /* 越近越亮,久远的链条沉下去,和余烬同一个逻辑 */
      var age = currentYear - P.l.to;
      var op = age <= 6 ? 0.85 : Math.max(0.2, 0.5 - age / 700);
      el.setAttribute("class", "tl-link s-" + P.l.strength);
      el.setAttribute("d", d);
      el.setAttribute("opacity", op.toFixed(2));
      el.setAttribute("stroke-dashoffset", (-flowClock * 14).toFixed(1));
    });
    for (var i = drawn; i < lp.length; i++) lp[i].setAttribute("display", "none");
  }

  /* ---------- 每帧重画 ---------- */
  function paint() {
    Globe.renderCanvas();

    marks.forEach(function (m) {
      var ev = m.ev;
      if (ev.year > currentYear || !activeCats[ev.cat]) { m.g.style.display = "none"; return; }
      var c = at(ev, TIMELINE_EVENTS.indexOf(ev));
      var q = Globe.project(c[0], c[1], 0);
      if (!q) { m.g.style.display = "none"; return; }   /* 在地球背面 */
      m.g.style.display = "";
      m.g.setAttribute("transform", "translate(" + q[0].toFixed(1) + "," + q[1].toFixed(1) + ")");
      /* 刚发生的亮,年代久远的沉成余烬——拖到 2050 时整颗星球布满历史的光点 */
      var age = currentYear - ev.year;
      var fresh = age <= 4;
      m.g.setAttribute("class", "tl-marker cat-" + ev.cat + (fresh ? " st-now" : " st-past") +
        " k-" + (ev.status || "点亮"));
      m.dot.setAttribute("transform", fresh ? "scale(1)" : "scale(0.78)");
      m.glow.setAttribute("r", fresh ? 6.5 : 4.2);
    });

    var shown = [];
    waves.forEach(function (w) {
      var d = Globe.depth(w.c[0], w.c[1]);
      if (d <= 0.12) return;                 /* 震中贴近地平线:圆环被压成细缝,不画 */
      var fade = Math.min(1, (d - 0.12) / 0.3);
      shown.push({ w: w, o: Math.max(0, 1 - w.th / 100) * fade });
    });
    /* 一粗一细两条:粗的当辉光,细的当核心。比 feGaussianBlur 便宜得多 */
    var wp = takeWaves(shown.length * 2);
    shown.forEach(function (it, i) {
      var d = Globe.ringPath(it.w.c[0], it.w.c[1], it.w.th);
      var lo = wp[i * 2], hi = wp[i * 2 + 1];
      lo.removeAttribute("display");
      lo.setAttribute("class", "tl-wave tl-wave-glow cat-" + it.w.ev.cat);
      lo.setAttribute("d", d); lo.setAttribute("opacity", (it.o * 0.32).toFixed(2));
      hi.removeAttribute("display");
      hi.setAttribute("class", "tl-wave cat-" + it.w.ev.cat);
      hi.setAttribute("d", d); hi.setAttribute("opacity", it.o.toFixed(2));
    });
    paintRhumbs();
    paintLinks();
    paintFlows();
    /* 放大到贴近地表时,球缘的大气层已经在视口外,留着只会是一道假边 */
    if (atmos) {
      var z = Globe.zoom;
      atmos.style.transform = "scale(" + z.toFixed(3) + ")";
      atmos.style.opacity = z > 1.6 ? "0" : (1 - (z - 1) / 0.6).toFixed(2);
    }
    /* 放大之后球比容器还大:画布满幅成了一块硬边的矩形海,
       航向线又顺着 overflow:visible 铺满整页,看着像坏了。
       裁成一个圆窗——凑近看球面本来就该是从圆孔里看出去 */
    if (globeWrap) globeWrap.classList.toggle("zoomed", Globe.zoom > 1.02);

    placePopup();
  }

  /* ---------- 年份 ---------- */
  function render() {
    applyEra(eraOf(currentYear));
    if (view === "country") paintCountryMarks();
    yearBadge.textContent = fmtYear(currentYear);
    nowYear.textContent = fmtYear(currentYear);
    slider.value = currentYear;

    var todays = TIMELINE_EVENTS.filter(function (ev) {
      return ev.year === currentYear && activeCats[ev.cat];
    });
    var linkHtml = activeLinks().filter(function (P) {
      return P.l.to === currentYear || P.l.from === currentYear;
    }).map(function (P) {
      var a = TIMELINE_EVENTS[byYear[P.l.from]], b = TIMELINE_EVENTS[byYear[P.l.to]];
      return '<div class="tl-link-item s-' + P.l.strength + '">' +
        '<span class="tl-link-strength">' + P.l.strength + '</span>' +
        '<strong>' + P.l.from + ' ' + a.title + ' → ' + P.l.to + ' ' + b.title + '</strong>' +
        '<p>' + P.l.note + '</p></div>';
    }).join("");

    var flowHtml = activeFlows().map(function (f) {
      return '<div class="tl-flow-item kind-' + f.kind + '">' +
        '<span class="tl-flow-kind">' + f.kind + '</span>' +
        '<strong>' + FLOW_PLACES[f.from].name + ' → ' + FLOW_PLACES[f.to].name + '</strong>' +
        '<span class="tl-flow-year">' + f.year + '</span>' +
        '<p>' + f.note + '</p></div>';
    }).join("");

    var extra = linkHtml + flowHtml;
    if (!todays.length && !extra) {
      nowList.innerHTML = '<p class="tl-empty">这一年，世界安静得像深呼吸——拖动时间轴，去有故事的年份看看。</p>';
    } else if (!todays.length) {
      nowList.innerHTML = extra;
    } else {
      nowList.innerHTML = todays.map(function (ev) {
        var i = TIMELINE_EVENTS.indexOf(ev);
        var link = ev.chapter ? ' <a href="' + ev.chapter + '">📖 章节</a>' : "";
        return '<div class="tl-now-item" data-idx="' + i + '">' +
          '<span class="tag-pill tl-cat-' + ev.cat + '">' + ev.cat + '</span>' +
          '<strong>' + ev.title + '</strong>' +
          '<span class="tl-now-place">' + ev.city + '，' + ev.country + '</span>' +
          '<p>' + ev.summary + '</p>' + link + '</div>';
      }).join("") + extra;
      nowList.querySelectorAll(".tl-now-item").forEach(function (el) {
        el.addEventListener("click", function () {
          var i = +el.dataset.idx, ev = TIMELINE_EVENTS[i];
          openIdx = i; fillPopup(ev); Globe.rotateTo(ev.lng, ev.lat);
        });
      });
    }
  }

  function setYear(y, animate) {
    var prev = currentYear;
    currentYear = y;
    /* 一步跨过几十年时,沿途每个事件都点一道波,结果是五道同半径的环一起炸开——
       那是噪音不是历史。只为落点附近真正"正在发生"的事件点火。 */
    var jump = Math.abs(y - prev);
    TIMELINE_EVENTS.forEach(function (ev, i) {
      if (ev.year > prev && ev.year <= y && activeCats[ev.cat]) {
        if (jump <= 12 || ev.year > y - 12) {
          fire(ev, i);
          /* 历史在哪儿发生,地球就转到哪儿 */
          if (animate) { var c = at(ev, i); Globe.rotateTo(c[0], c[1]); openIdx = i; fillPopup(ev); }
        }
      }
    });
    if (y < prev) { waves.length = 0; openIdx = null; }   /* 往回拖就清场 */
    render();
  }

  /* ---------- 渲染循环 ---------- */
  var last = performance.now();
  function loop(now) {
    var dt = Math.min(3, (now - last) / 16.67); last = now;
    Globe.step(dt);
    if (!CALM) flowClock += dt / 60;
    if (!CALM) {
      for (var i = waves.length - 1; i >= 0; i--) {
        waves[i].th += 0.85 * dt;
        if (waves[i].th > 130) waves.splice(i, 1);
      }
    }
    paint();
    requestAnimationFrame(loop);
  }

  /* ---------- 控件 ---------- */
  slider.addEventListener("input", function () { stopPlay(); setYear(+slider.value, false); });

  function stopPlay() {
    if (timer) { clearInterval(timer); timer = null; }
    playBtn.textContent = "▶"; playBtn.classList.remove("playing");
  }
  playBtn.addEventListener("click", function () {
    if (timer) { stopPlay(); return; }
    if (currentYear >= MAX_YEAR - 1) { currentYear = MIN_YEAR; waves.length = 0; openIdx = null; }
    playBtn.textContent = "⏸"; playBtn.classList.add("playing");
    timer = setInterval(function () {
      /* 步长按时代跨度缩放:中世纪近千年,两年一步要走五百下 */
      var step = Math.max(1, Math.round((MAX_YEAR - MIN_YEAR) / 180));
      var y = currentYear + step;
      if (y >= MAX_YEAR) { setYear(MAX_YEAR, true); stopPlay(); return; }
      setYear(y, true);
    }, 160);
  });

  /* 给筛选按钮也配上符号,这样图例和地图上是同一套记号 */
  filterWrap.querySelectorAll("button[data-cat]").forEach(function (btn) {
    var cat = btn.dataset.cat;
    if (GLYPH[cat]) {
      btn.insertAdjacentHTML("afterbegin",
        '<svg class="g" viewBox="-6 -6 12 12" aria-hidden="true"><path d="' + GLYPH[cat] + '"/></svg>');
    }
  });
  filterWrap.querySelectorAll("button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cat = btn.dataset.cat;
      activeCats[cat] = !activeCats[cat];
      btn.classList.toggle("off", !activeCats[cat]);
      render();
    });
  });

  if (flowToggle) {
    flowToggle.addEventListener("click", function () {
      flowsOn = !flowsOn;
      flowToggle.setAttribute("aria-pressed", flowsOn ? "true" : "false");
      flowToggle.classList.toggle("off", !flowsOn);
      render();
    });
  }

  if (linkToggle) {
    linkToggle.addEventListener("click", function () {
      linksOn = !linksOn;
      linkToggle.setAttribute("aria-pressed", linksOn ? "true" : "false");
      linkToggle.classList.toggle("off", !linksOn);
      render();
    });
  }

  /* 版面的上下留白交给浏览器去量,不写死。
     控制坞会随时代带、时代注、筛选胶囊换行而长高缩矮,
     之前几处手写的 248/252/470 就是这么跟实际值走散的,
     地球下缘被压掉一截、面板叠到坞上都是同一个根因。 */
  function measureChrome() {
    var root = document.documentElement;
    var dock = document.querySelector(".tl-dock");
    var bar = document.querySelector(".tl-topbar");
    /* 坞是 fixed 贴底的,真正占掉的是"从视口底边往上"这一段 */
    if (dock) {
      var r = dock.getBoundingClientRect();
      root.style.setProperty("--dock-h", Math.round(window.innerHeight - r.top) + "px");
    }
    if (bar) {
      root.style.setProperty("--top-h", Math.round(bar.getBoundingClientRect().bottom) + "px");
    }
  }

  buildEraBand();
  refreshStatuses();
  render();
  measureChrome();
  if (window.ResizeObserver) {
    var chromeRO = new ResizeObserver(measureChrome);
    [".tl-dock", ".tl-topbar"].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) chromeRO.observe(el);
    });
  }
  window.addEventListener("resize", measureChrome);
  requestAnimationFrame(loop);

  /* 测试与将来的资金流动都要拿到内部状态 */
  window.TL = {
    setYear: function (y) { setYear(y, false); },
    spin: function (d) { Globe.rotation = d; },
    year: function () { return currentYear; },
    waves: function () { return waves; },
    flows: function () { return activeFlows(); },
    links: function () { return activeLinks(); },
    zoom: function (z) { Globe.setZoom(z); },
    openCountry: enterCountry, closeCountry: exitCountry,
    view: function () { return view; },
    countryMarks: function () { return cmarks.map(function (m) {
      return { year: m.ev.year, cls: m.g.getAttribute("class"),
               at: m.g.getAttribute("transform") }; }); },
    cmap: function () { return cmap; },
    gather: gather, cityCountry: cityCountry,
    era: function () { return era; }, eras: ERAS, glyphs: GLYPH,
    drafts: function () { return drafts; }, rows: allRows,
    toggleFlows: function () { flowToggle.click(); },
    globe: Globe
  };
})();
