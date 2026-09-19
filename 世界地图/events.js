/* 世界历史时间轴 · 事件数据
 * 字段：year 年份 / city 城市 / country 国家 / lat,lng 经纬度
 *       cat 分类（经济/政治/战争/科技/文化）/ title 标题
 *       summary 一句话 / chapter 读书笔记章节相对路径（无则为 null）
 * 以后加新事件（比如法国大革命这类政治事件）只需照格式加一行。
 */
const TIMELINE_EVENTS = [
  {
    year: 1720, city: "巴黎", country: "法国", lat: 48.85, lng: 2.35,
    cat: "经济", title: "密西西比泡沫破裂",
    summary: "约翰·劳的纸币与股票游戏崩盘，人类历史上第一次现代金融泡沫。",
    chapter: "../读书笔记/逃不开的经济周期/01-密西西比泡沫/"
  },
  {
    year: 1789, city: "巴黎", country: "法国", lat: 48.85, lng: 2.35,
    cat: "政治", title: "法国大革命",
    summary: "巴士底狱被攻陷；革命政府滥发指券，纸币再次崩盘——政治与货币从此绑在一起。",
    chapter: null
  },
  {
    year: 1797, city: "伦敦", country: "英国", lat: 51.5, lng: -0.12,
    cat: "经济", title: "现金支付危机",
    summary: "战争压力下英格兰银行暂停纸币兑付黄金：信心消失的那天，就是危机开始的那天。",
    chapter: null
  },
  {
    year: 1837, city: "纽约", country: "美国", lat: 40.71, lng: -74.0,
    cat: "经济", title: "1837 年美国经济危机",
    summary: "土地投机狂热之后银行倒闭潮来袭，杰克逊“银行战争”的余波横扫全美。",
    chapter: null
  },
  {
    year: 1869, city: "纽约", country: "美国", lat: 40.71, lng: -74.0,
    cat: "经济", title: "黑色星期五：幽灵黄金",
    summary: "杰伊·古尔德黄金逼空失败，金价崩盘，华尔街一片狼藉。",
    chapter: null
  },
  {
    year: 1929, city: "纽约", country: "美国", lat: 40.71, lng: -74.0,
    cat: "经济", title: "大萧条开幕",
    summary: "10 月“黑色星期四”美股崩盘，全球长达十年的大萧条拉开帷幕。",
    chapter: null
  },
  {
    year: 1936, city: "伦敦", country: "英国", lat: 51.5, lng: -0.12,
    cat: "经济", title: "凯恩斯发表《通论》",
    summary: "《就业、利息和货币通论》出版，政府出手熨平周期的剧本就此写下。",
    chapter: null
  },
  {
    year: 2000, city: "旧金山", country: "美国", lat: 37.77, lng: -122.41,
    cat: "经济", title: "互联网泡沫破裂",
    summary: "纳斯达克崩盘，无数 .com 公司蒸发；活下来的亚马逊们穿越废墟长大。",
    chapter: null
  },
  {
    year: 2008, city: "纽约", country: "美国", lat: 40.71, lng: -74.0,
    cat: "经济", title: "次贷危机",
    summary: "房价—信贷正反馈逆转，“周期之母”房地产把全球拖入金融危机。",
    chapter: null
  },
  {
    year: 2050, city: "上海", country: "中国", lat: 31.23, lng: 121.47,
    cat: "经济", title: "2050 年的上海（思想实验）",
    summary: "书中的未来推演：AI、人口与城市化，会如何改写周期的形态？",
    chapter: null
  }
];
