/* 世界历史时间轴 · 时代切分
 *
 * 每个时代有自己的纸。这不是换个主题色——每个时代真的有自己的视觉传统,
 * 莎草纸和泥金手抄本和铜版画是三种完全不同的东西。
 *
 * 边界取通行断代。有争议的地方(比如中世纪的起止)取最常见的那个说法,
 * 不在这里替史学界下结论。
 *
 * 注意:空的时代是故意留空的。这是一张知识图谱,
 * 看得见自己还没走到哪儿,比只看得见走过的地方重要。
 */
const ERAS = [
  { id: "greece",     name: "古希腊",   from: -800, to: -146,
    note: "从荷马到科林斯陷落。城邦、铸币与最早的海上贸易网。" },
  { id: "rome",       name: "罗马",     from: -146, to: 476,
    note: "共和末期到西罗马崩溃。帝国货币、税制与通货贬值。" },
  { id: "medieval",   name: "中世纪",   from: 476,  to: 1453,
    note: "西罗马灭亡到君士坦丁堡陷落。行会、汇票与教会的禁利贷。" },
  { id: "sail",       name: "大航海",   from: 1453, to: 1760,
    note: "君士坦丁堡陷落到工业革命前夜。贸易公司、殖民与第一批现代泡沫。" },
  { id: "industrial", name: "革命与工业", from: 1760, to: 1914,
    note: "法国大革命与蒸汽到一战前。这一段同时装着政治革命与工业化——所以不叫\"工业革命\"。" },
  { id: "modern",     name: "现代",     from: 1914, to: 1991,
    note: "一战到苏联解体。大萧条、布雷顿森林与凯恩斯之后的世界。" },
  { id: "contemp",    name: "当代",     from: 1991, to: 2050,
    note: "冷战结束至今。全球化、互联网泡沫、次贷,以及还没发生的事。" }
];

function eraOf(year) {
  for (var i = 0; i < ERAS.length; i++) {
    if (year >= ERAS[i].from && year < ERAS[i].to) return ERAS[i];
  }
  return year < ERAS[0].from ? ERAS[0] : ERAS[ERAS.length - 1];
}
