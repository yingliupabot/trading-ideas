/* 潜水(国家地图 → 手卷)的端到端检查,在真的加载了 GSAP 的页面上跑。
 *
 * 每一节都对应一个真出过的问题:
 *   - 多块陆地的国家(英国、法国、中国)变形时,岛屿之间被画出一条横跨海峡的边;
 *   - 推近那半秒按 Esc 被吞掉,照样进国家;
 *   - 球变纸途中按 Esc,回到地球视图时球是隐形的(globe-in 没人摘);
 *   - 形变收尾后 300ms 内按 Esc,撤画布的定时器把反向形变的画布藏掉,空台一秒;
 *   - 反向形变播着时再按 Esc,重入后一帧跳回地球;
 *   - 手机上拉开卷宗抽屉,角上的球(回去的按钮)被推进顶栏底下;
 *   - 没有 GSAP 时,"跳过"的判断拿着旧的 rAF id,吞掉纸上的每一次点击。
 * 首尾状态对、过程里出错,是这一页反复犯的错,所以这里验的多是过程。
 *
 *   npm run dive
 */
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");
var browser = require(path.join(__dirname, "browser.js"));
var gsapPin = require(path.join(__dirname, "gsap.js"));
var T = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
          ".svg": "image/svg+xml", ".json": "application/json" };

function serve() {
  var s = http.createServer(function (q, r) {
    var rel = decodeURIComponent(q.url.split("?")[0]);
    if (rel.slice(-1) === "/") rel += "index.html";
    fs.readFile(path.join(ROOT, rel), function (e, b) {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { "content-type": T[path.extname(rel).toLowerCase()] || "application/octet-stream" });
      r.end(b);
    });
  });
  return new Promise(function (x) { s.listen(0, "127.0.0.1", function () { x(s); }); });
}
var pass = true;
function ok(c, l, x) { console.log((c ? "  ✓ " : "  ✗ ") + l + (x ? "  (" + x + ")" : "")); if (!c) pass = false; return c; }
function head(t) { console.log("\n【" + t + "】"); }

