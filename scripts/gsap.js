/* 让测试里的页面真的用上 GSAP。
 *
 * 世界地图从 jsdelivr 引 GSAP。云端容器的出网是白名单,jsdelivr 不在里面,
 * 页面上的 GSAP 永远加载失败 —— 测试于是全程走"没有 GSAP"的降级路径,
 * 导演层那几百行一行都没被测到,而且全绿。这个坑实际踩过。
 *
 * 做法:gsap 按页面钉的同一个版本装进 devDependencies,
 * 测试把那条 CDN 请求路由到 node_modules 里的文件。
 * 版本从 index.html 里读,和 node_modules 对不上就直接报错 ——
 * 宁可测试挂掉,也别拿另一个版本去测、测完还说通过。
 */
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");

function pinned() {
  var html = fs.readFileSync(path.join(ROOT, "世界地图/index.html"), "utf8");
  var m = /https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@([\d.]+)\/dist\/gsap\.min\.js/.exec(html);
  if (!m) throw new Error("世界地图/index.html 里找不到钉版本的 GSAP 引用");
  return { url: m[0], version: m[1] };
}

function localFile(version) {
  var pkgPath = path.join(ROOT, "node_modules/gsap/package.json");
  if (!fs.existsSync(pkgPath)) throw new Error("没装 gsap:先跑 npm install");
  var have = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  if (have !== version) {
    throw new Error("index.html 钉的是 gsap@" + version + ",node_modules 里是 " + have +
                    " —— 把 package.json 的 devDependencies 改成同一版本再 npm install");
  }
  return fs.readFileSync(path.join(ROOT, "node_modules/gsap/dist/gsap.min.js"));
}

/* 给一个 context 装上路由;返回钉住的版本号,测试拿它去核对 window.gsap.version */
async function route(context) {
  var pin = pinned(), body = localFile(pin.version);
  await context.route(pin.url, function (r) {
    r.fulfill({ status: 200, contentType: "text/javascript", body: body });
  });
  return pin.version;
}

/* 给整个 browser 装上:之后每个 newContext 都自带路由。
   on=false 时什么都不做 —— 页面去连 CDN,连不上就走降级路径(云端就是这样)。
   两条路径都要测:用户看到的是有 GSAP 的,CDN 挂了看到的是没有的。 */
function install(browser, on) {
  if (!on) return browser;
  var orig = browser.newContext.bind(browser);
  browser.newContext = async function () {
    var ctx = await orig.apply(null, arguments);
    await route(ctx);
    return ctx;
  };
  return browser;
}

/* 命令行里带 --no-gsap 就测降级路径 */
function wanted() { return process.argv.indexOf("--no-gsap") < 0; }

module.exports = { route: route, pinned: pinned, install: install, wanted: wanted };
