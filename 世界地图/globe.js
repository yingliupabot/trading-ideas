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
  var sinT = Math.sin(tilt * D2R), cosT = Math.cos(tilt * D2R);
  var countries = [], paths = [], landGroup = null;

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
    var r = R * (1 + (alt || 0));
    var x = r * cosLat * sl;
    var y = -r * (cosT * sinLat - sinT * cosLat * cl);
    /* 表面点(alt=0)的 x²+y² 恒等于 R²,浮点误差会让地平线附近 z<0 的点
       侥幸通过轮廓判据,于是跨球连成假直线。轮廓豁免只给抬起的弧线用。 */
    if (z < 0 && (!alt || (x * x + y * y) <= R * R)) return null;
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
  function arcPath(a, b, opts) {
    opts = opts || {};
    var n = opts.steps || 64, lift = opts.lift || 0, t1 = opts.to == null ? 1 : opts.to;
    var out = [], open = false;
    for (var i = 0; i <= n; i++) {
      var t = (i / n) * t1;
      var ll = lerpPoint(a, b, t);
      var q = project(ll[0], ll[1], lift * Math.sin(Math.PI * t));
      if (!q) { open = false; continue; }
      out.push(open ? "L" : "M", q[0].toFixed(1), ",", q[1].toFixed(1));
      open = true;
    }
    return out.join("");
  }
  /* 弧线上 t 处的屏幕坐标——粒子沿流动路径移动时用 */
  function arcPointAt(a, b, t, lift) {
    var ll = lerpPoint(a, b, t);
    return project(ll[0], ll[1], (lift || 0) * Math.sin(Math.PI * t));
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
      var dt2 = (-spinTarget.lat * 0.45) - tilt;      /* 稍微仰视,别让极点顶到中间 */
      if (Math.abs(dl) < 0.4 && Math.abs(dt2) < 0.4) { spinTarget = null; }
      else { rot += dl * 0.07; setTilt(tilt + dt2 * 0.07); }
      return;
    }
    if (Math.abs(vel) > 0.002) { rot += vel; vel *= 0.94; }   /* 拖拽惯性 */
    else if (Date.now() > idleUntil) rot += autoSpin * dt;    /* 空闲自转 */
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
      rot += dx * 0.28; setTilt(tilt + dy * 0.22);
      vel = dx * 0.28; px = p.x; py = p.y;
      spinTarget = null;
      e.preventDefault();
    }
    function up() { if (!dragging) return; dragging = false; idleUntil = Date.now() + 4000; }
    function pt(e) { return e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }; }
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return { didDrag: function () { return moved; } };
  }

  return {
    R: R,
    setWorld: setWorld, mount: mount,
    project: project, visible: visible, depth: depth,
    renderLand: renderLand, ringPath: ringPath,
    arcPath: arcPath, arcPointAt: arcPointAt, lerpPoint: lerpPoint,
    rotateTo: rotateTo, step: step, attachDrag: attachDrag,
    get rotation() { return rot; }, set rotation(v) { rot = v; },
    get tilt() { return tilt; }, setTilt: setTilt
  };
})();
