/**
 * 宿主端 ⇄ 客户端传输接线：走连接服务的泛型 RPC 通道。
 *
 * 背景：插件不能访问 `/api` 单次路由表（`dsh-host-apiproxy` 里的
 * `UNARY_ROUTES` 对插件关闭），所以要给 GUI 提供可写 API，只能走插件自有的
 * 泛型 RPC 通道：
 *
 *   - 宿主端：  在 `webServer` 上挂 `/capability-panel` 前缀路由（见
 *     {@link mountRpcChannel}；等价于连接服务给 `/api` 挂路由的方式）
 *   - 客户端：  ctx.get("connection").rpc.call("/capability-panel", endpoint, payload, signal)
 *
 * handler 签名是 `(endpoint, payload, signal) -> value`。endpoint 按域前缀
 * 命名：`skills.*` 路由到 skills 管理器，`mcp.*` 路由到 MCP 管理器，
 * `overrides.*` 走项目级默认声明，`jev.*` 走能力决策，`tools.*` 走 Tools 域
 * （插件级会话开关），`session.setBulk` 走三域批量端点（R1）。
 * 所有返回值统一包一层 {@link RpcResult} 信封，错误信息收敛进 `errors` 数组，
 * 客户端据此展示而不抛原始异常。
 *
 * @module dsh-capability-settings/remote
 */

import { CHANNEL } from "./channel.js";
import type { JevManager } from "./jev/manager.js";

export { CHANNEL };

/**
 * RPC 通道的业务信封。
 *
 * 注意：传输层**恒为 `{ ok: true }`**。连接通道（dsh-client-connection）对
 * 每个服务器响应做 zod 校验，`result` 必须是
 * `{ ok: true, value } | { ok: false, error: RpcError }` 二选一，其中
 * RpcError 是带特定业务 code（bad-request / session-not-found / …）的
 * 判别联合——插件的通用失败（未知 endpoint、handler 抛错、业务失败）
 * 不属于这些 code，直接返回 `{ ok: false, errors }` 会被客户端当成非法
 * 响应抛 zod invalid_union。因此失败一律包成**业务信封**：
 * `{ ok: true, value: { ok: false, errors: [...] } }`（value 是
 * unknown，恒能过通道校验），由客户端适配器（api-adapter）归一成
 * 与旧信封同构的 RawResult，业务 ok 以 value 里的为准。
 */
export type RpcResult = { ok: true; value: unknown };

/** 业务失败信封（挂在 RpcResult.value 上，与客户端 RawResult 同构）。 */
export type BusinessFailure = { ok: false; errors: string[] };

/** 构造一个始终通过通道校验的业务失败响应。 */
function failure(errors: readonly string[]): RpcResult {
  return { ok: true, value: { ok: false, errors: [...errors] } };
}

