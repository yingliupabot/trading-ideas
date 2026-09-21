/* 缩放的三个入口:按钮、滚轮、双指捏合。
 * 捏合是后补的 —— 在那之前手机上根本没法缩放,滚轮是唯一的路。
 * 捏完还要能单指拖,两种手势不能互相吃掉。
 *
 *   npm run zoom
 */
var http=require("http"),fs=require("fs"),path=require("path");
var ROOT=path.join(__dirname,".."), browser=require(path.join(ROOT,"scripts/browser.js"));
var T={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml"};
function serve(){var s=http.createServer(function(q,r){var rel=decodeURIComponent(q.url.split("?")[0]);if(rel.slice(-1)==="/")rel+="index.html";
fs.readFile(path.join(ROOT,rel),function(e,b){if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{"content-type":T[path.extname(rel).toLowerCase()]||"application/octet-stream"});r.end(b);});});
return new Promise(function(x){s.listen(0,"127.0.0.1",function(){x(s);});});}
function ok(c,l,x){console.log((c?"  ✓ ":"  ✗ ")+l+(x?"  ("+x+")":""));return c;}
(async function(){
  var srv=await serve(), base="http://127.0.0.1:"+srv.address().port, b=await browser.launch(), pass=true, errs=[];
  var ctx=await b.newContext({viewport:{width:1440,height:900}}), pg=await ctx.newPage();
  pg.on("pageerror",e=>errs.push(e.message));
  await pg.goto(base+"/世界地图/index.html",{waitUntil:"networkidle"}); await pg.waitForTimeout(600);
  var st=()=>pg.evaluate(()=>({z:+TL.globe.zoom.toFixed(2),
    读数:document.getElementById("tl-zoom-read").textContent,
    加:!document.getElementById("tl-zoom-in").disabled,
    减:!document.getElementById("tl-zoom-out").disabled}));
  pass &= ok(JSON.stringify(await st())==='{"z":1,"读数":"1.0×","加":true,"减":false}',
             "起手 1.0×,缩小键是灰的", JSON.stringify(await st()));
  await pg.click("#tl-zoom-in"); await pg.waitForTimeout(400);
  var a=await st(); pass &= ok(a.z>1.4 && a.读数==="1.5×" && a.减, "点 + 放大到 1.5×", JSON.stringify(a));
  for (var i=0;i<10 && (await st()).加;i++){ await pg.click("#tl-zoom-in"); await pg.waitForTimeout(320); }
  var b2=await st(); pass &= ok(Math.abs(b2.z-4.5)<0.02 && !b2.加, "顶到 4.5× 后 + 变灰", JSON.stringify(b2));
  for (var i=0;i<12 && (await st()).减;i++){ await pg.click("#tl-zoom-out"); await pg.waitForTimeout(280); }
  var c=await st(); pass &= ok(Math.abs(c.z-1)<0.02 && !c.减, "退回 1.0× 后 − 变灰", JSON.stringify(c));
  // 滚轮改了倍率,读数也要跟
  await pg.mouse.move(720,420); await pg.mouse.wheel(0,-600); await pg.waitForTimeout(300);
  var d=await st(); pass &= ok(d.z>1.2 && d.读数===d.z.toFixed(1)+"×", "滚轮缩放读数同步", JSON.stringify(d));
  await pg.evaluate(()=>TL.zoom(1)); await pg.waitForTimeout(200);

  // 国家视图里控件要让开
  await pg.evaluate(()=>TL.openCountry("Japan")); await pg.waitForTimeout(2100);
  var hid = await pg.evaluate(()=>+getComputedStyle(document.getElementById("tl-zoom")).opacity);
  pass &= ok(hid===0, "国家视图里控件隐去", "opacity="+hid);
  await pg.evaluate(()=>TL.closeCountry()); await pg.waitForTimeout(1800);

  // 双指捏合
  await ctx.close();
  var tctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}), tp=await tctx.newPage();
  tp.on("pageerror",e=>errs.push("触屏: "+e.message));
  await tp.goto(base+"/世界地图/index.html",{waitUntil:"networkidle"}); await tp.waitForTimeout(700);
  var z0 = await tp.evaluate(()=>TL.globe.zoom);
  // 用 CDP 直接派发两根指针
  var box = await tp.evaluate(()=>{var r=document.getElementById("world-map").getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};});
  var cdp = await tctx.newCDPSession(tp);
  async function touch(type, pts){ await cdp.send("Input.dispatchTouchEvent",{type:type,touchPoints:pts}); }
  await touch("touchStart",[{x:box.x-40,y:box.y,id:1},{x:box.x+40,y:box.y,id:2}]);
  for (var g=1;g<=6;g++){ await touch("touchMove",[{x:box.x-40-g*12,y:box.y,id:1},{x:box.x+40+g*12,y:box.y,id:2}]); await tp.waitForTimeout(40); }
  await touch("touchEnd",[]);
  await tp.waitForTimeout(300);
  var z1 = await tp.evaluate(()=>TL.globe.zoom);
  pass &= ok(z1 > z0*1.4, "双指张开 = 放大", z0.toFixed(2)+" → "+z1.toFixed(2));
  // 捏回去
  await touch("touchStart",[{x:box.x-112,y:box.y,id:1},{x:box.x+112,y:box.y,id:2}]);
  for (var g=1;g<=6;g++){ await touch("touchMove",[{x:box.x-112+g*15,y:box.y,id:1},{x:box.x+112-g*15,y:box.y,id:2}]); await tp.waitForTimeout(40); }
  await touch("touchEnd",[]);
  await tp.waitForTimeout(300);
  var z2 = await tp.evaluate(()=>TL.globe.zoom);
  pass &= ok(z2 < z1*0.8, "双指捏合 = 缩小", z1.toFixed(2)+" → "+z2.toFixed(2));
  // 捏完单指还能拖
  var rot0 = await tp.evaluate(()=>TL.globe.rotation);
  await touch("touchStart",[{x:box.x,y:box.y,id:1}]);
  for (var g=1;g<=5;g++){ await touch("touchMove",[{x:box.x+g*14,y:box.y,id:1}]); await tp.waitForTimeout(40); }
  await touch("touchEnd",[]);
  await tp.waitForTimeout(200);
  var rot1 = await tp.evaluate(()=>TL.globe.rotation);
  pass &= ok(Math.abs(rot1-rot0) > 3, "捏完之后单指拖动还在", rot0.toFixed(1)+" → "+rot1.toFixed(1));
  pass &= ok(errs.length===0, "无脚本错误", errs[0]||"");
  console.log(pass?"\n通过":"\n有失败");
  await b.close(); srv.close(); process.exit(pass?0:1);
})();
