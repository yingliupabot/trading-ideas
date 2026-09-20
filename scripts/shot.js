/* 本地渲染静态站并截图,不依赖外网(云端出网是白名单,线上 Pages 站访问不到)
   用法: npm run shot -- [页面] [输出目录]
   例:   npm run shot -- notes.html
          npm run shot -- 世界地图/index.html */
var http = require("http");
var fs = require("fs");
var path = require("path");
var browser = require("./browser");

var ROOT = path.resolve(__dirname, "..");
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

/* 极简静态服务。端口传 0 让内核挑一个空闲的,避免和别的会话撞 */
function serve(root) {
  var server = http.createServer(function (req, res) {
    var rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.slice(-1) === "/") rel += "index.html";
    var file = path.join(root, rel);
    if (file.indexOf(root) !== 0) { res.writeHead(403); res.end("403"); return; }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }); res.end("404"); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

(async function () {
  var target = process.argv[2] || "index.html";
  var outDir = process.argv[3] || path.join(ROOT, ".shots");
  fs.mkdirSync(outDir, { recursive: true });

  var server = await serve(ROOT);
  var url = "http://127.0.0.1:" + server.address().port + "/" + target.replace(/^\//, "");
  var b = await browser.launch();
  var page = await b.newPage({ viewport: { width: 1280, height: 900 } });

  var problems = [];
  page.on("pageerror", function (e) { problems.push("JS 异常: " + e.message); });
  page.on("console", function (m) { if (m.type() === "error") problems.push("控制台: " + m.text()); });
  page.on("response", function (r) { if (r.status() >= 400) problems.push(r.status() + " " + r.url()); });

  var resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  var base = target.replace(/[\/\\]/g, "_").replace(/\.html$/, "");

  await page.screenshot({ path: path.join(outDir, base + "-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, base + "-mobile.png"), fullPage: true });

  var title = await page.title();
  await b.close();
  server.close();

  console.log("页面:     " + target);
  console.log("HTTP:     " + resp.status());
  console.log("标题:     " + title);
  console.log("截图:     " + path.relative(ROOT, outDir) + "/" + base + "-{desktop,mobile}.png");
  console.log("问题:     " + (problems.length ? problems.length + " 个" : "无"));
  problems.forEach(function (p) { console.log("          " + p); });

  if (!resp.ok()) process.exit(1);
})();