/** 被路由的服务形状（各域的方法签名）。 */
export interface PanelRpcService {
  skills: {
    list(cwd?: string): Promise<unknown>;
    /**
     * 磁盘列表 + **本会话**启用态（按会话落盘的 runtime shadow）：`enabledInSession` /
     * `canToggleInSession` 两列，供面板/输入框下方开关消费。
     */
    sessionList(cwd?: string, sessionId?: string): Promise<unknown>;
    /**
     * 设置某个 session 的 skill 开关（**按会话落盘**，重启/resume 后恢复）：
     * 关闭 = 在 agent 作用域注册同名 runtime shadow（`invocation` 双向 false）；
     * 开启 = 解除。业务失败（会话无 live agent / skills 服务缺失）走
     * `value.ok=false` 信封。
     */
    setSessionEnabled(input: unknown): Promise<unknown>;
    read(input: unknown): Promise<unknown>;
    /** 读取注入技能的资源文件（路径边界见 skills/registry.ts；业务失败在 value.code 里）。 */
    readResource(input: unknown): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
    update(input: unknown): Promise<unknown>;
    remove(input: unknown): Promise<unknown>;
    setEnabled(input: unknown): Promise<unknown>;
    setInvocation(input: unknown): Promise<unknown>;
    install(input: unknown): Promise<unknown>;
    importToProject(input: unknown): Promise<unknown>;
    disableInProject(input: unknown): Promise<unknown>;
    enableInProject(input: unknown): Promise<unknown>;
    export(input: unknown): Promise<unknown>;
  };
  mcp: {
    list(cwd?: string, sessionId?: string): Promise<unknown>;
    upsert(input: unknown): Promise<unknown>;
    remove(input: unknown): Promise<unknown>;
    setEnabled(input: unknown): Promise<unknown>;
    importToProject(input: unknown): Promise<unknown>;
    status(cwd?: string): unknown;
    /**
     * 连通性测试：真实连接一份（可能未保存的）条目，返回工具名与入参。
     * 零副作用（不落盘、不注册工具），失败也走业务失败信封（value.ok=false）。
     */
    test(input: unknown): Promise<unknown>;
    /**
     * 最近 MCP 工具调用记录（只读、内存内、不落盘）。
     * 传 `serverName` 只返回该 server 的调用；`limit` 控制"最近 n 条"。
     */
    usage(input: unknown): unknown;
    /**
     * 运行时注入的 MCP 实例（只读）：不是本插件配置文件里的条目，而是其它插件或
     * profile 直接挂载的 mcp-client。按工具注册表 + 内存使用记录反推。
     */
    runtime(input: unknown): Promise<unknown>;
    /**
     * 设置某个 session 的能力开关（**按会话落盘**，重启/resume 后恢复）：
     * 项目条目按需挂载/卸载，全局/外部实例用 `tools.restrict` 屏蔽/恢复工具。
     * `enabled: undefined` 清掉显式覆盖、重新跟随项目默认。
     */
    setSessionEnabled(input: unknown): Promise<unknown>;
  };
  overrides: {
    get(cwd?: string): Promise<unknown>;
    toggle(input: unknown): Promise<unknown>;
  };
  /**
   * Tools 域（插件级会话开关，v13）：只读枚举 + 批量写会话开关。
   *
   * 见 `src/tools/manager.ts`；`setSessionEnabled` 的 `units` 只接受单元 id
   * （不是工具名），宿主自己重算 `tools.restrict` 的 deny 名单。
   */
  tools: {
    list(input: { sessionId?: string }): Promise<unknown>;
    setSessionEnabled(input: unknown): Promise<unknown>;
    /**
     * 懒加载单个单元的工具 schema（`tools.inspect`）：完整 description + 原始
     * `parameters` JSON Schema。成功 value = `{ unit, tools }`；业务失败 =
     * `{ok:false, errors}`（信封仍恒 `{ok:true,value}`）。
     */
    inspect(input: unknown): Promise<unknown>;
    /**
     * 设置 **全局默认**（能力面板开关，所有会话；写 `tools-global.json` 并扇出）。
     *
     * `{units, enabled}` → `{ok:true, applied}` / `{ok:false, errors}`；
     * 会话首屏的开关仍走 `tools.setSessionEnabled`（只写本会话覆盖）。
     */
    setGlobalEnabled(input: unknown): Promise<unknown>;
  };
  /**
   * R1 批量端点：三域一次开关（Skills / MCP / Tools），幂等、按会话串行、
   * 部分失败不回滚（见 `src/session-bulk.ts`）。
   */
  session: {
    setBulk(input: unknown): Promise<unknown>;
    /** 读取会话级「派生继承模式」+ 派生会话创建快照。 */
    deriveGet(input: unknown): Promise<unknown>;
    /** 设置会话级「派生继承模式」。 */
    deriveSet(input: unknown): Promise<unknown>;
  };
  /**
   * Jev 能力决策（配置 / 连通性 / 批量打分 / 批量应用）。
   *
   * 业务失败一律走 `value.ok=false`（信封仍恒 `ok:true`）；`rank` / `apply`
   * 的成功支里可能带回 `pendingOutcome`（冷会话排队结果，读取即消费）。
   */
  jev: JevManager;
}

/**
 * 把 `(endpoint, payload)` 路由到服务并规范化结果。
 *
 * 从 payload 里解析可选的 `cwd`（skills.list / mcp.list / mcp.status 用它
 * 限定项目作用域）；未知 endpoint 或服务抛错都归一成业务失败信封
 * `{ ok: true, value: { ok: false, errors } }`（见 {@link failure}）。
 */
