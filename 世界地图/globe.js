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
  /* 钉住后备画布的尺寸。视图切换时球一边飞一边缩,布局宽度先跳到落点,
     画布跟着重画成小的,飞行途中被放大就是糊的。钉在大的那一档,落地再放开。 */
  var pinnedSize = null;
  function pinSize(px) { pinnedSize = px || null; resizeCanvas(); renderCanvas(); }
  function resizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cssSize = pinnedSize || cv.clientWidth || 1;
    cv.width = Math.round(cssSize * dpr);
    cv.height = Math.round(cssSize * dpr);
  }
  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function renderCanvas() {
    if (!cx2) return;
    if (!pinnedSize && cv.clientWidth && Math.abs(cv.clientWidth - cssSize) > 1) resizeCanvas();
    var S = cv.width, half = S / 2;
    /* viewBox 是 -120..120,球半径 100 → 画布上的球半径 */
    var k = (S / 240) * R * zoom;
    cx2.clearRect(0, 0, S, S);

    /* 先在纸上投一道影。球和纸的色值本来就近,靠投影把球托起来
       比把海压暗管用——压暗只会得到一个木球(试过,像泥巴)。
       画在这里而不是用 CSS:影子跟着 k 走,缩放时自动对齐球缘。 */
    var cast = css("--globe-cast", "");
    if (cast) {
      cx2.save();
      cx2.shadowColor = cast;
      cx2.shadowBlur = k * 0.16;
      cx2.shadowOffsetY = k * 0.07;
      cx2.beginPath(); cx2.arc(half, half, k, 0, Math.PI * 2);
      cx2.fillStyle = "#000";   /* 填什么都行,下一步就被海盖住,只留外溢的那圈影 */
      cx2.fill();
      cx2.restore();
    }

    /* 海洋:偏离中心的径向渐变,球体才有体积感 */
    var g = cx2.createRadialGradient(half - k * 0.22, half - k * 0.30, k * 0.05, half, half, k);
    g.addColorStop(0, css("--globe-sea-1", "#26355e"));
    g.addColorStop(0.68, css("--globe-sea-2", "#151f3d"));
    g.addColorStop(1, css("--globe-sea-3", "#0a0f22"));
    cx2.beginPath(); cx2.arc(half, half, k, 0, Math.PI * 2); cx2.fillStyle = g; cx2.fill();
    /* 球缘描一道墨线。让球读成"纸上的一个物件"靠的是这条线,
       不是把海压暗——压暗只会变成一个木球。 */
    var limb = css("--globe-limb", "");
    if (limb) {
      cx2.lineWidth = Math.max(1.2, (S / 240) * 1.4);
      cx2.strokeStyle = limb;
      cx2.stroke();
    }

    cx2.fillStyle = css("--globe-land", "#5a6796");
    cx2.strokeStyle = css("--globe-stroke", "rgba(91,106,156,.85)");
    cx2.lineWidth = Math.max(0.7, (S / 240) * 0.55);   /* 海岸线要看得出是描过的 */
    cx2.lineJoin = "round";

    var sc = S / 240;
    function trace(rings) {
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
    }
    for (var i = 0; i < countries.length; i++) {
      trace(countries[i].rings);
      cx2.fill(); cx2.stroke();
    }
    /* 鼠标底下的那个国家单独再描一遍,换成高亮色。
       --globe-land-hover 一直定义着却没人用,现在它是"可以看进去"的提示 */
    if (hoverName) {
      for (i = 0; i < countries.length; i++) {
        if (countries[i].n !== hoverName) continue;
        trace(countries[i].rings);
        cx2.fillStyle = css("--globe-land-hover", css("--globe-land", "#5a6796"));
        cx2.fill(); cx2.stroke();
        break;
      }
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

  /* ---------- 球摊平 ----------
   * 同一批顶点,一头是它在球面上的正射位置,一头是它在纸上的位置,
   * 逐帧在两者之间插值。Mapbox 从球切墨卡托用的就是这一招:
   * 屏幕空间直接插,看着就是地壳从球面上剥下来铺平。
   *
   * 关键的简化:视口里的球心 cx,cy 和半径 r 由外面量好传进来,
   * 于是 zoom 和 viewBox 的换算全部抵消掉 ——
   * x = cx + r·cosφ·sinλ,y = cy - r·(cosT·sinφ - sinT·cosφ·cosλ)。
   */
  function morphPrep(name, from, to) {
    var m = countryMap(name, to.w, to.h);
    if (!m) return null;

    /* 旋转和倾角在整段动画里冻住,两头的坐标才都能一次算完 */
    var r0 = rot * D2R, st = sinT, ct = cosT;
    function onSphere(v) {
      var l = v.lng - r0, cl = Math.cos(l), sl = Math.sin(l);
      return {
        sx: from.cx + from.r * v.cosLat * sl,
        sy: from.cy - from.r * (ct * v.sinLat - st * v.cosLat * cl),
        z: st * v.sinLat + ct * v.cosLat * cl
      };
    }
    function conv(rings) {
      return rings.map(function (ring) {
        return ring.map(function (v) {
          var p = onSphere(v);
          p.fx = to.x + v.x; p.fy = to.y + v.y;
          return p;
        });
      });
    }
    var groups = [{ target: true, rings: conv(m.rings) }];
    m.neighbors.forEach(function (c) { groups.push({ target: false, rings: conv(c.rings) }); });

    /* 画框:圆补间成矩形。两边都按周长比例取点,起点都放在右边的中点、
       同向绕,不然形变途中整个框会拧一圈 */
    var N = 128, frame = [];
    var w = to.w, h = to.h, per = 2 * w + 2 * h;
    function onRect(f) {
      var d = f * per;
      if (d < h / 2) return [to.x + w, to.y + h / 2 + d];
      d -= h / 2;
      if (d < w) return [to.x + w - d, to.y + h];
      d -= w;
      if (d < h) return [to.x, to.y + h - d];
      d -= h;
      if (d < w) return [to.x + d, to.y];
      d -= w;
      return [to.x + w, to.y + d];
    }
    for (var i = 0; i < N; i++) {
      var f = i / N, a = f * Math.PI * 2, rp = onRect(f);
      frame.push([from.cx + from.r * Math.cos(a), from.cy + from.r * Math.sin(a), rp[0], rp[1]]);
    }

    function ease(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function draw(g, t, dpr) {
      var e = ease(Math.max(0, Math.min(1, t))), i, j, k;
      var W = g.canvas.width, H = g.canvas.height;
      g.clearRect(0, 0, W, H);

      function framePath() {
        g.beginPath();
        for (i = 0; i < N; i++) {
          var f = frame[i];
          var X = (f[0] + (f[2] - f[0]) * e) * dpr, Y = (f[1] + (f[3] - f[1]) * e) * dpr;
          if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
        }
        g.closePath();
      }

      /* 海:球上是带体积感的径向渐变,纸上是平涂。两层叠着按 e 过渡,
         e=1 时正好等于 SVG 那边的"纸 + 16% 海色",交接才看不出缝 */
      framePath();
      var rr = from.r * dpr;
      var grad = g.createRadialGradient(
        (from.cx - from.r * 0.22) * dpr, (from.cy - from.r * 0.30) * dpr, rr * 0.05,
        from.cx * dpr, from.cy * dpr, rr);
      grad.addColorStop(0, css("--globe-sea-1", "#26355e"));
      grad.addColorStop(0.68, css("--globe-sea-2", "#151f3d"));
      grad.addColorStop(1, css("--globe-sea-3", "#0a0f22"));
      g.fillStyle = grad; g.fill();
      g.globalAlpha = e; g.fillStyle = css("--paper-1", "#e4d4b4"); g.fill();
      g.globalAlpha = 0.16 * e; g.fillStyle = css("--globe-sea-1", "#26355e"); g.fill();
      g.globalAlpha = 1;

      g.save();
      framePath(); g.clip();

      var land = css("--globe-land", "#5a6796");
      var seaMix = css("--globe-sea-2", "#151f3d");
      var ink = css("--ink", "#2b2318");
      var gs = css("--globe-stroke", "rgba(91,106,156,.85)");
      for (k = 0; k < groups.length; k++) {
        var grp = groups[k];
        g.beginPath();
        for (i = 0; i < grp.rings.length; i++) {
          var ring = grp.rings[i];
          for (j = 0; j < ring.length; j++) {
            var v = ring[j];
            var X = (v.sx + (v.fx - v.sx) * e) * dpr, Y = (v.sy + (v.fy - v.sy) * e) * dpr;
            if (j) g.lineTo(X, Y); else g.moveTo(X, Y);
          }
          g.closePath();
        }
        g.fillStyle = land; g.fill();
        /* 邻国在纸上要退成陆海之间的一档中间色。不去解析 color-mix,
           直接把海色按 48% 叠上去 —— 算出来就是同一个值 */
        if (!grp.target) { g.globalAlpha = 0.48 * e; g.fillStyle = seaMix; g.fill(); g.globalAlpha = 1; }
        g.lineJoin = "round";
        g.globalAlpha = 1 - e; g.strokeStyle = gs;
        g.lineWidth = Math.max(0.7, 0.55 * dpr * (from.r / 260)); g.stroke();
        g.globalAlpha = e;
        g.strokeStyle = grp.target ? ink : css("--ink-faint", "rgba(0,0,0,.2)");
        g.lineWidth = (grp.target ? 2 : 0.8) * dpr;
        g.stroke();
        g.globalAlpha = 1;
      }
      g.restore();

      /* 球缘的墨线过渡成纸的上下缘 */
      var limb = css("--globe-limb", "");
      if (limb) {
        framePath();
        g.strokeStyle = limb;
        g.lineWidth = Math.max(1.2, 1.4 * dpr) * (1 - e * 0.35);
        g.stroke();
      }
    }

    return { draw: draw, paper: [to.w, to.h] };
  }

  /* 鼠标底下的国家。null 表示在海上或球外 */
  var hoverName = null;
  function setHover(n) {
    if (n === hoverName) return false;
    hoverName = n;
    return true;                       /* 变了才值得重画 */
  }

  /* ---------- 一个国家的平面地图 ----------
   * 点进国家之后要的不是球面,是把这一块摊平了看。
   * 等距圆柱投影 + 一次纬度余弦校正:高纬国家不会被横向拉扁。
   * 返回的 project 让外面能把城市放到同一套坐标里。
   */
  function countryMap(name, w, h, padFrac) {
    var target = null, i, k;
    for (i = 0; i < countries.length; i++) {
      if (countries[i].n === name) { target = countries[i]; break; }
    }
    if (!target) return null;
    var pad = padFrac == null ? 0.1 : padFrac;

    /* 主岛/大陆那一环定基准。海外飞地(阿拉斯加、法属圭亚那)离主体十万
       八千里,让它们参与包围盒,地图就缩成正中一个点了 */
    var main = target.rings[0];
    for (k = 1; k < target.rings.length; k++) {
      if (target.rings[k].length > main.length) main = target.rings[k];
    }
    /* 经度的平均不能直接加起来除——跨 180° 时 179 和 -179 会平均成 0。
       取单位圆上的平均角 */
    var sx = 0, sy = 0;
    for (k = 0; k < main.length; k++) { sx += Math.cos(main[k].lng); sy += Math.sin(main[k].lng); }
    var anchor = Math.atan2(sy, sx) * R2D;

    /* 把经度挪到离锚点近的那一侧,俄罗斯这种跨 180° 的才连得成一块 */
    function nearLng(lngDeg) {
      var l = lngDeg;
      while (l - anchor > 180) l -= 360;
      while (anchor - l > 180) l += 360;
      return l;
    }
    function toDeg(ring) {
      return ring.map(function (v) {
        return [nearLng(v.lng * R2D), Math.asin(v.sinLat) * R2D];
      });
    }

    /* 包围盒先按主环算,再把离得不远的环并进来(北爱、科西嘉、北海道要留,
       阿拉斯加要丢)。40° 是分界:比它远的基本都是海外领地 */
    var mainDeg = toDeg(main), keep = [mainDeg];
    var x0 = 180, x1 = -180, y0 = 90, y1 = -90;
    function grow(pts) {
      for (var j = 0; j < pts.length; j++) {
        if (pts[j][0] < x0) x0 = pts[j][0];
        if (pts[j][0] > x1) x1 = pts[j][0];
        if (pts[j][1] < y0) y0 = pts[j][1];
        if (pts[j][1] > y1) y1 = pts[j][1];
      }
    }
    grow(mainDeg);
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (k = 0; k < target.rings.length; k++) {
      if (target.rings[k] === main) continue;
      var d = toDeg(target.rings[k]);
      var mx = 0, my = 0;
      for (i = 0; i < d.length; i++) { mx += d[i][0]; my += d[i][1]; }
      mx /= d.length; my /= d.length;
      if (Math.abs(mx - cx) < 40 && Math.abs(my - cy) < 40) { keep.push(d); grow(d); }
    }
    /* 一个国家只有一圈很小的环时(城邦、岛国)包围盒会塌成一条线 */
    if (x1 - x0 < 0.6) { x0 -= 0.3; x1 += 0.3; }
    if (y1 - y0 < 0.6) { y0 -= 0.3; y1 += 0.3; }

    var kx = Math.cos((y0 + y1) / 2 * D2R);
    var bw = (x1 - x0) * kx, bh = y1 - y0;
    var sc = Math.min(w * (1 - pad * 2) / bw, h * (1 - pad * 2) / bh);
    var ox = (w - bw * sc) / 2 - x0 * kx * sc;
    var oy = (h - bh * sc) / 2 + y1 * sc;

    function project(lngDeg, latDeg) {
      return [ox + nearLng(lngDeg) * kx * sc, oy - latDeg * sc];
    }
    function pathOf(ringsDeg) {
      return ringsDeg.map(function (ring) {
        return ring.map(function (p, j) {
          var X = ox + p[0] * kx * sc, Y = oy - p[1] * sc;
          return (j ? "L" : "M") + X.toFixed(1) + "," + Y.toFixed(1);
        }).join("") + "Z";
      }).join("");
    }
    /* 球摊平的动画要拿同一批顶点的两套坐标:纸上的 (x,y) 和球上的经纬度。
       只给 path 字符串的话,外面就得反过来解析一遍字符串 */
    function vertsOf(ringsDeg) {
      return ringsDeg.map(function (ring) {
        return ring.map(function (p) {
          var lngRad = p[0] * D2R, latRad = p[1] * D2R;
          return {
            x: ox + p[0] * kx * sc, y: oy - p[1] * sc,
            lng: lngRad, sinLat: Math.sin(latRad), cosLat: Math.cos(latRad)
          };
        });
      });
    }

    /* 邻国:落进这张纸里的都画上,不然国家是悬空的一块,认不出是哪儿。
       取景范围直接把投影反解出来——按包围盒乘个系数去猜,中国和俄罗斯
       会把全世界一百多个国家都算成邻居 */
    var mx0 = (0 - ox) / (kx * sc), mx1 = (w - ox) / (kx * sc);
    var my1 = oy / sc, my0 = (oy - h) / sc;
    var neighbors = [];
    for (i = 0; i < countries.length; i++) {
      if (countries[i] === target) continue;
      var rs = [], touched = false;
      for (k = 0; k < countries[i].rings.length; k++) {
        var rd = toDeg(countries[i].rings[k]);
        var rx0 = 1e9, rx1 = -1e9, ry0 = 1e9, ry1 = -1e9;
        for (var m = 0; m < rd.length; m++) {
          if (rd[m][0] < rx0) rx0 = rd[m][0];
          if (rd[m][0] > rx1) rx1 = rd[m][0];
          if (rd[m][1] < ry0) ry0 = rd[m][1];
          if (rd[m][1] > ry1) ry1 = rd[m][1];
        }
        /* 两个矩形相交就画:整块比纸还大的国家(点进卢森堡时的德国)
           一个顶点都不在纸里,但它确实占着半张纸 */
        if (rx1 >= mx0 && rx0 <= mx1 && ry1 >= my0 && ry0 <= my1) { rs.push(rd); touched = true; }
      }
      if (touched) neighbors.push({ n: countries[i].n, d: pathOf(rs), rings: vertsOf(rs) });
    }

    return {
      name: name, w: w, h: h,
      d: pathOf(keep),
      rings: vertsOf(keep),
      neighbors: neighbors,
      project: project,
      bbox: [x0, y0, x1, y1],
      /* 一度经线在这张纸上有多少像素——外面拿它定标记大小 */
      scale: sc
    };
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
    /* 还按着的指针。两根手指就是捏合缩放 —— 之前手机上根本没法缩放,
       滚轮是唯一的入口 */
    var pts = {}, nPts = 0, pinchD = 0, pinchZ = 1;
    function spread() {
      var k = Object.keys(pts);
      if (k.length < 2) return 0;
      var a = pts[k[0]], b = pts[k[1]];
      return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    }
    function down(e) {
      if (e.pointerId != null) { pts[e.pointerId] = { x: e.clientX, y: e.clientY }; nPts = Object.keys(pts).length; }
      if (nPts >= 2) { dragging = false; moved = true; pinchD = spread(); pinchZ = zoom; return; }
      dragging = true; moved = false; vel = 0;
      var p = pt(e); px = p.x; py = p.y;
      /* 注意:这里不能抓指针捕获。一旦在 pointerdown 就 setPointerCapture,
         后续事件会被重定向到 SVG 本身,click 就落不到标记上了。
         等真正动起来再抓。 */
    }
    function move(e) {
      if (e.pointerId != null && pts[e.pointerId]) { pts[e.pointerId].x = e.clientX; pts[e.pointerId].y = e.clientY; }
      if (nPts >= 2) {
        var d = spread();
        if (pinchD > 4 && d > 4) setZoom(pinchZ * d / pinchD);
        idleUntil = Date.now() + 2500;
        e.preventDefault();
        return;
      }
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
    function up(e) {
      if (e && e.pointerId != null && pts[e.pointerId]) { delete pts[e.pointerId]; nPts = Object.keys(pts).length; }
      if (nPts < 2) pinchD = 0;
      if (!dragging) return;
      dragging = false; idleUntil = Date.now() + 4000;
    }
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
    countryMap: countryMap, pinSize: pinSize,
    setHover: setHover, hover: function () { return hoverName; },
    morphPrep: morphPrep,
    get rotation() { return rot; }, set rotation(v) { rot = v; },
    get tilt() { return tilt; }, setTilt: setTilt,
    get zoom() { return zoom; }, setZoom: setZoom,
    ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX,
    onZoom: function (cb) { onZoom = cb; }
  };
})();
