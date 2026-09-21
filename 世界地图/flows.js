/* 世界历史时间轴 · 资金流动数据
 *
 * 每条 flow 是一次真实发生过的资金/危机跨境传递。年份取"传递发生"的年份,
 * 不一定等于事件爆发年(例如 1929 崩盘,欧洲的连锁到 1931 才到顶)。
 *
 * kind 三类:
 *   外逃  资本从崩盘地撤出       (红)
 *   传染  危机顺着敞口传到下一处  (紫)
 *   流动性 央行/官方资金注入救火   (青)
 *
 * note 里带"推测"二字的是未经严格考据的示意,其余为通行史实。
 * 加新路线照格式加一行即可。
 */
const FLOW_PLACES = {
  paris:      { name: "巴黎",     lat: 48.85, lng: 2.35 },
  london:     { name: "伦敦",     lat: 51.50, lng: -0.12 },
  amsterdam:  { name: "阿姆斯特丹", lat: 52.37, lng: 4.90 },
  hamburg:    { name: "汉堡",     lat: 53.55, lng: 9.99 },
  newyork:    { name: "纽约",     lat: 40.71, lng: -74.0 },
  sanfran:    { name: "旧金山",   lat: 37.77, lng: -122.41 },
  berlin:     { name: "柏林",     lat: 52.52, lng: 13.40 },
  vienna:     { name: "维也纳",   lat: 48.21, lng: 16.37 },
  frankfurt:  { name: "法兰克福", lat: 50.11, lng: 8.68 },
  reykjavik:  { name: "雷克雅未克", lat: 64.15, lng: -21.94 },
  dublin:     { name: "都柏林",   lat: 53.35, lng: -6.26 },
  shanghai:   { name: "上海",     lat: 31.23, lng: 121.47 },
  hongkong:   { name: "香港",     lat: 22.32, lng: 114.17 },
  tokyo:      { name: "东京",     lat: 35.68, lng: 139.65 }
};

const MONEY_FLOWS = [
  /* ---- 1720:三城同年吹泡,资本在它们之间来回跑 ---- */
  { year: 1720, from: "paris", to: "london", kind: "外逃",
    note: "密西西比泡沫破裂,资金渡过海峡——同一年南海泡沫在伦敦吹到顶。" },
  { year: 1720, from: "paris", to: "amsterdam", kind: "外逃",
    note: "阿姆斯特丹同年爆发 windhandel(风之交易),1720 是欧洲第一个跨国泡沫年。" },
  { year: 1720, from: "london", to: "amsterdam", kind: "传染",
    note: "南海崩盘后恐慌向低地国家扩散。" },

  /* ---- 1797:英格兰银行停兑,冲击顺着贸易融资传到汉堡 ---- */
  { year: 1799, from: "london", to: "hamburg", kind: "传染",
    note: "停兑后信用收缩,1799 年汉堡商业危机——当时欧洲最严重的一次票据崩溃。" },

  /* ---- 1837:方向是反的,英国抽资引爆美国 ---- */
  { year: 1836, from: "newyork", to: "london", kind: "外逃",
    note: "英格兰银行 1836 年加息,英资从美国棉花与土地投机中撤回——抽走的钱引爆了 1837。" },

  /* ---- 1929-1931:崩盘从纽约扩散,两年后在中欧引爆 ---- */
  { year: 1929, from: "newyork", to: "london", kind: "传染",
    note: "美股崩盘,国际短期资金链收缩。" },
  { year: 1930, from: "newyork", to: "berlin", kind: "外逃",
    note: "美国短期贷款从德国撤出,魏玛的偿债链条随之断裂。" },
  { year: 1931, from: "vienna", to: "berlin", kind: "传染",
    note: "奥地利信贷银行(Creditanstalt)倒闭,危机向德国传导。" },
  { year: 1931, from: "berlin", to: "london", kind: "传染",
    note: "德国银行业挤兑波及英国敞口,同年 9 月英镑脱离金本位。" },

  /* ---- 2000:泡沫从湾区传到华尔街再到全球 ---- */
  { year: 2000, from: "sanfran", to: "newyork", kind: "传染",
    note: "纳斯达克见顶回落,风险偏好从科技股全面撤退。" },
  { year: 2000, from: "sanfran", to: "tokyo", kind: "传染",
    note: "全球科技股同步下跌(推测:传导细节各市场不同)。" },

  /* ---- 2008:教科书级的跨境传染 ---- */
  { year: 2008, from: "newyork", to: "london", kind: "传染",
    note: "雷曼倒闭,伦敦同业市场冻结。" },
  { year: 2008, from: "newyork", to: "frankfurt", kind: "传染",
    note: "德国银行持有的美国次级资产大幅减记。" },
  { year: 2008, from: "newyork", to: "reykjavik", kind: "传染",
    note: "冰岛三大银行在数天内相继国有化,银行资产曾达 GDP 的近十倍。" },
  { year: 2008, from: "newyork", to: "dublin", kind: "传染",
    note: "爱尔兰地产信贷崩塌,政府为银行债务兜底。" },
  { year: 2008, from: "newyork", to: "frankfurt", kind: "流动性",
    note: "美联储与欧洲央行开通美元互换额度,官方资金反向注入。" },
  { year: 2009, from: "newyork", to: "hongkong", kind: "流动性",
    note: "量化宽松后套利资金涌向亚洲(推测:规模与路径存在争议)。" },

  /* ---- 2050:思想实验,不是预测 ---- */
  { year: 2050, from: "shanghai", to: "newyork", kind: "外逃",
    note: "思想实验:如果周期的下一个中心在东边,资金会往哪个方向跑?" },
  { year: 2050, from: "shanghai", to: "london", kind: "传染",
    note: "思想实验:同上。" }
];