export async function handleEndpoint(service: PanelRpcService, endpoint: string, payload: unknown, _signal?: AbortSignal): Promise<RpcResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
  // 会话级能力开关需要 sessionId（面板不传 = 只看项目默认；composer 的 api 会带）。
  const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
  try {
    switch (endpoint) {
      case "skills.list":
        return { ok: true, value: await service.skills.list(cwd) };
      case "skills.sessionList":
        // 会话级视图：磁盘列表 + enabledInSession / canToggleInSession。
        return { ok: true, value: await service.skills.sessionList(cwd, sessionId) };
      case "skills.setSessionEnabled":
        // 内存态开关；业务失败在 value.ok=false 里（信封仍恒 ok:true）。
        return { ok: true, value: await service.skills.setSessionEnabled(p) };
      case "skills.read":
        return { ok: true, value: await service.skills.read(p) };
      case "skills.readResource":
        // 注入技能的资源读取：业务失败（escape / too-large / not-text …）
        // 收进 value.ok=false + value.code，传输层信封仍恒 ok:true。
        return { ok: true, value: await service.skills.readResource(p) };
      case "skills.create":
        return { ok: true, value: await service.skills.create(p) };
      case "skills.update":
        return { ok: true, value: await service.skills.update(p) };
      case "skills.remove":
        return { ok: true, value: await service.skills.remove(p) };
      case "skills.setEnabled":
        return { ok: true, value: await service.skills.setEnabled(p) };
      case "skills.setInvocation":
        return { ok: true, value: await service.skills.setInvocation(p) };
      case "skills.install":
        return { ok: true, value: await service.skills.install(p) };
      case "skills.importToProject":
        return { ok: true, value: await service.skills.importToProject(p) };
      case "skills.disableInProject":
        return { ok: true, value: await service.skills.disableInProject(p) };
      case "skills.enableInProject":
        return { ok: true, value: await service.skills.enableInProject(p) };
      case "skills.export":
        return { ok: true, value: await service.skills.export(p) };
      case "mcp.list":
        return { ok: true, value: await service.mcp.list(cwd, sessionId) };
      case "mcp.upsert":
        return { ok: true, value: await service.mcp.upsert(p) };
      case "mcp.remove":
        return { ok: true, value: await service.mcp.remove(p) };
      case "mcp.setEnabled":
        return { ok: true, value: await service.mcp.setEnabled(p) };
      case "mcp.importToProject":
        return { ok: true, value: await service.mcp.importToProject(p) };
      case "mcp.status":
        return { ok: true, value: service.mcp.status(cwd) };
      case "mcp.runtime":
        return { ok: true, value: await service.mcp.runtime({ cwd, sessionId }) };
      case "mcp.setSessionEnabled":
        return { ok: true, value: await service.mcp.setSessionEnabled(p) };
      case "mcp.usage":
        // 只读查询：始终返回 { ok:true, value:{ entries, limit } }。
        return { ok: true, value: service.mcp.usage(p) };
      case "mcp.test":
        // 探测自身把失败收进业务信封（value.ok=false），这里保持同一形状：
        // 客户端适配器解出 { ok:false, errors } 后由面板展示。
        return { ok: true, value: await service.mcp.test(p) };
      case "overrides.get":
        return { ok: true, value: await service.overrides.get(cwd) };
      case "overrides.toggle":
        return { ok: true, value: await service.overrides.toggle(p) };
      case "tools.list":
        // sessionId 缺省 = 主面板的只读视图（enabledInSession 恒为默认值）。
        return { ok: true, value: await service.tools.list(sessionId !== undefined ? { sessionId } : {}) };
      case "tools.setSessionEnabled":
        // batch-first（单条 = 长度 1 的数组）；业务失败收在 value.ok=false。
        return { ok: true, value: await service.tools.setSessionEnabled(p) };
      case "tools.inspect":
        // 懒加载工具 schema（完整 description + parameters）；业务失败在 value 内。
        return { ok: true, value: await service.tools.inspect(p) };
      case "tools.setGlobalEnabled":
        // 全局默认（能力面板）：写 tools-global.json + 异步扇出；业务失败在 value 内。
        return { ok: true, value: await service.tools.setGlobalEnabled(p) };
      case "session.setBulk":
        // 三域批量：业务失败（缺 sessionId / 非法 action / 未知域名）也在 value 内。
        return { ok: true, value: await service.session.setBulk(p) };
      case "session.deriveGet":
        // 派生继承模式 + 派生会话创建快照；业务失败在 value.ok=false。
        return { ok: true, value: await service.session.deriveGet(p) };
      case "session.deriveSet":
        // 只接受 session / workspace；业务失败在 value.ok=false。
        return { ok: true, value: await service.session.deriveSet(p) };
      case "jev.getConfig":
        // 只回掩码视图（hasApiKey / apiKeySource / apiKeyLast4），绝无明文 key。
        return { ok: true, value: await service.jev.getConfig() };
      case "jev.setConfig":
        return { ok: true, value: await service.jev.setConfig(p) };
      case "jev.test":
        // 探针在宿主进程 fetch（客户端拿不到 key）。payload 可为 `{config?}`
        // （本次表单值，不落盘）；取消信号透传。
        return { ok: true, value: await service.jev.test(p, _signal) };
      case "jev.rank":
        // 传整个 payload：sessionId / cwd / draft 由 service 再校验（与 mcp 一致）。
        return { ok: true, value: await service.jev.rank(p, _signal) };
      case "jev.apply":
        return { ok: true, value: await service.jev.apply(p) };
      default:
        return failure([`unknown endpoint "${endpoint}"`]);
    }
  } catch (error) {
    return failure([error instanceof Error ? error.message : String(error)]);
  }
}

