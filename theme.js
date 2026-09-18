/* 共用交互:深色/浅色切换、移动端侧边栏、目录高亮 */
(function () {
  var root = document.documentElement;

  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("ti-theme", t); } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", function () {
    /* 主题切换按钮 */
    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var cur = root.getAttribute("data-theme") === "light" ? "light" : "dark";
        setTheme(cur === "light" ? "dark" : "light");
      });
    }

    /* 移动端侧边栏 */
    var sb = document.getElementById("sidebar");
    var ham = document.getElementById("sidebar-toggle");
    var scrim = document.getElementById("scrim");
    function closeSb() {
      if (sb) sb.classList.remove("open");
      if (scrim) scrim.classList.remove("show");
    }
    if (ham && sb) {
      ham.addEventListener("click", function () {
        var open = sb.classList.toggle("open");
        if (scrim) scrim.classList.toggle("show", open);
      });
    }
    if (scrim) scrim.addEventListener("click", closeSb);
    if (sb) {
      sb.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", closeSb);
      });
    }

    /* 目录 scrollspy */
    var links = Array.prototype.slice.call(
      document.querySelectorAll('.sidebar a[href^="#"]')
    );
    var secs = links
      .map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); })
      .filter(Boolean);
    function spy() {
      var y = window.scrollY + 140, cur = null;
      secs.forEach(function (s) { if (s.offsetTop <= y) cur = s.id; });
      links.forEach(function (a) {
        a.classList.toggle("active", a.getAttribute("href") === "#" + cur);
      });
    }
    if (links.length) {
      window.addEventListener("scroll", spy, { passive: true });
      spy();
    }
  });
})();
