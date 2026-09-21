/* 世界历史时间轴 · 交互逻辑(球面版)
 * 投影与球面几何在 globe.js;这里只管事件、年份与渲染循环。
 */
(function () {
  "use strict";

  var MIN_YEAR = 1600, MAX_YEAR = 2050;
  var NS = "http://www.w3.org/2000/svg";
  var CALM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  var rhumbLayer = document.getElementById("tl-rhumbs");
  var dossier = document.getElementById("tl-dossier");
  var dossierSheet = document.getElementById("tl-dossier-sheet");

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
    hit.setAttribute("r", "7"); hit.setAttribute("class", "tl-hit");
    var halo = document.createElementNS(NS, "circle");
    halo.setAttribute("r", "4"); halo.setAttribute("class", "tl-halo");
    /* 辉光用一层大而透明的同色圆,不用 feGaussianBlur。
       滤镜要对每个移动元素逐帧重新求值,实测三处 bloom 吃掉 11fps。 */
    var glow = document.createElementNS(NS, "circle");
    glow.setAttribute("class", "tl-glow");
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "tl-dot");
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

  function openDossier(en) {
    var d = gather(en);
    document.getElementById("tl-seal-path").setAttribute("d", Globe.outlinePath(en, 60));
    document.getElementById("tl-dossier-name").textContent = d.cn;
    document.getElementById("tl-dossier-sub").textContent =
      d.cn === d.en ? "" : d.en;

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
             '<span>往 events.js 里加一行，这张纸就有字了。</span></p>';
    }
    document.getElementById("tl-dossier-body").innerHTML = html;

    dossier.hidden = false;
    /* 强制回流一次,否则加 class 和去 hidden 在同一帧,动画不触发 */
    void dossierSheet.offsetWidth;
    dossierSheet.classList.add("open");

    var aim = Globe.aimOf(en);
    if (aim) { Globe.rotateTo(aim[0], aim[1]); Globe.setZoom(2.2); }
  }
  function closeDossier() {
    dossierSheet.classList.remove("open");
    Globe.setZoom(1);
    setTimeout(function () { dossier.hidden = true; }, 420);
  }
  document.getElementById("tl-dossier-close").addEventListener("click", closeDossier);
  dossier.addEventListener("click", function (e) { if (e.target === dossier) closeDossier(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !dossier.hidden) closeDossier();
  });

  /* 点空白海面关弹窗,点陆地开卷宗 */
  svg.addEventListener("click", function (e) {
    if (drag.didDrag()) return;
    var box = svg.getBoundingClientRect();
    var X = (e.clientX - box.left) / box.width * 240 - 120;
    var Y = (e.clientY - box.top) / box.height * 240 - 120;
    var hit = Globe.pick(X, Y);
    if (hit && hit.country) openDossier(hit.country);
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
      m.g.setAttribute("class", "tl-marker cat-" + ev.cat + (fresh ? " st-now" : " st-past"));
      m.dot.setAttribute("r", fresh ? 3 : 1.9);
      m.glow.setAttribute("r", fresh ? 7 : 4.5);
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

    placePopup();
  }

  /* ---------- 年份 ---------- */
  function render() {
    yearBadge.textContent = currentYear;
    nowYear.textContent = currentYear;
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
    if (currentYear >= MAX_YEAR) { currentYear = MIN_YEAR; waves.length = 0; openIdx = null; }
    playBtn.textContent = "⏸"; playBtn.classList.add("playing");
    timer = setInterval(function () {
      var y = currentYear + 2;
      if (y >= MAX_YEAR) { setYear(MAX_YEAR, true); stopPlay(); return; }
      setYear(y, true);
    }, 160);
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

  render();
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
    openCountry: openDossier, closeCountry: closeDossier,
    gather: gather, cityCountry: cityCountry,
    toggleFlows: function () { flowToggle.click(); },
    globe: Globe
  };
})();