/**
 * 挂载插件自有的 HTTP RPC 通道。
 *
 * **为什么不用 `connection.rpc.handle(...)`**：该 API 的契约（
 * dsh-client-connection 的 `HostConnectionRpc.handle`）正是"注册一个绝对通道
 * 前缀 + 返回 disposer"，本插件此前也这么用；但当前宿主（0.1.5-rc.2）的实现
 * 是 `owner.effect(() => owner.webServer.register(route))`，其中 `owner` 经
 * cordis 的 shadow/origin 绑定解析成 **connection 插件自己的 ctx**（不是调用
 * 方的注入 ctx），而那个 ctx 的 inject 里没有 `webServer`，于是**恒定**抛
 * `cannot get property "webServer" without inject`。异常发生在 `rpc.handle`
 * 内部，通道静默不挂载，浏览器端在 `/capability-panel/*` 上只拿到
 * frontend-static 兜底的 405。
 *
 * 因此这里改用宿主**公开且文档化**的三个 API 自己挂路由，与 connection 插件
 * 挂 `/api`、api-gateway 挂 WebSocket 升波路由完全同构：
 *
 *   - `ctx.inject(["connection", "webServer"], ...)`：等两端服务就位再挂，
 *     早于 webServer 出现就挂会拿不到服务；
 *   - `connection.requestRejection(req)`：宿主的 Host/Origin 信任检查 + 浏览器
 *     会话认证（未认证 401 / 不受信来源 403）；
 *   - `webServer.register({ kind: "prefix", path: CHANNEL, handler })`：注册
 *     前缀路由。注册生命周期挂在**本插件的 fiber** 上（`ctx.effect`），插件
 *     卸载 / 重载即摘除，不会留下旧 handler。
 *
 * 线上信封与 `dsh-client-connection` 客户端 `rpc.call` 保持一致（见
 * {@link createChannelRoute}）：请求 `{ type: "client-request", rpcId, method,
 * payload }`，响应 `{ type: "server-response", rpcId, result }`，其中 result 即
 * {@link RpcResult}。
 */
