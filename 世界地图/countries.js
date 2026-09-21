/* 世界历史时间轴 · 国名中译
 *
 * map.js 用的是英文名,events.js 用的是中文名,这里把两边对上。
 * 只收录当前有内容的国家加少量常见国;查不到就原样显示英文名,
 * 不做猜测。加新国家照格式加一行。
 */
const COUNTRY_CN = {
  "United Kingdom": "英国",
  "France": "法国",
  "United States of America": "美国",
  "China": "中国",
  "Germany": "德国",
  "Austria": "奥地利",
  "Netherlands": "荷兰",
  "Iceland": "冰岛",
  "Ireland": "爱尔兰",
  "Japan": "日本",
  "Italy": "意大利",
  "Spain": "西班牙",
  "Portugal": "葡萄牙",
  "Belgium": "比利时",
  "Switzerland": "瑞士",
  "Russia": "俄罗斯",
  "India": "印度",
  "Brazil": "巴西",
  "Canada": "加拿大",
  "Australia": "澳大利亚",
  "Mexico": "墨西哥",
  "South Korea": "韩国",
  "Turkey": "土耳其",
  "Greece": "希腊",
  "Sweden": "瑞典",
  "Norway": "挪威",
  "Denmark": "丹麦",
  "Poland": "波兰"
};

/* events.js 里写的是中文国名,反查回英文以便和 map.js 对上 */
const COUNTRY_EN = (function () {
  var m = {};
  Object.keys(COUNTRY_CN).forEach(function (en) { m[COUNTRY_CN[en]] = en; });
  return m;
})();

/* 兜底表。实测当前 14 个城市全部能由 Globe.countryAt 几何判定出来,
   这张表一次都没用上;留着是因为海岸线只有 54 顶点级别的精度,
   将来新增沿海城市时可能落在多边形之外。 */
const CITY_COUNTRY_FALLBACK = {
  "hongkong": "China",
  "reykjavik": "Iceland",
  "dublin": "Ireland",
  "amsterdam": "Netherlands",
  "hamburg": "Germany",
  "frankfurt": "Germany",
  "berlin": "Germany",
  "vienna": "Austria",
  "tokyo": "Japan",
  "sanfran": "United States of America",
  "newyork": "United States of America",
  "london": "United Kingdom",
  "paris": "France",
  "shanghai": "China"
};
