/* 国家视图的端到端检查:点进一个国家 → 镜头推近 → 平面地图像卷轴铺开 →
 * 地球缩到左上角 → 点它回全局视图。
 *
 * 这里每一条都对应一个真出过的问题:
 *   - clip-path 两端的分量形状不一样,Chrome 插不了值,纸是"啪"地一下全开的;
 *   - eras.css 里那条换色 transition 会整条覆盖掉 clip-path 的过渡;
 *   - 推近途中改点别的国家,两张纸会打架。
 * 所以不能只验首尾状态,必须验"铺开途中确实有中间态"。
 *
 *   npm run country
 */
var http=require("http"),fs=require("fs"),path=require("path");
var ROOT=path.join(__dirname,".."), browser=require(path.join(ROOT,"scripts/browser.js"));
var T={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml"};
function serve(){var s=http.createServer(function(q,r){var rel=decodeURIComponent(q.url.split("?")[0]);if(rel.slice(-1)==="/")rel+="index.html";
fs.readFile(path.join(ROOT,rel),function(e,b){if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{"content-type":T[path.extname(rel).toLowerCase()]||"application/octet-stream"});r.end(b);});});
return new Promise(function(x){s.listen(0,"127.0.0.1",function(){x(s);});});}
function ok(c,l,x){console.log((c?"  ✓ ":"  ✗ ")+l+(x?"  ("+x+")":""));return c;}
function head(t){console.log("\n【"+t+"】");}
(async function(){
  var srv=await serve(), base="http://127.0.0.1:"+srv.address().port, b=await browser.launch(), pass=true, errs=[];
  var ctx=await b.newContext({viewport:{width:1440,height:900}}), pg=await ctx.newPage();
  pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(base+"/世界地图/index.html",{waitUntil:"networkidle"});
  await pg.evaluate(()=>TL.setYear(1797)); await pg.waitForTimeout(600);

  var geo=()=>pg.evaluate(()=>{
    function bx(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();
      return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};}
    return {view:TL.view(), 球:bx(".tl-globe-wrap"), 卷轴:bx(".tl-scroll"),
            坞:bx(".tl-dock"), 面板:bx(".tl-panel"),
            卷轴显示:!document.getElementById("tl-scroll").hasAttribute("hidden"),
            铺开:document.getElementById("tl-scroll").classList.contains("open"),
            标题:(document.getElementById("tl-country-name")||{}).textContent,
            回球键:!document.getElementById("tl-back-globe").hasAttribute("hidden")};});

  head("进入国家视图");
  var before = await geo();
  pass &= ok(before.view==="globe" && !before.卷轴显示, "起手是全局视图");
  var bigGlobe = before.球.w;

  await pg.evaluate(()=>TL.openCountry("United Kingdom"));
  await pg.waitForTimeout(1700);
  var inC = await geo();
  pass &= ok(inC.view==="country" && inC.卷轴显示 && inC.铺开, "切到国家视图且卷轴铺开");
  pass &= ok(inC.球.w < bigGlobe*0.35 && inC.球.l < 40 && inC.球.t < 200,
             "地球缩到左上角", "由 "+Math.round(bigGlobe)+" 缩到 "+Math.round(inC.球.w)+"，落点 ["+Math.round(inC.球.l)+","+Math.round(inC.球.t)+"]");
  pass &= ok(inC.标题==="英国" && inC.回球键, "面板换成国家卷宗", inC.标题);
  pass &= ok(inC.球.r <= inC.卷轴.l+1, "小球不压在卷轴上",
             "球右 "+Math.round(inC.球.r)+" / 卷轴左 "+Math.round(inC.卷轴.l));
  pass &= ok(inC.卷轴.b <= inC.坞.t+1 && inC.卷轴.r <= inC.面板.l+1, "卷轴不撞坞也不撞面板");

  head("卷轴真的是从左往右铺开的");
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(900);
  await pg.evaluate(()=>TL.openCountry("France"));
  await pg.waitForTimeout(560);
  var mid = await pg.evaluate(()=>{
    var p=document.getElementById("tl-scroll-paper"), r=document.getElementById("tl-roller-end");
    return {clip:getComputedStyle(p).clipPath, 右轴:Math.round(r.getBoundingClientRect().left)};});
  await pg.waitForTimeout(1600);
  var done = await pg.evaluate(()=>{
    var p=document.getElementById("tl-scroll-paper"), r=document.getElementById("tl-roller-end");
    return {clip:getComputedStyle(p).clipPath, 右轴:Math.round(r.getBoundingClientRect().left),
            纸右:Math.round(p.getBoundingClientRect().right)};});
  pass &= ok(done.右轴 > mid.右轴 + 200, "右轴跟着纸边往右走", mid.右轴+" → "+done.右轴);
  /* 铺开到头:四个分量全是 0(Chrome 会把 inset(0% 0% 0% 0%) 缩写成 inset(0%)) */
  pass &= ok(done.clip==="none" || /^inset\(\s*0(%|px)?(\s+0(%|px)?){0,3}\s*\)$/.test(done.clip),
             "铺开后不再裁剪", done.clip);
  pass &= ok(Math.abs(done.右轴 + 18 - done.纸右) < 26, "右轴停在纸的右缘",
             "轴右 "+(done.右轴+18)+" / 纸右 "+done.纸右);

  head("镜头是连着的:先推到国家跟前,再铺纸");
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1000);
  await pg.evaluate(()=>TL.openCountry("United Kingdom"));
  await pg.waitForTimeout(280);
  var step1 = await pg.evaluate(()=>({zoom:+TL.globe.zoom.toFixed(2), view:TL.view(),
    卷轴:!document.getElementById("tl-scroll").hasAttribute("hidden")}));
  pass &= ok(step1.zoom>1.5 && step1.view==="globe" && !step1.卷轴,
             "第一步:还在球上,已经推近了", JSON.stringify(step1));
  await pg.waitForTimeout(1500);
  var step2 = await pg.evaluate(()=>({zoom:+TL.globe.zoom.toFixed(2), view:TL.view(),
    铺开:document.getElementById("tl-scroll").classList.contains("open")}));
  pass &= ok(step2.view==="country" && step2.铺开 && step2.zoom<1.3,
             "第二步:纸铺开,角上的球缩回整个世界", JSON.stringify(step2));
  // 推近途中改点别的国家,不能两张纸打架
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1000);
  await pg.evaluate(()=>TL.openCountry("France"));
  await pg.waitForTimeout(150);
  await pg.evaluate(()=>TL.openCountry("Japan"));
  await pg.waitForTimeout(1700);
  var race = await pg.evaluate(()=>({标题:document.getElementById("tl-country-name").textContent,
    view:TL.view()}));
  pass &= ok(race.标题==="日本" && race.view==="country", "推近途中改点别的国家:以后点的为准", JSON.stringify(race));
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1000);

  head("纸是一点点铺开的,不是啪地一下全开");
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1000);
  var trace = await pg.evaluate(()=>new Promise(res=>{
    var out=[], t0=performance.now();
    TL.openCountry("United States of America");
    (function tick(){
      var p=document.getElementById("tl-scroll-paper"), r=document.getElementById("tl-roller-end");
      if (p) out.push({t:performance.now()-t0, clip:getComputedStyle(p).clipPath,
                       纸左:p.getBoundingClientRect().left, 纸宽:p.getBoundingClientRect().width,
                       轴:r.getBoundingClientRect().left});
      if (performance.now()-t0 < 1500) requestAnimationFrame(tick); else res(out);
    })();
  }));
  // 抽出所有"中途"的帧:右缘既不是 100% 也不是 0
  var mids = trace.filter(function(r){
    var m = /inset\(0%\s+([\d.]+)%/.exec(r.clip);
    if (!m) return false;
    var v = parseFloat(m[1]);
    return v > 2 && v < 98;
  });
  pass &= ok(mids.length >= 8, "铺开途中有连续的中间态", mids.length+" 帧");
  // 轴要钉在纸的边缘上(误差 ≤ 纸宽的 3%)
  var drift = mids.map(function(r){
    var v = parseFloat(/inset\(0%\s+([\d.]+)%/.exec(r.clip)[1]);
    var edge = r.纸左 + r.纸宽 * (1 - v/100);
    return Math.abs(r.轴 - edge);
  });
  var worst = Math.max.apply(null, drift);
  /* 头几帧纸还 display:none,宽度是 0 —— 基准得取量到过的最大宽度 */
  var paperW = Math.max.apply(null, trace.map(function(r){ return r.纸宽; }));
  pass &= ok(worst < paperW * 0.04, "右轴始终钉在纸边上",
             "最大偏差 "+Math.round(worst)+"px / 纸宽 "+Math.round(paperW));
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1000);

  head("年份还在驱动这张纸");
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(900);
  await pg.evaluate(()=>{TL.setYear(1837); TL.openCountry("United States of America");});
  await pg.waitForTimeout(1700);
  var m1 = await pg.evaluate(()=>TL.countryMarks());
  pass &= ok(m1.length===5, "美国 5 个标记", m1.length+" 个");
  pass &= ok(m1.filter(m=>/st-now/.test(m.cls)).length===1 &&
             m1.find(m=>m.year===1837).cls.indexOf("st-now")>=0, "1837 那个亮着");
  pass &= ok(m1.filter(m=>/st-future/.test(m.cls)).length===4, "其余四个还在未来");
  await pg.evaluate(()=>TL.setYear(2008)); await pg.waitForTimeout(400);
  var m2 = await pg.evaluate(()=>TL.countryMarks());
  pass &= ok(m2.find(m=>m.year===2008).cls.indexOf("st-now")>=0 &&
             m2.find(m=>m.year===1837).cls.indexOf("st-past")>=0,
             "拖到 2008:换 2008 亮、1837 变成往事");
  pass &= ok(new Set(m2.map(m=>m.at)).size===5, "同坐标的 5 个事件在纸上错开了");

  head("平面地图画对了");
  var cm = await pg.evaluate(()=>{var m=TL.cmap();
    return {邻国:m.neighbors.length, 有路径:m.d.length>100,
            纽约:m.project(-74,40.71).map(Math.round),
            纸:[m.w,m.h]};});
  pass &= ok(cm.有路径 && cm.邻国>0, "主角与邻国都画了", JSON.stringify(cm));
  pass &= ok(cm.纽约[0]>cm.纸[0]*0.5 && cm.纽约[1]<cm.纸[1]*0.6,
             "纽约落在纸的右上半边(东海岸)", JSON.stringify(cm.纽约)+" / 纸 "+JSON.stringify(cm.纸));

  head("回到全局视图");
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1000);
  var back = await geo();
  pass &= ok(back.view==="globe" && !back.卷轴显示 && !back.回球键, "退回全局,卷轴收掉");
  pass &= ok(Math.abs(back.球.w - bigGlobe) < 2, "地球回到原尺寸",
             Math.round(back.球.w)+" vs "+Math.round(bigGlobe));
  head("小球是回程的按钮");
  await pg.evaluate(()=>TL.openCountry("Japan")); await pg.waitForTimeout(1700);
  var box = await pg.evaluate(()=>{var r=document.getElementById("world-map").getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};});
  await pg.mouse.click(box.x, box.y); await pg.waitForTimeout(1000);
  pass &= ok((await geo()).view==="globe", "点小球退回全局视图");

  head("Esc 也能退");
  await pg.evaluate(()=>TL.openCountry("China")); await pg.waitForTimeout(1700);
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(900);
  pass &= ok((await geo()).view==="globe", "Esc 退回全局视图");

  head("没内容的国家");
  await pg.evaluate(()=>TL.openCountry("Brazil")); await pg.waitForTimeout(1700);
  var empty = await pg.evaluate(()=>({
    标记:TL.countryMarks().length, 有图:!!TL.cmap(),
    正文:document.getElementById("tl-dossier-body").textContent.slice(0,14)}));
  pass &= ok(empty.有图 && empty.标记===0 && /还是空白/.test(empty.正文),
             "空国家:地图照画,卷宗是空状态不是白纸", JSON.stringify(empty));
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(900);

  head("连续进出不串台");
  for (var n of ["France","Japan","United Kingdom","Germany"]) {
    await pg.evaluate(k=>TL.openCountry(k), n); await pg.waitForTimeout(700);
    await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(260);
  }
  await pg.evaluate(()=>TL.openCountry("United Kingdom")); await pg.waitForTimeout(1700);
  var last = await pg.evaluate(()=>({标题:document.getElementById("tl-country-name").textContent,
    标记:TL.countryMarks().map(m=>m.year), 邻国:TL.cmap().neighbors.length}));
  pass &= ok(last.标题==="英国" && last.标记.length===2 && last.邻国>0,
             "快速切换后状态干净", JSON.stringify(last));
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(900);

  pass &= ok(errs.length===0, "无脚本错误", errs[0]||"");
  console.log(pass?"\n全部通过":"\n有失败");
  await b.close(); srv.close(); process.exit(pass?0:1);
})();
