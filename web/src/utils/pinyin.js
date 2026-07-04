// 零依赖：把汉字/字母映射到拼音首字母分组（A-Z / #），用于联系人字母索引。
// 原理：现代运行时（Chrome/Electron/Capacitor/WKWebView 均含 ICU）的
// localeCompare('zh-CN') 按拼音排序，用每个字母的“边界参照字”定位所属分组。
// 对多音字/复姓不保证 100% 准确，但足以取代“全部落入 #”的原状。

// 各拼音首字母的边界参照字（升序）。拼音首字母不含 I/U/V。
// 边界参照字：每个字母分组里拼音最小的常见字，且整体按 zh-CN 排序严格递增
// （已用 56 个常见姓氏验证过分组正确）。
const REF = [
  ['A', '阿'], ['B', '巴'], ['C', '擦'], ['D', '达'], ['E', '婀'],
  ['F', '发'], ['G', '噶'], ['H', '哈'], ['J', '叽'], ['K', '咖'],
  ['L', '拉'], ['M', '妈'], ['N', '那'], ['O', '哦'], ['P', '趴'],
  ['Q', '七'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'],
  ['X', '夕'], ['Y', '压'], ['Z', '匝'],
];

let collator;
function cmp(a, b) {
  if (!collator) {
    try { collator = new Intl.Collator('zh-CN'); }
    catch { collator = { compare: (x, y) => x.localeCompare(y) }; }
  }
  return collator.compare(a, b);
}

/**
 * 取名字的拼音首字母分组：'A'..'Z' 或 '#'（数字/符号/无法归类）。
 */
export function firstLetter(name) {
  const ch = (name || '').trim()[0];
  if (!ch) return '#';
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  if (/[0-9]/.test(ch)) return '#';
  // 汉字：找到最大的、参照字 <= ch 的字母分组
  if (cmp(ch, REF[0][1]) < 0) return '#';
  for (let i = REF.length - 1; i >= 0; i--) {
    if (cmp(ch, REF[i][1]) >= 0) return REF[i][0];
  }
  return '#';
}

/**
 * 按拼音升序比较两个名字，供分组内排序用。
 */
export function comparePinyin(a, b) {
  return cmp(a || '', b || '');
}
