/* 版面碰撞检查:把世界地图页放进一排视口里量,看三件东西会不会打架——
 * 地球、右侧事件面板、底部控制坞。
 *
 * 为什么要有这个脚本:控制坞的高度是内容算出来的(时代带、时代注、
 * 筛选胶囊换不换行都会变),而留白一度是手写的常数。坞一长高,
 * 地球下缘就被压掉一截、面板叠到坞上——同一个错犯过两次。
 * 现在尺寸都从 --dock-h / --top-h 实测值推出来,这个脚本负责钉住它。
 *
 *   npm run layout
 */
var http = require("http"), fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");
var browser = require(path.join(ROOT, "scripts/browser.js"));

var TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json"
};

/* 手机、平板、笔记本、外接屏,外加两种被压矮的窗口 */
var SIZES = [
  [320, 568], [360, 640], [390, 844], [430, 932], [600, 800], [760, 1024],
  [768, 600], [900, 700], [1024, 768], [1100, 800], [1200, 700],
  [1239, 900], [1240, 900], [1280, 720], [1440, 900],
  [1600, 1000], [1920, 1080], [2560, 1440], [1440, 560], [1024, 500]
];

function serve() {
  var s = http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.slice(-1) === "/") rel += "index.html";
    fs.readFile(path.join(ROOT, rel), function (e, buf) {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise(function (r) { s.listen(0, "127.0.0.1", function () { r(s); }); });
}

/* 页面里量:全部用 getBoundingClientRect,不猜 CSS 值 */
function probe() {
  function box(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height };
  }
  var g = box(".tl-globe-wrap"), d = box(".tl-dock"),
      p = box(".tl-panel"), bar = box(".tl-topbar");
  var narrow = matchMedia("(max-width: 760px)").matches;
  var bad = [];
  if (g.b > d.t + 1) bad.push("球被坞压");
  if (p.b > d.t + 1 && p.l < d.r) bad.push("面板叠坞");
  if (!narrow && g.t < bar.b - 1) bad.push("球顶到顶栏");
  if (g.t < -1 || g.b > innerHeight + 1) bad.push("球出视口");
  if (d.l < -1 || d.r > innerWidth + 1) bad.push("坞出视口");
  if (p.l < -1 || p.r > innerWidth + 1) bad.push("面板出视口");
  /* 窄屏的面板是贴着坞的抽屉,盖住球是设计;宽屏的面板在右舷,不该碰到球 */
  if (!narrow && g.r > p.l + 1 && g.t < p.b && g.b > p.t) bad.push("球叠面板");
  if (g.w < 120) bad.push("球缩到 " + Math.round(g.w) + "px");
  return { bad: bad, globe: Math.round(g.w), dock: Math.round(d.h) };
}

(async function () {
  var srv = await serve();
  var base = "http://127.0.0.1:" + srv.address().port;
  var b = await browser.launch();
  var ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  var page = await ctx.newPage();
  var errs = [];
  page.on("pageerror", function (e) { errs.push(e.message); });

  await page.goto(base + "/世界地图/index.html", { waitUntil: "networkidle" });
  await page.evaluate(function () { TL.setYear(1720); });
  await page.waitForTimeout(600);

  var failed = [];
  for (var i = 0; i < SIZES.length; i++) {
    var s = SIZES[i], tag = s[0] + "×" + s[1];
    await page.setViewportSize({ width: s[0], height: s[1] });
    await page.waitForTimeout(260);          /* 等 ResizeObserver 把 --dock-h 量完 */
    var m = await page.evaluate(probe);
    if (m.bad.length) {
      failed.push(tag + " → " + m.bad.join("、"));
      console.log("  ✗ " + tag.padEnd(10) + m.bad.join("、"));
    } else {
      console.log("  ✓ " + tag.padEnd(10) + "球 " + String(m.globe).padEnd(4) + " 坞 " + m.dock);
    }
  }
  if (errs.length) { failed.push("脚本错误:" + errs[0]); console.log("  ✗ 脚本错误 " + errs[0]); }

  console.log(failed.length
    ? "\n" + failed.length + " 处版面碰撞:\n  " + failed.join("\n  ")
    : "\n" + SIZES.length + " 种视口全部合格");

  await b.close();
  srv.close();
  process.exit(failed.length ? 1 : 0);
})();
