// Q13 全修：三端"首屏拿 100 条就当全量"的假设跟服务端 limit/offset 分页契约冲突——
// 收藏允许最多 1000 条，服务端默认/上限都是 100，客户端从不传 offset 续页，超过
// 100 条的旧收藏永久不可达（本地类型筛选同样只覆盖这 100 条）。
// 抽成通用小工具（不依赖 axios/React），便于直接单测循环终止条件。
export async function fetchAllPages({ requestPage, limit = 100, signal }) {
  const items = [];
  let offset = 0;
  for (;;) {
    if (signal?.aborted) break;
    const page = await requestPage(offset, limit);
    items.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return items;
}
