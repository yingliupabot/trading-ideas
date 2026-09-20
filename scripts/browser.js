/* 云端 Chromium 启动封装:抹平 Claude Code on the web 的两个坑 */
var fs = require("fs");
var playwright = require("playwright");

/* 云端镜像预装的 Chromium。这是个符号链接,镜像升级时自动跟随,比钉版本号稳 */
var PREINSTALLED = "/opt/pw-browsers/chromium";

function launchOptions(extra) {
  var opts = Object.assign({}, extra || {});

  /* 坑一:npm 装的 playwright 往往比预装 Chromium 新,不指路它会去下载,
     而云端出网是白名单,下载必然失败 */
  if (!opts.executablePath && fs.existsSync(PREINSTALLED)) {
    opts.executablePath = PREINSTALLED;
  }

  /* 坑二:Chromium 会自己捡环境变量里的代理,连 127.0.0.1 都往隧道里塞。
     必须显式 bypass,否则访问本地起的静态服务会 ERR_TUNNEL_CONNECTION_FAILED */
  var proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!opts.proxy && proxy) {
    opts.proxy = { server: proxy, bypass: "localhost,127.0.0.1,::1" };
  }

  return opts;
}

/* 本地开发机上这两个条件都不成立,会原样退化成普通的 chromium.launch() */
function launch(extra) {
  return playwright.chromium.launch(launchOptions(extra));
}

module.exports = { launch: launch, launchOptions: launchOptions, PREINSTALLED: PREINSTALLED };
