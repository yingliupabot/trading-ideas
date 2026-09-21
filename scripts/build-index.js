#!/usr/bin/env node
/* 词条索引生成
 *
 * 真相只有一份:词条/<id>/meta.json。这个脚本把它们收成
 * 世界地图/词条.js,地球、时间轴、以后的目录页都读它。
 *
 * 生成物要提交进仓库——GitHub Pages 是纯静态的,线上没有构建步骤。
 */
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var SRC = path.join(ROOT, "词条");
var OUT = path.join(ROOT, "世界地图", "词条.js");

var STATUS = ["点亮", "在读", "想读"];

function read() {
  if (!fs.existsSync(SRC)) return [];
  return fs.readdirSync(SRC).filter(function (d) {
    return fs.existsSync(path.join(SRC, d, "meta.json"));
  }).map(function (d) {
    var raw = fs.readFileSync(path.join(SRC, d, "meta.json"), "utf8");
    var m;
    try { m = JSON.parse(raw); }
    catch (e) { throw new Error("词条/" + d + "/meta.json 不是合法 JSON:" + e.message); }
    m.id = d;
    return m;
  }).sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
}

function check(list) {
  var errs = [], ids = {};
  list.forEach(function (m) {
    if (ids[m.id]) errs.push("重复的词条 id:" + m.id);
    ids[m.id] = true;
    if (typeof m.year !== "number") errs.push(m.id + ":缺 year 或不是数字");
    if (!m.title) errs.push(m.id + ":缺 title");
    if (m.status && STATUS.indexOf(m.status) < 0)
      errs.push(m.id + ":status 只能是 " + STATUS.join("/") + ",收到 " + m.status);
    if (m.place && (typeof m.place.lat !== "number" || typeof m.place.lng !== "number"))
      errs.push(m.id + ":place 缺 lat/lng");
  });
  /* 连接必须指向真实存在的词条,否则图谱里会有断头线 */
  list.forEach(function (m) {
    (m.links || []).forEach(function (l) {
      if (!ids[l.to]) errs.push(m.id + ":links 指向不存在的词条 " + l.to);
    });
  });
  return errs;
}

function main() {
  var list = read();
  var errs = check(list);
  if (errs.length) {
    console.error("✗ 词条校验未通过:");
    errs.forEach(function (e) { console.error("   " + e); });
    process.exit(1);
  }
  var body = "/* 由 scripts/build-index.js 生成,不要手改。\n" +
             " * 真相在 词条/<id>/meta.json,改完跑 npm run index。\n" +
             " * 生成时间无关紧要,所以不写进来——否则每次构建都产生一个假 diff。\n" +
             " */\n" +
             "const ENTRIES = " + JSON.stringify(list, null, 2) + ";\n";
  fs.writeFileSync(OUT, body, "utf8");

  var by = {};
  list.forEach(function (m) { var s = m.status || "未标"; by[s] = (by[s] || 0) + 1; });
  console.log("✓ 生成 " + path.relative(ROOT, OUT));
  console.log("  词条 " + list.length + " 条 · " +
    Object.keys(by).map(function (k) { return k + " " + by[k]; }).join(" / "));
}
main();
