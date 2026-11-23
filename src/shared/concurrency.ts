/**
 * 并发限流执行（进程内 worker 池）。
 *
 * 两个变体，语义不同，不要混用：
 *
 *   - {@link runWithConcurrency}：固定并发度、按输入顺序返回结果；某个任务抛错
 *     时**不**打断其它在飞任务（`Promise.all` 语义，调用方拿到第一个拒绝）。
 *     `jev/apply.ts` 的 MCP 写入 / 回滚用它——一项失败后仍要继续收尾其它项。
 *   - {@link runWithConcurrencySignal}：同上，但把**合并后的 AbortSignal** 交给
 *     每个任务，并在**第一个失败**时取消其余在飞任务、抛该失败（不做按索引
 *     归并，避免把「被取消」的 timeout 误当真实错误）。
 *     `jev.rank` 与派生动态选择的分片请求用它——分片互不依赖，一片 4xx 就
 *     没必要再等其余分片（它们只会被计费、不会有结果）。
 *
 * 两个都保持「按输入顺序」写回结果，调用方可以按下标合并（分片 answers 的
 * 合并顺序因此确定）。
 *
 * @module dsh-capability-settings/shared/concurrency
 */

/** 固定并发度执行；按输入顺序返回结果。首个拒绝原样抛出，不取消其它在飞任务。 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 固定并发度执行 + 可取消。
 *
 * 取消来源二合一（共用同一 `AbortController`）：
 *
 *   1. **失败即取消**：任一任务抛出第一个错误后，取消其余在飞任务，并直接抛该错误；
 *   2. **外部取消**：`external`（RPC 客户端取消等）abort 时转发给每个任务。若任务
 *      自身不响应 signal、仍然成功返回，池子会在下一个领取点停下，缺失的槽位在
 *      返回前用「未完成」错误兜底（调用方不会拿到带空洞的数组）。
 *
 * 注意：外部已取消时**不是**空跑返回——每个 worker 仍会领取一个任务交给 `run`，
 * 由 `run` 按自己的取消语义抛错（`postSystemOne` 会映射成 `timeout`），保持与
 * 串行实现一致的错误码。
 */
export async function runWithConcurrencySignal<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  external?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return [];
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  if (external !== undefined) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", forward, { once: true });
  }
  const results = new Array<R>(items.length);
  const completed = new Array<boolean>(items.length).fill(false);
  let cursor = 0;
  let failure: { error: unknown } | undefined;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index]!, index, controller.signal);
        completed[index] = true;
      } catch (error) {
        // 只有「第一个」失败被保留：后续错误多半是本池取消引发的 timeout。
        if (failure === undefined) failure = { error };
        controller.abort();
        return;
      }
      // 已取消（失败或外部取消）后不再领取新任务。
      if (controller.signal.aborted) return;
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    external?.removeEventListener("abort", forward);
  }
  if (failure !== undefined) throw failure.error;
  const missing = completed.indexOf(false);
  if (missing >= 0) throw new Error(`concurrent task #${missing} did not complete`);
  return results;
}
