/**
 * 注入接管层（P1）：把「本会话选中的 prompt 集合」交给宿主渲染器，并冻结结果。
 *
 * 设计（与用户确认的口径一致）：
 *
 *   - **不自己拼接 / 去重 / 算预算**：调用 `manager.render()` → 宿主导出的
 *     `loadBaselineInstructions`，渲染结果原样使用；
 *   - **只控制传递什么**：宿主注入器先跑（我们注册在 root ctx 的 `prepend`
 *     最外层，`next()` 返回后能看到它处理完的 decision），我们把宿主 baseline
 *     正文替换成「允许集合」的宿主渲染结果；允许集合为空时替换成宿主的
 *     empty-replacement 文本（或整条丢弃）；
 *   - **冻结**：首轮之后丢弃所有 `source.kind = "agent-instructions"` 的消息
 *     并清 `agent.inbox` 里的同类排队；跨 resume / compaction 后仍按冻结清单
 *     重放同一正文；
 *   - **fail-open**：任何异常只 warn，原样放行宿主消息（全量注入），绝不拖垮对话。
 *
 * @module dsh-capability-settings/prompt/inject
 */

import { parseBaselineIdentity } from "./host.js";
import type { PromptManager, PromptSelection } from "./manager.js";

/** 注入层依赖。 */
export interface PromptInjectionDeps {
  manager: PromptManager;
  logger?: { warn?: (message: string) => void };
}

/** 最小 agent 形状（只用到这些字段；host 类型不引入）。 */
interface AgentLike {
  id?: string;
  session?: { header?: { id?: string; cwd?: string } };
  inbox?: { nextStep?: unknown; remove?: (id: unknown) => void };
}

/** 一条消息的最小形状。 */
interface MessageLike {
  id?: unknown;
  content?: unknown;
  source?: Record<string, unknown> & { kind?: unknown; baseline?: unknown; baselineIdentity?: unknown };
}

/** 判断是否为宿主指令消息。 */
function isInstructionMessage(message: unknown): message is MessageLike {
  const source = (message as MessageLike | undefined)?.source;
  return typeof source === "object" && source !== null && source.kind === "agent-instructions";
}

