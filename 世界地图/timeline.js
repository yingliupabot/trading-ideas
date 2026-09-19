/* 世界历史时间轴 · 交互逻辑 */
(function () {
  "use strict";

  var W = 1000, H = 500;
  var MIN_YEAR = 1600, MAX_YEAR = 2050;

  function proj(lat, lng) {
    return [(lng + 180) / 360 * W, (90 - lat) / 180 * H];
  }

  var svg = document.getElementById("world-map");
  var slider = document.getElementById("tl-slider");
  var playBtn = document.getElementById("tl-play");
  var yearBadge = document.getElementById("tl-year");
  var nowYear = document.getElementById("tl-now-year");
  var nowList = document.getElementById("tl-now-list");
  var popup = document.getElementById("tl-popup");
  var filterWrap = document.getElementById("tl-filters");

  var NS = "http://www.w3.org/2000/svg";
  var currentYear = 1720;
  var activeCats = { "经济": true, "政治": true, "战争": true, "科技": true, "文化": true };
  var timer = null;
  var markers = [];

  /* ---------- 画地图 ---------- */
  var land = document.getElementById("tl-land");
  WORLD_MAP.forEach(function (c) {
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", c.d);
    p.setAttribute("class", "tl-country");
    p.appendChild(document.createElementNS(NS, "title")).textContent = c.n;
    land.appendChild(p);
  });

  /* ---------- 事件标记 ---------- */
  var markerLayer = document.getElementById("tl-markers");
  TIMELINE_EVENTS.forEach(function (ev, i) {
    var xy = proj(ev.lat, ev.lng);
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "tl-marker cat-" + ev.cat);
    g.setAttribute("transform", "translate(" + xy[0] + "," + xy[1] + ")");
    g.dataset.idx = i;

    var halo = document.createElementNS(NS, "circle");
    halo.setAttribute("r", "14");
    halo.setAttribute("class", "tl-halo");
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("r", "6");
    dot.setAttribute("class", "tl-dot");
    var spark = document.createElementNS(NS, "text");
    spark.setAttribute("class", "tl-spark");
    spark.setAttribute("y", "-16");
    spark.textContent = "✦";

    g.appendChild(halo);
    g.appendChild(dot);
    g.appendChild(spark);
    g.addEventListener("click", function (e) {
      e.stopPropagation();
      showPopup(ev, xy);
    });
    markerLayer.appendChild(g);
    markers.push({ ev: ev, g: g, xy: xy });
  });

  svg.addEventListener("click", hidePopup);

  /* ---------- 弹窗 ---------- */
  function showPopup(ev, xy) {
    var linkHtml = ev.chapter
      ? '<a class="tl-popup-link" href="' + ev.chapter + '">📖 去看绘本章节 →</a>'
      : '<a class="tl-popup-link" href="../notes.html">📖 去读书笔记目录 →</a>';
    popup.innerHTML =
      '<span class="tag-pill tl-cat-' + ev.cat + '">' + ev.cat + '</span>' +
      '<h4>' + ev.year + ' · ' + ev.title + '</h4>' +
      '<p class="tl-popup-place">' + ev.city + '，' + ev.country + '</p>' +
      '<p>' + ev.summary + '</p>' + linkHtml;
    /* 定位：靠近标记，限制在容器内 */
    var px = (xy[0] / W) * 100, py = (xy[1] / H) * 100;
    popup.style.left = Math.min(Math.max(px, 2), 62) + "%";
    popup.style.top = Math.min(Math.max(py - 8, 2), 55) + "%";
    popup.hidden = false;
  }
  function hidePopup() { popup.hidden = true; }

  /* ---------- 年份刷新 ---------- */
  function render() {
    yearBadge.textContent = currentYear;
    nowYear.textContent = currentYear;
    slider.value = currentYear;

    markers.forEach(function (m) {
      var ev = m.ev;
      var g = m.g;
      var visible = activeCats[ev.cat];
      var state = "";
      if (ev.year > currentYear) state = "future";
      else if (ev.year === currentYear) state = "now";
      else state = "past";
      g.setAttribute("class", "tl-marker cat-" + ev.cat + " st-" + state);
      g.style.display = visible && state !== "future" ? "" : "none";
    });

    var todays = TIMELINE_EVENTS.filter(function (ev) {
      return ev.year === currentYear && activeCats[ev.cat];
    });
    if (!todays.length) {
      nowList.innerHTML = '<p class="tl-empty">这一年，世界安静得像深呼吸——拖动时间轴，去有故事的年份看看。</p>';
    } else {
      nowList.innerHTML = todays.map(function (ev) {
        var i = TIMELINE_EVENTS.indexOf(ev);
        var link = ev.chapter
          ? ' <a href="' + ev.chapter + '">📖 章节</a>'
          : "";
        return '<div class="tl-now-item" data-idx="' + i + '">' +
          '<span class="tag-pill tl-cat-' + ev.cat + '">' + ev.cat + '</span>' +
          '<strong>' + ev.title + '</strong>' +
          '<span class="tl-now-place">' + ev.city + '，' + ev.country + '</span>' +
          '<p>' + ev.summary + '</p>' + link + '</div>';
      }).join("");
      nowList.querySelectorAll(".tl-now-item").forEach(function (el) {
        el.addEventListener("click", function () {
          var m = markers[+el.dataset.idx];
          showPopup(m.ev, m.xy);
        });
      });
    }
    hidePopup();
  }

  /* ---------- 时间轴拖拽 ---------- */
  slider.addEventListener("input", function () {
    stopPlay();
    currentYear = +slider.value;
    render();
  });

  /* ---------- 播放 ---------- */
  function stopPlay() {
    if (timer) { clearInterval(timer); timer = null; }
    playBtn.textContent = "▶";
    playBtn.classList.remove("playing");
  }
  playBtn.addEventListener("click", function () {
    if (timer) { stopPlay(); return; }
    if (currentYear >= MAX_YEAR) currentYear = MIN_YEAR;
    playBtn.textContent = "⏸";
    playBtn.classList.add("playing");
    timer = setInterval(function () {
      currentYear += 2;
      if (currentYear >= MAX_YEAR) { currentYear = MAX_YEAR; stopPlay(); }
      render();
    }, 160);
  });

  /* ---------- 分类筛选 ---------- */
  filterWrap.querySelectorAll("button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var cat = btn.dataset.cat;
      activeCats[cat] = !activeCats[cat];
      btn.classList.toggle("off", !activeCats[cat]);
      render();
    });
  });

  render();
})();