export function mountRpcChannel(ctx: any, service: PanelRpcService) {
  const handler = (endpoint: string, payload: unknown) => handleEndpoint(service, endpoint, payload);

  if (typeof ctx.inject !== "function") {
    ctx.logger?.warn?.("capability-panel: `ctx.inject` unavailable; host RPC channel not mounted");
    return () => undefined;
  }

  let disposeRoute: unknown;
  const stopInject = ctx.inject(["connection", "webServer"], (hostCtx: any) => {
    const connection = hostCtx.connection;
    const webServer = hostCtx.webServer;
    if (connection?.requestRejection === undefined || webServer?.register === undefined) {
      ctx.logger?.warn?.("capability-panel: `connection`/`webServer` unavailable; host RPC channel not mounted");
      return;
    }
    disposeRoute = hostCtx.effect(
      () => webServer.register({ kind: "prefix", path: CHANNEL, handler: createChannelRoute(connection, handler) }),
      `capability-panel: ${CHANNEL} rpc channel`,
    );
  });

  return () => {
    if (typeof disposeRoute === "function") (disposeRoute as () => void)();
    // cordis 4 的 `ctx.inject` 返回 Fiber（对象，带 dispose()），旧版返回函数。
    if (typeof stopInject === "function") (stopInject as () => void)();
    else void (stopInject as { dispose?: () => Promise<void> } | undefined)?.dispose?.();
  };
}

/** 通道请求体的字节上限，与 dsh-client-connection 的默认值（300 MiB）对齐。 */
const MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024;

/** endpoint 单段字符集，与宿主 `endpointFromPath` 的校验保持一致。 */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;

/** 从 `${CHANNEL}/<endpoint>` 抽出 endpoint；路径不合法时返回 undefined。 */
function endpointFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith(`${CHANNEL}/`)) return undefined;
  const endpoint = pathname.slice(CHANNEL.length + 1);
  if (endpoint.split("/").some((segment) => segment === "" || segment === "." || segment === ".." || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined;
  }
  return endpoint;
}

/**
 * 组装通道的 node:http 处理函数：先过信任/认证闸门，再把
 * `{ type: "client-request", rpcId, method, payload }` 解成
 * `handler(endpoint, payload)`，最后以 `{ type: "server-response", rpcId, result }`
 * 回写（HTTP 始终 200，业务失败在 result 里表达，与宿主同款语义）。
 */
function createChannelRoute(connection: any, handler: (endpoint: string, payload: unknown) => Promise<RpcResult>) {
  /** 写一个 JSON 响应。 */
  const respond = (res: any, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
    res.end(payload);
  };

  /** 以宿主同款的 bad-request 信封回应非法请求（HTTP 200 + result.ok=false）。 */
  const badRequest = (res: any, rpcId: unknown, message: string) =>
    respond(res, {
      type: "server-response",
      rpcId: typeof rpcId === "string" ? rpcId : "invalid-request",
      result: { ok: false, error: { code: "gateway/bad-request", message, details: { issues: [] } } },
    });

  return async (req: any, res: any) => {
    const rejection = connection.requestRejection(req);
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end(rejection === 401 ? "unauthorized" : "forbidden");
      return;
    }

    const endpoint = endpointFromPath(new URL(req.url ?? "/", "http://dsh.internal").pathname);
    if (req.method !== "POST" || endpoint === undefined) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      res.writeHead(415);
      res.end("content type must be application/json");
      return;
    }

    // 逐块读请求体并限长（上传安装走这条通道，base64 zip 可能很大）。
    const declared = req.headers["content-length"];
    if (declared !== undefined && Number(declared) > MAX_REQUEST_BODY_BYTES) {
      res.writeHead(413, { connection: "close" });
      res.end();
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      received += buffer.byteLength;
      if (received > MAX_REQUEST_BODY_BYTES) {
        res.writeHead(413, { connection: "close" });
        res.end();
        req.destroy();
        return;
      }
      chunks.push(buffer);
    }

    let body: any;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400);
      res.end("body is not JSON");
      return;
    }

    if (body === null || typeof body !== "object" || body.type !== "client-request" || typeof body.rpcId !== "string" || typeof body.method !== "string") {
      badRequest(res, body?.rpcId, "invalid client-request message");
      return;
    }
    if (body.method !== endpoint) {
      badRequest(res, body.rpcId, `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`);
      return;
    }

    try {
      respond(res, { type: "server-response", rpcId: body.rpcId, result: await handler(endpoint, body.payload) });
    } catch (error) {
      res.writeHead(500);
      res.end(`handler failure: ${String(error)}`);
    }
  };
}