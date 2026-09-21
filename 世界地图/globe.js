/* 世界历史时间轴 · 球面投影引擎
 *
 * 原始地图数据是 1000x500 的等距圆柱投影(纯 M/L/Z 折线),这里把每个顶点
 * 反解回经纬度,再正射投影到球面。世界数据通过 setWorld() 注入,
 * 所以将来换成按年份的历史疆域快照(苏联、奥匈帝国……)引擎不用改。
 */
var Globe = (function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var R = 100;                       /* 球半径,与 viewBox 同单位 */

  var rot = 0, tilt = -10;           /* 经度旋转 / 视角倾角 */
  /* 缩放上限钉在 4.5:再往上就撑不住了——英国的轮廓在原始数据里只有 54 个顶点
     (整幅世界图宽度的 2.6%),放得更大只会看见多边形的棱角。
     这是数据分辨率的限制,不是投影的限制,换平面地图同样难看。 */
  var zoom = 1, ZOOM_MIN = 1, ZOOM_MAX = 4.5;
  var sinT = Math.sin(tilt * D2R), cosT = Math.cos(tilt * D2R);
  var countries = [], paths = [], landGroup = null;

  function setZoom(z) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    if (onZoom) onZoom(zoom);
  }
  var onZoom = null;

  function setTilt(t) {
    tilt = Math.max(-75, Math.min(75, t));
    sinT = Math.sin(tilt * D2R); cosT = Math.cos(tilt * D2R);
  }

  /* ---------- 数据 ---------- */
  /* 等距圆柱像素 → 经纬度 */
  function toLngLat(x, y) { return [x / 1000 * 360 - 180, 90 - y / 500 * 180]; }

  function setWorld(raw) {
    countries = raw.map(function (c) {
      var rings = c.d.split("Z").filter(function (s) { return s.trim(); }).map(function (sub) {
        return sub.replace(/^M/, "").split("L").map(function (p) {
          var a = p.split(","), ll = toLngLat(parseFloat(a[0]), parseFloat(a[1]));
          var lat = ll[1] * D2R;
          /* 顶点的三角函数与旋转无关,预先算好,每帧省掉一半开销 */
          return { lng: ll[0] * D2R, sinLat: Math.sin(lat), cosLat: Math.cos(lat) };
        });
      });
      return { n: c.n, rings: rings };
    });
    if (landGroup) buildPaths();
  }

  function buildPaths() {
    landGroup.innerHTML = "";
    paths = countries.map(function (c) {
      var p = document.createElementNS(NS, "path");
      p.setAttribute("class", "globe-land");
      p.appendChild(document.createElementNS(NS, "title")).textContent = c.n;
      landGroup.appendChild(p);
      return p;
    });
  }

  function mount(group) { landGroup = group; if (countries.length) buildPaths(); }

  /* ---------- canvas 渲染 ----------
   * 176 条每帧都在变的 SVG 路径,浏览器栅格化本身就把帧率封在 35fps 左右
   * (实测:JS 只占 3.5ms/帧,余下全是渲染)。canvas 一次性描完所有线段,
   * 代价与顶点数成正比而不是与路径元素数成正比。
   */
  var cv = null, cx2 = null, cssSize = 0, dpr = 1;
  function mountCanvas(canvas) {
    cv = canvas; cx2 = canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
  }
  function resizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cssSize = cv.clientWidth || 1;
    cv.width = Math.round(cssSize * dpr);
    cv.height = Math.round(cssSize * dpr);
  }
  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function renderCanvas() {
    if (!cx2) return;
    if (cv.clientWidth && Math.abs(cv.clientWidth - cssSize) > 1) resizeCanvas();
    var S = cv.width, half = S / 2;
    /* viewBox 是 -120..120,球半径 100 → 画布上的球半径 */
    var k = (S / 240) * R * zoom;
    cx2.clearRect(0, 0, S, S);

    /* 海洋:偏离中心的径向渐变,球体才有体积感 */
    var g = cx2.createRadialGradient(half - k * 0.32, half - k * 0.44, k * 0.05, half, half, k);
    g.addColorStop(0, css("--globe-sea-1", "#26355e"));
    g.addColorStop(0.68, css("--globe-sea-2", "#151f3d"));
    g.addColorStop(1, css("--globe-sea-3", "#0a0f22"));
    cx2.beginPath(); cx2.arc(half, half, k, 0, Math.PI * 2); cx2.fillStyle = g; cx2.fill();

    cx2.fillStyle = css("--globe-land", "#5a6796");
    cx2.strokeStyle = css("--globe-stroke", "rgba(91,106,156,.85)");
    cx2.lineWidth = Math.max(0.5, (S / 240) * 0.35);
    cx2.lineJoin = "round";

    var sc = S / 240;
    for (var i = 0; i < countries.length; i++) {
      var rings = countries[i].rings;
      cx2.beginPath();
      for (var j = 0; j < rings.length; j++) {
        var ring = rings[j], open = false;
        for (var m = 0; m < ring.length; m++) {
          var v = ring[m], q = projectRad(v.lng, v.sinLat, v.cosLat, 0);
          if (!q) { open = false; continue; }
          var X = half + q[0] * sc, Y = half + q[1] * sc;
          if (open) cx2.lineTo(X, Y); else cx2.moveTo(X, Y);
          open = true;
        }
        if (open) cx2.closePath();
      }
      cx2.fill(); cx2.stroke();
    }
  }

  /* ---------- 投影 ----------
   * 正射投影:z 是朝向观察者的分量。z<0 即球体背面,被自己挡住。
   * alt>0 的点(抬起的弧线)如果落在球体轮廓之外,即使 z<0 也看得见。
   */
  function project(lngDeg, latDeg, alt) {
    var lat = latDeg * D2R;
    return projectRad(lngDeg * D2R, Math.sin(lat), Math.cos(lat), alt);
  }
  function projectRad(lng, sinLat, cosLat, alt) {
    var l = lng - rot * D2R, cl = Math.cos(l), sl = Math.sin(l);
    var z = sinT * sinLat + cosT * cosLat * cl;        /* 朝向观察者 */
    var r = R * zoom * (1 + (alt || 0));
    var x = r * cosLat * sl;
    var y = -r * (cosT * sinLat - sinT * cosLat * cl);
    /* 表面点(alt=0)的 x²+y² 恒等于 R²,浮点误差会让地平线附近 z<0 的点
       侥幸通过轮廓判据,于是跨球连成假直线。轮廓豁免只给抬起的弧线用。 */
    var Rz = R * zoom;
    if (z < 0 && (!alt || (x * x + y * y) <= Rz * Rz)) return null;
    return [x, y];
  }
  function visible(lngDeg, latDeg) { return project(lngDeg, latDeg, 0) !== null; }
  /* 视深:1 = 正对镜头,0 = 正在地平线上。侧视的圆环会被压成一条缝,
     上层据此淡出,免得它看起来像条画错的直线 */
  function depth(lngDeg, latDeg) {
    var p = latDeg * D2R, l = lngDeg * D2R - rot * D2R;
    return sinT * Math.sin(p) + cosT * Math.cos(p) * Math.cos(l);
  }

  /* ---------- 画陆地 ---------- */
  function renderLand() {
    for (var i = 0; i < countries.length; i++) {
      var rings = countries[i].rings, out = [];
      for (var j = 0; j < rings.length; j++) {
        var ring = rings[j], open = false;
        for (var k = 0; k < ring.length; k++) {
          var v = ring[k], q = projectRad(v.lng, v.sinLat, v.cosLat, 0);
          if (!q) { open = false; continue; }          /* 转到背面就断开,不硬连 */
          out.push(open ? "L" : "M", q[0].toFixed(1), ",", q[1].toFixed(1));
          open = true;
        }
        if (open) out.push("Z");
      }
      paths[i].setAttribute("d", out.join(""));
    }
  }

  /* ---------- 球面圆环:冲击波 ----------
   * 到震中角距为 angDeg 的所有点。angDeg 增大时它会贴着球面爬,
   * 绕过地平线、从另一侧绕回来——平面地图做不到这件事。
   */
  function ringPath(lngDeg, latDeg, angDeg, step) {
    var p0 = latDeg * D2R, l0 = lngDeg * D2R, t = angDeg * D2R;
    var st = Math.sin(t), ct = Math.cos(t), sp = Math.sin(p0), cp = Math.cos(p0);
    var out = [], open = false;
    for (var a = 0; a <= 360; a += (step || 4)) {
      var b = a * D2R;
      var lat = Math.asin(sp * ct + cp * st * Math.cos(b));
      var lng = l0 + Math.atan2(Math.sin(b) * st * cp, ct - sp * Math.sin(lat));
      var q = projectRad(lng, Math.sin(lat), Math.cos(lat), 0);
      if (!q) { open = false; continue; }
      out.push(open ? "L" : "M", q[0].toFixed(1), ",", q[1].toFixed(1));
      open = true;
    }
    return out.join("");
  }

  /* ---------- 大圆弧:两点间的最短路径 ----------
   * 资金流动、因果连线都走这里。lift 把弧线抬离球面,
   * 抬起的部分即使在球体背面方向,只要落在轮廓外依然可见。
   */
  function lerpPoint(a, b, t) {
    var v1 = toVec(a[0], a[1]), v2 = toVec(b[0], b[1]);
    var d = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    var om = Math.acos(Math.max(-1, Math.min(1, d)));
    if (om < 1e-9) return a.slice();
    var s = Math.sin(om), k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s;
    var v = [v1[0] * k1 + v2[0] * k2, v1[1] * k1 + v2[1] * k2, v1[2] * k1 + v2[2] * k2];
    var m = Math.hypot(v[0], v[1], v[2]);
    return [Math.atan2(v[1] / m, v[0] / m) * R2D, Math.asin(v[2] / m) * R2D];
  }
  function toVec(lngDeg, latDeg) {
    var p = latDeg * D2R, l = lngDeg * D2R;
    return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  }
  /* 两点间的球面角距(度)。抬升高度按它缩放:短程贴着球走,跨洋才拱起来 */
  function angleBetween(a, b) {
    var v1 = toVec(a[0], a[1]), v2 = toVec(b[0], b[1]);
    var d = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    return Math.acos(Math.max(-1, Math.min(1, d))) * R2D;
  }
  /* 端点在整条弧的生命周期里都不变,预备一次即可。
     原先每取一个点都重算两端的单位向量,56 步就白算 112 次——实测掉到 43fps。 */
  function prepArc(a, b) {
    var v1 = toVec(a[0], a[1]), v2 = toVec(b[0], b[1]);
    var d = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    var om = Math.acos(Math.max(-1, Math.min(1, d)));
    return { v1: v1, v2: v2, om: om, sin: Math.sin(om) };
  }
  function arcPointFrom(pr, t, lift) {
    var lat, lng;
    if (pr.om < 1e-9) { lng = Math.atan2(pr.v1[1], pr.v1[0]) * R2D; lat = Math.asin(pr.v1[2]) * R2D; }
    else {
      var k1 = Math.sin((1 - t) * pr.om) / pr.sin, k2 = Math.sin(t * pr.om) / pr.sin;
      var x = pr.v1[0] * k1 + pr.v2[0] * k2, y = pr.v1[1] * k1 + pr.v2[1] * k2, z = pr.v1[2] * k1 + pr.v2[2] * k2;
      var m = Math.sqrt(x * x + y * y + z * z);
      lng = Math.atan2(y / m, x / m) * R2D; lat = Math.asin(z / m) * R2D;
    }
    return project(lng, lat, (lift || 0) * Math.sin(Math.PI * t));
  }
  function arcPathFrom(pr, opts) {
    opts = opts || {};
    var n = opts.steps || 64, lift = opts.lift || 0;
    var out = [], open = false;
    for (var i = 0; i <= n; i++) {
      var q = arcPointFrom(pr, i / n, lift);
      if (!q) { open = false; continue; }
      out.push(open ? "L" : "M", q[0].toFixed(1), ",", q[1].toFixed(1));
      open = true;
    }
    return out.join("");
  }
  function arcPath(a, b, opts) { return arcPathFrom(prepArc(a, b), opts); }
  function arcPointAt(a, b, t, lift) { return arcPointFrom(prepArc(a, b), t, lift); }

  /* ---------- 反投影与点选 ----------
   * 陆地画在 canvas 上,没有 DOM 可以挂点击事件。改成把屏幕坐标反解回经纬度,
   * 再对每个国家的多边形做射线法判定——点击时才算一次,不进每帧开销。
   */
  function unproject(X, Y) {
    var Rz = R * zoom;
    var xu = X / Rz, yu = -Y / Rz;               /* 屏幕 y 向下,几何里向上 */
    var rho = Math.sqrt(xu * xu + yu * yu);
    if (rho > 1) return null;                    /* 点在球外 */
    if (rho < 1e-9) return [rot, tilt];          /* 正中心:视图中心纬度就等于 tilt */
    var c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
    var p0 = tilt * D2R;
    var lat = Math.asin(cc * Math.sin(p0) + yu * sc * Math.cos(p0) / rho);
    var lng = rot * D2R + Math.atan2(xu * sc, rho * cc * Math.cos(p0) - yu * sc * Math.sin(p0));
    lng = lng * R2D;
    while (lng > 180) lng -= 360;
    while (lng < -180) lng += 360;
    return [lng, lat * R2D];
  }

  /* 射线法:数一条向右的射线穿过多边形边界几次 */
  function inRing(ring, lng, lat) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = Math.asin(ring[i].sinLat) * R2D, xi = ring[i].lng * R2D;
      var yj = Math.asin(ring[j].sinLat) * R2D, xj = ring[j].lng * R2D;
      if (Math.abs(xi - xj) > 180) continue;     /* 跨越日界线的边,跳过 */
      if ((yi > lat) !== (yj > lat) &&
          lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function countryAt(lng, lat) {
    for (var i = 0; i < countries.length; i++) {
      var rings = countries[i].rings;
      for (var j = 0; j < rings.length; j++) {
        if (inRing(rings[j], lng, lat)) return countries[i].n;
      }
    }
    return null;
  }
  /* 屏幕坐标(viewBox 单位) → 国家名 */
  function pick(X, Y) {
    var ll = unproject(X, Y);
    return ll ? { lng: ll[0], lat: ll[1], country: countryAt(ll[0], ll[1]) } : null;
  }

  /* 国家的顶点平均位置——用来把地球转过去。不是严格的形心,但够用 */
  function aimOf(name) {
    for (var i = 0; i < countries.length; i++) {
      if (countries[i].n !== name) continue;
      var best = null, bestN = 0;
      countries[i].rings.forEach(function (ring) {
        if (ring.length <= bestN) return;        /* 取顶点最多的那个环,避开小离岛 */
        bestN = ring.length; best = ring;
      });
      if (!best) return null;
      var sx = 0, sy = 0, sz = 0;
      best.forEach(function (v) {
        sx += v.cosLat * Math.cos(v.lng); sy += v.cosLat * Math.sin(v.lng); sz += v.sinLat;
      });
      var m = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      return [Math.atan2(sy / m, sx / m) * R2D, Math.asin(sz / m) * R2D];
    }
    return null;
  }
  function countryNames() { return countries.map(function (c) { return c.n; }); }

  /* 单个国家的轮廓,画成小印章用:投影到一个 size×size 的方框里 */
  function outlinePath(name, size) {
    for (var i = 0; i < countries.length; i++) {
      if (countries[i].n !== name) continue;
      var pts = [];
      countries[i].rings.forEach(function (ring) {
        pts.push(ring.map(function (v) { return [v.lng * R2D, Math.asin(v.sinLat) * R2D]; }));
      });
      var all = [].concat.apply([], pts);
      var xs = all.map(function (p) { return p[0]; }), ys = all.map(function (p) { return p[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      /* 按纬度做一次余弦校正,否则高纬国家会被横向拉扁 */
      var kx = Math.cos((y0 + y1) / 2 * D2R);
      var w = (x1 - x0) * kx, h = y1 - y0;
      var sc = (size * 0.86) / Math.max(w, h), ox = (size - w * sc) / 2, oy = (size - h * sc) / 2;
      return pts.map(function (ring) {
        return ring.map(function (p, k) {
          var X = ox + (p[0] - x0) * kx * sc, Y = oy + (y1 - p[1]) * sc;
          return (k ? "L" : "M") + X.toFixed(1) + "," + Y.toFixed(1);
        }).join("") + "Z";
      }).join("");
    }
    return "";
  }

  /* ---------- 旋转 ---------- */
  var spinTarget = null, autoSpin = 0.035, idleUntil = 0, vel = 0, dragging = false;

  function normDelta(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }

  /* 把某个经纬度转到正面 */
  function rotateTo(lngDeg, latDeg) {
    spinTarget = { lng: lngDeg, lat: latDeg };
    idleUntil = Date.now() + 2600;
  }

  function step(dt) {
    if (dragging) return;
    if (spinTarget) {
      var dl = normDelta(spinTarget.lng - rot);
      /* 视图中心的纬度就等于 tilt:在 l=0 处 z = cos(φ - tilt),φ = tilt 时最大。
         原来写成 -lat*0.45,对着 54°N 调用会把镜头转到 24°S——差 78 度。
         zoom=1 时整个半球都在视野里看不出来,一放大就全是海。 */
      var dt2 = spinTarget.lat - tilt;
      if (Math.abs(dl) < 0.4 && Math.abs(dt2) < 0.4) { spinTarget = null; }
      else { rot += dl * 0.07; setTilt(tilt + dt2 * 0.07); }
      return;
    }
    if (Math.abs(vel) > 0.002) { rot += vel; vel *= 0.94; }   /* 拖拽惯性 */
    else if (Date.now() > idleUntil) rot += (autoSpin / zoom) * dt;  /* 空闲自转,放大后放慢 */
  }

  function attachDrag(el) {
    var px = 0, py = 0, moved = false;
    function down(e) {
      dragging = true; moved = false; vel = 0;
      var p = pt(e); px = p.x; py = p.y;
      /* 注意:这里不能抓指针捕获。一旦在 pointerdown 就 setPointerCapture,
         后续事件会被重定向到 SVG 本身,click 就落不到标记上了。
         等真正动起来再抓。 */
    }
    function move(e) {
      if (!dragging) return;
      var p = pt(e), dx = p.x - px, dy = p.y - py;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true;
        if (el.setPointerCapture && e.pointerId != null) el.setPointerCapture(e.pointerId);
      }
      var k = 0.28 / zoom;                    /* 放大后手感不该变快 */
      rot += dx * k; setTilt(tilt + dy * (0.22 / zoom));
      vel = dx * k; px = p.x; py = p.y;
      spinTarget = null;
      e.preventDefault();
    }
    function up() { if (!dragging) return; dragging = false; idleUntil = Date.now() + 4000; }
    function pt(e) { return e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }; }
    /* 滚轮缩放:以指数步进,快慢手感一致 */
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0013));
      idleUntil = Date.now() + 2500;
    }, { passive: false });

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return { didDrag: function () { return moved; } };
  }

  return {
    R: R,
    setWorld: setWorld, mount: mount, mountCanvas: mountCanvas, renderCanvas: renderCanvas,
    project: project, visible: visible, depth: depth,
    renderLand: renderLand, ringPath: ringPath,
    arcPath: arcPath, arcPointAt: arcPointAt, lerpPoint: lerpPoint, angleBetween: angleBetween,
    prepArc: prepArc, arcPathFrom: arcPathFrom, arcPointFrom: arcPointFrom,
    rotateTo: rotateTo, step: step, attachDrag: attachDrag,
    unproject: unproject, countryAt: countryAt, pick: pick,
    aimOf: aimOf, countryNames: countryNames, outlinePath: outlinePath,
    get rotation() { return rot; }, set rotation(v) { rot = v; },
    get tilt() { return tilt; }, setTilt: setTilt,
    get zoom() { return zoom; }, setZoom: setZoom,
    ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX,
    onZoom: function (cb) { onZoom = cb; }
  };
})();