(async function () {
  var srv = await serve(), base = "http://127.0.0.1:" + srv.address().port;
  var b = await browser.launch(), errs = [];

  async function open(opts, withGsap) {
    var ctx = await b.newContext(opts || { viewport: { width: 1440, height: 900 } });
    var ver = withGsap === false ? null : await gsapPin.route(ctx);
    var pg = await ctx.newPage();
    pg.on("pageerror", function (e) { errs.push(e.message); });
    await pg.goto(base + "/世界地图/index.html", { waitUntil: "networkidle" });
    await pg.waitForTimeout(500);
    return { ctx: ctx, pg: pg, ver: ver };
  }
  /* 在页面里等一个条件,不走 playwright 往返,时序才准 */
  function until(pg, fnSrc, ms) {
    return pg.evaluate(function (a) {
      var f = new Function("return (" + a.src + ")();");
      return new Promise(function (res) {
        var t0 = performance.now();
        (function poll() {
          var v = f();
          if (v) return res(v);
          if (performance.now() - t0 > a.ms) return res(null);
          requestAnimationFrame(poll);
        })();
      });
    }, { src: fnSrc.toString(), ms: ms || 9000 });
  }
  var clean = function () {
    var land = document.getElementById("tl-cmap-land");
    var loops = window.gsap ? gsap.globalTimeline.getChildren(true, true, false)
      .filter(function (t) { return t.repeat && t.repeat() === -1; }).length : 0;
    return {
      view: TL.view(), busy: TL.busy(),
      画布: !document.getElementById("tl-morph").hasAttribute("hidden"),
      卷轴: !document.getElementById("tl-scroll").hasAttribute("hidden"),
      morphing: document.body.classList.contains("morphing"),
      globeIn: document.body.classList.contains("globe-in"),
      残留origD: !!(land && land.dataset.origD),
      小岛: !!document.getElementById("tl-cmap-minor"),
      无限循环: loops,
      球透明: +getComputedStyle(document.querySelector(".tl-globe-wrap")).opacity
    };
  };
  function isClean(s) {
    return s.view === "globe" && !s.busy && !s.画布 && !s.卷轴 && !s.morphing && !s.globeIn &&
           !s.残留origD && !s.小岛 && s.无限循环 === 0 && s.球透明 > 0.98;
  }

  /* ------------------------------------------------------------ */
  head("页面里的 GSAP 真的是钉住的那个版本");
  var P = await open();
  var gv = await P.pg.evaluate(function () { return window.gsap && window.gsap.version; });
  ok(gv === P.ver, "window.gsap.version = index.html 里钉的版本", gv + " / " + P.ver);

  /* ------------------------------------------------------------ */
  head("多块陆地:只拿主陆地去变形,小岛淡出");
  var MULTI = [["United Kingdom", 1797], ["France", 1789], ["China", 2015]];
  for (var i = 0; i < MULTI.length; i++) {
    var c = MULTI[i];
    await P.pg.evaluate(function (y) { TL.setYear(y); }, c[1]);
    await P.pg.evaluate(function (n) { TL.openCountry(n); }, c[0]);
    /* 变形刚起步(v 过了 0.03)时采一次 */
    var early = await until(P.pg, function () {
      var d = TL.dive();
      if (!(d.v > 0.03 && d.srcBox)) return null;
      var m = TL.cmap();
      function box(rings) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        rings.forEach(function (r) { r.forEach(function (p) {
          if (p.x < b[0]) b[0] = p.x; if (p.y < b[1]) b[1] = p.y;
          if (p.x > b[2]) b[2] = p.x; if (p.y > b[3]) b[3] = p.y; }); });
        return b;
      }
      var mn = document.getElementById("tl-cmap-minor");
      return { src: d.srcBox, main: box([m.rings[0]]), full: box(m.rings),
               小岛: !!mn, 小岛透明: mn ? +getComputedStyle(mn).opacity : null };
    });
    if (!ok(!!early, c[0] + " 潜水开始变形")) continue;
    var inMain = early.src[0] >= early.main[0] - 1.5 && early.src[1] >= early.main[1] - 1.5 &&
                 early.src[2] <= early.main[2] + 1.5 && early.src[3] <= early.main[3] + 1.5;
    var meaningful = early.full[0] < early.main[0] - 3 || early.full[1] < early.main[1] - 3 ||
                     early.full[2] > early.main[2] + 3 || early.full[3] > early.main[3] + 3;
    ok(meaningful, c[0] + " 确实有主陆地之外的岛(这项检查才有意义)");
    ok(inMain, c[0] + " 变形的采样点全落在主陆地上,没有跨海的边",
       "采样盒 " + early.src.map(Math.round) + " / 主陆地 " + early.main.map(Math.round));
    ok(early.小岛, c[0] + " 小岛单独成一条路径");
    var fin = await until(P.pg, function () {
      var d = TL.dive(); if (!d.dived) return null;
      var mn = document.getElementById("tl-cmap-minor");
      return { 小岛透明: mn ? +getComputedStyle(mn).opacity : -1 };
    });
    ok(fin && fin.小岛透明 === 0, c[0] + " 潜水到位后小岛已淡出", fin && fin.小岛透明);
    await P.pg.evaluate(function () { TL.closeCountry(); });
    var back = await until(P.pg, function () {
      if (TL.view() !== "globe" || TL.busy()) return null;
      var land = document.getElementById("tl-cmap-land");
      return { 小岛: !!document.getElementById("tl-cmap-minor"),
               还原: land.getAttribute("d") === TL.cmap().d };
    });
    ok(back && !back.小岛 && back.还原, c[0] + " 回来后小岛路径摘掉、轮廓接回原样", JSON.stringify(back));
    await P.pg.waitForTimeout(700);
  }
  await P.pg.evaluate(function () { TL.setYear(1929); TL.openCountry("United States of America"); });
  var us = await until(P.pg, function () { var d = TL.dive(); return d.v > 0.03 ? { 小岛: !!document.getElementById("tl-cmap-minor") } : null; });
  ok(us && !us.小岛, "美国只有一块主陆地:不多造小岛路径");
  await P.pg.evaluate(function () { TL.closeCountry(); });
  await until(P.pg, function () { return TL.view() === "globe" && !TL.busy(); });
  await P.pg.waitForTimeout(700);

  /* ------------------------------------------------------------ */
  head("半路退出:每一段按 Esc 都回得干净");
  await P.pg.evaluate(function () { TL.setYear(1789); });
  var STAGES = [[200, "推近中"], [700, "球变纸刚开始"], [1300, "球变纸中途"],
                [2200, "潜水:先看地图"], [3200, "潜水:贴近"], [4200, "潜水:变卷"], [7000, "到位之后"]];
  for (var k = 0; k < STAGES.length; k++) {
    await P.pg.evaluate(function () { TL.openCountry("France"); });
    await P.pg.waitForTimeout(STAGES[k][0]);
    await P.pg.keyboard.press("Escape");
    await until(P.pg, function () { return TL.view() === "globe" && !TL.busy(); });
    await P.pg.waitForTimeout(900);
    var st = await P.pg.evaluate(clean);
    ok(isClean(st), ("第 " + STAGES[k][0] + "ms(" + STAGES[k][1] + ")按 Esc").padEnd(26), isClean(st) ? "" : JSON.stringify(st));
  }

  /* 形变收尾后 300ms 内按 Esc:撤画布的定时器不许把反向形变的画布藏掉 */
  var r300 = await P.pg.evaluate(function () {
    return new Promise(function (res) {
      TL.openCountry("France");
      var t0 = performance.now(), fired = false, hidden = false;
      (function poll() {
        var morphing = document.body.classList.contains("morphing");
        var cvHidden = document.getElementById("tl-morph").hasAttribute("hidden");
        if (!fired && TL.view() === "country" && !morphing && performance.now() - t0 > 700) {
          fired = true;
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        } else if (fired && TL.view() === "country" && cvHidden) {
          hidden = true;
        }
        if (fired && TL.view() === "globe") return res({ 反向途中画布被藏: hidden });
        if (performance.now() - t0 > 9000) return res({ 超时: true });
        requestAnimationFrame(poll);
      })();
    });
  });
  ok(r300.反向途中画布被藏 === false, "形变刚收尾就按 Esc:反向形变全程画布都在", JSON.stringify(r300));
  await P.pg.waitForTimeout(900);

  /* 反向形变播着时再按一次 Esc:不许重入,反向形变照常播完 */
  await P.pg.evaluate(function () { TL.openCountry("France"); });
  await until(P.pg, function () { return TL.dive().dived; });
  var errsBefore = errs.length;
  var dbl = await P.pg.evaluate(function () {
    return new Promise(function (res) {
      var t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      setTimeout(function () { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); }, 250);
      (function poll() {
        if (TL.view() === "globe" && !TL.busy()) return res({ 用时: Math.round(performance.now() - t0) });
        if (performance.now() - t0 > 9000) return res({ 超时: true });
        requestAnimationFrame(poll);
      })();
    });
  });
  await P.pg.waitForTimeout(300);
  var dblErr = errs.slice(errsBefore);
  /* 不防重入时,第二次退出会在第一次清掉的数据上继续插值,直接抛错 —— 这是实测到的样子 */
  ok(dbl.用时 > 1200 && dblErr.length === 0, "连按两次 Esc:第二次不重入,退场没被截断、也没抛错",
     JSON.stringify(dbl) + (dblErr.length ? " 报错:" + dblErr[0] : ""));
  await P.pg.waitForTimeout(900);
  var afterAll = await P.pg.evaluate(clean);
  ok(isClean(afterAll), "折腾完之后页面状态干净", isClean(afterAll) ? "" : JSON.stringify(afterAll));

  /* ------------------------------------------------------------ */
  head("点一下纸面:直接跳到结果");
  await P.pg.evaluate(function () { TL.setYear(1700); TL.openCountry("France"); });
  await P.pg.waitForTimeout(1000);                           /* 球变纸途中 */
  var paper = await P.pg.evaluate(function () {
    var r = document.getElementById("tl-scroll-paper").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  var tClick = Date.now();
  await P.pg.mouse.click(paper.x, paper.y);
  var sk = await until(P.pg, function () {
    var d = TL.dive(), hs = document.querySelector(".tl-handscroll");
    return (!TL.busy() && d.dived && hs && +getComputedStyle(hs).opacity > 0.98) ? { v: d.v } : null;
  }, 3000);
  ok(sk && sk.v === 1 && Date.now() - tClick < 1500, "球变纸途中点一下:一步到手卷", sk ? (Date.now() - tClick) + "ms" : "没到位");
  /* 到位之后,纸上的点击要照常落到小景上 —— 跳过不能变成吞点击 */
  var scn = await P.pg.evaluate(function () {
    var e = document.querySelector(".tl-hs-scene"); if (!e) return null;
    var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (ok(!!scn, "手卷上有小景可点")) {
    await P.pg.mouse.click(scn.x, scn.y);
    var y1 = await until(P.pg, function () { return TL.year() !== 1700 ? TL.year() : null; }, 3000);
    ok(y1 === 1720 || y1 === 1789, "闲下来之后点小景:年份照常跳过去", "年份 → " + y1);
  }
  await P.pg.evaluate(function () { TL.closeCountry(); });
  await until(P.pg, function () { return TL.view() === "globe" && !TL.busy(); });
  await P.pg.waitForTimeout(800);

  /* 潜水中途跳 */
  await P.pg.evaluate(function () { TL.openCountry("United Kingdom"); });
  await until(P.pg, function () { return TL.dive().active ? true : null; });
  await P.pg.waitForTimeout(400);
  await P.pg.mouse.click(paper.x, paper.y);
  var sk2 = await until(P.pg, function () { return (!TL.busy() && TL.dive().dived) ? true : null; }, 1500);
  ok(!!sk2, "潜水中途点一下:一步到位");
  /* 退场途中也能跳 */
  await P.pg.evaluate(function () { TL.closeCountry(); });
  await P.pg.waitForTimeout(250);
  await P.pg.mouse.click(paper.x, paper.y);
  var sk3 = await until(P.pg, function () { return (TL.view() === "globe" && !TL.busy()) ? true : null; }, 1500);
  ok(!!sk3, "退场途中点一下:一步回到地球");
  await P.pg.waitForTimeout(900);
  var afterSkip = await P.pg.evaluate(clean);
  ok(isClean(afterSkip), "跳来跳去之后页面状态干净", isClean(afterSkip) ? "" : JSON.stringify(afterSkip));
  await P.ctx.close();

  /* ------------------------------------------------------------ */
  head("没有 GSAP(CDN 连不上):能跳,闲着时不吞点击");
  var N = await open(null, false);
  ok(await N.pg.evaluate(function () { return !window.gsap; }), "这一页确实没有 GSAP");
  await N.pg.evaluate(function () { TL.setYear(1700); TL.openCountry("France"); });
  await N.pg.waitForTimeout(900);
  var np = await N.pg.evaluate(function () {
    var r = document.getElementById("tl-scroll-paper").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 20 };
  });
  await N.pg.mouse.click(np.x, np.y);
  var nsk = await until(N.pg, function () { return (TL.view() === "country" && !TL.busy() && !document.body.classList.contains("morphing")) ? true : null; }, 1200);
  ok(!!nsk, "球变纸途中点一下:直接到国家视图");
  await N.pg.waitForTimeout(500);
  var nscn = await N.pg.evaluate(function () {
    var e = document.querySelector(".tl-hs-scene"); if (!e) return null;
    var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (ok(!!nscn, "降级版手卷也有小景")) {
    await N.pg.mouse.click(nscn.x, nscn.y);
    var ny = await until(N.pg, function () { return TL.year() !== 1700 ? TL.year() : null; }, 2000);
    ok(ny === 1720 || ny === 1789, "闲下来之后点小景没被吞", "年份 → " + ny);
  }
  await N.ctx.close();

  /* ------------------------------------------------------------ */
  head("手机:拉开卷宗抽屉,角上的球还在屏幕里");
  var M = await open({ viewport: { width: 390, height: 844 } });
  await M.pg.evaluate(function () { TL.setYear(1797); TL.openCountry("United Kingdom"); });
  await until(M.pg, function () { return (TL.view() === "country" && !TL.busy()) ? true : null; });
  await M.pg.evaluate(function () { document.getElementById("tl-panel-toggle").click(); });
  await M.pg.waitForTimeout(600);
  var mg = await M.pg.evaluate(function () {
    var g = document.querySelector(".tl-globe-wrap").getBoundingClientRect();
    var t = document.querySelector(".tl-topbar").getBoundingClientRect();
    return { 球顶: Math.round(g.top), 顶栏底: Math.round(t.bottom) };
  });
  ok(mg.球顶 >= mg.顶栏底, "角上的球没被推进顶栏底下", JSON.stringify(mg));
  await M.ctx.close();

  ok(errs.length === 0, "无脚本错误", errs[0] || "");
  console.log(pass ? "\n全部通过" : "\n有失败");
  await b.close(); srv.close();
  process.exit(pass ? 0 : 1);
})();
