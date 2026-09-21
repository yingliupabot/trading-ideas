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

  var currentYear = 1720;
  var activeCats = { "经济": true, "政治": true, "战争": true, "科技": true, "文化": true };
  var timer = null, waves = [], openIdx = null;

  Globe.setWorld(WORLD_MAP);
  Globe.mount(document.getElementById("tl-land"));
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
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "tl-dot");
    g.appendChild(hit); g.appendChild(halo); g.appendChild(dot);
    g.addEventListener("click", function (e) {
      e.stopPropagation();
      if (drag.didDrag()) return;              /* 拖完球别误触发弹窗 */
      var c = at(ev, i);
      openIdx = i; fillPopup(ev); Globe.rotateTo(c[0], c[1]); paint();
    });
    markerLayer.appendChild(g);
    return { ev: ev, g: g, dot: dot, halo: halo };
  });
  svg.addEventListener("click", function () { openIdx = null; popup.hidden = true; });

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

  /* ---------- 每帧重画 ---------- */
  function paint() {
    Globe.renderLand();

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
    });

    var out = [];
    waves.forEach(function (w) {
      var d = Globe.depth(w.c[0], w.c[1]);
      if (d <= 0.12) return;                 /* 震中贴近地平线:圆环被压成细缝,不画 */
      var fade = Math.min(1, (d - 0.12) / 0.3);
      var life = Math.max(0, 1 - w.th / 100);
      out.push('<path class="tl-wave cat-' + w.ev.cat + '" d="' + Globe.ringPath(w.c[0], w.c[1], w.th) +
               '" opacity="' + (life * fade).toFixed(2) + '"/>');
    });
    waveLayer.innerHTML = out.join("");

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
    if (!todays.length) {
      nowList.innerHTML = '<p class="tl-empty">这一年，世界安静得像深呼吸——拖动时间轴，去有故事的年份看看。</p>';
    } else {
      nowList.innerHTML = todays.map(function (ev) {
        var i = TIMELINE_EVENTS.indexOf(ev);
        var link = ev.chapter ? ' <a href="' + ev.chapter + '">📖 章节</a>' : "";
        return '<div class="tl-now-item" data-idx="' + i + '">' +
          '<span class="tag-pill tl-cat-' + ev.cat + '">' + ev.cat + '</span>' +
          '<strong>' + ev.title + '</strong>' +
          '<span class="tl-now-place">' + ev.city + '，' + ev.country + '</span>' +
          '<p>' + ev.summary + '</p>' + link + '</div>';
      }).join("");
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

  render();
  requestAnimationFrame(loop);

  /* 测试与将来的资金流动都要拿到内部状态 */
  window.TL = {
    setYear: function (y) { setYear(y, false); },
    spin: function (d) { Globe.rotation = d; },
    year: function () { return currentYear; },
    waves: function () { return waves; },
    globe: Globe
  };
})();
