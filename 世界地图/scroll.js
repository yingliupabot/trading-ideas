/* 世界历史时间轴 · 清明上河图式手卷
 *
 * 国家视图的下半截:一条"时间长河"自左(过去)向右(未来)流,
 * 每个词条是岸边的一段"小景"。卷轴长度随事件数伸缩:
 *   宽 = 2*PAD + n*SEG,事件越多卷越长。
 *
 * 数据只读 ENTRIES(词条.js 生成),不手改。
 * 全部描边不填充,沿用墨绘符号的质感;颜色走 currentColor,
 * 由 CSS 里 --ink 决定,深浅主题自动成立。
 */
var Scroll = (function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var SEG = 520, PAD = 130, H = 300;
  var RIVER = 212;               /* 河心线 y */
  var INK = "currentColor";

  /* 动效总开关:没 GSAP、或用户说了要少动效,就保持静态,页面照常工作 */
  function motionOK() {
    return !!window.gsap && !(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* 一串字竖着排:每字一个 text,传统题签的味道 */
  function vtext(parent, x, y, str, size, cls) {
    var g = el("g", { "class": "tl-hs-vtext " + (cls || "") }, parent);
    var chars = String(str).split("");
    for (var i = 0; i < chars.length; i++) {
      var t = el("text", {
        x: x, y: y + i * (size * 1.28),
        "text-anchor": "middle", "font-size": size
      }, g);
      t.textContent = chars[i];
    }
    return g;
  }

  /* 横向波浪线:x0→x1,波幅 amp,波长 len */
  function wave(x0, x1, y, amp, len) {
    var d = "M" + x0 + "," + y, x = x0, up = true;
    while (x < x1) {
      var nx = Math.min(x + len, x1);
      d += " Q" + ((x + nx) / 2).toFixed(1) + "," + (y + (up ? -amp : amp)).toFixed(1) +
           " " + nx.toFixed(1) + "," + y;
      x = nx; up = !up;
    }
    return d;
  }

  /* ---------- 小景:按分类给母题 ----------
   * 全部是示意性的墨线小品,不是写实插画。
   * s 为整体缩放,cx/cy 为场景中心。 */

  /* 经济:纸币风暴 —— 飞舞的票据 + 方孔钱 + 爆裂的星(泡沫破了) */
  function econScene(g, cx, cy, s) {
    var i, a;
    /* 爆裂星:泡沫破的那一下 */
    for (i = 0; i < 12; i++) {
      a = i * Math.PI / 6;
      el("line", {
        x1: cx + Math.cos(a) * 14 * s, y1: cy + Math.sin(a) * 14 * s,
        x2: cx + Math.cos(a) * 26 * s, y2: cy + Math.sin(a) * 26 * s,
        stroke: INK, "stroke-width": 1.6 * s, "stroke-linecap": "round",
        opacity: 0.55
      }, g);
    }
    /* 票据:三张,转着角度飞 */
    var notes = [[-34, -18, -18], [30, -26, 12], [2, 22, -8]];
    notes.forEach(function (n) {
      var ng = el("g", {
        transform: "translate(" + (cx + n[0] * s) + "," + (cy + n[1] * s) + ") rotate(" + n[2] + ") scale(" + s + ")"
      }, g);
      el("rect", { x: -23, y: -13, width: 46, height: 26, stroke: INK, fill: "none", "stroke-width": 1.6 }, ng);
      el("rect", { x: -18, y: -8, width: 36, height: 16, stroke: INK, fill: "none", "stroke-width": 1 }, ng);
      el("path", { d: "M-10,0 q5,-4 10,0 t10,0", stroke: INK, fill: "none", "stroke-width": 1 }, ng);
    });
    /* 方孔钱:两个 */
    [[-52, 26], [52, 18]].forEach(function (p) {
      var cg = el("g", { transform: "translate(" + (cx + p[0] * s) + "," + (cy + p[1] * s) + ") scale(" + s + ")" }, g);
      el("circle", { r: 10, stroke: INK, fill: "none", "stroke-width": 1.6 }, cg);
      el("rect", { x: -3.5, y: -3.5, width: 7, height: 7, stroke: INK, fill: "none", "stroke-width": 1.2 }, cg);
    });
    /* 底下围观的人:三个剪影 */
    for (i = -1; i <= 1; i++) {
      var fg = el("g", { transform: "translate(" + (cx + i * 26 * s) + "," + (cy + 52 * s) + ") scale(" + s + ")", opacity: 0.8 }, g);
      el("circle", { cx: 0, cy: 0, r: 4, stroke: INK, fill: "none", "stroke-width": 1.4 }, fg);
      el("path", { d: "M0,5 L0,17 M-6,9 L6,9 M0,17 L-5,26 M0,17 L5,26", stroke: INK, fill: "none", "stroke-width": 1.4, "stroke-linecap": "round" }, fg);
    }
  }

  /* 政治:城门 + 旌旗 + 正在坠落的王冠 */
  function politicsScene(g, cx, cy, s) {
    /* 城门 */
    var mg = el("g", { transform: "translate(" + cx + "," + cy + ") scale(" + s + ")" }, g);
    el("rect", { x: -45, y: -8, width: 90, height: 52, stroke: INK, fill: "none", "stroke-width": 1.8 }, mg);
    /* 垛口 */
    for (var i = 0; i < 5; i++) {
      el("rect", { x: -45 + i * 18, y: -18, width: 12, height: 10, stroke: INK, fill: "none", "stroke-width": 1.6 }, mg);
    }
    /* 拱门 */
    el("path", { d: "M-14,44 L-14,18 A14,14 0 0,1 14,18 L14,44", stroke: INK, fill: "none", "stroke-width": 1.8 }, mg);
    /* 旌旗:两根杆 */
    [[-62, 0], [62, 0]].forEach(function (p) {
      el("line", { x1: p[0], y1: 44, x2: p[0], y2: -34, stroke: INK, "stroke-width": 1.6 }, mg);
      el("path", { d: "M" + p[0] + ",-34 l26,7 l-26,7 Z", stroke: INK, fill: "none", "stroke-width": 1.4 }, mg);
    });
    /* 坠落的王冠:歪的,带一条下落的弧线 */
    var cg = el("g", { transform: "translate(" + (cx + 30 * s) + "," + (cy - 52 * s) + ") rotate(-18) scale(" + s * 1.1 + ")" }, g);
    el("path", { d: "M-13,8 L-13,-6 L-6.5,0 L0,-10 L6.5,0 L13,-6 L13,8 Z",
      stroke: INK, fill: "none", "stroke-width": 1.6, "stroke-linejoin": "round" }, cg);
    el("path", { d: wave(cx - 6 * s, cx + 66 * s, cy - 78 * s, 3, 14),
      stroke: INK, fill: "none", "stroke-width": 1, opacity: 0.5 }, g);
  }

  /* 战争:城墙 + 交叉双剑 + 旗(通用版,留给以后) */
  function warScene(g, cx, cy, s) {
    var mg = el("g", { transform: "translate(" + cx + "," + cy + ") scale(" + s + ")" }, g);
    el("path", { d: "M-50,40 L-50,10 L50,10 L50,40", stroke: INK, fill: "none", "stroke-width": 1.8 }, mg);
    for (var i = 0; i < 6; i++) {
      el("rect", { x: -50 + i * 17, y: 0, width: 11, height: 10, stroke: INK, fill: "none", "stroke-width": 1.5 }, mg);
    }
    el("path", { d: "M-24,-28 L24,20 M24,-28 L-24,20", stroke: INK, "stroke-width": 1.8, "stroke-linecap": "round" }, mg);
    el("path", { d: "M0,-34 l14,4 l-14,4 Z", stroke: INK, fill: "none", "stroke-width": 1.3 }, mg);
  }

  /* 科技:大齿轮 + 基座线(通用版) */
  function techScene(g, cx, cy, s) {
    var mg = el("g", { transform: "translate(" + cx + "," + cy + ") scale(" + s + ")" }, g);
    el("circle", { r: 26, stroke: INK, fill: "none", "stroke-width": 1.8 }, mg);
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      el("line", {
        x1: Math.cos(a) * 26, y1: Math.sin(a) * 26,
        x2: Math.cos(a) * 34, y2: Math.sin(a) * 34,
        stroke: INK, "stroke-width": 2.4, "stroke-linecap": "round"
      }, mg);
    }
    el("circle", { r: 7, stroke: INK, fill: "none", "stroke-width": 1.5 }, mg);
    el("line", { x1: -44, y1: 40, x2: 44, y2: 40, stroke: INK, "stroke-width": 1.6 }, mg);
  }

  /* 文化:摞起来的书卷 + 一卷展开的(通用版) */
  function cultureScene(g, cx, cy, s) {
    var mg = el("g", { transform: "translate(" + cx + "," + cy + ") scale(" + s + ")" }, g);
    for (var i = 0; i < 3; i++) {
      el("rect", { x: -30, y: 8 - i * 14, width: 60, height: 12, stroke: INK, fill: "none", "stroke-width": 1.5 }, mg);
    }
    el("path", { d: "M-44,-22 q22,-10 44,0 l0,10 q-22,-10 -44,0 Z", stroke: INK, fill: "none", "stroke-width": 1.4 }, mg);
  }

  var SCENES = { "经济": econScene, "政治": politicsScene, "战争": warScene, "科技": techScene, "文化": cultureScene };

  /* 虹桥:清明上河图里那道高拱桥,架在两段小景之间 */
  function bridge(g, x) {
    var bg = el("g", { "class": "tl-hs-bridge", opacity: 0.9 }, g);
    el("path", { d: "M" + (x - 78) + "," + (RIVER + 34) + " Q" + x + "," + (RIVER - 66) + " " + (x + 78) + "," + (RIVER + 34),
      stroke: INK, fill: "none", "stroke-width": 2.2 }, bg);
    el("path", { d: "M" + (x - 66) + "," + (RIVER + 30) + " Q" + x + "," + (RIVER - 44) + " " + (x + 66) + "," + (RIVER + 30),
      stroke: INK, fill: "none", "stroke-width": 1.2, opacity: 0.7 }, bg);
    /* 栏杆 */
    for (var i = -3; i <= 3; i++) {
      var bx = x + i * 20;
      var t = Math.abs(i) / 4;
      var top = (RIVER - 44) + t * 70;
      el("line", { x1: bx, y1: top, x2: bx, y2: top - 12, stroke: INK, "stroke-width": 1.2, opacity: 0.8 }, bg);
    }
    el("path", { d: "M" + (x - 70) + "," + (RIVER - 52) + " Q" + x + "," + (RIVER - 108) + " " + (x + 70) + "," + (RIVER - 52),
      stroke: INK, fill: "none", "stroke-width": 1.2, opacity: 0.8 }, bg);
    /* 桥上一个小人 */
    var fg = el("g", { transform: "translate(" + (x + 12) + "," + (RIVER - 78) + ")", opacity: 0.85 }, bg);
    el("circle", { cx: 0, cy: 0, r: 3.2, stroke: INK, fill: "none", "stroke-width": 1.2 }, fg);
    el("path", { d: "M0,4 L0,13 M0,13 L-4,20 M0,13 L4,20", stroke: INK, "stroke-width": 1.2, "stroke-linecap": "round", fill: "none" }, fg);
  }

  /* 一只小船,漂在河上 */
  function boat(g, x) {
    var bg = el("g", { "class": "tl-hs-boat", opacity: 0.85 }, g);
    el("path", { d: "M" + (x - 42) + "," + (RIVER + 12) + " Q" + x + "," + (RIVER + 26) + " " + (x + 42) + "," + (RIVER + 12),
      stroke: INK, fill: "none", "stroke-width": 1.8 }, bg);
    el("path", { d: "M" + (x - 22) + "," + (RIVER + 12) + " Q" + x + "," + (RIVER - 12) + " " + (x + 22) + "," + (RIVER + 12),
      stroke: INK, fill: "none", "stroke-width": 1.4 }, bg);
    el("line", { x1: x, y1: RIVER - 2, x2: x, y2: RIVER - 26, stroke: INK, "stroke-width": 1.4 }, bg);
  }

  /* 远山:三笔一座,淡 */
  function mountains(g, W) {
    var mg = el("g", { "class": "tl-hs-mountains", opacity: 0.28 }, g);
    for (var x = 40; x < W; x += 260) {
      var h = 34 + (x % 3) * 12;
      el("path", { d: "M" + x + ",118 q" + (h * 0.5) + "," + (-h) + " " + h + "," + (-h * 0.72) +
        " M" + (x + h * 0.5) + "," + (118 - h * 0.5) + " q" + (h * 0.4) + "," + (-h * 0.5) + " " + (h * 0.8) + "," + (-h * 0.28),
        stroke: INK, fill: "none", "stroke-width": 1.4, "stroke-linecap": "round" }, mg);
    }
  }

  /* 卷云:几笔回纹 */
  function clouds(g, W) {
    var cg = el("g", { "class": "tl-hs-clouds", opacity: 0.4 }, g);
    for (var x = 150; x < W; x += 420) {
      el("path", { d: "M" + x + ",52 q26,-14 52,0 q-26,10 -52,0 M" + (x + 60) + ",66 q18,-10 36,0",
        stroke: INK, fill: "none", "stroke-width": 1.2, "stroke-linecap": "round" }, cg);
    }
  }

  function fmtYear(y) { return y < 0 ? "前" + (-y) : String(y); }

  /* 一段小景:场景 + 年份印签 + 竖排题名 + 类目朱印 */
  function scene(g, ev, cx, i, onPick) {
    var dim = ev.status !== "点亮";
    var sg = el("g", {
      "class": "tl-hs-scene" + (dim ? " st-dim" : ""),
      transform: "translate(" + cx + ",0)"
    }, g);
    /* 隐形大点击区:墨线只占小景中间一小块,空白处点不中。
       先垫一张透明纸,整幅小景随便点哪儿都算选中。 */
    el("rect", { x: -160, y: 16, width: 320, height: 272,
      fill: "rgba(0,0,0,0)", "pointer-events": "all", "class": "tl-hs-hit" }, sg);

    var draw = SCENES[ev.cat] || SCENES["经济"];
    var vg = el("g", { "class": "tl-hs-vig" }, sg);
    /* 奇偶错开一点高低,别排成阅兵 */
    draw(vg, 0, i % 2 ? 128 : 108, 1, ev);

    /* 年份:小小一方印签,压在河上 */
    var yg = el("g", { "class": "tl-hs-yearseal", transform: "translate(0," + (RIVER + 44) + ")" }, sg);
    el("rect", { x: -32, y: -11, width: 64, height: 22, stroke: INK, fill: "none", "stroke-width": 1.2 }, yg);
    var yt = el("text", { x: 0, y: 5, "text-anchor": "middle", "font-size": 14, "letter-spacing": 1 }, yg);
    yt.textContent = fmtYear(ev.year);
    var ct = el("text", { x: 0, y: 30, "text-anchor": "middle", "font-size": 11, opacity: 0.65 }, yg);
    ct.textContent = ev.city || "";

    /* 题名:竖排 */
    vtext(sg, 118, 52, ev.title, 15, "tl-hs-title");
    /* 类目朱印 */
    var seal = el("g", { "class": "tl-hs-catseal", transform: "translate(-128,52)" }, sg);
    el("rect", { x: -11, y: -11, width: 22, height: 22, fill: "#a83c32", opacity: 0.85 }, seal);
    var st = el("text", { x: 0, y: 6, "text-anchor": "middle", "font-size": 14, fill: "#f5efe2" }, seal);
    st.textContent = ev.cat.charAt(0);

    sg.style.cursor = "pointer";
    sg.addEventListener("click", function (e) {
      e.stopPropagation();
      /* 按下去先缩一下再弹开,像真的摁了个印 */
      if (motionOK()) {
        gsap.fromTo(sg, { scale: 1 }, { scale: 0.92, transformOrigin: "50% 50%",
          duration: 0.1, yoyo: true, repeat: 1, ease: "power2.in",
          onComplete: function () { onPick(ev); } });
      } else { onPick(ev); }
    });
    return sg;
  }

  /* 因果丝:同一国的两段小景之间,若有因果链,沿河拉一条虚线 */
  function causalThread(g, events, xOf) {
    var idX = {};
    events.forEach(function (e, i) { idX[e.id] = xOf(i); });
    events.forEach(function (e, i) {
      (e.links || []).forEach(function (l) {
        if (l.type !== "因果" || !(l.to in idX)) return;
        var j = events.findIndex(function (o) { return o.id === l.to; });
        if (j < 0 || j === i) return;
        var x0 = xOf(i), x1 = idX[l.to];
        el("path", {
          "class": "tl-hs-causal",
          d: "M" + x0 + "," + (RIVER - 6) + " C" + ((x0 + x1) / 2) + "," + (RIVER - 34) + " " +
             ((x0 + x1) / 2) + "," + (RIVER - 34) + " " + x1 + "," + (RIVER - 6),
          stroke: INK, fill: "none", "stroke-width": 1, "stroke-dasharray": "5,5", opacity: 0.45
        }, g);
      });
    });
  }

  /* 卷尾"未完待续":虚线空印,虚位以待。
     卷的长度随事件数伸缩,空着的这一段就是"未来还可以写"的意思。 */
  function toBeContinued(g, x) {
    var tg = el("g", { "class": "tl-hs-tbd", opacity: 0.55 }, g);
    el("circle", { cx: x, cy: 118, r: 24, stroke: INK, fill: "none",
      "stroke-width": 1.4, "stroke-dasharray": "6,6" }, tg);
    vtext(tg, x + 36, 76, "未完待续", 13, "");
  }

  /* 开卷编排:小景一朵一朵点上去,印签像盖印一样落下来,
     因果丝自己织,河在走,船在晃。全部用 gsap.from ——
     万一 CDN 没加载,元素本来就在终点位置,直接静态呈现。 */
  function animateIn(wrap) {
    if (!motionOK()) return;
    var loops = wrap._hsTweens = [];
    var q = function (sel) { return wrap.querySelectorAll(sel); };

    var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    /* 空卷(一个事件都没有)时,对应的 from 目标是空的,跳过免得 devtools 里刷警告 */
    var F = function (sel, vars, pos) {
      var els = q(sel);
      if (els.length) tl.from(els, vars, pos);
    };
    F(".tl-hs-head", { opacity: 0, x: -22, duration: 0.5 }, 0);
    F(".tl-hs-vig", { y: 38, opacity: 0, duration: 0.75, stagger: 0.22 }, 0.15);
    F(".tl-hs-yearseal", { scale: 1.9, opacity: 0, rotation: -12,
        transformOrigin: "50% 50%", duration: 0.45, ease: "back.out(1.7)", stagger: 0.22 }, 0.6);
    F(".tl-hs-catseal", { scale: 0, opacity: 0, transformOrigin: "50% 50%",
        duration: 0.4, ease: "back.out(2.2)", stagger: 0.22 }, 0.75);
    F(".tl-hs-bridge", { y: 26, opacity: 0, duration: 0.6 }, 1.0);
    F(".tl-hs-tbd", { opacity: 0, duration: 0.9 }, 1.3);
    F(".tl-hs-boat", { opacity: 0, x: -46, duration: 0.9 }, 1.2);
    loops.push(tl);

    /* 因果丝:虚线自己往前流,像因果在走 */
    q(".tl-hs-causal").forEach(function (p) {
      gsap.from(p, { opacity: 0, duration: 0.8, delay: 1.1 });
      loops.push(gsap.to(p, { strokeDashoffset: -20, duration: 1.6,
        repeat: -1, ease: "none", delay: 1.1 }));
    });

    /* 河在走:两道波浪线起虚线,错开半拍往前流 */
    q(".tl-hs-wave").forEach(function (p, i) {
      p.setAttribute("stroke-dasharray", "34 26");
      loops.push(gsap.to(p, { strokeDashoffset: i ? 60 : -60,
        duration: 5, repeat: -1, ease: "none" }));
    });

    /* 小船晃,云在飘 —— 卷是活的 */
    var boatEl = q(".tl-hs-boat")[0];
    if (boatEl) loops.push(gsap.to(boatEl, { y: -6, rotation: 1.5,
      transformOrigin: "50% 60%", duration: 1.8, yoyo: true, repeat: -1,
      ease: "sine.inOut", delay: 2.1 }));
    var cloudsEl = q(".tl-hs-clouds")[0];
    if (cloudsEl) loops.push(gsap.to(cloudsEl, { x: -70, duration: 18,
      yoyo: true, repeat: -1, ease: "sine.inOut" }));
  }

  function build(paperEl, events, opts) {
    opts = opts || {};
    var old = paperEl.querySelector(".tl-handscroll");
    if (old) {
      /* 无限循环的氛围动画(船晃、云飘、水流)跟着旧卷一起走,不留孤魂 */
      (old._hsTweens || []).forEach(function (t) { t.kill(); });
      old.remove();
    }

    var wrap = document.createElement("div");
    wrap.className = "tl-handscroll";
    /* 融形模式:卷铺满整张纸,内容裁进国家的轮廓里 —— 河在法国的形状里流 */
    if (opts.inShape) wrap.classList.add("in-shape");
    paperEl.appendChild(wrap);

    var evs = (events || []).filter(function (e) { return typeof e.year === "number"; });
    if (!evs.length) {
      wrap.innerHTML = '<div class="tl-hs-empty">这一段还是空白的 —— 时间的河从这里流过，还没留下小景。</div>';
      return wrap;
    }

    var W = PAD * 2 + evs.length * SEG;
    var xOf = function (i) { return PAD + i * SEG + SEG / 2; };

    /* 背景层:远山卷云,视差慢半拍 */
    var bgSvg = el("svg", { "class": "tl-hs-bg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid slice" }, wrap);
    bgSvg.setAttribute("width", W);
    bgSvg.setAttribute("height", H);
    /* 融形:把卷的内容裁进国家的轮廓里 —— clipPath 用 userSpaceOnUse,
       坐标就是纸面像素;横滚时反向平移,让法国的形状罩在纸上不动,河从里面流过。
       旧卷连 defs 一起被删掉才建新卷,同文档里不会撞 id */
    var shapeD = opts.shapeD || null, cpf = null, cpb = null, bandTop = 0;
    var bgRoot = bgSvg, fgRoot = null;
    if (shapeD) {
      bandTop = Math.max(0, (wrap.clientHeight - H) / 2);
      var defs = el("defs", {}, bgSvg);
      var cp1 = el("clipPath", { id: "tl-hs-cpf", clipPathUnits: "userSpaceOnUse" }, defs);
      cpf = el("path", { d: shapeD, transform: "translate(0," + (-bandTop) + ")" }, cp1);
      var cp2 = el("clipPath", { id: "tl-hs-cpb", clipPathUnits: "userSpaceOnUse" }, defs);
      cpb = el("path", { d: shapeD, transform: "translate(0," + (-bandTop) + ")" }, cp2);
      bgRoot = el("g", { "clip-path": "url(#tl-hs-cpb)" }, bgSvg);
    }
    mountains(bgRoot, W);
    clouds(bgRoot, W);

    var fgSvg = el("svg", { "class": "tl-hs-fg", viewBox: "0 0 " + W + " " + H }, wrap);
    fgSvg.setAttribute("width", W);
    fgSvg.setAttribute("height", H);
    fgRoot = shapeD ? el("g", { "clip-path": "url(#tl-hs-cpf)" }, fgSvg) : fgSvg;

    /* 河:两道波浪线 + 水纹 */
    var rg = el("g", { "class": "tl-hs-river" }, fgRoot);
    el("path", { "class": "tl-hs-wave", d: wave(0, W, RIVER - 16, 5, 46), stroke: INK, fill: "none", "stroke-width": 1.6, opacity: 0.75 }, rg);
    el("path", { "class": "tl-hs-wave", d: wave(0, W, RIVER + 16, 5, 46), stroke: INK, fill: "none", "stroke-width": 1.6, opacity: 0.75 }, rg);
    for (var wx = 30; wx < W; wx += 92) {
      el("path", { d: "M" + wx + "," + RIVER + " q12,-9 24,0 q-12,7 -24,0",
        stroke: INK, fill: "none", "stroke-width": 1, opacity: 0.4 }, rg);
    }

    /* 桥架在小景之间;卷尾先虚位以待,再让船向未来驶去 */
    for (var b = 1; b < evs.length; b++) bridge(fgRoot, PAD + b * SEG);
    toBeContinued(fgRoot, W - PAD * 1.5);
    boat(fgRoot, W - PAD * 0.55);

    causalThread(fgRoot, evs, xOf);
    evs.forEach(function (e, i) { scene(fgRoot, e, xOf(i), i, opts.onPick || function () {}); });

    /* 卷首题签:卷从哪里开始 */
    var head = el("g", { "class": "tl-hs-head", transform: "translate(44,0)" }, fgRoot);
    vtext(head, 0, 60, "时间长河", 16, "tl-hs-title");
    var hd = el("text", { x: 0, y: 250, "text-anchor": "middle", "font-size": 11, opacity: 0.55 }, head);
    hd.textContent = "自左向右 · 过去 → 未来";

    /* 视差:背景比前景慢;融形时同步平移裁剪形状,让它罩在纸上不动。
       clipPath 是 userSpaceOnUse,跟着 SVG 一起被原生滚动带走(sl 向左);
       要让框在屏幕上不动,裁剪形状必须跟着滚动窗口一起走 —— 前景 +sl,
       背景净位移是 -0.65sl(视差 0.35 抵掉一部分),所以 +0.65sl。写成 -sl
       的话框会反方向跑,滚到底框里就是空的。 */
    wrap.addEventListener("scroll", function () {
      var sl = wrap.scrollLeft;
      bgSvg.style.transform = "translateX(" + (sl * 0.35).toFixed(1) + "px)";
      if (cpf) cpf.setAttribute("transform", "translate(" + sl.toFixed(1) + "," + (-bandTop) + ")");
      if (cpb) cpb.setAttribute("transform", "translate(" + (sl * 0.65).toFixed(1) + "," + (-bandTop) + ")");
    });

    /* 纵向滚轮横着走:桌面鼠标没有横滚轮,不接的话卷轴根本滚不动。
       只在卷还能往该方向滚时接管,到头了就放行,不挡页面滚动。 */
    wrap.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      var max = wrap.scrollWidth - wrap.clientWidth - 1;
      var can = (e.deltaY > 0 && wrap.scrollLeft < max) || (e.deltaY < 0 && wrap.scrollLeft > 0);
      if (can) { e.preventDefault(); wrap.scrollLeft += e.deltaY; }
    }, { passive: false });

    /* 开卷:有 GSAP 就演一出,没有就静静地摊着。
       defer 时先藏好 —— 外面潜水到位了,再由 Scroll.play 点火 */
    if (opts.defer) {
      wrap.style.visibility = "hidden";
    } else {
      animateIn(wrap);
    }
    return wrap;
  }

  return { build: build, play: animateIn };
})();
