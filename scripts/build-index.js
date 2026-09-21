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
    /* 有地点的是"事件",要能落在地球上,所以必须有年份;
       没地点的是"概念"(比如"肥尾效应"),只在图谱里占位,不要求年份。 */
    if (m.place && typeof m.year !== "number") errs.push(m.id + ":有 place 就必须有 year");
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

  writeNotes(list);

  var by = {};
  list.forEach(function (m) { var s = m.status || "未标"; by[s] = (by[s] || 0) + 1; });
  console.log("✓ 生成 " + path.relative(ROOT, OUT));
  console.log("  词条 " + list.length + " 条 · " +
    Object.keys(by).map(function (k) { return k + " " + by[k]; }).join(" / "));
}
/* notes.html 的章节表原来是手写的,和词条会漂移。改成在标记之间生成——
   仍然是静态 HTML(不靠 JS 渲染),但真相只有一份。 */
function writeNotes(list) {
  var NOTES = path.join(ROOT, "notes.html");
  if (!fs.existsSync(NOTES)) return;
  var html = fs.readFileSync(NOTES, "utf8");
  var S = "<!-- 词条:开始 -->", E = "<!-- 词条:结束 -->";
  var i = html.indexOf(S), j = html.indexOf(E);
  if (i < 0 || j < 0) { console.log("  (notes.html 里没有词条标记,跳过)"); return; }

  var chapters = list.filter(function (m) { return m.book; })
    .sort(function (a, b) { return a.book.chapter - b.book.chapter; });
  var parts = [], seen = {};
  chapters.forEach(function (m) {
    if (!seen[m.book.part]) { seen[m.book.part] = []; parts.push(m.book.part); }
    seen[m.book.part].push(m);
  });

  var body = parts.map(function (part, k) {
    var cells = seen[part].map(function (m) {
      /* 两个轴,不要混成一个:status 是"我懂没懂",note 是"写没写"。
         懂了但没写,和没懂,是完全不同的两件事。 */
      var mark = m.note ? " · 🎨" : (m.status === "点亮" ? " · 已懂" : (m.status === "在读" ? " · 在读" : ""));
      var inner = '<span class="ch-num">第 ' + m.book.chapter + ' 章' + mark + '</span>' +
                  '<span class="ch-title">' + m.title + '</span>';
      return m.note
        ? '<a class="chapter-cell painting" href="' + m.note + '">' + inner + '</a>'
        : '<span class="chapter-cell ' + (m.status === "想读" ? "todo" : "known") + '">' + inner + '</span>';
    }).join("\n        ");
    return '      <h3 class="part-title" id="part' + (k + 1) + '">' + part + '</h3>\n' +
           '      <div class="chapter-grid">\n        ' + cells + '\n      </div>';
  }).join("\n\n");

  var out = html.slice(0, i + S.length) + "\n" + body + "\n      " + html.slice(j);
  fs.writeFileSync(NOTES, out, "utf8");
  console.log("✓ 更新 notes.html 章节表(" + chapters.length + " 章)");
}

main();