/** 清掉 agent inbox 里排队的指令消息（宿主 reject / 空步路径会走 inbox）。 */
function clearInstructionInbox(agent: AgentLike): void {
  const inbox = agent.inbox;
  const pending = inbox?.nextStep;
  if (inbox === undefined || pending === undefined) return;
  const list = Array.isArray(pending) ? pending : Array.from(pending as Iterable<unknown>);
  for (const message of list) {
    if (isInstructionMessage(message)) {
      try {
        inbox.remove?.((message as MessageLike).id);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 用冻结清单里的正文替换消息内容（保留宿主 source / identity / changes）。 */
function withContent(message: MessageLike, text: string): MessageLike {
  return { ...message, content: [{ type: "text", text }] };
}

/** 丢弃所有指令消息，只保留（可选的）替换后的 baseline。 */
function filterMessages(messages: unknown[], baseline: MessageLike | undefined, text: string | undefined): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (!isInstructionMessage(message)) {
      out.push(message);
      continue;
    }
    if (baseline !== undefined && message === baseline && text !== undefined) out.push(withContent(message, text));
  }
  return out;
}

/** 会话 id（宿主 `agent.session.header.id`；旧版本回退 `agent.id`）。 */
function sessionIdOf(agent: AgentLike): string {
  const id = agent.session?.header?.id ?? agent.id;
  return typeof id === "string" ? id : "";
}

/** 会话 cwd。 */
function cwdOf(agent: AgentLike): string {
  const cwd = agent.session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}

/** 找 decision 里的宿主 baseline 消息（保留对象身份用于替换）。 */
function baselineOf(decision: unknown): MessageLike | undefined {
  const messages = (decision as { messages?: unknown[] } | undefined)?.messages;
  if (!Array.isArray(messages)) return undefined;
  return messages.find(
    (message) => isInstructionMessage(message) && message.source !== undefined && message.source.baseline === true,
  ) as MessageLike | undefined;
}

/**
 * 冻结态 decision：丢弃全部指令消息；若本会话冻结正文存在且宿主重建了 baseline，
 * 则把正文按冻结内容重放（保留宿主 source/identity）。
 */
function freezeDecision(
  decision: { messages: unknown[] },
  agent: AgentLike,
  sessionId: string,
  frozenTexts: Map<string, string | undefined>,
  buildMessages: (text: string | undefined) => unknown[],
): unknown {
  clearInstructionInbox(agent);
  const text = frozenTexts.get(sessionId);
  return { ...decision, messages: buildMessages(text) };
}

/**
 * 安装注入接管（root ctx，`prepend` 最外层）。
 *
 * @param ctx 宿主插件 ctx
 * @param deps manager + logger
 * @returns disposer；宿主不支持事件系统时返回 noop
 */
export function installPromptInjection(
  ctx: { on?: (name: string, handler: (payload: any, next: () => Promise<any>) => unknown, options?: unknown) => (() => void) | void },
  deps: PromptInjectionDeps,
): () => void {
  if (typeof ctx.on !== "function") return () => undefined;
  const processed = new Set<string>();
  /** 会话冻结正文（resume / compaction 后宿主重建 baseline 时用它重放，而不是丢弃）。 */
  const frozenTexts = new Map<string, string | undefined>();
  const logger = deps.logger;
  /** 宿主渲染管线是否可用（不可用 = 整个接管层 no-op，fail-open 放行宿主原行为）。 */
  let hostAvailable: boolean | undefined;
  let warnedNoHost = false;

  const handler = async (payload: any, next: () => Promise<any>): Promise<any> => {
    const decision = await next();
    try {
      const agent = payload?.agent as AgentLike | undefined;
      if (agent === undefined || decision === null || typeof decision !== "object") return decision;
      if (hostAvailable === undefined) hostAvailable = await deps.manager.hostAvailable();
      if (!hostAvailable) {
        if (!warnedNoHost) {
          warnedNoHost = true;
          logger?.warn?.("prompt injection disabled: host renderer unavailable (@deepseek-ai/dsh-agent-instructions not resolved)");
        }
        return decision;
      }
      if (decision.kind !== "enter" || !Array.isArray(decision.messages)) return decision;
      const sessionId = sessionIdOf(agent);
      if (sessionId.length === 0) return decision;
      const cwd = cwdOf(agent);

      // 冻结：本会话已处理过（或恢复会话已有清单）→ 每步丢弃增量并清 inbox；
      // 若宿主在 compaction 后重建了 baseline，则用冻结正文重放（保持“模型能看到
      // 同一份指令”，同时不重新计算）。
      if (processed.has(sessionId) || frozenTexts.has(sessionId)) {
        return freezeDecision(decision as { messages: unknown[] }, agent, sessionId, frozenTexts, (text) =>
          filterMessages((decision as { messages: unknown[] }).messages, baselineOf(decision), text),
        );
      }
      const existing = await deps.manager.manifest({ sessionId });
      if (existing.manifest !== undefined) {
        processed.add(sessionId);
        frozenTexts.set(sessionId, existing.manifest.text);
        return freezeDecision(decision as { messages: unknown[] }, agent, sessionId, frozenTexts, (text) =>
          filterMessages((decision as { messages: unknown[] }).messages, baselineOf(decision), text),
        );
      }

      const instructionMessages: MessageLike[] = (decision.messages as unknown[]).filter(isInstructionMessage);
      if (instructionMessages.length === 0) return decision;
      const baseline = instructionMessages.find(
        (message: MessageLike) => message.source !== undefined && message.source.baseline === true,
      );
      const config = parseBaselineIdentity(baseline?.source?.baselineIdentity);

      const selection: PromptSelection = await deps.manager.select({
        cwd,
        sessionId,
        ...(config !== undefined ? { config } : {}),
      });
      const emptySelection = selection.allowed.size === 0;
      const rendered = emptySelection
        ? await deps.manager.render(selection, { replacePreviousBaseline: true })
        : await deps.manager.render(selection);
      await deps.manager.recordManifest(selection, rendered, sessionId);
      processed.add(sessionId);
      frozenTexts.set(sessionId, rendered?.text);
      clearInstructionInbox(agent);

      if (rendered === undefined) {
        // 非空选择却渲染失败：fail-open 放行宿主原消息（不记录冻结、下一步重试）。
        if (!emptySelection) {
          logger?.warn?.("prompt render failed; falling back to host baseline");
          return decision;
        }
        // 空选择且宿主也渲染不出 replacement：冻结为空（丢弃指令消息）。
        return { ...decision, messages: filterMessages(decision.messages, undefined, undefined) };
      }
      if (baseline === undefined) return decision;
      return {
        ...decision,
        messages: filterMessages(decision.messages, baseline, rendered.text),
      };
    } catch (error) {
      logger?.warn?.(`prompt injection failed (fail-open): ${error instanceof Error ? error.message : String(error)}`);
      return decision;
    }
  };

  const dispose = ctx.on("agent/pre-step", handler, { prepend: true });
  return typeof dispose === "function" ? dispose : () => undefined;
}
