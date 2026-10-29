window.__ModuleLoader__.load({
	id: "dsh-capability-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/channel.ts
		/**
		* RPC 通道名常量——宿主端与浏览器端共享的唯一通道标识。
		*
		* 面板的宿主服务（skills / mcp 两个域）与浏览器客户端之间不开放插件的
		* `/api` 单次路由表（见 remote.ts 的详细说明），统一走这条泛型通道通信：
		*
		*   - 宿主端：在 `webServer` 上挂前缀路由（见 remote.ts 的 mountRpcChannel，
		*     不用 `connection.rpc.handle`——当前宿主版本里它拿不到 `webServer`）；
		*   - 客户端：`ctx.get("connection").rpc.call("/capability-panel", endpoint,
		*     payload, signal)`（宿主端实现的就是这条通道的线上信封）。
		*
		* 两端源码各自 import 这个常量，而不是各自硬编码字符串，避免通道名拼写漂移：
		* 改名只需要动这一处。
		*
		* @module dsh-capability-settings/channel
		*/
		const CHANNEL = "/capability-panel";
		//#endregion
		//#region src/client/api-adapter.ts
		/**
		* `CapabilityPanelApi` 的 Web 客户端适配器：每个调用都走插件自有 RPC 通道
		* （`/capability-panel`，见 channel.ts），endpoint 按域前缀命名
		* （`skills.*` / `mcp.*`，见 remote.ts 的路由表）。
		*
		* 这里负责：包上信封 → 调用通道 → 解信封（失败抛错）→ 把宿主返回的
		* 普通对象投影成客户端类型（见 toSummary）。
		*
		* @module dsh-capability-settings/client/api-adapter
		*/
		/** 构建传输无关的面板 API（RPC 实现）。 */
		function createPanelApi(deps) {
			/** 调用一次宿主 RPC，并把响应归一成与旧信封同构的 RawResult。 */
			async function rpc(endpoint, payload, signal) {
				const raw = await deps.rpc.call(CHANNEL, endpoint, payload, signal);
				if (raw && typeof raw === "object" && "ok" in raw) {
					const record = raw;
					if (record.ok === true && record.value !== null && typeof record.value === "object") {
						const inner = record.value;
						if (inner.ok === false && Array.isArray(inner.errors)) {
							const { ok: _ok, errors, ...rest } = inner;
							return {
								ok: false,
								errors,
								...rest
							};
						}
						return raw;
					}
					return {
						ok: false,
						errors: Array.isArray(record.errors) ? record.errors : [typeof record.message === "string" ? record.message : "操作失败"]
					};
				}
				return {
					ok: false,
					errors: [`unexpected response from ${CHANNEL}`]
				};
			}
			/**
			* 解开双层信封：宿主编排层把业务结果（CreateResult / TransferResult 等
			* 自带 ok/errors 的形状）包进 RPC 信封 `{ ok: true, value }`，所以信封
			* ok 不代表业务成功。value 自身带 ok 字段时以业务层为准。
			*/
			function unwrap(result) {
				if (result.ok && result.value !== null && typeof result.value === "object" && "ok" in result.value) return result.value;
				return result;
			}
			return {
				skills: {
					/** 列表：把宿主返回的普通对象逐条投影成 ClientSkillSummary。 */
					async list() {
						const result = await rpc("skills.list", { cwd: deps.currentWorkspaceCwd() });
						if (!result.ok) throw new Error(result.errors.join("; "));
						return result.value.filter((v) => v !== null && typeof v === "object").map(toSummary);
					},
					/**
					* 会话视角列表：与 `list()` 同源，但宿主额外投影 `enabledInSession` /
					* `canToggleInSession`（需要本 api 带 sessionId——只有 composer 的每会话
					* api 有）。输入框下方的能力配置区用它。
					*/
					async sessionList() {
						if (deps.sessionId === void 0) throw new Error("skills.sessionList 只能在会话作用域的 api 上调用");
						const result = await rpc("skills.sessionList", {
							cwd: deps.currentWorkspaceCwd(),
							sessionId: deps.sessionId
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						return result.value.filter((v) => v !== null && typeof v === "object").map(toSummary);
					},
					/** 会话级关闭 / 恢复：宿主返回业务信封，失败抛错由 UI 回滚。 */
					async setSessionEnabled(input) {
						if (deps.sessionId === void 0) throw new Error("skills.setSessionEnabled 只能在会话作用域的 api 上调用");
						const cwd = deps.currentWorkspaceCwd();
						const result = unwrap(await rpc("skills.setSessionEnabled", {
							...input,
							sessionId: deps.sessionId,
							...cwd !== void 0 ? { cwd } : {}
						}));
						if (!result.ok) throw new Error(result.errors.join("; "));
						return result;
					},
					/** 详情：宿主可能返回 undefined（不存在）；注入行走 registry fallback。 */
					async read(name, ref) {
						const result = unwrap(await rpc("skills.read", {
							name,
							cwd: deps.currentWorkspaceCwd(),
							...ref ?? {},
							...deps.sessionId !== void 0 ? { sessionId: deps.sessionId } : {}
						}));
						if (!result.ok) return void 0;
						return toSkillDetail(result, name);
					},
					/**
					* 注入技能的单个资源文件读取：业务失败（escape / not-text / too-large …）
					* 原样返回 `{ok:false, errors, code}`，由内容区就地展示；传输层失败才抛。
					*/
					async readResource(input) {
						const cwd = deps.currentWorkspaceCwd();
						const result = unwrap(await rpc("skills.readResource", {
							...input,
							cwd,
							...deps.sessionId !== void 0 ? { sessionId: deps.sessionId } : {}
						}));
						if (!result.ok) {
							const code = result.code;
							return {
								ok: false,
								errors: result.errors,
								...typeof code === "string" && code.length > 0 ? { code } : {}
							};
						}
						const raw = result;
						const value = typeof raw.path === "string" ? raw : raw.value !== null && typeof raw.value === "object" ? raw.value : raw;
						if (typeof value.path !== "string" || typeof value.content !== "string") return {
							ok: false,
							errors: ["资源读取返回了非法结果"]
						};
						return {
							ok: true,
							path: value.path,
							size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : value.content.length,
							content: value.content,
							truncated: value.truncated === true
						};
					},
					async create(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.create", {
							...input,
							cwd
						}));
					},
					async update(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.update", {
							...input,
							cwd
						}));
					},
					async remove(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.remove", {
							...input,
							cwd
						}));
					},
					/** 一键启用/禁用：与服务端同名词条一致，直接返回信封。 */
					async setEnabled(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.setEnabled", {
							...input,
							cwd
						}));
					},
					/** 细粒度调节调用方式（模型/用户两个方向分别开关）：与服务端同名词条一致。 */
					async setInvocation(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.setInvocation", {
							...input,
							cwd
						}));
					},
					/** 上传安装：解开信封后投影成 InstallResult。 */
					async installUpload(input) {
						const cwd = deps.currentWorkspaceCwd();
						return toInstallResult(unwrap(await rpc("skills.install", {
							...input,
							cwd
						})));
					},
					/** 宿主路径安装。 */
					async installFromPath(input) {
						const cwd = deps.currentWorkspaceCwd();
						return toInstallResult(unwrap(await rpc("skills.install", {
							...input,
							cwd
						})));
					},
					/** URL 下载安装（GitHub 仓库 / .zip / raw .md）。 */
					async installFromUrl(input) {
						const cwd = deps.currentWorkspaceCwd();
						return toInstallResult(unwrap(await rpc("skills.install", {
							...input,
							cwd
						})));
					},
					/** 导入全局 skill 到当前项目：与服务端同名词条一致，直接返回信封（existed/path 字段透传）。 */
					async importToProject(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.importToProject", {
							...input,
							cwd
						}));
					},
					/** 在本项目内禁用某个全局 skill（shadow stub）：与服务端同名词条一致（existed 字段透传）。 */
					async disableInProject(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.disableInProject", {
							...input,
							cwd
						}));
					},
					/** 恢复全局 skill 在本项目可用（删除 shadow stub，幂等）。 */
					async enableInProject(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.enableInProject", {
							...input,
							cwd
						}));
					},
					/** 导出为文件清单：解开信封后按宿主返回的形状投影。 */
					async exportFiles(input) {
						const cwd = deps.currentWorkspaceCwd();
						const result = unwrap(await rpc("skills.export", {
							...input,
							cwd
						}));
						if (!result.ok) return {
							ok: false,
							errors: result.errors
						};
						const self = result;
						if (!Array.isArray(self.files)) return {
							ok: false,
							errors: ["export returned no files"]
						};
						return {
							ok: true,
							name: typeof self.name === "string" ? self.name : input.name,
							format: self.format === "directory" ? "directory" : "flat",
							files: self.files,
							...self.lossy === true ? { lossy: true } : {}
						};
					},
					/** 导出到宿主目录。 */
					async exportToPath(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("skills.export", {
							...input,
							cwd
						}));
					}
				},
				mcp: {
					/** 列表：宿主的合并视图直接可用，无需投影。 */
					async list() {
						const result = await rpc("mcp.list", {
							cwd: deps.currentWorkspaceCwd(),
							...deps.sessionId !== void 0 ? { sessionId: deps.sessionId } : {}
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						return result.value;
					},
					async upsert(input) {
						const cwd = deps.currentWorkspaceCwd();
						return rpc("mcp.upsert", {
							...input,
							cwd
						});
					},
					async remove(input) {
						const cwd = deps.currentWorkspaceCwd();
						return rpc("mcp.remove", {
							...input,
							cwd
						});
					},
					async setEnabled(input) {
						const cwd = deps.currentWorkspaceCwd();
						return rpc("mcp.setEnabled", {
							...input,
							cwd
						});
					},
					/** 导入全局 server 到当前项目：与服务端同名词条一致，直接返回信封（existed 字段透传）。 */
					async importToProject(input) {
						const cwd = deps.currentWorkspaceCwd();
						return unwrap(await rpc("mcp.importToProject", {
							...input,
							cwd
						}));
					},
					async status() {
						const result = await rpc("mcp.status", { cwd: deps.currentWorkspaceCwd() });
						if (!result.ok) throw new Error(result.errors.join("; "));
						return result.value;
					},
					/**
					* 「测试」：探测结果自带业务 ok/errors 形状，`unwrap` 后直接以
					* McpTestResult 归一返回（失败不抛异常，交给面板就地展示）。
					*/
					async test(input) {
						const cwd = deps.currentWorkspaceCwd();
						return toMcpTestResult(unwrap(await rpc("mcp.test", {
							...input,
							cwd
						})));
					},
					/**
					* 最近 MCP 工具调用记录（只读、内存内、不落盘）。
					* 宿主的 `sessionId` 在这里就地解析成会话标题，面板直接展示。
					*/
					async usage(input) {
						const result = await rpc("mcp.usage", { ...input ?? {} });
						if (!result.ok) throw new Error(result.errors.join("; "));
						const view = result.value ?? {
							entries: [],
							limit: 0
						};
						const entries = Array.isArray(view.entries) ? view.entries : [];
						return {
							limit: typeof view.limit === "number" ? view.limit : entries.length,
							entries: entries.map((raw) => {
								const entry = raw ?? {};
								const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
								const title = sessionId.length > 0 ? deps.sessionTitle?.(sessionId) : void 0;
								return {
									time: typeof entry.time === "number" ? entry.time : 0,
									serverName: typeof entry.serverName === "string" ? entry.serverName : "",
									tool: typeof entry.tool === "string" ? entry.tool : "",
									sessionId,
									...typeof title === "string" && title.length > 0 ? { sessionTitle: title } : {}
								};
							}).filter((entry) => entry.serverName.length > 0 && entry.tool.length > 0)
						};
					},
					/**
					* 运行时注入的 MCP（只读）：宿主的 `{servers:[{serverName,tools,calls}]}` 直接
					* 投影成客户端类型；脏数据丢弃。v13 R4 额外透传 channel / attribution /
					* synthesized，并把 `origin:"namespace"`（工具命名空间合成行）原样保留。
					*/
					/**
					* 设置**当前 session** 的能力开关。sessionId 来自 api 的 deps（composer 的
					* 每个 session 一份 api），面板侧没有这个入口。
					*/
					async setSessionEnabled(input) {
						if (deps.sessionId === void 0) throw new Error("mcp.setSessionEnabled 只能在会话作用域的 api 上调用");
						const cwd = deps.currentWorkspaceCwd();
						const result = await rpc("mcp.setSessionEnabled", {
							...input,
							sessionId: deps.sessionId,
							...cwd !== void 0 ? { cwd } : {}
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value ?? {};
						if (value.ok === false) throw new Error(Array.isArray(value.errors) ? value.errors.join("; ") : "mcp.setSessionEnabled failed");
					},
					async runtime(input) {
						const result = await rpc("mcp.runtime", {
							cwd: input?.cwd ?? deps.currentWorkspaceCwd(),
							...deps.sessionId !== void 0 ? { sessionId: deps.sessionId } : {}
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const view = result.value ?? { servers: [] };
						return { servers: (Array.isArray(view.servers) ? view.servers : []).map((raw) => {
							const server = raw ?? {};
							const tools = Array.isArray(server.tools) ? server.tools : [];
							return {
								serverName: typeof server.serverName === "string" ? server.serverName : "",
								...typeof server.source === "string" && server.source.length > 0 ? { source: server.source } : {},
								origin: server.origin === "entry" ? "entry" : server.origin === "namespace" ? "namespace" : "fiber",
								...typeof server.channel === "string" && server.channel.length > 0 ? { channel: server.channel } : {},
								...toMcpAttribution(server.attribution) !== void 0 ? { attribution: toMcpAttribution(server.attribution) } : {},
								...server.synthesized === true ? { synthesized: true } : {},
								...server.transport === "stdio" || server.transport === "http" ? { transport: server.transport } : {},
								...typeof server.summary === "string" && server.summary.length > 0 ? { summary: server.summary } : {},
								...server.disabledInProject === true ? { disabledInProject: true } : {},
								restrictable: server.restrictable === true,
								...typeof server.enabledInSession === "boolean" ? { enabledInSession: server.enabledInSession } : {},
								calls: typeof server.calls === "number" ? server.calls : 0,
								tools: tools.map((item) => {
									const tool = item ?? {};
									return {
										name: typeof tool.name === "string" ? tool.name : "",
										...typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {},
										...tool.parameters !== null && typeof tool.parameters === "object" ? { parameters: tool.parameters } : {}
									};
								}).filter((tool) => tool.name.length > 0)
							};
						}).filter((server) => server.serverName.length > 0) };
					}
				},
				tools: {
					/**
					* 列出插件单元（v13）。宿主把「服务缺失 / schemas() 失败」包成空 units +
					* errors（不阻断其它域）；适配器原样投影，界面据此显示空态说明。
					*/
					async list(input) {
						const sessionId = input?.sessionId ?? deps.sessionId;
						const result = await rpc("tools.list", { ...sessionId !== void 0 ? { sessionId } : {} });
						if (!result.ok) return {
							units: [],
							totalGlobalTools: 0,
							excludedBuiltinCount: 0,
							errors: result.errors
						};
						return toToolsList(result.value);
					},
					/** 按会话开关插件（batch-first）；业务失败抛错（与 skills/mcp 单条一致）。 */
					async setSessionEnabled(input) {
						const sessionId = input.sessionId ?? deps.sessionId;
						if (sessionId === void 0) throw new Error("tools.setSessionEnabled 需要当前会话");
						const result = unwrap(await rpc("tools.setSessionEnabled", {
							sessionId,
							units: input.units,
							enabled: input.enabled
						}));
						if (!result.ok) throw new Error(result.errors.join("; "));
						return {
							ok: true,
							applied: typeof result.applied === "number" ? result.applied : input.units.length
						};
					}
				},
				session: { 
				/**
				* 批量开/关/恢复默认（v13 R1）。`failed[]` 属成功 value，不抛错；
				* 业务失败（缺 sessionId / 非法 action / 未知域）原样返回 `{ok:false,errors}`。
				*/
async setBulk(input) {
					const sessionId = input.sessionId ?? deps.sessionId;
					const result = await rpc("session.setBulk", {
						...input,
						...sessionId !== void 0 ? { sessionId } : {}
					});
					if (!result.ok) return {
						ok: false,
						errors: result.errors
					};
					return toSessionBulkResult(unwrap(result));
				} },
				overrides: {
					/** 读取当前项目的禁用声明全量（宿主侧无工作区时返回空清单）。 */
					async get() {
						const result = await rpc("overrides.get", { cwd: deps.currentWorkspaceCwd() });
						if (!result.ok) throw new Error(result.errors.join("; "));
						const view = result.value ?? {};
						const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
						return {
							mcp: listOf(view.mcp),
							skills: listOf(view.skills),
							...typeof view.filePath === "string" ? { filePath: view.filePath } : {},
							...typeof view.projectRoot === "string" ? { projectRoot: view.projectRoot } : {}
						};
					},
					/** 切换某个全局能力在本项目的禁用状态（写回后由面板重拉列表刷新标记）。 */
					async toggle(domain, key) {
						return unwrap(await rpc("overrides.toggle", {
							cwd: deps.currentWorkspaceCwd(),
							domain,
							key
						}));
					}
				},
				jev: {
					/**
					* 读取全局配置视图：宿主只回掩码 / 来源，**永不含明文**（架构 §4.2）。
					* 传输层失败（通道不可用 / 宿主未装配 jev 服务）抛错，配置页进入
					* load-error 态并给「重试」。
					*/
					async getConfig() {
						const result = await rpc("jev.getConfig", {});
						if (!result.ok) throw new Error(result.errors.join("; "));
						return toJevConfigView(result.value);
					},
					/**
					* 保存全局配置：**业务失败原样返回**（`invalid-config` / `write-failed`
					* + errors + 可选 issues），不抛错——配置页需要按 code 分类并把
					* issues 落到字段行内。只有传输层失败才抛。
					*/
					async setConfig(input) {
						const result = await rpc("jev.setConfig", { config: input.config });
						const failure = toJevFailure(result);
						if (failure !== void 0) return failure;
						if (!result.ok) throw new Error(result.errors.join("; "));
						return { ok: true };
					},
					/**
					* 测试连接：宿主发一次最小探针。
					*
					* - 无参：payload `{}` ⇒ 用已保存配置（旧行为）；
					* - 传 `{config: JevSetConfigInput}`：**透传内层对象**为 RPC payload
					*   `{config: JevConfigInput}`（与 setConfig 同形），宿主据此合并出仅本次
					*   探针使用的临时配置，不写盘（AC-CFG-10）。
					*
					* 业务失败带 code 原样返回供分类文案；传输层失败才抛。
					*/
					async test(input) {
						const result = await rpc("jev.test", input?.config !== void 0 ? input.config : {});
						const failure = toJevFailure(result);
						if (failure !== void 0) return failure;
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = unwrap(result);
						return {
							ok: true,
							model: typeof value.model === "string" && value.model.length > 0 ? value.model : "",
							latencyMs: typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs) ? value.latencyMs : 0
						};
					},
					/**
					* 评分：`sessionId` / `cwd` 由 api 依赖注入（组件只传草稿）。
					* 业务失败（含 no-config / auth / timeout 等 9 个 code）**不 throw**，
					* 前端按 code 分类；面板根 api 没有 session 上下文时直接抛错。
					*/
					async rank(input, signal) {
						if (deps.sessionId === void 0) throw new Error("jev.rank requires a session context");
						const cwd = input.cwd ?? deps.currentWorkspaceCwd();
						const result = await rpc("jev.rank", {
							sessionId: deps.sessionId,
							draft: input.draft,
							...cwd !== void 0 ? { cwd } : {}
						}, signal);
						const failure = toJevFailure(result);
						if (failure !== void 0) return failure;
						if (!result.ok) throw new Error(result.errors.join("; "));
						return unwrap(result);
					},
					/** 应用：同上，业务失败原样返回（bad-request / write-failed）。 */
					async apply(input) {
						if (deps.sessionId === void 0) throw new Error("jev.apply requires a session context");
						const cwd = input.cwd ?? deps.currentWorkspaceCwd();
						const result = await rpc("jev.apply", {
							sessionId: deps.sessionId,
							plan: input.plan,
							...cwd !== void 0 ? { cwd } : {}
						});
						const failure = toJevFailure(result);
						if (failure !== void 0) return failure;
						if (!result.ok) throw new Error(result.errors.join("; "));
						return unwrap(result);
					}
				},
				currentSessionId() {
					return deps.currentSessionId?.();
				},
				workspaceLabel() {
					return deps.currentWorkspaceCwd() ?? "（无工作区）";
				},
				selectedProject() {
					return deps.selectedProject();
				},
				selectProject(path) {
					deps.selectProject(path);
				},
				projects() {
					return deps.listProjects();
				},
				subscribeWorkspace(listener) {
					return deps.subscribeWorkspace(listener);
				}
			};
		}
		/**
		* `tools.list` 视图的防御性投影：宿主字段缺失 / 类型漂移时补默认值，
		* 保证 UI 永远可渲染（工具清单只收 name/description，不带 parameters）。
		*/
		function toToolsList(value) {
			const raw = value ?? {};
			return {
				units: (Array.isArray(raw.units) ? raw.units : []).map((item) => {
					const unit = item ?? {};
					if (typeof unit.unit !== "string" || unit.unit.length === 0) return void 0;
					const tools = (Array.isArray(unit.tools) ? unit.tools : []).map((tool) => {
						const brief = tool ?? {};
						if (typeof brief.name !== "string" || brief.name.length === 0) return void 0;
						return {
							name: brief.name,
							...typeof brief.description === "string" && brief.description.length > 0 ? { description: brief.description } : {}
						};
					}).filter((tool) => tool !== void 0);
					const attribution = unit.attribution ?? {};
					const matchedBy = attribution.matchedBy === "prefix" || attribution.matchedBy === "exact" ? attribution.matchedBy : "unknown";
					const restriction = unit.restriction ?? {};
					const restrictionState = restriction.state === "applied" || restriction.state === "skipped" || restriction.state === "failed" ? restriction.state : void 0;
					return {
						unit: unit.unit,
						name: typeof unit.name === "string" && unit.name.length > 0 ? unit.name : unit.unit,
						kind: unit.kind === "unattributed" ? "unattributed" : "plugin",
						tools,
						toolCount: typeof unit.toolCount === "number" && Number.isFinite(unit.toolCount) ? unit.toolCount : tools.length,
						attribution: {
							matchedBy,
							...typeof attribution.pattern === "string" && attribution.pattern.length > 0 ? { pattern: attribution.pattern } : {},
							...typeof attribution.packageName === "string" && attribution.packageName.length > 0 ? { packageName: attribution.packageName } : {}
						},
						enabledInSession: unit.enabledInSession !== false,
						explicit: unit.explicit === true,
						...typeof unit.lockedReason === "string" && unit.lockedReason.length > 0 ? { lockedReason: unit.lockedReason } : {},
						...restrictionState !== void 0 ? { restriction: {
							state: restrictionState,
							...typeof restriction.error === "string" && restriction.error.length > 0 ? { error: restriction.error } : {}
						} } : {}
					};
				}).filter((unit) => unit !== void 0),
				totalGlobalTools: typeof raw.totalGlobalTools === "number" ? raw.totalGlobalTools : 0,
				excludedBuiltinCount: typeof raw.excludedBuiltinCount === "number" ? raw.excludedBuiltinCount : 0,
				errors: Array.isArray(raw.errors) ? raw.errors.filter((item) => typeof item === "string") : [],
				...typeof raw.sessionId === "string" && raw.sessionId.length > 0 ? { sessionId: raw.sessionId } : {}
			};
		}
		/** `session.setBulk` 成功 value 的防御性投影（缺字段补 0 / 空表）。 */
		function toSessionBulkResult(value) {
			const raw = value ?? {};
			const countOf = (input) => {
				const item = input ?? {};
				const num = (candidate) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
				return {
					changed: num(item.changed),
					unchanged: num(item.unchanged),
					skipped: num(item.skipped),
					failed: num(item.failed)
				};
			};
			const byDomain = raw.byDomain ?? {};
			const failed = (Array.isArray(raw.failed) ? raw.failed : []).map((item) => {
				const entry = item ?? {};
				if (typeof entry.domain !== "string" || typeof entry.target !== "string") return void 0;
				const kind = entry.kind === "skill" || entry.kind === "mcp-project" || entry.kind === "mcp-server" || entry.kind === "plugin" ? entry.kind : "skill";
				return {
					domain: entry.domain,
					target: entry.target,
					kind,
					error: typeof entry.error === "string" ? entry.error : "操作失败"
				};
			}).filter((item) => item !== void 0);
			const action = raw.action === "disable" || raw.action === "reset" ? raw.action : "enable";
			const num = (candidate) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
			return {
				ok: true,
				action,
				applied: num(raw.applied),
				unchanged: num(raw.unchanged),
				skipped: num(raw.skipped),
				failed,
				byDomain: {
					skills: countOf(byDomain.skills),
					mcp: countOf(byDomain.mcp),
					tools: countOf(byDomain.tools)
				},
				...raw.coldSession === true ? { coldSession: true } : {},
				elapsedMs: num(raw.elapsedMs)
			};
		}
		/** `mcp.runtime` 的 attribution 投影（未知形状丢弃，避免 UI 渲染垃圾）。 */
		function toMcpAttribution(value) {
			if (value === null || typeof value !== "object") return void 0;
			const raw = value;
			if (raw.matchedBy !== "namespace" && raw.matchedBy !== "source" && raw.matchedBy !== "unknown") return void 0;
			return {
				matchedBy: raw.matchedBy,
				...typeof raw.pattern === "string" && raw.pattern.length > 0 ? { pattern: raw.pattern } : {}
			};
		}
		/**
		* 把宿主返回的行对象投影成客户端摘要：
		* 调用策略是嵌套的 `invocation` 对象 → 拍平成两个布尔；
		* 其它字段做了宽松的字符串归一，防御宿主侧数据漂移。
		*
		* 注入字段（`injected` / `origin` / `channel` / …）是 additive 的：宿主/旧
		* 宿主缺失时整组字段不出现，UI 按磁盘行渲染（降级兼容）。
		*/
		function toSummary(value) {
			const inv = value.invocation ?? {};
			const origin = value.origin === "bundled" || value.origin === "plugin" || value.origin === "preset" ? value.origin : void 0;
			const resourceBaseKind = value.resourceBaseKind === "directory" || value.resourceBaseKind === "url" || value.resourceBaseKind === "opaque" ? value.resourceBaseKind : void 0;
			const injected = value.injected === true;
			return {
				name: String(value.name),
				description: String(value.description ?? ""),
				...typeof value.whenToUse === "string" ? { whenToUse: value.whenToUse } : {},
				modelInvocable: inv.modelInvocable !== false,
				userInvocable: inv.userInvocable !== false,
				source: String(value.source ?? "unknown"),
				format: value.format === "directory" ? "directory" : "flat",
				readOnly: value.readOnly === true,
				...typeof value.path === "string" ? { path: value.path } : {},
				...typeof value.root === "string" ? { root: value.root } : {},
				...value.shadowStub === true ? { shadowStub: true } : {},
				...value.projectShadow === "stub" || value.projectShadow === "skill" ? { projectShadow: value.projectShadow } : {},
				...typeof value.enabledInSession === "boolean" ? { enabledInSession: value.enabledInSession } : {},
				...typeof value.canToggleInSession === "boolean" ? { canToggleInSession: value.canToggleInSession } : {},
				...injected ? { injected: true } : {},
				...origin !== void 0 ? { origin } : {},
				...typeof value.channel === "string" && value.channel.length > 0 ? { channel: value.channel } : {},
				...typeof value.provider === "string" && value.provider.length > 0 ? { provider: value.provider } : {},
				...typeof value.registrySource === "string" && value.registrySource.length > 0 ? { registrySource: value.registrySource } : {},
				...resourceBaseKind !== void 0 ? { resourceBaseKind } : {},
				...value.contentReadOnly === true ? { contentReadOnly: true } : {},
				...typeof value.disabledInProject === "boolean" ? { disabledInProject: value.disabledInProject } : {}
			};
		}
		/**
		* 把 `skills.read` 的业务结果投影成客户端详情。
		*
		* 宿主的 `ReadResult` 是 `{ ok: true, spec, body, format, resources,
		* fromRegistry?, resourceBaseNote?, path? }`（不含拍平的摘要字段），这里补齐
		* `ClientSkillSummary` 的形状；注入行补 `injected` 由调用方从列表行带下来，
		* 本函数只透传宿主给的只读标记。
		*/
		function toSkillDetail(result, name) {
			const raw = result ?? {};
			const value = raw.value !== null && typeof raw.value === "object" ? raw.value : raw;
			const spec = value.spec ?? {};
			const invocation = spec.invocation ?? {};
			const resources = Array.isArray(value.resources) ? value.resources.filter((item) => typeof item === "string") : [];
			if (typeof value.body !== "string") return void 0;
			return {
				name: typeof spec.name === "string" && spec.name.length > 0 ? spec.name : name,
				description: typeof spec.description === "string" ? spec.description : "",
				...typeof spec.whenToUse === "string" && spec.whenToUse.length > 0 ? { whenToUse: spec.whenToUse } : {},
				modelInvocable: invocation["disable-model-invocation"] !== true,
				userInvocable: invocation["user-invocable"] !== false,
				source: String(value.source ?? "unknown"),
				format: value.format === "directory" ? "directory" : "flat",
				readOnly: value.readOnly === true,
				...typeof value.path === "string" ? { path: value.path } : {},
				spec,
				body: value.body,
				resources,
				...value.fromRegistry === true ? { fromRegistry: true } : {},
				...typeof value.resourceBaseNote === "string" && value.resourceBaseNote.length > 0 ? { resourceBaseNote: value.resourceBaseNote } : {}
			};
		}
		/** 把解开信封后的安装结果投影成 InstallResult（防御宿主侧数据漂移）。 */
		function toInstallResult(result) {
			if (!result.ok) return {
				ok: false,
				errors: result.errors
			};
			const self = result;
			return {
				ok: true,
				...typeof self.name === "string" ? { name: self.name } : {},
				...self.existed === true ? { existed: true } : {}
			};
		}
		/**
		* 把解开信封后的探测结果投影成 McpTestResult（防御宿主侧数据漂移：
		* 工具必须是对象且带字符串 name，否则丢弃；缺省值补齐）。
		*/
		function toMcpTestResult(result) {
			if (!result.ok) return {
				ok: false,
				errors: result.errors
			};
			const self = result;
			const tools = (Array.isArray(self.tools) ? self.tools : []).filter((tool) => tool !== null && typeof tool === "object" && !Array.isArray(tool)).filter((tool) => typeof tool.name === "string" && tool.name.length > 0).map((tool) => toClientTool(tool));
			return {
				ok: true,
				serverName: typeof self.serverName === "string" && self.serverName.length > 0 ? self.serverName : "server",
				tools,
				elapsedMs: typeof self.elapsedMs === "number" && Number.isFinite(self.elapsedMs) ? self.elapsedMs : 0,
				...typeof self.instruction === "string" && self.instruction.length > 0 ? { instruction: self.instruction } : {}
			};
		}
		/** 单个工具的宽松投影（parameters 必须是对象，否则省略该字段）。 */
		function toClientTool(tool) {
			const parameters = tool.parameters;
			const outputSchema = tool.outputSchema;
			return {
				name: tool.name,
				...typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {},
				...parameters !== null && typeof parameters === "object" && !Array.isArray(parameters) ? { parameters } : {},
				...outputSchema !== void 0 ? { outputSchema } : {}
			};
		}
		/**
		* `jev.*` 的业务失败提取（与 skills/mcp 的 unwrap 抛错刻意不同，架构 §9.7）：
		* 宿主把业务失败包成 `{ok:true, value:{ok:false, code, errors, issues?}}`，
		* 适配器 `rpc()` 已展平为 `{ok:false, code, errors, issues?}`。这里保留
		* `code` 原样返回，供调用方做错误分类；没有 `code` 的是传输层失败，返回
		* undefined 交给调用方抛错。
		*/
		function toJevFailure(result) {
			if (result.ok) return void 0;
			const record = result;
			const code = record.code;
			if (typeof code !== "string" || code.length === 0) return void 0;
			return {
				ok: false,
				code,
				errors: result.errors,
				...Array.isArray(record.issues) ? { issues: record.issues } : {}
			};
		}
		/**
		* `jev.getConfig` 视图的防御性投影：宿主字段缺失 / 类型漂移时回退默认值，
		* 保证配置表单永远可渲染（默认值与宿主 `defaultJevConfig()` 对齐）。
		*/
		function toJevConfigView(value) {
			const raw = value ?? {};
			const auto = raw.autoTrigger ?? {};
			const source = raw.apiKeySource === "env" || raw.apiKeySource === "file" ? raw.apiKeySource : "none";
			const num = (input, fallback) => typeof input === "number" && Number.isFinite(input) ? input : fallback;
			return {
				baseURL: typeof raw.baseURL === "string" && raw.baseURL.length > 0 ? raw.baseURL : "https://api.typesafe.ai",
				model: typeof raw.model === "string" && raw.model.length > 0 ? raw.model : "jev-latest",
				hasApiKey: raw.hasApiKey === true || source !== "none",
				apiKeySource: source,
				apiKeyLast4: typeof raw.apiKeyLast4 === "string" ? raw.apiKeyLast4 : null,
				autoTrigger: {
					enabled: auto.enabled === true,
					pauseMs: num(auto.pauseMs, 1e3),
					minChars: num(auto.minChars, 10),
					minEditChars: num(auto.minEditChars, 4)
				},
				timeoutMs: num(raw.timeoutMs, 3e4),
				...typeof raw.apiKeyEnv === "string" && raw.apiKeyEnv.length > 0 ? { apiKeyEnv: raw.apiKeyEnv } : {}
			};
		}
		//#endregion
		//#region src/mcp/entry-util.ts
		/**
		* 归类条目的传输方式：显式 `type` 优先；`url` 存在且无 command 视为 http。
		* 扩展的 `"sse"` 也归类为 http（桥接层统一走 streamable-http）。
		*/
		function transportOf(entry) {
			if (entry.type === "http" || entry.type === "sse") return "http";
			if (entry.type === "stdio") return "stdio";
			return typeof entry.url === "string" && entry.url.length > 0 && entry.command === void 0 ? "http" : "stdio";
		}
		/** 生成面板列表用的一行摘要：http 显示 URL，stdio 显示"命令 参数"。 */
		function summarizeEntry(entry) {
			if (transportOf(entry) === "http") return entry.url ?? "(missing url)";
			const args = (entry.args ?? []).join(" ");
			return [entry.command ?? "(missing command)", args].filter((part) => part.length > 0).join(" ");
		}
		/**
		* 校验面板提交的条目，返回问题列表；空列表表示可挂载。
		*
		* 检查项：键名非空且 ≤ 64 字符；stdio 必须有 command、args 必须是字符串数组；
		* http 必须有 url；env / headers 必须是"字符串值"的对象；timeoutMs 必须是正数。
		*/
		function validateEntry(key, entry) {
			const errors = [];
			if (key.trim().length === 0) errors.push("name must not be empty");
			if (key.length > 64) errors.push("name must be at most 64 characters");
			if (transportOf(entry) === "stdio") {
				if (typeof entry.command !== "string" || entry.command.trim().length === 0) errors.push("stdio server requires \"command\"");
				if (entry.args !== void 0 && !Array.isArray(entry.args)) errors.push("\"args\" must be an array of strings");
			} else if (typeof entry.url !== "string" || entry.url.trim().length === 0) errors.push("http server requires \"url\"");
			for (const [field, record] of [["env", entry.env], ["headers", entry.headers]]) {
				if (record === void 0) continue;
				if (record === null || typeof record !== "object" || Array.isArray(record)) {
					errors.push(`"${field}" must be an object of string values`);
					continue;
				}
				for (const [k, v] of Object.entries(record)) if (typeof v !== "string") errors.push(`"${field}.${k}" must be a string`);
			}
			if (entry.timeoutMs !== void 0 && (!Number.isFinite(entry.timeoutMs) || entry.timeoutMs <= 0)) errors.push("\"timeoutMs\" must be a positive number");
			return errors;
		}
		//#endregion
		//#region src/client/modal.tsx
		/** 模态框外壳：标题 + 内容；点遮罩关闭（内容区点击已拦截）。 */
		function Modal({ title, children, onClose }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-modal-overlay",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-modal",
					role: "dialog",
					"aria-label": title,
					onClick: (e) => e.stopPropagation(),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: title }), children]
				})
			});
		}
		//#endregion
		//#region src/client/select.tsx
		/**
		* 自绘下拉框（替代原生 <select>——原生的选项列表由浏览器渲染，
		* 无法定制样式，视觉与面板其余部分不一致）。
		*
		* 结构：触发按钮（.skp-dd-btn，带雪佛龙箭头）+ fixed 定位的弹出列表
		* （.skp-dd-pop）。弹出层用 getBoundingClientRect 锚定到按钮下方，因此不受
		* 父级 overflow:auto（如模态框）裁剪；列表项支持禁用、右侧 hint 与选中对勾。
		*
		* **视口钳制**（工作区很多时必须，否则列表会顶出屏幕）：打开时按按钮位置算
		* 出下方/上方可用空间，取宽裕的一侧展开（下方放不下"舒适高度"且上方更宽裕
		* 时向上弹），高度再夹在 [POP_MIN_HEIGHT, POP_MAX_HEIGHT] 内；水平方向按视口
		* 宽度钳制 `left`，并在渲染后用弹出层的实测宽度二次修正，保证右边缘不出屏。
		*
		* 关闭时机：点击组件外部（capture 阶段判定）、Esc、窗口缩放。**列表内部的
		* 滚动不关闭**（否则工作区一多就无法滚动选择），但页面/面板容器的滚动会关闭。
		*
		* @module dsh-capability-settings/client/select
		*/
		/** 与视口边缘的最小间距。 */
		const VIEWPORT_MARGIN = 8;
		/** 与触发按钮之间的间距。 */
		const POP_GAP = 6;
		/** 高度下限 / 上限 / "舒适高度"（下方小于舒适高度且上方更宽裕时向上弹）。 */
		const POP_MIN_HEIGHT = 120;
		const POP_MAX_HEIGHT = 480;
		const POP_COMFORT_HEIGHT = 240;
		/** 宽度下限与上限（超出上限的标签靠 ellipsis 收敛）。 */
		const POP_MIN_WIDTH = 200;
		const POP_MAX_WIDTH = 520;
		/**
		* 扁平风格下拉框。
		*
		* `className` 追加在根节点上（如头部作用域选择器的 `skp-dd-scope`
		* 限宽；表单字段内由 `.skp-field .skp-dd` 撑满整行）。
		*/
		function SkpSelect({ value, options, onChange, disabled, ariaLabel, title, className }) {
			const [anchor, setAnchor] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const btnRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const open = anchor !== null;
			const selected = options.find((option) => option.value === value);
			(0, react.useEffect)(() => {
				if (!open) return;
				const close = () => setAnchor(null);
				const onPointerDown = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				const onScroll = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return;
					close();
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				window.addEventListener("resize", close);
				window.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("resize", close);
					window.removeEventListener("scroll", onScroll, true);
				};
			}, [open]);
			(0, react.useLayoutEffect)(() => {
				if (anchor === null) return;
				const el = popRef.current;
				if (el === null) return;
				const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - el.getBoundingClientRect().width);
				if (anchor.left > maxLeft) setAnchor({
					...anchor,
					left: maxLeft
				});
			}, [anchor]);
			/** 打开时按按钮视口位置锚定弹出层，并保证不越出视口。 */
			const toggle = () => {
				if (disabled === true) return;
				if (open) {
					setAnchor(null);
					return;
				}
				const rect = btnRef.current?.getBoundingClientRect();
				if (rect === void 0) return;
				const vw = window.innerWidth;
				const vh = window.innerHeight;
				const spaceBelow = vh - rect.bottom - POP_GAP - VIEWPORT_MARGIN;
				const spaceAbove = rect.top - POP_GAP - VIEWPORT_MARGIN;
				const openUp = spaceBelow < Math.min(POP_COMFORT_HEIGHT, spaceAbove);
				const maxHeight = Math.max(POP_MIN_HEIGHT, Math.min(POP_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
				const maxWidth = Math.max(POP_MIN_WIDTH, Math.min(POP_MAX_WIDTH, vw - 16));
				const width = Math.min(Math.max(rect.width, POP_MIN_WIDTH), maxWidth);
				const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - width));
				setAnchor(openUp ? {
					left,
					bottom: vh - rect.top + POP_GAP,
					width,
					maxHeight,
					maxWidth
				} : {
					left,
					top: rect.bottom + POP_GAP,
					width,
					maxHeight,
					maxWidth
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: className === void 0 ? "skp-dd" : `skp-dd ${className}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					ref: btnRef,
					type: "button",
					className: "skp-dd-btn",
					disabled,
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					"aria-label": ariaLabel,
					title,
					onClick: toggle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dd-label",
						children: selected?.label ?? value
					})
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: popRef,
					className: "skp-dd-pop",
					role: "listbox",
					style: {
						left: anchor.left,
						...anchor.top === void 0 ? {} : { top: anchor.top },
						...anchor.bottom === void 0 ? {} : { bottom: anchor.bottom },
						minWidth: anchor.width,
						maxWidth: anchor.maxWidth,
						maxHeight: anchor.maxHeight
					},
					children: options.map((option) => {
						const active = option.value === value;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": active,
							className: active ? "skp-dd-opt skp-dd-opt-active" : "skp-dd-opt",
							disabled: option.disabled,
							onClick: () => {
								onChange(option.value);
								setAnchor(null);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dd-opt-label",
									children: option.label
								}),
								option.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dd-hint",
									children: option.hint
								}),
								active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dd-check",
									"aria-hidden": "true",
									children: "✓"
								})
							]
						}, option.value);
					})
				})]
			});
		}
		//#endregion
		//#region src/shared/skill-sources.ts
		/**
		* skill 来源（source）的作用域分类——宿主端（skills/manager.ts）与客户端
		* （panel-common.tsx / panel.tsx）共用的单一事实源，避免两端各自维护一份
		* 来源清单而在新增来源时 drift。
		*
		*   - 项目系：project-dsh / project-agents / project-claude，外加历史遗留的
		*     `custom`（rank 介于项目与全局之间，面板分组口径一直把它归入项目侧）；
		*   - 全局系：user-dsh / user-agents / user-claude；
		*   - `bundled` 两侧都不归（只读内置条目，不进面板的磁盘视图）；
		*   - `external` 两侧都不归：宿主 registry 注入条目（内置/插件/preset），
		*     由 `injected` / `origin` / `channel` 单独渲染，不参与磁盘分区的写权限判断。
		*
		* @module dsh-capability-settings/shared/skill-sources
		*/
		/** source 是否属于"项目系"（决定面板「项目」区归属，composer 弹层的分组口径与此一致）。 */
		function isProjectSkillSource(source) {
			return source === "project-dsh" || source === "project-agents" || source === "project-claude" || source === "custom";
		}
		/** source 是否属于"全局系"（决定面板「全局」区归属与归属徽标着色）。 */
		function isGlobalSkillSource(source) {
			return source === "user-dsh" || source === "user-agents" || source === "user-claude";
		}
		//#endregion
		//#region src/client/panel-common.tsx
		/**
		* 能力域面板共用的模型与小组件（Skills / MCP 两域视图共用）。
		*
		* 收敛了各处复制的小工具与标记：
		*   - `hasWorkspaceLabel`：面板是否附着在可写工作区上（workspaceLabel
		*     无工作区时返回占位字符串）；
		*   - `isProjectSource`：source 是否属于"项目系"（决定分组归属，
		*     composer 弹层的分组口径与此一致；清单的单一事实源在
		*     shared/skill-sources.ts，与宿主端共用）；
		*   - `useAsyncList`：两域视图高度同构的"挂载/依赖变化时拉取 + 显式重拉"
		*     状态机（loading/error/请求序号守卫）。
		*
		* 旧的 `PanelZone` / `ZoneTabs`（项目 / 全局二选一 Tab）已随「双组同屏」
		* 改版删除：作用域现在由同一列表列里的两个分组表达，两个域各自渲染
		* `skp-group*` 结构（样式见 styles.ts）。
		*
		* @module dsh-capability-settings/client/panel-common
		*/
		/** 面板是否附着在一个可写工作区上（workspaceLabel 无工作区时返回占位字符串）。 */
		function hasWorkspaceLabel(workspace) {
			return workspace !== void 0 && workspace !== "（无工作区）";
		}
		/** source 是否属于"项目系"（决定分组归属，composer 弹层的分组口径与此一致）。 */
		const isProjectSource = isProjectSkillSource;
		/**
		* 两域视图共用的"拉取 + 重拉"状态机。
		*
		* `load` 由调用方组装（Skills 直接 list；MCP 把 list+status+runtime 合并
		* 投影成单个结果对象），返回的结果整体存进 `data`，视图从 `data` 派生
		* 各自的行/错误。依赖变化（挂载、工作区切换）与显式 `reload()` 都会触发
		* 拉取。
		*
		* 内部用请求序号守卫：并发触发（连点写操作、工作区快速切换）时只让
		* **最新一次**请求的结果落地，防乱序旧响应覆盖新状态。
		*/
		function useAsyncList(load, deps) {
			const [data, setData] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(void 0);
			const seq = (0, react.useRef)(0);
			const reload = (0, react.useCallback)((options) => {
				const run = ++seq.current;
				if (options?.silent !== true) setLoading(true);
				setError(void 0);
				load().then((value) => {
					if (run !== seq.current) return;
					setData(value);
				}).catch((err) => {
					if (run !== seq.current) return;
					setError(String(err));
				}).finally(() => {
					if (run !== seq.current) return;
					setLoading(false);
				});
			}, deps);
			(0, react.useEffect)(() => {
				reload();
				return () => {
					seq.current += 1;
				};
			}, deps);
			return {
				data,
				loading,
				error,
				reload
			};
		}
		//#endregion
		//#region src/client/mcp-common.ts
		/** 挂载状态的展示文案（详情卡"状态"字段与弹层行 tooltip 共用）。 */
		const MOUNT_LABEL = {
			mounted: "已挂载",
			failed: "挂载失败",
			conflict: "名称冲突（已被其他会话挂载）"
		};
		/**
		* 聚合多个 session 的挂载状态：同名 server（不同 session）——
		* **任一 session 已挂载即视为"已挂载"**；没有任何 session 挂载成功时
		* 才取最差状态（conflict > failed），数字越大代表越需要关注。
		*
		* 桥接层按 app（`ctx.root`）预留 `serverName`：同一 server 全应用只允许
		* 一个 session 挂上，其余 session 再挂同名必报 `already in use`。这是
		* 预期行为而非故障——若用旧口径（conflict 排最高），只要存在第二个
		* session，行上就会永远显示"冲突"，即使 server 在首个 session 正常工作
		* （删除后重加也一样），看起来像删除没生效。
		*
		* @param statuses 各 session 的挂载状态视图（来自 api.mcp.status()）
		* @returns server.key → 聚合后的状态
		*/
		function aggregateMounts(statuses) {
			const byKey = {};
			const rank = (state) => state === "conflict" ? 2 : state === "failed" ? 1 : 0;
			for (const status of statuses) for (const mount of status.servers) {
				const next = {
					state: mount.state,
					...mount.error !== void 0 ? { error: mount.error } : {}
				};
				const prev = byKey[mount.key];
				if (prev === void 0) {
					byKey[mount.key] = next;
					continue;
				}
				if (next.state === "mounted") {
					byKey[mount.key] = next;
					continue;
				}
				if (prev.state === "mounted") continue;
				if (rank(next.state) > rank(prev.state)) byKey[mount.key] = next;
			}
			return byKey;
		}
		//#endregion
		//#region src/client/mcp-panel.tsx
		/**
		* Capability Panel 的 MCP 域视图。
		*
		* 布局与 Skills 域**同构**：左侧「全局 / 项目」作用域导航（ScopeNav）+ 中间
		* 列 + 右侧详情。项目 scope 下，工作区列表挂在 ScopeNav「项目」行下方（名称 =
		* 目录 basename，点选后钉选该项目，列表自身滚动；全局 scope 隐藏）；中间列只
		* 渲染当前列表标题与条目，未选工作区时显示「请选择左侧工作区」。全局 scope 显示
		* `~/.agents/mcp.json` 条目，并把「外部注入」（其它插件 / profile 在运行时挂载的
		* mcp-client）作为**第二组**只读展示（保留组头与计数，为空时不占位）。搜索框在
		* 根组件头部，由 `query` prop 传入，只过滤当前列表（全局 → server 名/summary；
		* 项目未选工作区 → 左侧工作区名/路径；项目已选 → server）。组容器样式由
		* styles.ts 的 `.skp-group*` / `.skp-scope-workspaces*` 统一提供（与 Skills 域共用）。
		*
		* 行 = 状态点 + 名称 + 标签（项目/全局/引用/导入/外部 + stdio/http +
		* 默认关闭/被遮蔽）+ meta（挂载状态 · 工具数）+ 命令/URL 摘要 + 行尾
		* 「默认」开关（语义不变 = 新建对话是否启用，写项目级 overrides 的 mcp 列表）。
		* 行内不提供文字按钮：启用/编辑/删除/导入/探测/使用记录都在详情卡。
		*
		* 详情把「工具与参数」做成左右两栏（ToolsInspector）：左侧工具列表可点选，
		* 右侧是该工具的参数表（参数/类型/必填/说明，来自 inputSchema 的
		* `properties` + `required`）；配置条目由「查看工具与参数」真连一次探测
		* （零副作用，见 `mcp/probe.ts`），外部注入实例直接取运行时注册表里的工具。
		*
		* @module dsh-capability-settings/client/mcp-panel
		*/
		/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
		function rowId(server) {
			return `${server.scope}:${server.key}`;
		}
		/**
		* 行圆点的 tooltip：以启用/禁用为主语义（与 Skills 同一套口径），
		* 挂载状态（未挂载 / 失败 / 冲突）作为补充说明收进同一句。
		*/
		function rowDotTitle(server, mount) {
			if (!server.enabled) return "已禁用（不挂载）";
			if (mount === void 0) return "已启用 · 未挂载到当前会话";
			return mount.error !== void 0 ? `已启用 · ${MOUNT_LABEL[mount.state]}：${mount.error}` : `已启用 · ${MOUNT_LABEL[mount.state]}`;
		}
		/**
		* 行首状态点的外观（沿用现有 `.skp-dot*` 类，缺的颜色用 CSS 变量兜底）：
		* 绿 = 已挂载；蓝 = 已启用但未挂载到当前会话；橙 = 默认关闭 / 名称冲突；
		* 红 = 挂载失败；灰 = 配置内禁用。
		*/
		function serverDot(server, mount) {
			if (!server.enabled) return { className: "skp-dot" };
			if (server.disabledInProject === true) return {
				className: "skp-dot",
				style: { background: "var(--skp-warn)" }
			};
			if (mount?.state === "failed") return {
				className: "skp-dot",
				style: { background: "var(--skp-error)" }
			};
			if (mount?.state === "conflict") return {
				className: "skp-dot",
				style: { background: "var(--skp-warn)" }
			};
			if (mount !== void 0) return { className: "skp-dot skp-dot-enabled" };
			return { className: "skp-dot skp-dot-partial" };
		}
		/**
		* 行的 meta 行文案：挂载状态 + 工具数。配置条目的工具数不进配置（不新增
		* 宿主字段），本次运行内探测成功后就地回填，未探测时显示「工具数未知」。
		*/
		function rowMetaText(server, mount, settling, toolCount) {
			const tools = toolCount !== void 0 ? `${toolCount} 个工具` : "工具数未知";
			if (!server.enabled) return `已禁用 · ${tools}`;
			if (mount === void 0) return `${settling ? "挂载中…" : "未挂载到当前会话"} · ${tools}`;
			if (mount.state === "conflict") return `名称冲突 · ${tools}`;
			return `${MOUNT_LABEL[mount.state]} · ${tools}`;
		}
		/** 行摘要：单行省略（覆盖 `.skp-row-desc` 的两行 clamp，保证行高 72）。 */
		const ROW_SUMMARY_STYLE = {
			display: "block",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
			WebkitLineClamp: "unset"
		};
		/** 详情头右侧的标签组（两个标签并排，无对应样式类）。 */
		const HEAD_TAGS_STYLE$1 = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			flex: "none"
		};
		/** 检视区标题行右侧（计数 / 重新测试并排）。 */
		const INSPECT_HEAD_RIGHT_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 10,
			flexWrap: "wrap",
			justifyContent: "flex-end"
		};
		/** 参数表：四列网格（参数 / 类型 / 必填 / 说明）。 */
		const PARAM_GRID_STYLE = {
			display: "grid",
			gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, .8fr) 56px minmax(0, 2fr)",
			columnGap: 10,
			minWidth: 0
		};
		/** 参数表单元格（表头与数据行共用，只有内边距/边框）。 */
		const PARAM_CELL_STYLE = {
			padding: "7px 0",
			borderBottom: "1px solid var(--skp-border)",
			minWidth: 0
		};
		/** 参数表表头单元格（去掉上内边距）。 */
		const PARAM_HEAD_CELL_STYLE = {
			...PARAM_CELL_STYLE,
			paddingTop: 0
		};
		/**
		* 一条配置条目行（本项目 / 全局共用）。
		*
		* 点行 = 选中（详情卡跟着换）；行尾「默认」开关独立，不改变选中。行内不渲染
		* 任何文字按钮——启用/编辑/删除/导入/探测/使用记录全部在详情卡里，与 Skills
		* 域同一口径。
		*/
		function McpServerRow({ server, mount, settling, toolCount, selected, onSelect, onToggleDefault }) {
			const dot = serverDot(server, mount);
			/** 归属标签按「出身」：引用 / 旧版导入副本本质是全局条目，标「引用」「导入」。 */
			const scopeTag = server.reference === true ? {
				label: "引用",
				className: "skp-tag skp-tag-flat"
			} : server.importedFromGlobal === true ? {
				label: "导入",
				className: "skp-tag skp-tag-flat"
			} : server.scope === "global" ? {
				label: "全局",
				className: "skp-tag skp-tag-global"
			} : {
				label: "项目",
				className: "skp-tag skp-tag-project"
			};
			const defaultOff = server.enabled !== false && server.disabledInProject === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: selected ? "skp-row skp-row-active" : "skp-row",
					style: { minHeight: 72 },
					onClick: onSelect,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-name",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: dot.className,
									style: dot.style,
									title: rowDotTitle(server, mount)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-row-title",
									title: server.key,
									children: server.key
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: scopeTag.className,
									children: scopeTag.label
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-meta",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: server.transport
								}),
								defaultOff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: "默认关闭：新建对话不启用；可在输入框的 MCP 弹层里按当前对话手动开启",
									children: "默认关闭"
								}),
								server.shadowed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-directory",
									title: "被本项目内的同名条目遮蔽：本项目的条目优先生效",
									children: "被遮蔽"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: rowMetaText(server, mount, settling, toolCount) })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-row-desc",
							style: ROW_SUMMARY_STYLE,
							title: server.summary,
							children: server.summary
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "skp-row-toggle",
					title: server.enabled === false ? "该条目在配置里被禁用（到编辑表单里启用）" : defaultOff ? "默认关闭：新建对话不启用；点此改为默认开启" : "默认开启：新建对话启用；点此改为默认关闭",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-row-default-label",
						children: "默认"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: server.enabled !== false && server.disabledInProject !== true,
							disabled: server.enabled === false,
							onChange: onToggleDefault
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
					})]
				})]
			});
		}
		/** 注入方展示名（R4）：优先 `channel`，没有则 undefined（不猜）。 */
		function externalChannelOf(server) {
			return typeof server.channel === "string" && server.channel.length > 0 ? server.channel : void 0;
		}
		/** true = 命名空间合成行（没有 mcp-client 实例，工具来自 `mcp__<ns>__*` 命名空间）。 */
		function isSynthesized(server) {
			return server.synthesized === true || server.origin === "namespace";
		}
		/**
		* 外部实例的来源标签（v13 R4 两枚标签规则）：
		*   - 有 channel → `插件` + 插件名（第二枚等宽小标签）；
		*   - 命名空间合成且无映射 → `未识别`（琥珀，只此一枚）；
		*   - 其余 → `外部注入`（只此一枚）。
		*/
		function ExternalSourceTags({ server }) {
			const channel = externalChannelOf(server);
			if (channel !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "skp-tag skp-tag-plugin",
				title: "插件注入的 MCP（来源由插件运行时注册）",
				children: "插件"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "skp-tag skp-tag-channel",
				title: channel,
				children: channel
			})] });
			if (isSynthesized(server)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "skp-tag skp-tag-warn",
				title: "工具命名空间合成：来源未识别（不是宿主内置）",
				children: "未识别"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "skp-tag skp-tag-readonly",
				title: "运行时注入 · 未注册插件名",
				children: "外部注入"
			});
		}
		/** 详情「来源判定」文案（方案 §7.6，frontend 直抄）。 */
		function externalAttributionText(server) {
			const channel = externalChannelOf(server);
			const matchedBy = server.attribution?.matchedBy;
			if (channel !== void 0) {
				if (matchedBy === "namespace") return `前缀 mcp__${server.attribution?.pattern ?? server.serverName}__ → ${channel}（插件清单映射表）`;
				return `运行时注入来源：${server.attribution?.pattern ?? server.source ?? server.serverName} → ${channel}`;
			}
			return "来源未识别（不是宿主内置）";
		}
		/** 详情「注入方式」文案（R4：命名空间合成单独说明）。 */
		function externalInjectionText(server) {
			if (server.origin === "namespace") return "工具命名空间合成（不落盘、无 mcp-client 实例）";
			return server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）";
		}
		/**
		* 一条「外部注入」实例行：只读，同样有行尾「默认」开关（能否按项目屏蔽由
		* `restrictable` 决定；不可屏蔽时置灰 + tooltip 说明原因）。
		*/
		function McpExternalRow({ server, selected, onSelect, onToggleDefault }) {
			const defaultOff = server.disabledInProject === true;
			const dot = defaultOff ? {
				className: "skp-dot",
				style: { background: "var(--skp-warn)" }
			} : { className: "skp-dot skp-dot-enabled" };
			const toolText = server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具数未知";
			const meta = server.calls > 0 ? `${toolText} · 调用 ${server.calls} 次` : toolText;
			const summary = isSynthesized(server) ? "由工具命名空间合成 · 无 mcp-client 实例（只读）" : server.summary ?? "运行时注入，不由能力面板管理（只读）";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: selected ? "skp-row skp-row-active" : "skp-row",
					style: { minHeight: 72 },
					onClick: onSelect,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-name",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: dot.className,
									style: dot.style,
									title: defaultOff ? "默认关闭（新建对话不启用）" : "运行时注入的实例"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-row-title",
									title: server.serverName,
									children: server.serverName
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExternalSourceTags, { server })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-meta",
							children: [
								externalChannelOf(server) === void 0 && server.source !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: server.source
								}),
								server.transport !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: server.transport
								}),
								defaultOff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: "默认关闭：新建对话不启用；可在输入框的 MCP 弹层里按当前对话手动开启",
									children: "默认关闭"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: meta })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-row-desc",
							style: ROW_SUMMARY_STYLE,
							title: summary,
							children: summary
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "skp-row-toggle",
					title: server.restrictable ? defaultOff ? "默认关闭：新建对话不启用；点此改为默认开启" : "默认开启：新建对话启用；点此改为默认关闭" : "该实例按会话注入，无法按项目默认关闭",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-row-default-label",
						children: "默认"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: server.restrictable ? !defaultOff : true,
							disabled: !server.restrictable,
							onChange: onToggleDefault
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
					})]
				})]
			});
		}
		/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
		function baseName(path) {
			const trimmed = path.replace(/[\\/]+$/, "");
			const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
			return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
		}
		/**
		* MCP 视图主组件：左侧「全局 / 项目」导航 + 中间列（全局列表 / 工作区选择 /
		* 某工作区的项目列表）+ 右侧详情。
		*
		* - **全局**：全局 `~/.agents/mcp.json` 条目 + 「外部注入」只读第二组；
		* - **项目**：中间列先列出所有工作区（点选 → `onSelectWorkspace(path)`），
		*   选中后显示该工作区 `.mcp.json` 的条目，顶部「‹ 工作区」可返回重选；
		* - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
		* - scope / 工作区切换清空选中；行尾「默认」开关写项目级 overrides（语义不变），
		*   行内没有文字按钮——启停/编辑/删除/导入/探测/使用记录都在详情卡。
		*/
		function McpView({ api, query, projects, workspace, pinned, onSelectWorkspace, onCount }) {
			const mcpApi = api.mcp;
			const [scope, setScope] = (0, react.useState)("project");
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [selected, setSelected] = (0, react.useState)(void 0);
			/** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
			const [selectedExternalName, setSelectedExternalName] = (0, react.useState)(void 0);
			/** 默认开关（项目级 overrides）最近一次操作失败的错误。 */
			const [defaultError, setDefaultError] = (0, react.useState)(void 0);
			const [editServer, setEditServer] = (0, react.useState)(void 0);
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			const [addScope, setAddScope] = (0, react.useState)("global");
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(void 0);
			const [confirmImport, setConfirmImport] = (0, react.useState)(void 0);
			/** 本次运行内探测成功回填的工具数（serverName → 工具数）；不落盘、不新增宿主字段。 */
			const [toolCounts, setToolCounts] = (0, react.useState)({});
			/**
			* 拉取 list + status 并聚合成单一结果（挂载时、工作区变化时自动执行，
			* 写操作后显式 reload()）。挂载状态按 server.key 聚合：任一 session 已
			* 挂载即视为"已挂载"，全部未挂载时才取最差状态（见 mcp-common.ts）。
			*/
			const { data, loading, error, reload } = useAsyncList(async () => {
				const [list, statuses, runtime] = await Promise.all([
					mcpApi.list(),
					mcpApi.status().catch(() => []),
					mcpApi.runtime({ cwd: workspace }).catch(() => ({ servers: [] }))
				]);
				return {
					servers: list.servers,
					listErrors: list.errors,
					mounts: aggregateMounts(statuses),
					runtimeServers: runtime.servers,
					settling: statuses.some((status) => status.settling === true)
				};
			}, [mcpApi, workspace]);
			/**
			* 面板「默认」开关：写项目级 `.agents/capability-overrides.json` 的 mcp 列表。
			*
			* 语义 = **新建对话的默认开关**：会话没有手动覆盖时跟随它；已有会话可以在输入框
			* 的 MCP 弹层里按当前对话手动覆盖（内存内）。切换后静默重拉列表刷新标记。
			*/
			const toggleDefault = async (key) => {
				setDefaultError(void 0);
				const result = await api.overrides.toggle("mcp", key);
				if (!result.ok) setDefaultError(result.errors.join("; "));
				reload({ silent: true });
			};
			const servers = data?.servers ?? [];
			const listErrors = data?.listErrors ?? [];
			const mounts = data?.mounts ?? {};
			const settling = data?.settling === true;
			/** 外部注入（非本插件配置）的 MCP：归入全局 scope 的第二组展示，只读。 */
			const runtimeServers = data?.runtimeServers ?? [];
			(0, react.useEffect)(() => {
				if (data === void 0) return;
				onCount?.(data.servers.length);
			}, [data, onCount]);
			/**
			* 写操作返回时宿主可能还在后台重挂（全局换代要逐条起进程 + 握手）：只要
			* `status().settling` 为真就每 800ms 静默重拉一次（上限 ~20 次 ≈16s），让
			* 「已挂载 / 未挂载」自行收敛——不阻塞写入 RPC 是"删掉立刻消失"的关键。
			*
			* 依赖里**必须带 `data`**：每次静默重拉都会换一个新的 data 对象，effect 才会
			* 重新排下一个定时器；只依赖 `settling` 的话，settling 一直为真 ⇒ 依赖没变
			* ⇒ 只轮询一次就停了。
			*/
			const settleTries = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				if (!settling) {
					settleTries.current = 0;
					return;
				}
				if (settleTries.current >= 20) return;
				const timer = window.setTimeout(() => {
					settleTries.current += 1;
					reload({ silent: true });
				}, 800);
				return () => window.clearTimeout(timer);
			}, [
				settling,
				data,
				reload
			]);
			/** 项目 scope 下已钉选的工作区（未选 = 中间列提示先选左侧工作区）。 */
			const projectPath = pinned;
			const projectName = projectPath === void 0 ? void 0 : projects.find((project) => project.path === projectPath)?.title ?? baseName(projectPath);
			/** scope / 工作区切换：清空选中与待确认态（详情跟走）。 */
			(0, react.useEffect)(() => {
				setSelected(void 0);
				setSelectedExternalName(void 0);
				setEditServer(void 0);
				setConfirmDelete(void 0);
				setConfirmImport(void 0);
			}, [
				scope,
				projectPath,
				workspace
			]);
			const trimmedQuery = query.trim();
			const q = trimmedQuery.toLowerCase();
			const matchesServer = (server) => q.length === 0 || server.key.toLowerCase().includes(q) || server.serverName.toLowerCase().includes(q) || server.summary.toLowerCase().includes(q);
			const matchesExternal = (server) => q.length === 0 || server.serverName.toLowerCase().includes(q) || (server.channel ?? "").toLowerCase().includes(q) || (server.source ?? "").toLowerCase().includes(q) || (server.summary ?? "").toLowerCase().includes(q);
			const globalServers = servers.filter((server) => server.scope === "global");
			const projectServers = servers.filter((server) => server.scope === "project");
			const visibleGlobal = globalServers.filter(matchesServer);
			const visibleProject = projectServers.filter(matchesServer);
			const visibleExternal = runtimeServers.filter(matchesExternal).sort((a, b) => {
				const aChannel = a.channel ?? "";
				const bChannel = b.channel ?? "";
				if (aChannel.length === 0 && bChannel.length > 0) return 1;
				if (bChannel.length === 0 && aChannel.length > 0) return -1;
				return aChannel.localeCompare(bChannel) || a.serverName.localeCompare(b.serverName);
			});
			const searching = trimmedQuery.length > 0;
			const visibleProjects = projects.filter((project) => {
				if (q.length === 0) return true;
				return baseName(project.path).toLowerCase().includes(q) || project.path.toLowerCase().includes(q);
			});
			/** 左侧导航工作区列表：未选工作区时搜索过滤（已选工作区时搜索只过滤服务器）。 */
			const navProjects = projectPath === void 0 ? visibleProjects : projects;
			const selectedServer = servers.find((s) => rowId(s) === selected);
			const selectedExternal = selectedExternalName === void 0 ? void 0 : runtimeServers.find((s) => s.serverName === selectedExternalName);
			/** 执行一次写操作：失败写 opError；成功清错误并重拉列表。返回是否成功。 */
			const runOp = async (op) => {
				const result = await op;
				if (!result.ok) {
					setOpError(result.errors.join("; "));
					return false;
				}
				setOpError(void 0);
				reload();
				return true;
			};
			/** 启用/禁用切换（直接写入配置文件，落盘后宿主自动重挂；只出现在项目条目）。 */
			const onToggle = (server) => {
				runOp(mcpApi.setEnabled({
					scope: server.scope,
					key: server.key,
					enabled: !server.enabled
				}));
			};
			/**
			* 导入这条**全局** server 到当前项目：登记项目级引用（内容跟随全局，启停是
			* 引用上的项目级标记）。项目内已有同名引用时进入"确认覆盖"态，再次点击带
			* overwrite 重新登记。成功后重拉列表（宿主热重挂本项目的 session）。
			*/
			const onImport = async (server) => {
				const id = rowId(server);
				const result = await mcpApi.importToProject({
					key: server.key,
					overwrite: confirmImport === id
				});
				if (!result.ok) {
					if (result.existed === true) {
						setConfirmImport(id);
						return;
					}
					setOpError(result.errors.join("; "));
					return;
				}
				setOpError(void 0);
				setConfirmImport(void 0);
				reload();
			};
			/** 删除：第一次点击进入确认态；同一行再次点击才真正删除并清空选中。 */
			const onDelete = (server) => {
				const id = rowId(server);
				if (confirmDelete !== id) {
					setConfirmDelete(id);
					return;
				}
				setConfirmDelete(void 0);
				runOp(mcpApi.remove({
					scope: server.scope,
					key: server.key
				})).then((ok) => {
					if (ok) setSelected(void 0);
				});
			};
			/** 选中一条配置条目：清掉外部实例选中与所有待确认态。 */
			const selectServer = (server) => {
				setSelected(rowId(server));
				setSelectedExternalName(void 0);
				setEditServer(void 0);
				setConfirmDelete(void 0);
				setConfirmImport(void 0);
			};
			/** 选中一个外部注入实例：与配置条目选中互斥。 */
			const selectExternal = (server) => {
				setSelectedExternalName(server.serverName);
				setSelected(void 0);
				setEditServer(void 0);
				setConfirmDelete(void 0);
				setConfirmImport(void 0);
			};
			const openAdd = (target) => {
				setEditServer(void 0);
				setAddScope(target);
				setAddOpen(true);
			};
			/** ScopeNav 一行：作用域名 + 计数 + 右侧「+」添加入口（与技能域同构）。 */
			const renderScopeItem = (target, label, count) => {
				const disabled = target === "project" && projectPath === void 0;
				const title = disabled ? "先选择工作区" : target === "global" ? "添加全局 MCP" : `添加项目 MCP（${projectName ?? projectPath}）`;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: scope === target ? "skp-scope-item skp-scope-item-active" : "skp-scope-item",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "skp-scope-main",
						"aria-pressed": scope === target,
						onClick: () => setScope(target),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-scope-label",
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-scope-count",
							children: count
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-scope-add",
						disabled,
						title,
						"aria-label": title,
						onClick: () => openAdd(target),
						children: "+"
					})]
				});
			};
			/**
			* ScopeNav「项目」行下方的工作区列表（仅 project scope 渲染，nav 内自身滚动）。
			* 未选工作区时跟随搜索词过滤名称/路径；已选中工作区时保持完整列表方便切换。
			*/
			const renderScopeWorkspaces = () => {
				const list = navProjects;
				if (list.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-scope-empty",
					children: projectPath === void 0 && searching ? "无匹配" : "没有工作区"
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-scope-workspaces",
					role: "listbox",
					"aria-label": "工作区",
					children: list.map((project) => {
						const active = project.path === projectPath;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "option",
							"aria-selected": active,
							className: active ? "skp-scope-workspace skp-scope-workspace-active" : "skp-scope-workspace",
							title: project.path,
							onClick: () => {
								setScope("project");
								onSelectWorkspace(project.path);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-scope-workspace-name",
								children: baseName(project.path)
							})
						}, project.path);
					})
				});
			};
			/** 非空的服务器列表（组内滚动 + listbox 语义）。 */
			const renderServerScroll = (list, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-group-scroll",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "skp-list",
					role: "listbox",
					"aria-label": label,
					children: list.map((server) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpServerRow, {
						server,
						mount: mounts[server.key],
						settling,
						toolCount: toolCounts[server.serverName],
						selected: selected === rowId(server),
						onSelect: () => selectServer(server),
						onToggleDefault: () => void toggleDefault(server.key)
					}, rowId(server)))
				})
			});
			/** 当前 scope 的服务器列表（空态区分「还没有」与搜索「无匹配」）。 */
			const renderServerList = (list, group) => {
				if (list.length === 0) {
					if (searching) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-empty",
						children: [
							"没有匹配「",
							trimmedQuery,
							"」的 MCP。"
						]
					});
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: group === "global" ? "还没有全局 MCP。" : "本项目还没有 MCP。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn",
							style: { marginTop: 10 },
							onClick: () => openAdd(group),
							children: group === "global" ? "添加全局 MCP" : "添加到本项目"
						})]
					});
				}
				return renderServerScroll(list, group === "global" ? "全局 MCP" : "本项目 MCP");
			};
			/** 全局 scope 的第二组：外部注入（只读，保留组头与计数；为空时不占位）。 */
			const renderExternalGroup = () => visibleExternal.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "skp-group",
				role: "group",
				"aria-label": `外部注入（${visibleExternal.length}）`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-group-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-group-title",
							children: "外部注入"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-group-count",
							children: visibleExternal.length
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-group-note",
							children: "运行时注入 · 只读"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-group-scroll",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "skp-list",
						role: "listbox",
						"aria-label": "外部注入 MCP",
						children: visibleExternal.map((server) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpExternalRow, {
							server,
							selected: selectedExternalName === server.serverName,
							onSelect: () => selectExternal(server),
							onToggleDefault: () => void toggleDefault(server.serverName)
						}, `external:${server.serverName}`))
					})
				})]
			}) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-domain",
				children: [
					listErrors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: listErrors.join("\n")
					}),
					opError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: opError
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: error
					}),
					defaultError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: defaultError
					}),
					loading && data === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-status",
						children: "加载中…"
					}),
					data !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
								className: "skp-scope-nav",
								"aria-label": "MCP 作用域",
								children: [
									renderScopeItem("global", "全局", globalServers.length),
									renderScopeItem("project", "项目", projectPath === void 0 ? "—" : projectServers.length),
									renderScopeWorkspaces()
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-workspace-pane",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-title",
									children: scope === "global" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										children: "全局 MCP"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-group-count",
										children: visibleGlobal.length
									})] }) : projectPath === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										children: "本项目"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										title: projectPath,
										children: baseName(projectPath)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-group-count",
										children: visibleProject.length
									})] })
								}), scope === "global" ? searching && visibleGlobal.length === 0 && visibleExternal.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-empty",
									children: [
										"没有匹配「",
										trimmedQuery,
										"」的 MCP。"
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [searching ? visibleGlobal.length > 0 && renderServerScroll(visibleGlobal, "全局 MCP") : renderServerList(visibleGlobal, "global"), renderExternalGroup()] }) : projectPath === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-empty",
									children: "请选择左侧工作区。"
								}) : renderServerList(visibleProject, "project")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-detail",
								children: selectedExternal !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpExternalDetail, {
									api: mcpApi,
									server: selectedExternal
								}, selectedExternal.serverName) : selectedServer ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpDetail, {
									api: mcpApi,
									server: selectedServer,
									mount: mounts[selectedServer.key],
									hasWorkspace: projectPath !== void 0,
									confirmingDelete: confirmDelete === rowId(selectedServer),
									confirmingImport: confirmImport === rowId(selectedServer),
									onEdit: () => setEditServer(selectedServer),
									onToggle: () => onToggle(selectedServer),
									onDelete: () => onDelete(selectedServer),
									onImport: () => void onImport(selectedServer),
									onToolCount: (count) => setToolCounts((prev) => prev[selectedServer.serverName] === count ? prev : {
										...prev,
										[selectedServer.serverName]: count
									})
								}, rowId(selectedServer)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-detail-empty",
									children: scope === "project" && projectPath === void 0 ? "先选择一个工作区，再查看或添加本项目 MCP。" : "选择一个服务器查看详情，或新增一个。"
								})
							})
						]
					}),
					addOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpAddDialog, {
						api: mcpApi,
						servers,
						workspace,
						defaultScope: addScope,
						onClose: () => setAddOpen(false),
						onMutated: () => reload()
					}),
					editServer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpEditDialog, {
						api: mcpApi,
						server: editServer,
						workspace,
						onClose: () => setEditServer(void 0),
						onSaved: () => reload()
					})
				]
			});
		}
		/**
		* 「使用记录」只读区：最近谁（哪个 session）在什么时候调用了该 server 的哪个 tool。
		*
		* 数据来自宿主内存（`tools.guard` 旁路记录，见 `mcp/usage.ts`）——插件/进程重载即
		* 清空、**不落盘**；打开期间每 2s 静默刷新。详情卡与「外部注入」详情共用这一块。
		*/
		function McpUsageSection({ api, serverName }) {
			const [view, setView] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				let cancelled = false;
				let timer;
				const load = async () => {
					try {
						const next = await api.usage({ serverName });
						if (cancelled) return;
						setView(next);
						setError(void 0);
					} catch (err) {
						if (cancelled) return;
						setError(String(err));
					}
					if (!cancelled) timer = window.setTimeout(() => void load(), 2e3);
				};
				load();
				return () => {
					cancelled = true;
					if (timer !== void 0) window.clearTimeout(timer);
				};
			}, [api, serverName]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-inspect-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-field-label",
						children: "使用记录"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-test-stat",
						children: ["仅本次运行 · 不落盘", view === void 0 ? "" : ` · 最近 ${view.limit} 条`]
					})]
				}),
				error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-error",
					children: error
				}),
				view === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-note",
					children: "读取中…"
				}) : view.entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-note",
					children: "本次运行还没有调用记录。"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "skp-usage",
					children: view.entries.slice().reverse().map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: "skp-usage-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-usage-time",
								title: new Date(entry.time).toLocaleString(),
								children: formatUsageTime(entry.time)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-usage-session",
								title: entry.sessionId === "" ? void 0 : entry.sessionId,
								children: entry.sessionTitle ?? (entry.sessionId.length > 0 ? `会话 ${entry.sessionId.slice(-8)}` : "—")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: "skp-usage-tool",
								title: entry.serverName,
								children: entry.tool
							})
						]
					}, `${entry.time}-${entry.tool}-${index}`))
				})
			] });
		}
		/**
		* 「外部注入」MCP 的**只读**详情。
		*
		* 这些实例不在本插件配置文件里（其它插件/profile 在运行时挂的 mcp-client），所以
		* 只展示能观察到的信息：来源插件、注入方式、命名空间、传输/命令摘要（能读到才有）、
		* 每个工具的说明与参数（来自工具注册表，与「查看工具与参数」同源），以及使用记录。
		* 不提供编辑/删除/测试——配置与生命周期都在注入方。
		*
		* 工具区与配置条目共用 `ToolsInspector`（左工具列表 + 右参数表）；「工具与参数」
		* 与「使用记录」都是折叠区，默认收起。
		*/
		function McpExternalDetail({ api, server }) {
			const [toolsOpen, setToolsOpen] = (0, react.useState)(false);
			const [usageOpen, setUsageOpen] = (0, react.useState)(false);
			const hasTools = server.tools.length > 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-detail-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: server.serverName }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: HEAD_TAGS_STYLE$1,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExternalSourceTags, { server }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								children: "只读"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: isSynthesized(server) ? `只读原因：该实例由工具命名空间 mcp__${server.serverName}__* 合成（没有 mcp-client 实例，无配置可编辑），能力面板只能查看工具与调用记录。按会话开关请到对话首屏「本会话能力」区。` : `只读原因：该 MCP 由 ${externalChannelOf(server) ?? server.source ?? "其它插件"} 在运行时注入，能力面板只能查看与记录调用，不能编辑或删除。按会话开关请到对话首屏「本会话能力」区。`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn",
							title: hasTools ? "查看该实例暴露的工具与参数（数据来自运行时工具注册表，不重新连接）" : "该实例的工具清单不可见（只能统计调用次数）",
							onClick: () => setToolsOpen((open) => !open),
							children: toolsOpen ? "收起工具与参数" : "查看工具与参数"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn",
							onClick: () => setUsageOpen((open) => !open),
							children: usageOpen ? "收起使用记录" : "使用记录"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: "skp-detail-fields",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "来源" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: externalChannelOf(server) ?? server.source ?? "来源未识别" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "来源判定" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: externalAttributionText(server) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "注入方式" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [externalInjectionText(server), isSynthesized(server) ? "；无实例配置，传输方式未知" : ""] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "命名空间" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: [
								"mcp__",
								server.serverName,
								"__*"
							] }) }),
							server.transport !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "传输方式" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [server.transport, server.summary !== void 0 ? ` · ${server.summary}` : ""] })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "默认 / 当前对话" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [server.restrictable ? "面板列表里的「默认」开关决定新建对话是否启用；输入框的 MCP 弹层里可按当前对话单独开启/关闭（用 tools.restrict 屏蔽或恢复其工具，不卸载共享实例）。" : "该实例按会话作用域注入，无法在当前对话里屏蔽。", server.disabledInProject === true ? "当前默认：关闭（新建对话不启用）。" : "当前默认：开启。"] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "本次运行调用" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: server.calls > 0 ? `${server.calls} 次` : "还没有调用记录" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "管理" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: isSynthesized(server) ? "按会话开关请到对话首屏「本会话能力」区（工具命名空间无法在这里编辑或卸载）。" : "由注入方管理；能力面板只读展示，不提供编辑/删除/卸载。" })
						]
					}),
					toolsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-inspect",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-detail-inspect-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-field-label",
								children: "工具与参数"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-test-stat",
								children: hasTools ? `${server.tools.length} 个工具 · 点击工具查看参数` : "工具清单不可见"
							})]
						}), hasTools ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsInspector, { tools: server.tools }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							children: "工具清单不可见（该实例按会话作用域注入，只能统计调用次数）。"
						})]
					}),
					usageOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-detail-inspect",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpUsageSection, {
							api,
							serverName: server.serverName
						})
					})
				]
			});
		}
		/**
		* 配置条目详情：归属徽标 + 字段 + 写操作 + 「工具与参数」（真连一次探测，
		* 两栏工具/参数）/「使用记录」两个折叠区。
		*
		* 动作语义沿用现状：**项目条目** = 启用/禁用、编辑、删除（两击确认）；
		* **全局条目** = 「导入到本项目」（登记项目级引用，同名时两击确认）、编辑、
		* 删除；全局条目自身 disabled 时给一个直接的恢复入口。
		*/
		function McpDetail({ api, server, mount, hasWorkspace, confirmingDelete, confirmingImport, onEdit, onToggle, onDelete, onImport, onToolCount }) {
			const isGlobal = server.scope === "global";
			/** 项目区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
			const imported = !isGlobal && server.importedFromGlobal === true;
			/** 项目级引用（内容跟随全局，启停是项目级标记；不提供「编辑」）。 */
			const isReference = server.reference === true;
			/** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
			const removeVerb = imported ? "移出" : "删除";
			const [inspect, setInspect] = (0, react.useState)({
				open: false,
				testing: false
			});
			const [usageOpen, setUsageOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setInspect({
					open: false,
					testing: false
				});
				setUsageOpen(false);
			}, [server.key, server.scope]);
			/** 跑一次探测；失败以 `{ ok:false, errors }` 归一（不抛异常，就地展示）。 */
			const runInspect = async () => {
				setInspect({
					open: true,
					testing: true
				});
				try {
					const result = await api.test({
						entry: server.entry,
						key: server.key
					});
					setInspect({
						open: true,
						testing: false,
						result
					});
					if (result.ok) onToolCount?.(result.tools.length);
				} catch (error) {
					setInspect({
						open: true,
						testing: false,
						result: {
							ok: false,
							errors: [String(error)]
						}
					});
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-detail-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: server.key }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: HEAD_TAGS_STYLE$1,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project",
								title: isGlobal ? server.shadowed ? "全局服务器（对所有项目生效）；当前被本项目内的同名条目遮蔽" : "全局服务器（对所有项目生效）" : isReference ? "本项目内对全局服务器的引用（内容跟随全局，启停只作用于本项目）" : imported ? "本项目内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本项目）" : "本项目内的服务器（遮蔽全局同名条目）",
								children: isGlobal || imported ? "全局" : "项目"
							}), isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								title: "引用：内容跟随全局，启停只作用于本项目",
								children: "引用"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-actions",
						children: [
							!isGlobal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `skp-btn ${server.enabled ? "skp-state-on" : "skp-state-off"}`,
								title: isReference ? server.enabled ? "点击在本项目禁用该引用（本项目不再挂载，全局配置不变）" : "点击在本项目启用该引用（全局配置不变）" : server.enabled ? "点击禁用（保留在配置文件中，不挂载）" : "点击启用（写入配置文件并挂载）",
								onClick: onToggle,
								children: server.enabled ? "已启用" : "已禁用"
							}),
							isGlobal && !server.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-state-off",
								title: "此全局服务器当前为禁用状态；点击恢复启用（对所有项目生效）",
								onClick: onToggle,
								children: "已禁用"
							}),
							isGlobal && hasWorkspace && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: confirmingImport ? "skp-btn skp-btn-danger" : "skp-btn",
								title: confirmingImport ? "项目内已有同名引用，再次点击将重新登记（保留原启停状态，全局配置不变）" : "在本项目登记对全局服务器的引用（内容跟随全局，可在本项目启停）",
								onClick: onImport,
								children: confirmingImport ? "确认重复导入同名引用？" : "导入到本项目"
							}),
							!isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								onClick: onEdit,
								children: "编辑"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: inspect.testing,
								title: inspect.open ? "收起工具与参数" : "真连一次该服务器并列出它的描述、工具与参数（不落盘、不注册工具、不影响已挂载的连接）",
								onClick: () => {
									if (inspect.open) setInspect({
										open: false,
										testing: false
									});
									else runInspect();
								},
								children: inspect.testing ? "连接中…" : inspect.open ? "收起工具列表" : "查看工具与参数"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								title: "查看最近哪个会话在什么时候调用了这个 MCP 的哪个工具（仅本次运行的内存记录，不落盘）",
								onClick: () => setUsageOpen((open) => !open),
								children: usageOpen ? "收起使用记录" : "使用记录"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: confirmingDelete ? "skp-btn skp-btn-danger" : "skp-btn skp-btn-danger-ghost",
								title: isGlobal ? "删除此全局服务器；各项目内的引用不受影响（变为悬空引用）" : isReference ? "移出本项目（移除对全局服务器的引用，全局原版仍在全局区）" : imported ? "移出本项目（移除全局导入的副本，全局原版仍在全局区）" : "删除本项目中的这个服务器",
								onClick: onDelete,
								children: confirmingDelete ? `确认${removeVerb}？` : removeVerb
							})
						]
					}),
					isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: "引用：内容跟随全局，启停只作用于本项目。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: "skp-detail-fields",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "命名空间" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
								"mcp__",
								server.serverName,
								"__*"
							] }),
							server.transport === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "命令" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
									className: "skp-path",
									children: server.entry.command
								}),
								(server.entry.args ?? []).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "参数" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
									className: "skp-path",
									children: (server.entry.args ?? []).join(" ")
								})] })
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "URL" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: "skp-path",
								children: server.entry.url
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "配置文件" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: "skp-path",
								children: server.filePath
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "状态" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: mount === void 0 ? "未挂载到当前会话" : MOUNT_LABEL[mount.state] }),
							mount?.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "错误" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								className: "skp-path",
								children: mount.error
							})] })
						]
					}),
					inspect.open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-inspect",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-detail-inspect-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-field-label",
								children: "工具与参数"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: INSPECT_HEAD_RIGHT_STYLE,
								children: [inspect.result?.ok === true && inspect.result.tools.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-test-stat",
									children: "点击工具查看参数"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-link-btn",
									disabled: inspect.testing,
									onClick: () => void runInspect(),
									children: inspect.testing ? "连接中…" : "重新测试"
								})]
							})]
						}), inspect.result === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							children: "正在连接并读取工具清单…"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsReport, { result: inspect.result })]
					}),
					usageOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-detail-inspect",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpUsageSection, {
							api,
							serverName: server.serverName
						})
					})
				]
			});
		}
		/**
		* 新增 / 编辑表单（分别内嵌在添加 / 编辑弹窗里，见 McpAddDialog / McpEditDialog）。
		*
		* 多行文本框承载 env / headers（每行 `KEY=VALUE`）与 args（每行一个参数），
		* 提交时解析成结构化字段；新增时 scope 与 name 可改（编辑改名 = 删除后重建，
		* 这里用禁用态规避）。
		*
		* `embedded` 为 true 时褪掉卡片外壳与自带标题，直接作为弹窗内容；
		* 此时按钮行由 `actionsClass` 指定落到弹窗底部的对齐方式。
		* onSave 抛错（如宿主校验/落盘失败）时把错误信息展示在表单顶部。
		*/
		function McpForm({ api, mode, server, workspace, embedded, actionsClass = "skp-detail-actions", defaultScope, onCancel, onSave }) {
			const entry = server?.entry ?? {};
			const [scope, setScope] = (0, react.useState)(server?.scope ?? defaultScope ?? (workspace !== void 0 ? "project" : "global"));
			const [key, setKey] = (0, react.useState)(server?.key ?? "");
			const [transport, setTransport] = (0, react.useState)(server?.transport ?? "stdio");
			const [command, setCommand] = (0, react.useState)(entry.command ?? "");
			const [args, setArgs] = (0, react.useState)((entry.args ?? []).join("\n"));
			const [env, setEnv] = (0, react.useState)(recordToLines(entry.env));
			const [url, setUrl] = (0, react.useState)(entry.url ?? "");
			const [headers, setHeaders] = (0, react.useState)(recordToLines(entry.headers));
			const [timeoutMs, setTimeoutMs] = (0, react.useState)(entry.timeoutMs !== void 0 ? String(entry.timeoutMs) : "");
			const [disabled, setDisabled] = (0, react.useState)(entry.disabled === true);
			const [errors, setErrors] = (0, react.useState)([]);
			const [saving, setSaving] = (0, react.useState)(false);
			const [testing, setTesting] = (0, react.useState)(false);
			const [testResult, setTestResult] = (0, react.useState)(void 0);
			const isNew = mode === "new";
			const noWorkspace = !hasWorkspaceLabel(workspace);
			/**
			* 从当前表单值构建条目（保存与测试共用同一口径，避免"能测不能存"漂移）。
			* 有校验问题时返回问题列表；测试与保存都直接展示这些问题。
			*/
			const buildEntry = () => {
				const problems = [];
				if (key.trim().length === 0) problems.push("名称不能为空");
				if (transport === "stdio" && command.trim().length === 0) problems.push("stdio 服务器需要填写「命令」");
				if (transport === "http" && url.trim().length === 0) problems.push("http 服务器需要填写「URL」");
				const envRecord = linesToRecord(env, "env", problems);
				const headerRecord = linesToRecord(headers, "headers", problems);
				const timeout = timeoutMs.trim().length === 0 ? void 0 : Number(timeoutMs);
				if (timeout !== void 0 && (!Number.isFinite(timeout) || timeout <= 0)) problems.push("超时必须是正数（ms）");
				if (problems.length > 0) return {
					ok: false,
					problems
				};
				const importMarker = entry.importedFromGlobal === true ? { importedFromGlobal: true } : {};
				return {
					ok: true,
					entry: transport === "stdio" ? {
						type: "stdio",
						command: command.trim(),
						args: linesToArray(args),
						...Object.keys(envRecord).length > 0 ? { env: envRecord } : {},
						...timeout !== void 0 ? { timeoutMs: timeout } : {},
						...disabled ? { disabled: true } : {},
						...importMarker
					} : {
						type: "http",
						url: url.trim(),
						...Object.keys(headerRecord).length > 0 ? { headers: headerRecord } : {},
						...timeout !== void 0 ? { timeoutMs: timeout } : {},
						...disabled ? { disabled: true } : {},
						...importMarker
					}
				};
			};
			/** 保存（客户端前置校验与宿主 validateEntry 同口径，快速反馈）。 */
			const submit = async () => {
				const built = buildEntry();
				if (!built.ok) {
					setErrors(built.problems);
					return;
				}
				setSaving(true);
				try {
					await onSave(scope, key.trim(), built.entry);
					setErrors([]);
				} catch (error) {
					setErrors([error instanceof Error ? error.message : String(error)]);
				} finally {
					setSaving(false);
				}
			};
			/**
			* 「测试」：把当前表单草稿直接交给宿主真实连接（不落盘、不挂载），
			* 结果就地展示工具名与参数。失败只更新 testResult，不抛异常。
			*/
			const runTest = async () => {
				const built = buildEntry();
				if (!built.ok) {
					setErrors(built.problems);
					setTestResult(void 0);
					return;
				}
				setErrors([]);
				setTesting(true);
				setTestResult(void 0);
				try {
					setTestResult(await api.test({
						entry: built.entry,
						key: key.trim()
					}));
				} catch (error) {
					setTestResult({
						ok: false,
						errors: [error instanceof Error ? error.message : String(error)]
					});
				} finally {
					setTesting(false);
				}
			};
			const busy = saving || testing;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: embedded ? void 0 : "skp-detail-card",
				children: [
					!embedded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: isNew ? "添加 MCP" : `编辑 ${server?.key}` }),
					errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: errors.join("\n")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-form",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "作用域"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
									value: scope,
									disabled: !isNew,
									ariaLabel: "服务器作用域",
									options: [{
										value: "project",
										label: "项目（.mcp.json）",
										disabled: noWorkspace
									}, {
										value: "global",
										label: "全局（~/.agents/mcp.json）"
									}],
									onChange: (value) => setScope(value === "project" ? "project" : "global")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "名称"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "skp-input",
									value: key,
									disabled: !isNew,
									placeholder: "github",
									onChange: (e) => setKey(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "传输方式"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
									value: transport,
									ariaLabel: "传输方式",
									options: [{
										value: "stdio",
										label: "stdio（启动本地命令）"
									}, {
										value: "http",
										label: "http（流式 HTTP 端点）"
									}],
									onChange: (value) => setTransport(value === "http" ? "http" : "stdio")
								})]
							}),
							transport === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "skp-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-field-label",
										children: "命令"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "skp-input",
										value: command,
										placeholder: "npx",
										onChange: (e) => setCommand(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "skp-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-field-label",
										children: "参数（每行一个）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										className: "skp-input skp-textarea",
										value: args,
										placeholder: "-y\n@modelcontextprotocol/server-github",
										onChange: (e) => setArgs(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "skp-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-field-label",
										children: [
											"环境变量（每行 KEY=VALUE，支持 $",
											"${VAR}",
											"）"
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										className: "skp-input skp-textarea",
										value: env,
										placeholder: "GITHUB_TOKEN=${GITHUB_TOKEN}",
										onChange: (e) => setEnv(e.target.value)
									})]
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "URL"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "skp-input",
									value: url,
									placeholder: "http://localhost:3000/mcp",
									onChange: (e) => setUrl(e.target.value)
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "请求头（每行 KEY=VALUE）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: "skp-input skp-textarea",
									value: headers,
									onChange: (e) => setHeaders(e.target.value)
								})]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "工具调用超时（ms，可选）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "skp-input",
									value: timeoutMs,
									inputMode: "numeric",
									placeholder: "60000",
									onChange: (e) => setTimeoutMs(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-field skp-field-inline",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: disabled,
									onChange: (e) => setDisabled(e.target.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "禁用（保留在配置文件中，不挂载）" })]
							}),
							testing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-status",
								children: "正在连接并读取工具列表…"
							}),
							testResult !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsReport, { result: testResult }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: actionsClass,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "skp-btn",
										disabled: busy,
										title: "用当前表单内容真实连接一次（不保存、不挂载），列出该服务器的工具与参数",
										onClick: () => void runTest(),
										children: testing ? "测试中…" : "测试连接"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "skp-btn skp-btn-primary",
										disabled: busy,
										onClick: () => void submit(),
										children: saving ? isNew ? "添加中…" : "保存中…" : isNew ? "添加" : "保存"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "skp-btn",
										onClick: onCancel,
										children: "取消"
									})
								]
							})
						]
					})
				]
			});
		}
		/**
		* 「工具与参数」手风琴检视器（配置条目与外部注入共用）：
		*  - 每个工具一行，只显示工具名 + 参数个数（不显示 description）；
		*  - 点工具名在其**下方**展开参数表（参数 / 类型 / 必填 / 说明），再点收起；
		*    同一时间只展开一个工具；
		*  - 参数从 `tool.parameters` 的 `properties` + `required` 展开；无参数显示「无参数」。
		*
		* 展开/收起只改变本地状态，**不重新探测**（探测由调用方控制）；工具清单变化
		* （重新测试 / 换服务器）时若当前展开项已不存在则自动收起。
		*/
		function ToolsInspector({ tools }) {
			const [expandedName, setExpandedName] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				setExpandedName((current) => current !== void 0 && tools.some((tool) => tool.name === current) ? current : void 0);
			}, [tools]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-tool-accordion",
				role: "list",
				children: tools.map((tool) => {
					const open = expandedName === tool.name;
					const parameters = toolParameters(tool);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item",
						role: "listitem",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "skp-tool-trigger",
							"aria-expanded": open,
							title: tool.name,
							onClick: () => setExpandedName(open ? void 0 : tool.name),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-chevron",
									"aria-hidden": "true",
									children: open ? "▾" : "▸"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: "skp-tool-name",
									children: tool.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-count",
									children: parameters.length > 0 ? `${parameters.length} 个参数` : "无参数"
								})
							]
						}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-tool-body",
							children: parameters.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-note",
								children: "无参数"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: PARAM_GRID_STYLE,
								children: [[
									"参数",
									"类型",
									"必填",
									"说明"
								].map((label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									style: PARAM_HEAD_CELL_STYLE,
									children: label
								}, label)), parameters.map((parameter) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: "skp-param-name",
										style: PARAM_CELL_STYLE,
										children: parameter.name
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-test-stat",
										style: PARAM_CELL_STYLE,
										children: parameter.type
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: PARAM_CELL_STYLE,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: parameter.required ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat",
											children: parameter.required ? "必填" : "可选"
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-param-desc",
										style: PARAM_CELL_STYLE,
										children: parameter.description !== void 0 && parameter.description.trim().length > 0 ? parameter.description : "—"
									})
								] }, parameter.name))]
							})
						})]
					}, tool.name);
				})
			});
		}
		/**
		* 「测试连接」/「查看工具与参数」的成功报告：状态行（连接正常 / 工具数 / 耗时）
		* + 服务器提示（默认折叠 3 行）+ 两栏工具/参数检视器。失败只展示错误块。
		*/
		function ToolsReport({ result }) {
			if (!result.ok) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-error",
				children: result.errors.join("\n")
			});
			const instruction = typeof result.instruction === "string" ? result.instruction.trim() : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-test",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-test-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-global",
								children: "连接正常"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-test-stat",
								children: [result.tools.length, " 个工具"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-test-stat",
								children: [
									"耗时 ",
									result.elapsedMs,
									"ms"
								]
							})
						]
					}),
					instruction.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpInstruction, { text: instruction }),
					result.tools.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: "连接成功，但服务器未暴露任何工具。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsInspector, { tools: result.tools })
				]
			});
		}
		/** 服务器提示（`instructions`）：默认折叠 3 行，点「展开/收起」切换。 */
		function McpInstruction({ text }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-test-instruction",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-test-instruction-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-field-label",
						children: "服务器提示"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-link-btn",
						onClick: () => setExpanded((value) => !value),
						children: expanded ? "收起" : "展开"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: expanded ? "skp-test-instruction-body" : "skp-test-instruction-body skp-clamp-3",
					children: text
				})]
			});
		}
		/**
		* 使用记录的时间列：当天只显示 `HH:mm:ss`，跨天补上 `MM-DD `（避免不同日期的
		* 记录看起来一样）。时间来自宿主 `Date.now()`，客户端本地时区格式化。
		*/
		function formatUsageTime(time) {
			if (!Number.isFinite(time) || time <= 0) return "—";
			const date = new Date(time);
			const pad = (value) => String(value).padStart(2, "0");
			const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
			const now = /* @__PURE__ */ new Date();
			return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate() ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
		}
		/** 从工具的 `inputSchema` 展开参数（`properties` + `required`）。 */
		function toolParameters(tool) {
			const schema = tool.parameters;
			if (schema === void 0 || schema === null) return [];
			const properties = schema.properties;
			if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
			const required = Array.isArray(schema.required) ? schema.required.filter((name) => typeof name === "string") : [];
			return Object.entries(properties).map(([name, raw]) => {
				const property = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
				const description = typeof property.description === "string" ? property.description : void 0;
				return {
					name,
					type: schemaType(property),
					required: required.includes(name),
					...description !== void 0 ? { description } : {}
				};
			});
		}
		/** 一个 JSON Schema 属性的类型名（联合类型用 ` | ` 连接，缺 type 时给结构提示）。 */
		function schemaType(property) {
			const type = property.type;
			if (typeof type === "string") return type;
			if (Array.isArray(type)) {
				const parts = type.filter((part) => typeof part === "string");
				if (parts.length > 0) return parts.join(" | ");
			}
			if (Array.isArray(property.enum)) return "enum";
			if (property.anyOf !== void 0 || property.oneOf !== void 0) return "union";
			return "unknown";
		}
		/**
		* 添加 MCP 服务器弹窗：与技能安装弹窗同构（Modal + 模式 Tab）。
		*
		* - 表单：沿用 McpForm（embedded 内嵌）逐字段填写单个条目；
		* - JSON：粘贴 .mcp.json 或裸服务器映射，实时预览后批量添加。
		*/
		function McpAddDialog({ api, servers, workspace, defaultScope, onClose, onMutated }) {
			const [tab, setTab] = (0, react.useState)("form");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
				title: "添加 MCP",
				onClose,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-tabs",
						role: "tablist",
						children: ["form", "json"].map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							role: "tab",
							"aria-selected": tab === t,
							className: tab === t ? "skp-tab skp-tab-active" : "skp-tab",
							onClick: () => setTab(t),
							children: t === "form" ? "表单" : "JSON"
						}, t))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						hidden: tab !== "form",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpForm, {
							api,
							mode: "new",
							workspace,
							embedded: true,
							actionsClass: "skp-modal-actions",
							defaultScope,
							onCancel: onClose,
							onSave: async (scope, key, entry) => {
								const result = await api.upsert({
									scope,
									key,
									entry
								});
								if (!result.ok) throw new Error(result.errors.join("; "));
								onMutated();
								onClose();
							}
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						hidden: tab !== "json",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpJsonImport, {
							api,
							servers,
							workspace,
							defaultScope,
							onClose,
							onMutated
						})
					})
				]
			});
		}
		/**
		* 编辑 MCP 服务器弹窗：与新增同款外壳（Modal + 内嵌 McpForm）。
		* 只含表单（JSON 批量导入只属于新增场景）；scope 与 name 在编辑态锁定
		* （改名 = 删除后重建，沿用 McpForm 的禁用态规避）。
		*/
		function McpEditDialog({ api, server, workspace, onClose, onSaved }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
				title: `编辑 ${server.key}`,
				onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpForm, {
					api,
					mode: "edit",
					server,
					workspace,
					embedded: true,
					actionsClass: "skp-modal-actions",
					onCancel: onClose,
					onSave: async (scope, key, entry) => {
						const result = await api.upsert({
							scope,
							key,
							entry
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						onSaved();
						onClose();
					}
				})
			});
		}
		/**
		* 解析"添加 MCP 服务器"的 JSON 文本为条目清单。
		*
		* 接受两种形状：
		*   - 完整配置文件：`{ "mcpServers": { … } }`（可直接粘贴 .mcp.json）；
		*   - 裸映射：`{ "github": { … }, "web": { … } }`。
		* 顶层必须是对象；逐条用与宿主同口径的 validateEntry 校验
		* （见 mcp/entry-util.ts），任一非法条目都会整体返回错误与逐条原因。
		*/
		function parseMcpJson(text) {
			let data;
			try {
				data = JSON.parse(text);
			} catch (error) {
				return {
					ok: false,
					errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`]
				};
			}
			if (data === null || typeof data !== "object" || Array.isArray(data)) return {
				ok: false,
				errors: ["JSON 顶层必须是对象，例如 { \"mcpServers\": { … } } 或 { \"服务器名\": { … } }"]
			};
			const root = data;
			if (Object.keys(root).length > 0 && Object.values(root).every((v) => v === null || typeof v !== "object" || Array.isArray(v))) return {
				ok: false,
				errors: ["看起来是单条服务器条目，缺少名称键；请用 { \"服务器名\": { … } } 包裹。"]
			};
			let servers;
			if (typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)) servers = root.mcpServers;
			else if ("mcpServers" in root && Object.keys(root).length === 1) return {
				ok: false,
				errors: ["「mcpServers」必须是服务器对象映射。"]
			};
			else servers = root;
			const entries = [];
			const problems = [];
			for (const [key, value] of Object.entries(servers)) {
				if (value === null || typeof value !== "object" || Array.isArray(value)) {
					problems.push(`${key}: 条目必须是对象`);
					continue;
				}
				const entry = value;
				const entryProblems = validateEntry(key, entry);
				if (entryProblems.length > 0) {
					problems.push(`${key}: ${entryProblems.join("; ")}`);
					continue;
				}
				entries.push({
					key,
					entry
				});
			}
			if (problems.length > 0) return {
				ok: false,
				errors: problems
			};
			if (entries.length === 0) return {
				ok: false,
				errors: ["没有可添加的服务器条目。"]
			};
			return {
				ok: true,
				entries
			};
		}
		/** JSON 文本框占位示例（两种形状都能贴）。 */
		const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    },
    "web": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}`;
		/**
		* JSON 批量添加面板：粘贴 .mcp.json 或裸服务器映射，实时解析并预览
		* （新增 / 覆盖 / 跳过与逐条错误），确认后逐条写入。
		*
		* 逐条**串行** upsert：并发读写同一配置文件会互相覆盖（读-改-写竞态），
		* 串行保证每次写入都基于最新文件内容。
		*/
		function McpJsonImport({ api, servers, workspace, defaultScope, onClose, onMutated }) {
			const noWorkspace = !hasWorkspaceLabel(workspace);
			const [text, setText] = (0, react.useState)("");
			const [scope, setScope] = (0, react.useState)(defaultScope ?? (noWorkspace ? "global" : "project"));
			const [overwrite, setOverwrite] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [opErrors, setOpErrors] = (0, react.useState)([]);
			const parse = (0, react.useMemo)(() => parseMcpJson(text), [text]);
			const preview = (0, react.useMemo)(() => {
				if (!parse.ok) return void 0;
				return parse.entries.map(({ key, entry }) => {
					const exists = servers.some((s) => s.scope === scope && s.key === key);
					return {
						key,
						entry,
						exists,
						overwriting: exists && overwrite,
						skipped: exists && !overwrite
					};
				});
			}, [
				parse,
				servers,
				scope,
				overwrite
			]);
			const addable = preview?.filter((item) => !item.skipped) ?? [];
			const doAdd = async () => {
				setBusy(true);
				setOpErrors([]);
				const failures = [];
				let added = 0;
				for (const { key, entry } of addable) {
					const result = await api.upsert({
						scope,
						key,
						entry
					});
					if (result.ok) added += 1;
					else failures.push(`${key}: ${result.errors.join("; ")}`);
				}
				onMutated();
				if (failures.length > 0) {
					setOpErrors([`已添加 ${added} 个，失败 ${failures.length} 个：`, ...failures]);
					setBusy(false);
					return;
				}
				onClose();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-form",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "skp-field",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-field-label",
								children: "JSON 配置"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "skp-input skp-textarea skp-json-field",
								value: text,
								spellCheck: false,
								placeholder: JSON_PLACEHOLDER,
								onChange: (e) => {
									setText(e.target.value);
									setOpErrors([]);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-note",
								children: [
									"支持完整 .mcp.json（含 mcpServers 键），或直接粘贴 ",
									`{ "服务器名": { … } }`,
									" 映射。"
								]
							})
						]
					}),
					!parse.ok && text.trim().length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: parse.errors.join("\n")
					}),
					preview !== void 0 && preview.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-field-label",
							children: [
								"将添加 ",
								addable.length,
								"/",
								preview.length,
								" 个"
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "skp-import-list",
							children: preview.map(({ key, entry, overwriting, skipped }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "skp-import-item",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-import-name",
										children: key
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-tag skp-tag-flat",
										children: transportOf(entry)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-import-desc",
										children: summarizeEntry(entry)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `skp-import-note ${overwriting ? "skp-import-note-over" : skipped ? "skp-import-note-skip" : "skp-import-note-add"}`,
										children: overwriting ? "将覆盖" : skipped ? "已存在，跳过" : "将新增"
									})
								]
							}, key))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-field-label",
							children: "添加到"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
							value: scope,
							ariaLabel: "添加目标作用域",
							options: [{
								value: "project",
								label: "项目（.mcp.json）",
								disabled: noWorkspace
							}, {
								value: "global",
								label: "全局（~/.agents/mcp.json）"
							}],
							onChange: (value) => setScope(value === "project" ? "project" : "global")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "skp-field skp-field-inline",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: overwrite,
							onChange: (e) => setOverwrite(e.target.checked)
						}), "同名服务器已存在时覆盖"]
					}),
					opErrors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: opErrors.join("\n")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-modal-actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn",
							onClick: onClose,
							children: "取消"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn skp-btn-primary",
							disabled: busy || addable.length === 0,
							onClick: () => void doAdd(),
							children: busy ? "添加中…" : `添加 ${addable.length} 个`
						})]
					})
				]
			});
		}
		/** 记录 → 每行 `KEY=VALUE` 的文本（多行文本框回填用）。 */
		function recordToLines(record) {
			return Object.entries(record ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
		}
		/** 文本 → 记录；非法行（不以 `KEY=` 开头）记入 problems 并跳过。 */
		function linesToRecord(text, field, problems) {
			const out = {};
			for (const rawLine of text.split("\n")) {
				const line = rawLine.trim();
				if (line.length === 0) continue;
				const eq = line.indexOf("=");
				if (eq <= 0) {
					problems.push(`${field}：行「${line}」不是 KEY=VALUE 格式`);
					continue;
				}
				out[line.slice(0, eq).trim()] = line.slice(eq + 1);
			}
			return out;
		}
		/** 文本 → 参数数组：按行拆分、trim、跳过空行。 */
		function linesToArray(text) {
			return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
		}
		//#endregion
		//#region src/client/tools-panel.tsx
		/**
		* 能力面板 · Tools 域（v13 R3 / 帧 06）。
		*
		* Tools 是**全局工具注册**，没有项目 / 工作区维度（UX v1.8 §2.4 / §2.5）：
		* 因此本视图没有左导航、没有工作区列表，只有**两栏**：
		*   - 左：插件单元列表（一个插件 = 一个开关单元，`N 个工具`）；
		*   - 右：插件详情 + **只读**工具清单（无逐工具开关、无参数表）。
		*
		* 开关语义（A5 已拍板「主面板也要能开关」）：主面板自身没有 sessionId，
		* 由 `api.currentSessionId()` 从客户端 sessions 快照解析当前会话：
		*   - 解析到 → 行/详情开关可点，写 `tools.setSessionEnabled`（只作用于该会话，
		*     不改项目默认）；
		*   - 解析不到 → 开关置灰 + 提示 `请在对话首屏设置本会话开关`（只读）。
		*
		* 契约：docs/architecture/v13-implementation.md §5.1 / §9.4 / 附录 A。
		*
		* @module dsh-capability-settings/client/tools-panel
		*/
		/** 详情标题右侧标签行的排版（与 mcp-panel 的 HEAD_TAGS_STYLE 同形）。 */
		const HEAD_TAGS_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			flex: "none"
		};
		/** 不做成按钮的说明文本（关闭影响条 / 只读说明）。 */
		const CLOSE_IMPACT_STYLE = { margin: "10px 0 0" };
		/** 未识别单元的琥珀标签类（复用既有 warn 标签）。 */
		function unitTagClass(unit) {
			return unit.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin";
		}
		/**
		* 单元排序：保持宿主枚举顺序（帧 06 的插件顺序来自运行时注册顺序），只把
		* 来源未识别恒排最后（UX v1.8 §5.4 的分组语义）。
		*/
		function sortUnits(units) {
			return [...units.filter((unit) => unit.kind !== "unattributed"), ...units.filter((unit) => unit.kind === "unattributed")];
		}
		/** 详情「来源判定」文案（frontend 直抄方案 §7.6 / §9.4）。 */
		function attributionText(unit) {
			if (unit.attribution.matchedBy === "unknown") return "来源未识别（不是宿主内置）";
			const pattern = unit.attribution.pattern ?? unit.name;
			return `${unit.attribution.matchedBy === "exact" ? `精确匹配 ${pattern}` : `前缀 ${pattern}`} → ${unit.name}（插件清单映射表）`;
		}
		/**
		* Tools 域视图：两栏（插件列表 + 详情/只读工具清单），无左导航。
		*
		* @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
		* @param workspace 当前工作区（只作为重新拉取的信号：会话切换后 currentSessionId 可能变化）。
		*/
		function ToolsView({ api, query, workspace, onCount }) {
			const [data, setData] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(void 0);
			const [version, setVersion] = (0, react.useState)(0);
			const [selectedUnit, setSelectedUnit] = (0, react.useState)(void 0);
			const [busyUnit, setBusyUnit] = (0, react.useState)(void 0);
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [copied, setCopied] = (0, react.useState)(false);
			const mountedRef = (0, react.useRef)(true);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const resolvedSessionId = api.currentSessionId?.();
			const sessionId = typeof resolvedSessionId === "string" && resolvedSessionId.length > 0 ? resolvedSessionId : void 0;
			(0, react.useEffect)(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setLoading(true);
				setError(void 0);
				api.tools.list(sessionId !== void 0 ? { sessionId } : {}).then((view) => {
					if (cancelled) return;
					setData(view);
				}).catch((failure) => {
					if (cancelled) return;
					setError(String(failure instanceof Error ? failure.message : failure));
				}).finally(() => {
					if (!cancelled) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, [
				api,
				sessionId,
				workspace,
				version
			]);
			const units = (0, react.useMemo)(() => sortUnits(data?.units ?? []), [data]);
			(0, react.useEffect)(() => {
				if (!loading && error === void 0) onCount?.(units.length);
			}, [
				units.length,
				loading,
				error,
				onCount
			]);
			(0, react.useEffect)(() => {
				if (units.length === 0) {
					if (selectedUnit !== void 0) setSelectedUnit(void 0);
					return;
				}
				if (selectedUnit !== void 0 && units.some((unit) => unit.unit === selectedUnit)) return;
				setSelectedUnit(units[0]?.unit);
			}, [units, selectedUnit]);
			const q = query.trim().toLowerCase();
			const visible = (0, react.useMemo)(() => units.filter((unit) => {
				if (q === "") return true;
				if (unit.name.toLowerCase().includes(q)) return true;
				return unit.tools.some((tool) => tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q));
			}), [units, q]);
			const selected = units.find((unit) => unit.unit === selectedUnit);
			/** 写会话开关（A5）：只有解析到当前会话且单元未锁定时才允许。 */
			const toggleUnit = (0, react.useCallback)(async (unit, next) => {
				if (sessionId === void 0 || unit.lockedReason !== void 0 || busyUnit !== void 0) return;
				setBusyUnit(unit.unit);
				setOpError(void 0);
				try {
					await api.tools.setSessionEnabled({
						units: [unit.unit],
						enabled: next,
						sessionId
					});
				} catch (failure) {
					setOpError(String(failure instanceof Error ? failure.message : failure));
				} finally {
					if (mountedRef.current) setBusyUnit(void 0);
					setVersion((value) => value + 1);
				}
			}, [
				api,
				busyUnit,
				sessionId
			]);
			const copyName = async (name) => {
				try {
					await navigator.clipboard?.writeText(name);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				} catch {}
			};
			const focusRow = (unit) => {
				const element = rowRefs.current.get(unit);
				element?.focus();
				element?.scrollIntoView({ block: "nearest" });
			};
			const onRowKeyDown = (event, unit) => {
				if (visible.length === 0) return;
				const index = visible.findIndex((item) => item.unit === unit);
				if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
					event.preventDefault();
					const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : event.key === "ArrowDown" ? Math.min(visible.length - 1, index + 1) : Math.max(0, index - 1);
					const nextUnit = visible[next]?.unit;
					if (nextUnit !== void 0) {
						setSelectedUnit(nextUnit);
						requestAnimationFrame(() => focusRow(nextUnit));
					}
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					setSelectedUnit(unit);
				}
			};
			const listErrors = data?.errors ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-domain",
				children: [
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: opError
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-error",
						children: ["读取失败：", error]
					}),
					error === void 0 && listErrors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: listErrors.join("\n")
					}),
					loading && data === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-status",
						children: "加载中…"
					}),
					data !== void 0 && error === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body skp-tools-body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-workspace-pane skp-tools-pane",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-pane-title",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										children: "Tools"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-group-count",
										children: units.length
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-pane-title-note",
										children: [
											"· ",
											units.filter((unit) => unit.enabledInSession).length,
											" 启用 · 插件级开关（整插件生效）"
										]
									})
								]
							}), units.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-empty",
								children: listErrors.length > 0 ? "当前外壳未提供工具注册表，无法列出 Tools。" : "尚未发现 Tools。"
							}) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-empty",
								children: [
									"没有匹配「",
									query.trim(),
									"」的 Tools。"
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-group-scroll",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: "skp-list",
									role: "listbox",
									"aria-label": "Tools",
									children: visible.map((unit) => {
										const active = unit.unit === selectedUnit;
										const locked = unit.lockedReason !== void 0;
										const readOnly = sessionId === void 0;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												role: "option",
												"aria-selected": active,
												tabIndex: active ? 0 : -1,
												className: active ? "skp-row skp-row-active" : "skp-row",
												ref: (element) => {
													if (element === null) rowRefs.current.delete(unit.unit);
													else rowRefs.current.set(unit.unit, element);
												},
												onClick: () => setSelectedUnit(unit.unit),
												onKeyDown: (event) => onRowKeyDown(event, unit.unit),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "skp-row-name",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: unit.enabledInSession ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow",
															"aria-hidden": "true"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "skp-sr-only",
															children: unit.enabledInSession ? "已启用" : "已关闭"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "skp-row-title",
															title: unit.name,
															children: unit.name
														})
													]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "skp-row-meta",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: unitTagClass(unit),
														title: unit.kind === "unattributed" ? "来源未识别：不是宿主内置工具" : "插件运行时注册（非 MCP）",
														children: unit.kind === "unattributed" ? "未识别" : "插件"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "skp-tag skp-tag-flat",
														children: [unit.toolCount, " 个工具"]
													})]
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: "skp-row-toggle",
												title: locked ? unit.lockedReason ?? "该插件无法按会话关闭" : readOnly ? "请在对话首屏设置本会话开关" : unit.enabledInSession ? "关闭：该插件全部工具在本会话不可见（不改项目默认）" : "开启：恢复该插件全部工具（仅当前会话）",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-row-default-label",
													children: "启用"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "skp-switch",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "checkbox",
														role: "switch",
														"aria-label": `启用 ${unit.name}`,
														checked: unit.enabledInSession,
														disabled: locked || readOnly || busyUnit === unit.unit,
														onChange: (event) => void toggleUnit(unit, event.target.checked)
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
												})]
											})]
										}, unit.unit);
									})
								})
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail skp-detail-fixed",
							children: selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-detail-empty",
								children: "选择一个插件查看工具清单（只读）。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-detail-card",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-detail-head",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
												title: selected.name,
												children: selected.name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: HEAD_TAGS_STYLE,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: selected.kind === "unattributed" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-plugin",
													children: selected.kind === "unattributed" ? "未识别" : "插件"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-tag skp-tag-channel",
													title: selected.attribution.packageName ?? selected.name,
													children: selected.name
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "skp-btn",
												onClick: () => void copyName(selected.name),
												children: copied ? "已复制" : "复制插件名"
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-detail-actions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-row-toggle",
											style: { marginLeft: 0 },
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-row-default-label",
												children: "本会话"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "skp-switch",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													role: "switch",
													"aria-label": `启用 ${selected.name}`,
													checked: selected.enabledInSession,
													disabled: selected.lockedReason !== void 0 || sessionId === void 0 || busyUnit === selected.unit,
													onChange: (event) => void toggleUnit(selected, event.target.checked)
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-note",
											children: [selected.enabledInSession ? "已启用" : "已关闭", sessionId === void 0 ? " · 请在对话首屏设置本会话开关" : " · 仅当前会话"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-detail-meta",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-detail-meta-item",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-detail-meta-strong",
												children: "来源判定："
											}), attributionText(selected)]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-detail-meta-item",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-detail-meta-strong",
												children: "注入方式："
											}), "插件运行时注册的非 MCP 工具（不落盘）"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-note",
										children: [
											"工具数 ",
											selected.toolCount,
											" · 开关为插件级：关闭后该插件全部工具在本会话不可见"
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-detail-inspect",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "skp-detail-inspect-head",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "skp-field-label",
												children: [
													"工具清单（",
													selected.toolCount,
													"）· 只读"
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-test-stat",
												children: "无逐工具开关、无参数表"
											})]
										}), selected.tools.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "skp-note",
											children: "工具清单不可见（该单元当前没有可见工具）。"
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
											className: "skp-tools-list",
											children: selected.tools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
												className: "skp-tools-item",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-tools-name",
													children: tool.name
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-tools-desc",
													children: tool.description ?? "（无说明）"
												})]
											}, tool.name))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-tools-impact",
										style: CLOSE_IMPACT_STYLE,
										children: [
											"关闭该插件后，本会话模型看不到它的全部 ",
											selected.toolCount,
											" 个工具；能力决策（Jev）以插件整体计分，选中才会启用该插件全部工具；不改项目默认"
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "skp-note",
										style: CLOSE_IMPACT_STYLE,
										children: "插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "skp-note",
										children: "※ 本版不做参数表：Tools 没有统一的 inputSchema 承诺；工具清单只读展示名称与说明。"
									})
								]
							})
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/jev-panel.tsx
		/**
		* 「Jev 模型」配置页（能力面板第三个域 Tab）。
		*
		* 纯客户端表单：配置读写、密钥掩码、测试连接全部走 `api.jev.*`（宿主进程
		* 持有密钥并发请求，浏览器永不接触明文，见架构 §4）。三块内容：
		*   1. Base URL / 模型名 / API Key 来源（直接填写 | 环境变量）；
		*   2. 「能力决策」区：自动评分开关 + 三个门槛（停顿阈值 / 最少触发字数 /
		*      最少修改间隔字符数）
		*   3. 测试连接 / 恢复默认 / 保存（保存成功**不关闭、不跳转**）。
		*
		* 关键约定（评审 checklist）：
		*   - 保存校验本地先做一遍（范围 / 必填 / 格式），失败不发 RPC；宿主返回的
		*     `issues` 再落到同一批行内错误上（双保险）。
		*   - 密钥只单向下发：输入框为空且已有文件密钥时提交**不带** `apiKey` 字段
		*     （避免把掩码写回文件）；切到「环境变量」保存时提交 `apiKey: ""` 让宿主
		*     删除文件密钥（架构 §3.6）。
		*   - 未保存草稿在**同一面板会话内**切 Tab 不丢：本组件由 panel.tsx 常驻挂载，
		*     用 `active` 控制显隐，不随切 Tab 卸载（AC-CFG-16）。
		*   - 测试连接按 RPC 契约使用**已保存配置**（`jev.test` payload 被忽略，
		*     架构 §5.3）；表单有未保存修改时结果行会注明。
		*
		* @module dsh-capability-settings/client/jev-panel
		*/
		/** 与宿主 `defaultJevConfig()` 对齐的默认值（架构 §3.4）。 */
		const DEFAULT_BASE_URL = "https://api.typesafe.ai";
		const DEFAULT_MODEL = "jev-latest";
		const DEFAULT_ENV_NAME = "TYPESAFE_API_KEY";
		const DEFAULT_PAUSE_MS = 1e3;
		const DEFAULT_MIN_CHARS = 10;
		const DEFAULT_MIN_EDIT_CHARS = 4;
		/**
		* 配置保存成功的全局事件名（F3 修复的发送端）。
		*
		* hero 的 `jev.getConfig` 只在挂载时读一次；配置页保存成功后广播该事件，
		* composer 侧（task-25）监听后重新读取配置，使「未配置」蓝点 / 自动触发门槛
		* 在同一挂载内即时更新。事件不带 detail（监听方自行 `getConfig`）。
		*/
		const JEV_CONFIG_CHANGED_EVENT = "capability-panel:jev-config-changed";
		/** 广播配置变更（仅在保存成功分支调用；无 window 的环境静默跳过）。 */
		function notifyJevConfigChanged() {
			if (typeof window === "undefined") return;
			try {
				window.dispatchEvent(new window.CustomEvent(JEV_CONFIG_CHANGED_EVENT));
			} catch {}
		}
		/** UX §5.8 的完整中文文案（可直抄副本，集中放这里便于对照）。 */
		const COPY = {
			title: "Jev 模型",
			/** R5：删除独立 callout，说明并入副标题两行（A10 已拍板文案）。 */
			subtitle: "用 Jev 模型给 Skills、MCP 与 Tools 打分，自动选出与本轮草稿最相关的能力。",
			subtitle2: "一次请求完成；发送输入框草稿与能力名称、描述（Tools 为插件名与工具说明摘要）；草稿仅用于本次评分、不落盘，结果只写当前会话。",
			/** 密钥安全承诺收进 API Key ⓘ（R5）。 */
			keySafety: "密钥仅存宿主，不下发浏览器",
			baseUrl: "Base URL",
			baseUrlHint: "留空使用默认值 https://api.typesafe.ai",
			model: "模型名",
			modelPlaceholder: "jev-latest",
			modelHint: "Jev 模型名，默认 jev-latest。",
			keyMode: "API Key 来源",
			modeDirect: "直接填写",
			modeEnv: "环境变量",
			apiKey: "API Key",
			apiKeyPlaceholder: "粘贴 API Key",
			apiKeyHint: "密钥仅保存在宿主侧；更换后需点「保存」才会生效。",
			changeKey: "更换",
			envName: "环境变量名",
			envNameHint: "宿主从自身进程环境读取；变量应在启动 DSH 的环境中设置。",
			autoSection: "能力决策",
			autoEnable: "输入停顿后自动评分",
			autoEnableHint: "开启后，在对话首屏停止输入达到阈值会自动发起 1 次评分（默认关闭）。",
			pause: "停顿阈值",
			pauseHint: "停止输入达到该时长后自动发起 1 次评分 · 修改量达到阈值后可再次触发",
			minChars: "最少触发字数",
			minCharsHint: "草稿字符数达到该值才可能自动触发（默认 10）",
			minEdit: "最少修改间隔字符数",
			minEditHint: "距上一次能力决策累计插入+删除字符数达到该值，才会再次自动触发（默认 4）",
			cost: "成本：每次约 1 次请求（$0.0003–0.001）",
			autoPrivacy: "开启后，草稿会在停止输入时自动发送到你配置的 Jev 服务，请确认符合你的隐私预期。",
			test: "测试连接",
			testing: "测试中…",
			testRunning: "正在连接 Jev 服务…",
			testFormHint: "测试使用当前表单配置，无需先保存。",
			testFormSuffix: "（测试使用当前表单配置）",
			retry: "重试",
			save: "保存",
			saving: "保存中…",
			saveOk: "Jev 配置已保存",
			reset: "恢复默认",
			resetConfirm: "确认恢复默认",
			cancel: "取消",
			resetTip: "已恢复默认值，保存后生效",
			dirty: "有未保存的修改",
			saveScope: "全局生效 · 保存后立即使用",
			loading: "正在读取配置…",
			unconfiguredTip: "尚未配置 Jev 模型。保存后可在首屏使用「能力决策」。",
			loadError: "读取配置失败：",
			saveError: "保存失败："
		};
		const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
		const ERR_BASE_URL = "Base URL 需以 http:// 或 https:// 开头";
		const ERR_KEY_REQUIRED = "请填写 API Key，或切换到「环境变量」";
		const ERR_ENV_REQUIRED = "请填写环境变量名";
		const ERR_ENV_FORMAT = "环境变量名只能包含字母、数字和下划线，且不能以数字开头";
		const ERR_MODEL_REQUIRED = "请填写模型名";
		const ERR_PAUSE_RANGE = "停顿阈值需在 300–3000 ms 之间（步长 100）";
		const ERR_MIN_CHARS_RANGE = "最少触发字数需在 1–200 之间";
		const ERR_MIN_EDIT_RANGE = "最少修改间隔字符数需在 1–100 之间";
		/** 读取失败 / 保存失败等异常的可读消息。 */
		function messageOf$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** 过长的错误信息截断，避免撑破结果行（宿主已脱敏，这里只控长度）。 */
		function shorten(text, max = 180) {
			const trimmed = text.trim();
			return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
		}
		/** 空串按默认值处理（UX：Base URL 留空 = 存默认值；末尾 `/` 规范化）。 */
		function normalizeBaseURL(value) {
			const trimmed = value.trim().replace(/\/+$/, "");
			return trimmed.length === 0 ? DEFAULT_BASE_URL : trimmed;
		}
		/** 严格非负整数解析：`"1e3"` / `"1.5"` / 空串一律视为非法。 */
		function parseIntStrict(value) {
			const trimmed = value.trim();
			if (!/^\d+$/.test(trimmed)) return void 0;
			const parsed = Number(trimmed);
			return Number.isSafeInteger(parsed) ? parsed : void 0;
		}
		/** 默认表单：Base URL / 模型默认值、**直接填写**、自动触发默认关闭（AC-CFG-3）。 */
		function defaultForm() {
			return {
				baseURL: DEFAULT_BASE_URL,
				model: DEFAULT_MODEL,
				keyMode: "direct",
				apiKeyDraft: "",
				replacingKey: false,
				showKey: false,
				apiKeyEnv: DEFAULT_ENV_NAME,
				autoEnabled: false,
				pauseMs: String(DEFAULT_PAUSE_MS),
				minChars: String(DEFAULT_MIN_CHARS),
				minEditChars: String(DEFAULT_MIN_EDIT_CHARS)
			};
		}
		/** 从 getConfig 视图生成表单；`keyMode` 缺省按已保存来源推断。 */
		function formFromView(view, keyMode) {
			return {
				baseURL: view.baseURL,
				model: view.model,
				keyMode: keyMode ?? (view.apiKeySource === "env" ? "env" : "direct"),
				apiKeyDraft: "",
				replacingKey: false,
				showKey: false,
				apiKeyEnv: view.apiKeyEnv ?? DEFAULT_ENV_NAME,
				autoEnabled: view.autoTrigger.enabled,
				pauseMs: String(view.autoTrigger.pauseMs),
				minChars: String(view.autoTrigger.minChars),
				minEditChars: String(view.autoTrigger.minEditChars)
			};
		}
		/** 表单是否有未保存修改（决定「有未保存的修改」提示与主按钮高亮）。 */
		function isDirty(form, saved, savedKeyMode) {
			if (normalizeBaseURL(form.baseURL) !== normalizeBaseURL(saved.baseURL)) return true;
			if (form.model.trim() !== saved.model.trim()) return true;
			if (form.keyMode !== savedKeyMode) return true;
			if (form.keyMode === "direct" && form.apiKeyDraft.trim().length > 0) return true;
			if (form.keyMode === "env" && form.apiKeyEnv.trim() !== (saved.apiKeyEnv ?? DEFAULT_ENV_NAME)) return true;
			if (form.autoEnabled !== saved.autoTrigger.enabled) return true;
			if (parseIntStrict(form.pauseMs) !== saved.autoTrigger.pauseMs) return true;
			if (parseIntStrict(form.minChars) !== saved.autoTrigger.minChars) return true;
			return parseIntStrict(form.minEditChars) !== saved.autoTrigger.minEditChars;
		}
		/** 宿主 `issues[].field` → 行内字段（宿主字段名见架构 §3.5）。 */
		function issueFieldOf(field) {
			if (field.includes("baseURL") || field.includes("base_url")) return "baseURL";
			if (field === "model" || field.endsWith(".model")) return "model";
			if (field.includes("apiKeyEnv")) return "apiKeyEnv";
			if (field.includes("apiKey")) return "apiKey";
			if (field.includes("pauseMs")) return "pauseMs";
			if (field.includes("minChars")) return "minChars";
			if (field.includes("minEdit")) return "minEditChars";
		}
		/** 把宿主返回的结构化 issues 落到行内错误（按已知字段；未知字段并入错误条）。 */
		function issuesToErrors(issues) {
			const next = {};
			for (const issue of issues ?? []) {
				const field = issueFieldOf(issue.field);
				if (field !== void 0) next[field] = issue.message;
			}
			return next;
		}
		/**
		* 测试失败的分类文案（UX §5.8 + 架构 §5.4 的 code → 中文映射）。
		* `envMode` 取自**已保存**配置的密钥来源：环境变量模式下 `no-config`
		* 说明宿主进程没有该变量（宿主错误文案是英文，不能靠它判断）。
		*/
		function testErrorText(code, model, envName, errors, envMode) {
			const joinErrors = () => errors.length > 0 ? shorten(errors[0]) : "";
			switch (code) {
				case "auth": return "API Key 无效或无权限（401）";
				case "rate-limit": return "请求过多，请稍后重试（429）";
				case "overloaded": return "服务繁忙，请稍后重试（529）";
				case "timeout": return "连接超时";
				case "context-too-long": return "内容过长，请精简草稿后重试";
				case "network": return "无法连接 Base URL（网络不可达或地址错误）";
				case "empty-capabilities": return "当前会话没有可评分的能力";
				case "no-config": return envMode || errors.some((item) => item.includes("环境变量")) ? `宿主环境变量 ${envName.length > 0 ? envName : DEFAULT_ENV_NAME} 未设置` : "尚未配置 Jev 模型（缺少 API Key）";
				default:
					if (errors.some((item) => item.includes("404"))) return `模型 ${model} 不可用（404）`;
					return joinErrors().length > 0 ? `请求参数有误：${joinErrors()}` : "请求参数有误";
			}
		}
		/** 输入框类名：错误态加红边。 */
		function inputClass(invalid) {
			return invalid ? "skp-jev-input skp-jev-input-invalid" : "skp-jev-input";
		}
		/**
		* 配置页本体。
		*
		* `active` 只控制显隐：切换域 Tab 时组件**不卸载**，未保存草稿因此保留
		* （AC-CFG-16）；关闭能力面板后整棵子树卸载，草稿按 UX 丢弃。
		*/
		function JevPanel({ api, active }) {
			const [phase, setPhase] = (0, react.useState)("loading");
			const [loadError, setLoadError] = (0, react.useState)("");
			const [saved, setSaved] = (0, react.useState)(null);
			/** 已保存配置的密钥来源模式（只在读取/保存成功时更新，避免视图漂移）。 */
			const [savedKeyMode, setSavedKeyMode] = (0, react.useState)("direct");
			const [form, setForm] = (0, react.useState)(defaultForm);
			const [errors, setErrors] = (0, react.useState)({});
			const [saveState, setSaveState] = (0, react.useState)("idle");
			const [saveErrors, setSaveErrors] = (0, react.useState)([]);
			const [savedNotice, setSavedNotice] = (0, react.useState)(false);
			const [resetConfirm, setResetConfirm] = (0, react.useState)(false);
			const [resetTip, setResetTip] = (0, react.useState)(false);
			const [test, setTest] = (0, react.useState)({ kind: "idle" });
			const apiKeyRef = (0, react.useRef)(null);
			const aliveRef = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				aliveRef.current = true;
				return () => {
					aliveRef.current = false;
				};
			}, []);
			/** 读取配置：失败进 load-error（表单禁用 + 重试）。 */
			const load = (0, react.useCallback)(async () => {
				setPhase("loading");
				setLoadError("");
				try {
					const view = await api.jev.getConfig();
					if (!aliveRef.current) return;
					setSaved(view);
					setSavedKeyMode(view.apiKeySource === "env" ? "env" : "direct");
					setForm(formFromView(view));
					setErrors({});
					setSaveErrors([]);
					setSavedNotice(false);
					setResetTip(false);
					setResetConfirm(false);
					setTest({ kind: "idle" });
					setPhase("ready");
				} catch (error) {
					if (!aliveRef.current) return;
					setLoadError(shorten(messageOf$1(error)));
					setPhase("load-error");
				}
			}, [api]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const disabled = phase !== "ready" || saveState === "saving";
			const busy = saveState === "saving" || test.kind === "running";
			const dirty = saved !== null && isDirty(form, saved, savedKeyMode);
			const showUnconfigured = phase === "ready" && saved !== null && !saved.hasApiKey;
			/** 直接填写模式下是否已有宿主文件密钥（有则可留空 = 不修改）。 */
			const hasSavedFileKey = saved !== null && saved.apiKeySource === "file" && saved.hasApiKey;
			const savedLast4 = saved?.apiKeyLast4 ?? "****";
			const keyMeta = saved === null ? void 0 : saved.apiKeySource === "file" ? `已保存 · 尾号 ${savedLast4}（来源：直接填写）` : saved.apiKeySource === "env" ? `已保存 · 尾号 ${savedLast4}（来源：环境变量 ${form.apiKeyEnv.trim() || DEFAULT_ENV_NAME}）` : "未保存密钥";
			/** 任一字段编辑：清掉保存结果 / 行内错误，取消恢复默认的待确认态。 */
			const update = (patch) => {
				setForm((prev) => ({
					...prev,
					...patch
				}));
				setErrors({});
				setSaveErrors([]);
				setSavedNotice(false);
				setResetTip(false);
				setResetConfirm(false);
			};
			/** 本地校验：通过则返回提交给宿主的 config；失败返回行内错误。 */
			const validate = () => {
				const nextErrors = {};
				const baseURL = normalizeBaseURL(form.baseURL);
				if (!/^https?:\/\//i.test(baseURL)) nextErrors.baseURL = ERR_BASE_URL;
				else try {
					new URL(baseURL);
				} catch {
					nextErrors.baseURL = ERR_BASE_URL;
				}
				const model = form.model.trim();
				if (model.length === 0) nextErrors.model = ERR_MODEL_REQUIRED;
				const envName = form.apiKeyEnv.trim();
				if (form.keyMode === "env") {
					if (envName.length === 0) nextErrors.apiKeyEnv = ERR_ENV_REQUIRED;
					else if (!ENV_NAME_PATTERN.test(envName)) nextErrors.apiKeyEnv = ERR_ENV_FORMAT;
				} else if (form.apiKeyDraft.trim().length === 0 && !hasSavedFileKey) nextErrors.apiKey = ERR_KEY_REQUIRED;
				const pause = parseIntStrict(form.pauseMs);
				if (pause === void 0 || pause < 300 || pause > 3e3 || pause % 100 !== 0) nextErrors.pauseMs = ERR_PAUSE_RANGE;
				const minChars = parseIntStrict(form.minChars);
				if (minChars === void 0 || minChars < 1 || minChars > 200) nextErrors.minChars = ERR_MIN_CHARS_RANGE;
				const minEditChars = parseIntStrict(form.minEditChars);
				if (minEditChars === void 0 || minEditChars < 1 || minEditChars > 100) nextErrors.minEditChars = ERR_MIN_EDIT_RANGE;
				const config = {
					baseURL,
					model,
					autoTrigger: {
						enabled: form.autoEnabled,
						pauseMs: pause ?? DEFAULT_PAUSE_MS,
						minChars: minChars ?? DEFAULT_MIN_CHARS,
						minEditChars: minEditChars ?? DEFAULT_MIN_EDIT_CHARS
					}
				};
				if (form.keyMode === "env") {
					config.apiKeyEnv = envName;
					config.apiKey = "";
				} else if (form.apiKeyDraft.trim().length > 0) config.apiKey = form.apiKeyDraft.trim();
				return {
					config,
					errors: nextErrors
				};
			};
			/**
			* 用当前表单值组装「仅本次测试」的 config（不写盘，AC-CFG-10）。
			*
			* 只校验与探针相关的字段（Base URL / 模型 / 密钥来源）；autoTrigger 仅在
			* 三个数字都合法时附带（测试与自动触发无关，非法值不应阻止测试）。
			* timeoutMs 一期没有 UI，不附带（宿主沿用已保存值）。
			*/
			const buildTestConfig = () => {
				const baseURL = normalizeBaseURL(form.baseURL);
				if (!/^https?:\/\//i.test(baseURL)) return { error: ERR_BASE_URL };
				try {
					new URL(baseURL);
				} catch {
					return { error: ERR_BASE_URL };
				}
				const model = form.model.trim();
				if (model.length === 0) return { error: ERR_MODEL_REQUIRED };
				const config = {
					baseURL,
					model
				};
				if (form.keyMode === "env") {
					const envName = form.apiKeyEnv.trim();
					if (envName.length === 0) return { error: ERR_ENV_REQUIRED };
					if (!ENV_NAME_PATTERN.test(envName)) return { error: ERR_ENV_FORMAT };
					config.apiKeyEnv = envName;
					config.apiKey = "";
				} else if (form.apiKeyDraft.trim().length > 0) config.apiKey = form.apiKeyDraft.trim();
				else if (!hasSavedFileKey) return { error: ERR_KEY_REQUIRED };
				const pause = parseIntStrict(form.pauseMs);
				const minChars = parseIntStrict(form.minChars);
				const minEditChars = parseIntStrict(form.minEditChars);
				if (pause !== void 0 && pause >= 300 && pause <= 3e3 && pause % 100 === 0 && minChars !== void 0 && minChars >= 1 && minChars <= 200 && minEditChars !== void 0 && minEditChars >= 1 && minEditChars <= 100) config.autoTrigger = {
					enabled: form.autoEnabled,
					pauseMs: pause,
					minChars,
					minEditChars
				};
				return { config };
			};
			const handleSave = async () => {
				if (phase !== "ready" || busy) return;
				const validation = validate();
				setErrors(validation.errors);
				setSaveErrors([]);
				setSavedNotice(false);
				if (Object.keys(validation.errors).length > 0) return;
				setSaveState("saving");
				try {
					const result = await api.jev.setConfig({ config: validation.config });
					if (!aliveRef.current) return;
					if (!result.ok) {
						setErrors(issuesToErrors(result.issues));
						setSaveErrors(result.errors.length > 0 ? result.errors : ["配置校验未通过"]);
						return;
					}
					setSavedKeyMode(form.keyMode);
					try {
						const view = await api.jev.getConfig();
						if (!aliveRef.current) return;
						setSaved(view);
						setForm((prev) => {
							return {
								...formFromView(view, prev.keyMode),
								apiKeyEnv: view.apiKeyEnv ?? prev.apiKeyEnv
							};
						});
					} catch {}
					setErrors({});
					setSaveErrors([]);
					setSavedNotice(true);
					setTest({ kind: "idle" });
					notifyJevConfigChanged();
				} catch (error) {
					if (!aliveRef.current) return;
					setSaveErrors([shorten(messageOf$1(error))]);
				} finally {
					if (aliveRef.current) setSaveState("idle");
				}
			};
			const handleTest = async () => {
				if (phase !== "ready" || busy) return;
				const built = buildTestConfig();
				if ("error" in built) {
					setTest({
						kind: "error",
						text: built.error
					});
					return;
				}
				setTest({ kind: "running" });
				try {
					const result = await api.jev.test({ config: { config: built.config } });
					if (!aliveRef.current) return;
					if (result.ok) setTest({
						kind: "ok",
						model: result.model.length > 0 ? result.model : form.model.trim(),
						latencyMs: Math.round(result.latencyMs)
					});
					else setTest({
						kind: "error",
						text: testErrorText(result.code, form.model.trim(), built.config.apiKeyEnv ?? form.apiKeyEnv.trim(), result.errors, built.config.apiKeyEnv !== void 0)
					});
				} catch (error) {
					if (!aliveRef.current) return;
					setTest({
						kind: "error",
						text: `无法连接宿主服务：${shorten(messageOf$1(error))}`
					});
				}
			};
			/** 恢复默认：两次确认（第一次只进入待确认态，第二次才重置表单，不写配置）。 */
			const handleReset = () => {
				if (phase !== "ready" || busy) return;
				if (!resetConfirm) {
					setResetConfirm(true);
					setResetTip(false);
					return;
				}
				setResetConfirm(false);
				setForm(defaultForm());
				setErrors({});
				setSaveErrors([]);
				setSavedNotice(false);
				setResetTip(true);
				setTest({ kind: "idle" });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-jev",
				role: "tabpanel",
				"aria-label": COPY.title,
				style: active ? void 0 : { display: "none" },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-jev-inner",
					children: [showUnconfigured && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-jev-top",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-jev-banner",
							role: "status",
							children: COPY.unconfiguredTip
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-jev-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "skp-jev-title",
								children: COPY.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "skp-jev-subtitle",
								children: COPY.subtitle
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "skp-jev-subtitle skp-jev-subtitle-sub",
								children: COPY.subtitle2
							}),
							phase === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-jev-loading",
								children: COPY.loading
							}),
							phase === "load-error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-error-bar",
								role: "alert",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [COPY.loadError, loadError] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-link-btn",
									onClick: () => void load(),
									children: "重试"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-field",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "skp-jev-label",
										htmlFor: "skp-jev-baseurl",
										children: COPY.baseUrl
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "skp-jev-baseurl",
										className: inputClass(errors.baseURL !== void 0),
										type: "text",
										inputMode: "url",
										spellCheck: false,
										value: form.baseURL,
										placeholder: DEFAULT_BASE_URL,
										disabled,
										"aria-invalid": errors.baseURL !== void 0,
										"aria-describedby": "skp-jev-baseurl-desc",
										onChange: (event) => update({ baseURL: event.target.value })
									}),
									errors.baseURL !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-err",
										id: "skp-jev-baseurl-desc",
										role: "alert",
										children: errors.baseURL
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-hint",
										id: "skp-jev-baseurl-desc",
										children: COPY.baseUrlHint
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-field",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "skp-jev-label",
										htmlFor: "skp-jev-model",
										children: COPY.model
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "skp-jev-model",
										className: inputClass(errors.model !== void 0),
										type: "text",
										spellCheck: false,
										value: form.model,
										placeholder: COPY.modelPlaceholder,
										disabled,
										"aria-invalid": errors.model !== void 0,
										"aria-describedby": "skp-jev-model-desc",
										onChange: (event) => update({ model: event.target.value })
									}),
									errors.model !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-err",
										id: "skp-jev-model-desc",
										role: "alert",
										children: errors.model
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-hint",
										id: "skp-jev-model-desc",
										children: COPY.modelHint
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-jev-label",
									id: "skp-jev-keymode-label",
									children: COPY.keyMode
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-jev-seg",
									role: "radiogroup",
									"aria-labelledby": "skp-jev-keymode-label",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										role: "radio",
										"aria-checked": form.keyMode === "direct",
										className: form.keyMode === "direct" ? "skp-jev-seg-btn skp-jev-seg-btn-active" : "skp-jev-seg-btn",
										disabled,
										onClick: () => update({
											keyMode: "direct",
											showKey: false,
											replacingKey: false
										}),
										children: COPY.modeDirect
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										role: "radio",
										"aria-checked": form.keyMode === "env",
										className: form.keyMode === "env" ? "skp-jev-seg-btn skp-jev-seg-btn-active" : "skp-jev-seg-btn",
										disabled,
										onClick: () => update({
											keyMode: "env",
											showKey: false,
											replacingKey: false
										}),
										children: COPY.modeEnv
									})]
								})]
							}),
							form.keyMode === "direct" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								className: "skp-jev-field",
								onSubmit: (event) => event.preventDefault(),
								noValidate: true,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-jev-label-row",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												className: "skp-jev-label",
												htmlFor: "skp-jev-apikey",
												children: COPY.apiKey
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "skp-jev-info",
												title: COPY.keySafety,
												"aria-label": "密钥存储说明",
												"aria-describedby": "skp-jev-apikey-safety",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													"aria-hidden": "true",
													children: "ⓘ"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-jev-key-safety",
												id: "skp-jev-apikey-safety",
												children: COPY.keySafety
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-input-row",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												id: "skp-jev-apikey",
												ref: apiKeyRef,
												className: inputClass(errors.apiKey !== void 0),
												type: form.showKey ? "text" : "password",
												autoComplete: "new-password",
												spellCheck: false,
												value: form.apiKeyDraft,
												placeholder: hasSavedFileKey && !form.replacingKey ? `已保存 · 尾号 ${savedLast4}` : COPY.apiKeyPlaceholder,
												disabled,
												"aria-invalid": errors.apiKey !== void 0,
												"aria-describedby": "skp-jev-apikey-desc",
												onChange: (event) => update({ apiKeyDraft: event.target.value })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "skp-jev-btn-icon",
												"aria-label": form.showKey ? "隐藏 API Key" : "显示 API Key",
												disabled,
												onClick: () => setForm((prev) => ({
													...prev,
													showKey: !prev.showKey
												})),
												children: form.showKey ? "隐藏" : "显示"
											}),
											hasSavedFileKey && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "skp-jev-btn-icon",
												disabled,
												onClick: () => {
													setForm((prev) => ({
														...prev,
														replacingKey: true,
														showKey: false
													}));
													apiKeyRef.current?.focus();
												},
												children: COPY.changeKey
											})
										]
									}),
									errors.apiKey !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-err",
										id: "skp-jev-apikey-desc",
										role: "alert",
										children: errors.apiKey
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-jev-hint",
										id: "skp-jev-apikey-desc",
										children: [COPY.apiKeyHint, keyMeta !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-key-meta",
											children: keyMeta
										})]
									})
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-field",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "skp-jev-label",
										htmlFor: "skp-jev-envname",
										children: COPY.envName
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "skp-jev-envname",
										className: inputClass(errors.apiKeyEnv !== void 0),
										type: "text",
										spellCheck: false,
										value: form.apiKeyEnv,
										placeholder: DEFAULT_ENV_NAME,
										disabled,
										"aria-invalid": errors.apiKeyEnv !== void 0,
										"aria-describedby": "skp-jev-envname-desc",
										onChange: (event) => update({ apiKeyEnv: event.target.value })
									}),
									errors.apiKeyEnv !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-err",
										id: "skp-jev-envname-desc",
										role: "alert",
										children: errors.apiKeyEnv
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-jev-hint",
										id: "skp-jev-envname-desc",
										children: [COPY.envNameHint, keyMeta !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-key-meta",
											children: keyMeta
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-section",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
										className: "skp-jev-section-title",
										children: COPY.autoSection
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-switch-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-jev-switch-text",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-jev-label skp-jev-label-strong",
												children: COPY.autoEnable
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-jev-hint",
												children: COPY.autoEnableHint
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: "skp-switch",
											title: COPY.autoEnable,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: form.autoEnabled,
												disabled,
												"aria-label": COPY.autoEnable,
												onChange: (event) => update({ autoEnabled: event.target.checked })
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "skp-jev-num-row",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													className: "skp-jev-label",
													htmlFor: "skp-jev-pause",
													children: COPY.pause
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													id: "skp-jev-pause",
													className: `${inputClass(errors.pauseMs !== void 0)} skp-jev-num`,
													type: "number",
													min: 300,
													max: 3e3,
													step: 100,
													value: form.pauseMs,
													disabled,
													"aria-invalid": errors.pauseMs !== void 0,
													"aria-describedby": "skp-jev-pause-desc",
													onChange: (event) => update({ pauseMs: event.target.value })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-jev-unit",
													children: "ms"
												})
											]
										}), errors.pauseMs !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-err",
											id: "skp-jev-pause-desc",
											role: "alert",
											children: errors.pauseMs
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-hint",
											id: "skp-jev-pause-desc",
											children: COPY.pauseHint
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "skp-jev-num-row",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													className: "skp-jev-label",
													htmlFor: "skp-jev-minchars",
													children: COPY.minChars
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													id: "skp-jev-minchars",
													className: `${inputClass(errors.minChars !== void 0)} skp-jev-num`,
													type: "number",
													min: 1,
													max: 200,
													step: 1,
													value: form.minChars,
													disabled,
													"aria-invalid": errors.minChars !== void 0,
													"aria-describedby": "skp-jev-minchars-desc",
													onChange: (event) => update({ minChars: event.target.value })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-jev-unit",
													children: "字"
												})
											]
										}), errors.minChars !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-err",
											id: "skp-jev-minchars-desc",
											role: "alert",
											children: errors.minChars
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-hint",
											id: "skp-jev-minchars-desc",
											children: COPY.minCharsHint
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "skp-jev-num-row",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													className: "skp-jev-label",
													htmlFor: "skp-jev-minedit",
													children: COPY.minEdit
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													id: "skp-jev-minedit",
													className: `${inputClass(errors.minEditChars !== void 0)} skp-jev-num`,
													type: "number",
													min: 1,
													max: 100,
													step: 1,
													value: form.minEditChars,
													disabled,
													"aria-invalid": errors.minEditChars !== void 0,
													"aria-describedby": "skp-jev-minedit-desc",
													onChange: (event) => update({ minEditChars: event.target.value })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-jev-unit",
													children: "字"
												})
											]
										}), errors.minEditChars !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-err",
											id: "skp-jev-minedit-desc",
											role: "alert",
											children: errors.minEditChars
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-hint",
											id: "skp-jev-minedit-desc",
											children: COPY.minEditHint
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-callout",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
												"草稿 ≥ ",
												parseIntStrict(form.minChars) ?? DEFAULT_MIN_CHARS,
												" 字符 · 修改 ≥",
												" ",
												parseIntStrict(form.minEditChars) ?? DEFAULT_MIN_EDIT_CHARS,
												" 字符 · 停顿",
												" ",
												parseIntStrict(form.pauseMs) ?? DEFAULT_PAUSE_MS,
												"ms"
											] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: COPY.cost }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: COPY.autoPrivacy })
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-test",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-test-actions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn",
											onClick: () => void handleTest(),
											disabled: disabled || test.kind === "running",
											children: test.kind === "running" ? COPY.testing : COPY.test
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-hint",
											children: COPY.testFormHint
										})]
									}),
									test.kind === "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "skp-jev-test-running",
										children: COPY.testRunning
									}),
									test.kind === "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-test-ok",
										role: "status",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												children: "✓"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
												"连接成功 · 模型 ",
												test.model,
												" · 耗时 ",
												test.latencyMs,
												" ms"
											] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-jev-hint",
												children: COPY.testFormSuffix
											})
										]
									}),
									test.kind === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-jev-test-err",
										role: "alert",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["连接失败：", test.text] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-link-btn",
											onClick: () => void handleTest(),
											children: COPY.retry
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-jev-hint",
										children: COPY.testFormSuffix
									})] })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-jev-actions-left",
									children: [
										resetConfirm ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn",
											disabled,
											onClick: handleReset,
											children: COPY.resetConfirm
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-link-btn",
											onClick: () => setResetConfirm(false),
											children: COPY.cancel
										})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn",
											disabled,
											onClick: handleReset,
											children: COPY.reset
										}),
										resetTip && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-hint",
											children: COPY.resetTip
										}),
										dirty && !resetTip && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-dirty",
											children: COPY.dirty
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-jev-actions-right",
									children: [
										savedNotice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-saved-note",
											role: "status",
											children: COPY.saveOk
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-jev-actions-note",
											children: COPY.saveScope
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: dirty ? "skp-btn skp-btn-primary" : "skp-btn",
											disabled,
											onClick: () => void handleSave(),
											children: saveState === "saving" ? COPY.saving : COPY.save
										})
									]
								})]
							}),
							saveErrors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-jev-error-bar",
								role: "alert",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [COPY.saveError, saveErrors.map((item) => shorten(item)).join("；")] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-link-btn",
									onClick: () => void handleSave(),
									children: COPY.retry
								})]
							})
						]
					})]
				})
			});
		}
		//#endregion
		//#region src/client/markdown.tsx
		/** 行内标记：`` `code` `` 与 `**bold**`（其余字符原样输出）。 */
		function renderInline(text, keyPrefix) {
			const nodes = [];
			const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
			let last = 0;
			let index = 0;
			for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
				if (match.index > last) nodes.push(text.slice(last, match.index));
				if (match[1] !== void 0) nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
					className: "skp-md-inline-code",
					children: match[1]
				}, `${keyPrefix}-c${index}`));
				else nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: match[2] }, `${keyPrefix}-b${index}`));
				last = match.index + match[0].length;
				index += 1;
			}
			if (last < text.length) nodes.push(text.slice(last));
			return nodes;
		}
		/** 段落内软换行：CJK 之间直接拼接，西文之间补一个空格（贴近 CommonMark 行为）。 */
		function joinSoft(a, b) {
			return /[\u3000-\u9fff\uff00-\uffef]$/.test(a) || /^[\u3000-\u9fff\uff00-\uffef]/.test(b) ? `${a}${b}` : `${a} ${b}`;
		}
		/** 围栏代码块起始行（``` 或 ~~~，允许首行缩进 ≤3 空格与语言后缀）。 */
		function fenceStart(line) {
			const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
			if (match === null) return void 0;
			return {
				marker: match[1][0].repeat(match[1].length),
				lang: match[2]
			};
		}
		/** 是否是一行的块级起始（用于段落收集时提前收口）。 */
		function isBlockStart(line) {
			return /^ {0,3}#{1,6}\s+/.test(line) || /^ {0,3}>/.test(line) || /^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(line) || /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) || fenceStart(line) !== void 0;
		}
		function headingLevel(hashes) {
			return Math.min(hashes.length, 3);
		}
		/**
		* 把 Markdown 原文解析为 React 元素树。
		*
		* 调用方负责兜底：本函数对任何输入都返回合法元素，但若未来出现解析缺陷，
		* `MarkdownPreview` 会捕获异常并显示 `<pre>` 原文。
		*/
		function renderMarkdown(source) {
			const lines = source.replace(/\r\n?/g, "\n").split("\n");
			const blocks = [];
			let i = 0;
			while (i < lines.length) {
				const line = lines[i];
				if (line.trim().length === 0) {
					i += 1;
					continue;
				}
				const fence = fenceStart(line);
				if (fence !== void 0) {
					const code = [];
					i += 1;
					while (i < lines.length) {
						const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
						if (closing !== null && closing[1][0] === fence.marker[0] && closing[1].length >= fence.marker.length) {
							i += 1;
							break;
						}
						code.push(lines[i]);
						i += 1;
					}
					blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "skp-md-pre",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: code.join("\n") })
					}, `pre-${blocks.length}`));
					continue;
				}
				const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
				if (heading !== null) {
					const level = headingLevel(heading[1]);
					const key = `h-${blocks.length}`;
					const content = renderInline(heading[2], key);
					if (level === 1) blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
						className: "skp-md-h1",
						children: content
					}, key));
					else if (level === 2) blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "skp-md-h2",
						children: content
					}, key));
					else blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "skp-md-h3",
						children: content
					}, key));
					i += 1;
					continue;
				}
				if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
					blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: "skp-md-hr" }, `hr-${blocks.length}`));
					i += 1;
					continue;
				}
				if (/^ {0,3}>/.test(line)) {
					const quoted = [];
					while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
						quoted.push(lines[i].replace(/^ {0,3}>\s?/, ""));
						i += 1;
					}
					blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
						className: "skp-md-quote",
						children: quoted.map((text, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: renderInline(text, `bq-${blocks.length}-${index}`) }, `bq-${blocks.length}-${index}`))
					}, `bq-${blocks.length}`));
					continue;
				}
				const unordered = /^ {0,3}[-*+]\s+(.*)$/.exec(line);
				const ordered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(line);
				if (unordered !== null || ordered !== null) {
					const isOrdered = ordered !== null;
					const items = [];
					while (i < lines.length) {
						const nextUnordered = /^ {0,3}[-*+]\s+(.*)$/.exec(lines[i]);
						const nextOrdered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(lines[i]);
						const match = isOrdered ? nextOrdered : nextUnordered;
						if (match === null) break;
						items.push(match[1]);
						i += 1;
					}
					const ListTag = isOrdered ? "ol" : "ul";
					blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ListTag, {
						className: isOrdered ? "skp-md-ol" : "skp-md-ul",
						children: items.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: renderInline(item, `li-${blocks.length}-${index}`) }, `li-${blocks.length}-${index}`))
					}, `list-${blocks.length}`));
					continue;
				}
				const paragraph = [line.trim()];
				i += 1;
				while (i < lines.length && lines[i].trim().length > 0 && !isBlockStart(lines[i])) {
					const previous = paragraph[paragraph.length - 1];
					paragraph[paragraph.length - 1] = joinSoft(previous, lines[i].trim());
					i += 1;
				}
				blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "skp-md-p",
					children: renderInline(paragraph.join("\n"), `p-${blocks.length}`)
				}, `p-${blocks.length}`));
			}
			return blocks;
		}
		/** 裁掉 YAML frontmatter（预览用；「源码」视图仍显示完整原文）。 */
		function stripFrontmatter(source) {
			return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
		}
		/**
		* 预览组件：正常时渲染 Markdown 元素树；渲染器抛错时回落到 `<pre>` 原文
		* 并提示（见 UX §5.9 的降级判定）。
		*/
		function MarkdownPreview({ source }) {
			try {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-md",
					children: renderMarkdown(source)
				});
			} catch {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-md skp-md-fallback",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "skp-md-warn",
						children: "Markdown 渲染失败，已显示原文"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: "skp-md-pre",
						children: source
					})]
				});
			}
		}
		//#endregion
		//#region src/client/zip.ts
		/** base64 → 字节（浏览器 atob；分块避免参数过长）。 */
		function base64ToBytes(base64) {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
			return bytes;
		}
		/** 把若干条目打成 store-only ZIP，返回整个归档的字节。 */
		function buildZip(entries) {
			const encoder = new TextEncoder();
			const chunks = [];
			const central = [];
			let offset = 0;
			for (const entry of entries) {
				const nameBytes = encoder.encode(entry.name);
				const crc = crc32(entry.data);
				const { dosTime, dosDate } = dosDateTime(/* @__PURE__ */ new Date());
				const local = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(30));
				local.setUint32(0, 67324752, true);
				local.setUint16(4, 20, true);
				local.setUint16(6, 2048, true);
				local.setUint16(8, 0, true);
				local.setUint16(10, dosTime, true);
				local.setUint16(12, dosDate, true);
				local.setUint32(14, crc, true);
				local.setUint32(18, entry.data.length, true);
				local.setUint32(22, entry.data.length, true);
				local.setUint16(26, nameBytes.length, true);
				local.setUint16(28, 0, true);
				chunks.push(new Uint8Array(local.buffer), nameBytes, entry.data);
				const record = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(46));
				record.setUint32(0, 33639248, true);
				record.setUint16(4, 20, true);
				record.setUint16(6, 20, true);
				record.setUint16(8, 2048, true);
				record.setUint16(10, 0, true);
				record.setUint16(12, dosTime, true);
				record.setUint16(14, dosDate, true);
				record.setUint32(16, crc, true);
				record.setUint32(20, entry.data.length, true);
				record.setUint32(24, entry.data.length, true);
				record.setUint16(28, nameBytes.length, true);
				record.setUint32(42, offset, true);
				central.push(new Uint8Array(record.buffer), nameBytes);
				offset += 30 + nameBytes.length + entry.data.length;
			}
			const centralStart = offset;
			let centralSize = 0;
			for (const chunk of central) centralSize += chunk.length;
			const eocd = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(22));
			eocd.setUint32(0, 101010256, true);
			eocd.setUint16(8, entries.length, true);
			eocd.setUint16(10, entries.length, true);
			eocd.setUint32(12, centralSize, true);
			eocd.setUint32(16, centralStart, true);
			const total = centralStart + centralSize + 22;
			const out = new Uint8Array(total);
			let cursor = 0;
			for (const chunk of [
				...chunks,
				...central,
				new Uint8Array(eocd.buffer)
			]) {
				out.set(chunk, cursor);
				cursor += chunk.length;
			}
			return out;
		}
		/** 触发一次浏览器下载（Blob → objectURL → 临时 <a> 点击 → 回收）。 */
		function downloadBytes(filename, data, mime = "application/octet-stream") {
			const blob = new Blob([data], { type: mime });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 1e3);
		}
		/** CRC-32（ZIP 必需；查表法，表懒初始化一次）。 */
		let crcTable;
		function crc32(data) {
			if (crcTable === void 0) {
				crcTable = /* @__PURE__ */ new Uint32Array(256);
				for (let n = 0; n < 256; n += 1) {
					let c = n;
					for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
					crcTable[n] = c >>> 0;
				}
			}
			let crc = 4294967295;
			for (let i = 0; i < data.length; i += 1) crc = (crcTable[(crc ^ data[i]) & 255] ^ crc >>> 8) >>> 0;
			return (crc ^ 4294967295) >>> 0;
		}
		/** Date → DOS 时间/日期字段（ZIP 头部格式；月/年越界时钳位）。 */
		function dosDateTime(date) {
			const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
			return {
				dosTime: date.getHours() << 11 | date.getMinutes() << 5 | Math.floor(date.getSeconds() / 2),
				dosDate: (year - 1980 & 127) << 9 | date.getMonth() + 1 << 5 | date.getDate()
			};
		}
		//#endregion
		//#region src/client/skill-content.tsx
		/**
		* 技能详情的「文件 + 阅读器」内容区（本版新增）。
		*
		* 数据来源：现有 `skills.export` RPC（`exportFiles`）——它已递归返回技能目录
		* 下全部普通文件的相对路径 + base64 内容，因此**宿主不新增 RPC**：
		*   - 打开技能时拉一次全量清单 → base64 解码 → 前端建树；切换文件 0 请求；
		*   - `SKILL.md` 恒置顶并默认选中；flat 格式（单 `.md`）隐藏文件树、阅读器占满；
		*   - 目录 200 文件、树深 3 层硬上限；单文件预览 256 KB 截断；
		*   - 二进制 / 非 UTF-8 不渲染正文，显示类型 + 大小 + 下载；空文件给提示。
		*
		* 预览走零依赖的 `markdown.tsx`（L1，React 元素树，无
		* `dangerouslySetInnerHTML`）；解析器异常时回落到 `<pre>` 原文。
		*
		* 窄容器降级（按内容区实测宽度，见 UX §4.5）：≥732 文件树 220；632–731
		* 文件树 200；<632 折叠为「文件 (N)」下拉，阅读器占满。
		*
		* @module dsh-capability-settings/client/skill-content
		*/
		/** 目录最多展示的文件数（超出只保留排序后前 200）。 */
		const MAX_FILES = 200;
		/** 树最多 3 层（相对技能根目录）。 */
		const MAX_DEPTH = 3;
		/** 单文件预览上限（字节）。 */
		const MAX_PREVIEW_BYTES = 262144;
		/** 文件树常驻宽度：基准 220，1000–1099 档 200。 */
		const TREE_WIDTH_WIDE = 220;
		const TREE_WIDTH_MEDIUM = 200;
		/** 内容区宽度低于该值时文件树折叠为下拉（≈主区 <1000，见 UX §4.5）。 */
		const TREE_COLLAPSE_WIDTH = 632;
		/** 文件树保持 220 宽所需的内容区宽度（≈主区 ≥1100）。 */
		const TREE_WIDE_WIDTH = 732;
		/** 组装一行的寻址入参：优先用宿主给的受管根；root 缺失时按 source 退化。 */
		function skillRefOf(summary) {
			return summary.root !== void 0 ? {
				name: summary.name,
				root: summary.root
			} : summary.source === "project-dsh" ? {
				name: summary.name,
				scope: "project",
				target: ".dsh"
			} : summary.source === "project-agents" ? {
				name: summary.name,
				scope: "project",
				target: ".agents"
			} : {
				name: summary.name,
				scope: "global"
			};
		}
		/** 字节数 → 人类可读大小（1 位小数，去掉多余的 .0）。 */
		function formatSize(bytes) {
			if (bytes < 1024) return `${bytes} B`;
			const kb = bytes / 1024;
			if (kb < 1024) return `${trimZero(kb.toFixed(1))} KB`;
			return `${trimZero((kb / 1024).toFixed(1))} MB`;
		}
		function trimZero(text) {
			return text.endsWith(".0") ? text.slice(0, -2) : text;
		}
		/** 路径后缀 → 类型徽标（MD / JSON / PNG…；无后缀显示 FILE）。 */
		function fileTypeLabel(path) {
			const base = path.slice(path.lastIndexOf("/") + 1);
			const dot = base.lastIndexOf(".");
			if (dot <= 0 || dot === base.length - 1) return "FILE";
			return base.slice(dot + 1).toUpperCase().slice(0, 4);
		}
		function basename(path) {
			return path.slice(path.lastIndexOf("/") + 1);
		}
		/** 隐藏文件（以 `.` 开头的段）与导出里可能出现的空路径不展示。 */
		function isHiddenPath(path) {
			return path.split("/").some((segment) => segment.startsWith("."));
		}
		function pathDepth(path) {
			return path.split("/").length;
		}
		/** 文本解码：含 NUL 或非 UTF-8 视为二进制；超上限按字符边界截断。 */
		function decodeFile(path, base64) {
			const bytes = base64ToBytes(base64);
			const size = bytes.length;
			if (bytes.includes(0)) return {
				path,
				bytes,
				size,
				binary: true,
				text: "",
				truncated: false
			};
			const decoder = new TextDecoder("utf-8", { fatal: true });
			let full;
			try {
				full = decoder.decode(bytes);
			} catch {
				return {
					path,
					bytes,
					size,
					binary: true,
					text: "",
					truncated: false
				};
			}
			if (size <= MAX_PREVIEW_BYTES) return {
				path,
				bytes,
				size,
				binary: false,
				text: full,
				truncated: false
			};
			let end = MAX_PREVIEW_BYTES;
			while (end > 0 && (bytes[end] & 192) === 128) end -= 1;
			return {
				path,
				bytes,
				size,
				binary: false,
				text: new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, end)),
				truncated: true
			};
		}
		/** 文件排序：SKILL.md 恒第一；其余按深度、再按名称（不区分大小写）。 */
		function sortFiles(files) {
			const skill = files.find((file) => file.path === "SKILL.md");
			const rest = files.filter((file) => file.path !== "SKILL.md");
			rest.sort((a, b) => {
				const depth = pathDepth(a.path) - pathDepth(b.path);
				if (depth !== 0) return depth;
				return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
			});
			return skill === void 0 ? rest : [skill, ...rest];
		}
		/** 文本 → SkillFile（注入技能正文：没有 base64 往返）。 */
		function textFile(path, text, truncated = false) {
			const bytes = new TextEncoder().encode(text);
			return {
				path,
				bytes,
				size: bytes.length,
				binary: false,
				text,
				truncated,
				lazyState: "done"
			};
		}
		/** 注入行资源条目：没有扩展名 ⇒ 视作目录（registry 只列一层条目名）。 */
		function looksLikeDirectory(name) {
			return !name.includes(".");
		}
		/** 注入行的空占位文件（正文按需通过 `skills.readResource` 读取）。 */
		function lazyFile(path) {
			return {
				path,
				bytes: /* @__PURE__ */ new Uint8Array(),
				size: 0,
				binary: false,
				text: "",
				truncated: false,
				lazyState: "idle"
			};
		}
		/** 以文件清单构建树（目录由路径前缀推导；同层 SKILL.md → 目录 → 文件 → 名称）。 */
		function buildTree(files, rootName, extraDirs = []) {
			const root = {
				name: rootName,
				path: "",
				kind: "root",
				depth: 0,
				children: []
			};
			for (const file of files) {
				const segments = file.path.split("/");
				let parent = root;
				segments.forEach((segment, index) => {
					const isLeaf = index === segments.length - 1;
					const path = segments.slice(0, index + 1).join("/");
					parent.children ??= [];
					let node = parent.children.find((child) => child.path === path);
					if (node === void 0) {
						node = isLeaf ? {
							name: segment,
							path,
							kind: "file",
							depth: index + 1,
							file
						} : {
							name: segment,
							path,
							kind: "dir",
							depth: index + 1,
							children: []
						};
						parent.children.push(node);
					}
					parent = node;
				});
			}
			for (const dir of extraDirs) {
				const segments = dir.split("/");
				let parent = root;
				segments.forEach((segment, index) => {
					const path = segments.slice(0, index + 1).join("/");
					parent.children ??= [];
					let node = parent.children.find((child) => child.path === path);
					if (node === void 0) {
						node = {
							name: segment,
							path,
							kind: "dir",
							depth: index + 1,
							children: []
						};
						parent.children.push(node);
					}
					parent = node;
				});
			}
			sortTree(root);
			countTree(root);
			return root;
		}
		function sortTree(node) {
			if (node.children === void 0) return;
			node.children.sort((a, b) => {
				if (a.kind === "file" && a.name === "SKILL.md") return -1;
				if (b.kind === "file" && b.name === "SKILL.md") return 1;
				if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
				return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
			});
			for (const child of node.children) sortTree(child);
		}
		function countTree(node) {
			if (node.kind === "file") return 1;
			let total = 0;
			for (const child of node.children ?? []) total += countTree(child);
			node.count = total;
			return total;
		}
		/** 扁平成「根 / 目录 / 文件」行；折叠目录的子树不展开。 */
		function flattenTree(root, collapsed) {
			const rows = [];
			const visit = (node, depth) => {
				rows.push({
					node,
					depth
				});
				if (node.kind === "file" || collapsed.has(node.path)) return;
				for (const child of node.children ?? []) visit(child, depth + 1);
			};
			visit(root, 0);
			return rows;
		}
		/** 单个文件的「下载」：复用导出时拿到的字节，不再发请求。 */
		function downloadFile(file) {
			const type = fileTypeLabel(file.path);
			const mime = type === "MD" ? "text/markdown" : type === "JSON" ? "application/json" : type === "PNG" ? "image/png" : "application/octet-stream";
			downloadBytes(basename(file.path), file.bytes, mime);
		}
		/**
		* 内容区组件：文件树 + 阅读器。
		*
		* `refreshKey` 变化（父级的写操作版本号）时丢弃已拉取清单并重拉——写操作
		* 可能改变目录内容（导入 / 删除），因此不做「切文件不请求」之外的缓存。
		*/
		function SkillContent({ summary, api, refreshKey }) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const [selectedPath, setSelectedPath] = (0, react.useState)(void 0);
			const [view, setView] = (0, react.useState)("preview");
			const [copied, setCopied] = (0, react.useState)(false);
			const [collapsed, setCollapsed] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [activeIndex, setActiveIndex] = (0, react.useState)(0);
			/** 重试计数：失败态点「重试」时自增，触发重新拉取。 */
			const [retry, setRetry] = (0, react.useState)(0);
			const [contentWidth, setContentWidth] = (0, react.useState)(TREE_WIDE_WIDTH);
			const contentRef = (0, react.useRef)(null);
			const treeRef = (0, react.useRef)(null);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const resetVersion = (0, react.useRef)(0);
			/** 拉取并解码整份文件清单（只在挂载 / 切技能 / 写操作后执行）。 */
			(0, react.useEffect)(() => {
				const version = ++resetVersion.current;
				let alive = true;
				setState({ status: "loading" });
				setSelectedPath(void 0);
				setCollapsed(/* @__PURE__ */ new Set());
				setView("preview");
				if (summary.injected === true) {
					api.read(summary.name, skillRefOf(summary)).then((detail) => {
						if (!alive || version !== resetVersion.current) return;
						if (detail === void 0) {
							setState({
								status: "error",
								message: `无法读取 Skills 「${summary.name}」：它可能已被插件卸载，或需要先在会话中激活所属预设。`
							});
							return;
						}
						const files = [textFile("SKILL.md", detail.body)];
						const dirs = [];
						for (const resource of detail.resources) {
							if (isHiddenPath(resource)) continue;
							if (looksLikeDirectory(resource)) {
								dirs.push(resource);
								continue;
							}
							files.push(lazyFile(resource));
						}
						const root = buildTree(files, summary.name, dirs);
						setState({
							status: "ready",
							files,
							root,
							dirs,
							...detail.resourceBaseNote !== void 0 ? { note: detail.resourceBaseNote } : {},
							totalCount: files.length + dirs.length,
							shownCount: files.length + dirs.length,
							hiddenCount: 0,
							deeperCount: 0,
							overLimitCount: 0
						});
						setSelectedPath("SKILL.md");
						const index = flattenTree(root, /* @__PURE__ */ new Set()).findIndex((row) => row.node.path === "SKILL.md");
						setActiveIndex(index >= 0 ? index : 0);
					}).catch((error) => {
						if (!alive || version !== resetVersion.current) return;
						setState({
							status: "error",
							message: String(error)
						});
					});
					return () => {
						alive = false;
					};
				}
				api.exportFiles(skillRefOf(summary)).then((result) => {
					if (!alive || version !== resetVersion.current) return;
					if (!result.ok) {
						setState({
							status: "error",
							message: result.errors.join("; ")
						});
						return;
					}
					const hidden = result.files.filter((file) => isHiddenPath(file.path)).length;
					const visible = result.files.filter((file) => !isHiddenPath(file.path));
					const deep = visible.filter((file) => pathDepth(file.path) > MAX_DEPTH).length;
					const ordered = sortFiles(visible.filter((file) => pathDepth(file.path) <= MAX_DEPTH));
					const overLimit = Math.max(0, ordered.length - MAX_FILES);
					const shown = ordered.slice(0, MAX_FILES).map((file) => decodeFile(file.path, file.content));
					const root = buildTree(shown, summary.name);
					const defaultFile = shown.find((file) => file.path === "SKILL.md") ?? shown[0];
					setState({
						status: "ready",
						files: shown,
						root,
						dirs: [],
						totalCount: result.files.length,
						shownCount: shown.length,
						hiddenCount: hidden,
						deeperCount: deep,
						overLimitCount: overLimit
					});
					setSelectedPath(defaultFile?.path);
					if (defaultFile !== void 0) {
						const index = flattenTree(root, /* @__PURE__ */ new Set()).findIndex((row) => row.node.path === defaultFile.path);
						setActiveIndex(index >= 0 ? index : 0);
					}
				}).catch((error) => {
					if (!alive || version !== resetVersion.current) return;
					setState({
						status: "error",
						message: String(error)
					});
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				summary.name,
				summary.root,
				summary.source,
				summary.injected,
				refreshKey,
				retry
			]);
			/** 监听内容区宽度，决定文件树宽度与是否折叠为下拉（UX §4.5）。 */
			(0, react.useEffect)(() => {
				const element = contentRef.current;
				if (element === null) return;
				const update = (width) => {
					if (width > 0) setContentWidth(width);
				};
				update(element.getBoundingClientRect().width);
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver((entries) => {
					const entry = entries[0];
					if (entry !== void 0) update(entry.contentRect.width);
				});
				observer.observe(element);
				return () => observer.disconnect();
			}, []);
			const rows = (0, react.useMemo)(() => state.status === "ready" ? flattenTree(state.root, collapsed) : [], [state, collapsed]);
			const selectedFile = (0, react.useMemo)(() => {
				if (state.status !== "ready" || selectedPath === void 0) return void 0;
				return state.files.find((file) => file.path === selectedPath);
			}, [state, selectedPath]);
			/** 就地更新一个文件对象（重建 root，保持树节点指向最新数据）。 */
			const patchFile = (path, patch) => {
				setState((previous) => {
					if (previous.status !== "ready") return previous;
					const files = previous.files.map((file) => file.path === path ? {
						...file,
						...patch
					} : file);
					return {
						...previous,
						files,
						root: buildTree(files, summary.name, previous.dirs)
					};
				});
			};
			/**
			* 注入行资源文件的懒加载：选中文件时按需 `skills.readResource`，避免打开
			* 详情就拉取整目录。（宿主限制路径边界：`..` / 绝对路径 / 符号链接 / 超
			* 256 KiB 都返回业务失败，这里原样展示原因。）
			*/
			(0, react.useEffect)(() => {
				if (summary.injected !== true || state.status !== "ready" || selectedPath === void 0) return;
				const file = state.files.find((item) => item.path === selectedPath);
				if (file === void 0 || file.lazyState !== "idle") return;
				let alive = true;
				patchFile(file.path, { lazyState: "loading" });
				api.readResource({
					name: summary.name,
					path: file.path
				}).then((result) => {
					if (!alive) return;
					if (!result.ok) {
						patchFile(file.path, {
							lazyState: "error",
							lazyError: result.errors.join("; ")
						});
						return;
					}
					const bytes = new TextEncoder().encode(result.content);
					patchFile(file.path, {
						lazyState: "done",
						text: result.content,
						bytes,
						size: result.size > 0 ? result.size : bytes.length,
						binary: result.content.includes("\0"),
						truncated: result.truncated
					});
				}).catch((error) => {
					if (!alive) return;
					patchFile(file.path, {
						lazyState: "error",
						lazyError: String(error)
					});
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				selectedPath,
				state,
				summary.injected,
				summary.name
			]);
			const showTree = summary.format !== "flat";
			const treeCollapsed = showTree && contentWidth < TREE_COLLAPSE_WIDTH;
			const treeWidth = contentWidth >= TREE_WIDE_WIDTH ? TREE_WIDTH_WIDE : TREE_WIDTH_MEDIUM;
			const toggleDir = (node) => {
				if (node.kind === "file" || node.kind === "root") return;
				setCollapsed((previous) => {
					const next = new Set(previous);
					if (next.has(node.path)) next.delete(node.path);
					else next.add(node.path);
					return next;
				});
			};
			const focusRow = (index) => {
				const row = rows[index];
				if (row === void 0) return;
				setActiveIndex(index);
				requestAnimationFrame(() => rowRefs.current.get(row.node.path)?.scrollIntoView({ block: "nearest" }));
			};
			const onTreeKeyDown = (event) => {
				if (rows.length === 0) return;
				const current = rows[activeIndex];
				if (event.key === "ArrowDown") {
					event.preventDefault();
					focusRow(Math.min(rows.length - 1, activeIndex + 1));
					return;
				}
				if (event.key === "ArrowUp") {
					event.preventDefault();
					focusRow(Math.max(0, activeIndex - 1));
					return;
				}
				if (event.key === "ArrowRight" && current !== void 0) {
					event.preventDefault();
					if (current.node.kind !== "file") {
						if (collapsed.has(current.node.path)) toggleDir(current.node);
						else if (current.node.children !== void 0) focusRow(Math.min(rows.length - 1, activeIndex + 1));
					}
					return;
				}
				if (event.key === "ArrowLeft" && current !== void 0) {
					event.preventDefault();
					if (current.node.kind !== "file" && !collapsed.has(current.node.path) && current.node.kind === "dir") {
						toggleDir(current.node);
						return;
					}
					const parentPath = current.node.path.slice(0, current.node.path.lastIndexOf("/"));
					const parentIndex = rows.findIndex((row) => row.node.path === parentPath);
					if (parentIndex >= 0) focusRow(parentIndex);
					return;
				}
				if (event.key === "Enter" && current !== void 0) {
					event.preventDefault();
					if (current.node.kind === "file") setSelectedPath(current.node.path);
					else toggleDir(current.node);
				}
			};
			const copySelected = async () => {
				if (selectedFile === void 0 || selectedFile.binary) return;
				try {
					await navigator.clipboard?.writeText(selectedFile.text);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				} catch {}
			};
			const selectFile = (path) => {
				setSelectedPath(path);
				setView("preview");
				const index = rows.findIndex((row) => row.node.path === path);
				if (index >= 0) setActiveIndex(index);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: treeCollapsed ? "skp-skill-content skp-skill-content-collapsed" : "skp-skill-content",
				ref: contentRef,
				children: [
					showTree && !treeCollapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-file-tree",
						role: "tree",
						"aria-label": "Skills 文件",
						tabIndex: 0,
						ref: treeRef,
						style: { width: treeWidth },
						onKeyDown: onTreeKeyDown,
						onFocus: () => {
							if (rows.length > 0) focusRow(activeIndex);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-file-tree-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-file-tree-title",
								children: "Skills 文件"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-group-count",
								title: state.status === "ready" ? `${state.totalCount} 个文件中显示 ${state.shownCount} 个${state.hiddenCount > 0 ? `（隐藏 ${state.hiddenCount}）` : ""}${state.deeperCount > 0 ? `，${state.deeperCount} 个超出 3 层未显示` : ""}` : void 0,
								children: state.status === "ready" && state.overLimitCount > 0 ? `${state.shownCount}+` : state.status === "ready" ? state.shownCount : "—"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-file-tree-scroll",
							children: [
								state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileTreeSkeleton, {}),
								state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-file-tree-error",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "文件列表读取失败" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "skp-link-btn",
										onClick: () => setRetry((value) => value + 1),
										children: "重试"
									})]
								}),
								state.status === "ready" && rows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-file-tree-empty",
									children: "目录中没有可显示的文件"
								}),
								state.status === "ready" && rows.map(({ node, depth }, index) => {
									if (node.kind === "root") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										id: "skp-tree-root",
										role: "treeitem",
										"aria-expanded": "true",
										"aria-level": 1,
										className: "skp-tree-row skp-tree-root",
										style: { paddingLeft: 12 + depth * 14 },
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-tree-chevron",
												children: "▾"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "skp-tree-name",
												children: [node.name, "/"]
											}),
											node.count !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-tree-count",
												children: node.count
											})
										]
									}, "__root__");
									const isFile = node.kind === "file";
									const isCollapsed = collapsed.has(node.path);
									const selected = isFile && node.path === selectedPath;
									const active = index === activeIndex;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										id: `skp-tree-${node.path.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
										role: "treeitem",
										"aria-selected": isFile ? selected : void 0,
										"aria-expanded": isFile ? void 0 : !isCollapsed,
										"aria-level": depth + 1,
										className: [
											"skp-tree-row",
											isFile ? "skp-tree-file" : "skp-tree-dir",
											selected ? "skp-tree-row-active" : "",
											active ? "skp-tree-row-focus" : ""
										].filter(Boolean).join(" "),
										style: { paddingLeft: 12 + depth * 14 },
										ref: (element) => {
											if (element === null) rowRefs.current.delete(node.path);
											else rowRefs.current.set(node.path, element);
										},
										onClick: () => isFile ? selectFile(node.path) : toggleDir(node),
										children: [
											!isFile && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-tree-chevron",
												"aria-hidden": "true",
												children: isCollapsed ? "▸" : "▾"
											}),
											!isFile && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "skp-tree-name",
												children: [node.name, "/"]
											}), (node.count ?? 0) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-tree-count",
												children: node.count
											})] }),
											isFile && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-tree-badge",
													children: fileTypeLabel(node.path)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-tree-name",
													children: node.name
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-tree-size",
													children: node.file?.lazyState === "idle" || node.file?.lazyState === "loading" ? "按需" : formatSize(node.file?.size ?? 0)
												})
											] })
										]
									}, node.path);
								}),
								state.status === "ready" && state.deeperCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-tree-note",
									children: [
										"…（",
										state.deeperCount,
										" 个更深层文件未显示）"
									]
								}),
								state.status === "ready" && state.note !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-tree-note",
									children: state.note
								})
							]
						})]
					}),
					showTree && treeCollapsed && state.status === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-file-picker",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-file-picker-label",
							children: [
								"文件 (",
								state.shownCount,
								")"
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
							className: "skp-file-picker-dd",
							value: selectedPath ?? "",
							ariaLabel: "选择 Skills 文件",
							options: state.files.map((file) => ({
								value: file.path,
								label: file.path,
								hint: formatSize(file.size)
							})),
							onChange: selectFile
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-reader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-reader-head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-reader-name",
									title: selectedFile?.path,
									children: selectedFile === void 0 ? "文件" : basename(selectedFile.path)
								}),
								selectedFile !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-reader-meta",
									children: selectedFile.lazyState === "idle" || selectedFile.lazyState === "loading" ? "按需读取" : `${formatSize(selectedFile.size)} · ${fileTypeLabel(selectedFile.path)}`
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-reader-seg",
									role: "group",
									"aria-label": "内容视图",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: view === "preview" ? "skp-reader-seg-btn skp-reader-seg-active" : "skp-reader-seg-btn",
										"aria-pressed": view === "preview",
										onClick: () => setView("preview"),
										children: "预览"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: view === "source" ? "skp-reader-seg-btn skp-reader-seg-active" : "skp-reader-seg-btn",
										"aria-pressed": view === "source",
										onClick: () => setView("source"),
										children: "源码"
									})]
								}),
								selectedFile !== void 0 && !selectedFile.binary && (selectedFile.lazyState === void 0 || selectedFile.lazyState === "done") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-link-btn skp-reader-copy",
									onClick: () => void copySelected(),
									children: copied ? "已复制" : "复制全文"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-reader-body",
							tabIndex: 0,
							"aria-label": selectedFile === void 0 ? "文件内容" : `${basename(selectedFile.path)} 内容`,
							children: [
								state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReaderSkeleton, {}),
								state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-reader-state",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "skp-reader-error",
										children: ["文件列表读取失败：", state.message]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "skp-link-btn",
										onClick: () => setRetry((value) => value + 1),
										children: "重试"
									})]
								}),
								state.status === "ready" && selectedFile === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-reader-state skp-reader-state-muted",
									children: "此 Skills 没有可预览的文件"
								}),
								state.status === "ready" && selectedFile !== void 0 && selectedFile.lazyState === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReaderSkeleton, {}),
								state.status === "ready" && selectedFile !== void 0 && selectedFile.lazyState === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-reader-state",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "skp-reader-error",
										children: ["资源读取失败：", selectedFile.lazyError ?? "未知错误"]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "skp-link-btn",
										onClick: () => patchFile(selectedFile.path, {
											lazyState: "idle",
											lazyError: void 0
										}),
										children: "重试"
									})]
								}),
								state.status === "ready" && selectedFile !== void 0 && (selectedFile.lazyState === void 0 || selectedFile.lazyState === "done") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReaderContent, {
									file: selectedFile,
									view
								}, selectedFile.path)
							]
						})]
					})
				]
			});
		}
		/** 阅读器正文：文本（预览/源码）、二进制、空文件、截断条。 */
		function ReaderContent({ file, view }) {
			if (file.binary) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-reader-state skp-reader-binary",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-reader-badge",
						children: fileTypeLabel(file.path)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "skp-reader-binary-title",
						children: "二进制文件，无法预览"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "skp-reader-state-muted",
						children: ["大小 ", formatSize(file.size)]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn",
						onClick: () => downloadFile(file),
						children: "下载此文件"
					})
				]
			});
			if (file.text.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-reader-state skp-reader-state-muted",
				children: "此文件为空"
			});
			const isMarkdown = fileTypeLabel(file.path) === "MD";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [view === "preview" && isMarkdown ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownPreview, { source: stripFrontmatter(file.text) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: "skp-reader-text",
				children: file.text
			}), file.truncated && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-reader-truncated",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "已截断，仅显示前 256 KB" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "skp-link-btn",
					onClick: () => downloadFile(file),
					children: "下载完整文件"
				})]
			})] });
		}
		function FileTreeSkeleton() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-skeleton-tree",
				"aria-hidden": "true",
				children: [
					80,
					65,
					90,
					55,
					70
				].map((width, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-skeleton-line",
					style: { width: `${width}%` }
				}, index))
			});
		}
		function ReaderSkeleton() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-skeleton-reader",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-skeleton-line",
						style: {
							width: "62%",
							height: 14
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-skeleton-line",
						style: {
							width: "86%",
							height: 14
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-skeleton-line",
						style: {
							width: "100%",
							height: 120
						}
					})
				]
			});
		}
		//#endregion
		//#region src/shared/skill-locate.ts
		/**
		* 在相对路径列表中定位 skill 根。路径约定为 posix 风格（`/` 分隔）、
		* 不含 `./` 或 `..` 段（调用方在解压/收集时已规范化）。
		*/
		function locateSkillRoot(paths) {
			const skillFiles = paths.filter((p) => p === "SKILL.md" || p.endsWith("/SKILL.md"));
			if (skillFiles.length > 0) {
				const depth = (p) => p.split("/").length;
				const minDepth = Math.min(...skillFiles.map(depth));
				const shallowest = skillFiles.filter((p) => depth(p) === minDepth);
				if (shallowest.length > 1) return {
					ok: false,
					error: `archive contains multiple skills (${shallowest.map((p) => p.slice(0, -9) || ".").join(", ")}) — pick one or use a subfolder URL`
				};
				const skillFile = shallowest[0];
				return {
					ok: true,
					root: {
						baseDir: skillFile === "SKILL.md" ? "" : skillFile.slice(0, -9),
						kind: "directory"
					}
				};
			}
			const flatCandidates = paths.filter((p) => !p.includes("/") && p.endsWith(".md"));
			if (flatCandidates.length === 1) return {
				ok: true,
				root: {
					baseDir: "",
					kind: "flat"
				}
			};
			if (flatCandidates.length > 1) return {
				ok: false,
				error: `archive has multiple top-level .md files (${flatCandidates.join(", ")}) and no SKILL.md`
			};
			return {
				ok: false,
				error: "no SKILL.md or top-level .md found in archive"
			};
		}
		/**
		* 若所有路径共享同一个首段（zipball 典型的 `<owner>-<repo>-<sha>/` 顶层
		* 文件夹），返回剥掉该首段后的路径列表；否则原样返回。
		*/
		function stripCommonTopFolder(paths) {
			if (paths.length === 0) return paths;
			const firstSegment = paths[0].split("/")[0];
			if (!paths.every((p) => p.includes("/") && p.split("/")[0] === firstSegment)) return paths;
			return paths.map((p) => p.slice(firstSegment.length + 1));
		}
		/**
		* 按定位结果把一组文件裁剪并重定根：只保留 skill 根下的文件，路径改写为
		* 相对 skill 根。flat 布局只保留那个 .md 文件本身。
		*/
		function rerootEntries(entries, root) {
			if (root.kind === "flat") return entries.filter((e) => !e.path.includes("/") && e.path.endsWith(".md"));
			const prefix = root.baseDir === "" ? "" : `${root.baseDir}/`;
			return entries.filter((e) => prefix === "" || e.path.startsWith(prefix)).map((e) => ({
				...e,
				path: prefix === "" ? e.path : e.path.slice(prefix.length)
			}));
		}
		//#endregion
		//#region src/client/unzip.ts
		const EOCD_SIGNATURE = 101010256;
		const CENTRAL_SIGNATURE = 33639248;
		const LOCAL_SIGNATURE = 67324752;
		const EOCD_SEARCH_WINDOW = 65557;
		/** 解压输出的累计上限（zip bomb：高压缩比输入可膨胀数 GB 进浏览器内存）。 */
		const MAX_EXTRACT_BYTES = 67108864;
		/** 解压整个 zip；目录条目跳过，不支持的条目抛错。 */
		async function unzip(archive) {
			if (typeof DecompressionStream === "undefined") throw new Error("this browser does not support zip extraction (DecompressionStream unavailable)");
			const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
			const decoder = new TextDecoder("utf-8");
			const eocdOffset = findEocd(view);
			const entryCount = view.getUint16(eocdOffset + 10, true);
			let centralOffset = view.getUint32(eocdOffset + 16, true);
			const entries = [];
			let totalBytes = 0;
			for (let i = 0; i < entryCount; i += 1) {
				if (view.getUint32(centralOffset, true) !== CENTRAL_SIGNATURE) throw new Error(`corrupt zip: bad central directory record #${i}`);
				const flags = view.getUint16(centralOffset + 8, true);
				const method = view.getUint16(centralOffset + 10, true);
				const compressedSize = view.getUint32(centralOffset + 20, true);
				const nameLength = view.getUint16(centralOffset + 28, true);
				const extraLength = view.getUint16(centralOffset + 30, true);
				const commentLength = view.getUint16(centralOffset + 32, true);
				const localOffset = view.getUint32(centralOffset + 42, true);
				const name = decoder.decode(archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength)).split("\\").join("/");
				centralOffset += 46 + nameLength + extraLength + commentLength;
				if (name.endsWith("/")) continue;
				if ((flags & 1) !== 0) throw new Error(`encrypted zip entries are not supported ("${name}")`);
				if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error(`corrupt zip: bad local header for "${name}"`);
				const localNameLength = view.getUint16(localOffset + 26, true);
				const localExtraLength = view.getUint16(localOffset + 28, true);
				const dataStart = localOffset + 30 + localNameLength + localExtraLength;
				if (compressedSize > view.byteLength - dataStart) throw new Error(`corrupt zip: data overruns archive for "${name}"`);
				const compressed = archive.subarray(dataStart, dataStart + compressedSize);
				let data;
				if (method === 0) {
					if (totalBytes + compressedSize > MAX_EXTRACT_BYTES) throw new Error(`extracted data exceeds ${MAX_EXTRACT_BYTES} bytes (zip bomb?)`);
					data = compressed.slice();
				} else if (method === 8) data = await readWithLimit(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")), MAX_EXTRACT_BYTES - totalBytes, name);
				else throw new Error(`unsupported zip compression method ${method} ("${name}")`);
				totalBytes += data.byteLength;
				entries.push({
					path: name,
					data
				});
			}
			return entries;
		}
		/** 流式读取解压输出，累计超限即以明确文案拒绝（配合上面的上限分摊）。 */
		async function readWithLimit(stream, limit, name) {
			const reader = stream.getReader();
			const chunks = [];
			let total = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > limit) {
					await reader.cancel().catch(() => void 0);
					throw new Error(`extracted data for "${name}" exceeds the zip extract limit`);
				}
				chunks.push(value);
			}
			const out = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				out.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return out;
		}
		/** 从尾部窗口倒扫 EOCD 签名；找不到即不是（或已损坏的）zip。 */
		function findEocd(view) {
			if (view.byteLength < 22) throw new Error("not a zip archive (too short)");
			const windowStart = Math.max(0, view.byteLength - EOCD_SEARCH_WINDOW);
			for (let offset = view.byteLength - 22; offset >= windowStart; offset -= 1) if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
			throw new Error("not a zip archive (end of central directory not found)");
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* Capability Panel 的 React 视图（占据**主区域**的页面，不再是浮层）。
		*
		* 入口在**侧栏上方**：本插件向 `sidebar.panellist`（ui-sidebar 的「全局
		* 面板」图标排，位于工作区列表之上、`sidebar.settings` 页脚之上）注册
		* `{ id: 'capability-panel', order: 30, label: '能力面板' }` 与图标本体，
		* 并向 `main` keyed slot 注册同名的 `key: 'capability-panel'` 页面组件。
		* 侧栏自己渲染按钮 / tooltip / label 文本，点击时把主区域切到该 key
		* （与 plugins / schedules / dsh-context 同构）；两者必须成对注册——侧栏
		* 选择没有对应 main 条目的 id 会抛错。浮层外壳、backdrop 与关闭按钮都已
		* 随之删除。
		*
		* **两份 api，切勿合并（防回归）**：
		*   - 面板自身用 client.ts 中带「项目钉选」的 `api`：`currentWorkspaceCwd`
		*     是 `selection.cwd ?? 当前会话工作区`，所以头部「项目作用域」下拉框
		*     能把项目级视图钉到任意工作区；
		*   - composer（输入框工具行：Skills / MCP 按钮与弹层）在 client.ts 中用
		*     单独的 `composerApi`：`currentWorkspaceCwd` **只**取当前会话自己的
		*     工作区，`selectedProject()` 恒为 undefined。两者共用同一份
		*     `subscribeWorkspace` 回调集合，因此都会随会话工作区切换刷新。
		*   若把面板这份 api 交给 composer，就会出现在面板里把项目作用域钉到 A
		*   工作区后、B 工作区的对话框弹层列出 A 的项目级技能/MCP 的串味 bug。
		*
		* 根容器按能力域分 Tab（**只剩两个**：技能 / MCP，带数据量计数），第二行
		* 是「域 Tab + 搜索框」：搜索框由根组件持有，按域切换 placeholder，两个
		* 视图只接收 `query` 做本地过滤（视图内不再有搜索/安装行）：
		*   - Skills：左列 200–220px 的 ScopeNav（全局 / 项目 + 行尾「+」安装），
		*     中间列按 scope 显示全局技能、工作区选择列表或选中工作区的项目技能
		*     （项目 scope 未选工作区时先列全部工作区，点击 = `api.selectProject`）；
		*     详情页带完整文件树 + SKILL.md 阅读器（见 skill-content.tsx）；
		*   - MCP：同构的左导航 + 中间列（全局含外部注入 / 项目→工作区下钻），
		*     带每个 session 的实时挂载状态（见 mcp-panel.tsx）。
		*
		* 快捷消息域已整体下线（2026-10 产品决定），域 Tab 不再有第三个入口。
		*
		* 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
		* 组件零硬依赖。
		*
		* @module dsh-capability-settings/client/panel
		*/
		/** 外部（client.ts）请求面板切域时派发的 window 自定义事件名。 */
		const PANEL_DOMAIN_EVENT = "capability-panel:set-domain";
		/**
		* 待应用的目标域：面板**尚未挂载**时，`openCapabilityPanel(domain)` 先把目标
		* 记在这里，由 CapabilityPanel 首次渲染读取并清空；面板已挂载时改用事件即时
		* 切换（见 setPanelDomain）。
		*/
		let pendingPanelDomain;
		/**
		* 请求能力面板切到指定域（由 client.ts 的 `openCapabilityPanel(domain?)` 在
		* `layout.selectPanel("capability-panel")` 之前调用）。
		*
		* 覆盖两种时序：
		*   - 面板**已挂载**：派发 `capability-panel:set-domain`，组件监听后立即切 Tab；
		*   - 面板**未挂载**：目标留在模块级 pending，组件首次渲染直接落在该域
		*     （hero「去配置」因此能一步打开 Jev Tab，AC-ENT-4）。
		*
		* `undefined` = 保持当前域（无参打开面板的旧行为）。
		*/
		function setPanelDomain(domain) {
			pendingPanelDomain = domain;
			if (typeof window === "undefined") return;
			try {
				window.dispatchEvent(new window.CustomEvent(PANEL_DOMAIN_EVENT, { detail: domain }));
			} catch {}
		}
		/** 域 Tab 的展示文案（当前硬编码中文，见 client.ts 的 locale 说明）。 */
		const DOMAIN_LABEL = {
			skills: "Skills",
			mcp: "MCP",
			tools: "Tools",
			jev: "Jev 模型"
		};
		const DOMAIN_ORDER = [
			"skills",
			"mcp",
			"tools",
			"jev"
		];
		/**
		* 各域的搜索占位符（搜索框在根组件头部，切换域时切换文案）。
		* `jev` 域没有搜索框，故不在此表内（渲染处按 `domain !== "jev"` 隐藏）。
		*/
		const DOMAIN_SEARCH_PLACEHOLDER = {
			skills: "搜索 Skills…",
			mcp: "搜索 MCP…",
			tools: "搜索插件或工具…"
		};
		/**
		* 面板根组件：头部（标题 + 项目下拉框 + 域 Tab）+ 当前域视图。
		*
		* 它是主区域页面的本体（见 panel-entry.tsx 的 CapabilityPanelPage），自带
		* `.skp-panel`（height:100% / flex column），因此不再需要浮层外壳与关闭
		* 按钮——关闭 = 侧栏切换到别的主面板。
		*/
		function CapabilityPanel$1({ api }) {
			const [domain, setDomain] = (0, react.useState)(() => pendingPanelDomain ?? "skills");
			/** 当前域的搜索词（搜索框在头部，按域切换 placeholder；切域清空）。 */
			const [query, setQuery] = (0, react.useState)("");
			const [workspace, setWorkspace] = (0, react.useState)(() => api.workspaceLabel());
			const [projects, setProjects] = (0, react.useState)(() => api.projects());
			const [pinned, setPinned] = (0, react.useState)(() => api.selectedProject());
			const [skillsCount, setSkillsCount] = (0, react.useState)(void 0);
			const [mcpCount, setMcpCount] = (0, react.useState)(void 0);
			const [toolsCount, setToolsCount] = (0, react.useState)(void 0);
			/**
			* Jev 配置页在首次进入该 Tab 时挂载，之后**常驻**（用 active 控制显隐）：
			* 这样在同一面板会话内切到技能/MCP 再切回来，未保存的表单草稿仍在
			* （AC-CFG-16）；关闭能力面板后整棵子树卸载，草稿丢弃。
			* 若初始域就是 jev（pending），同样要挂载。
			*/
			const [jevMounted, setJevMounted] = (0, react.useState)(() => pendingPanelDomain === "jev");
			(0, react.useEffect)(() => {
				pendingPanelDomain = void 0;
				const onSetDomain = (event) => {
					pendingPanelDomain = void 0;
					const detail = event.detail;
					if (detail !== "skills" && detail !== "mcp" && detail !== "tools" && detail !== "jev") return;
					setDomain(detail);
					setQuery("");
					if (detail === "jev") setJevMounted(true);
				};
				window.addEventListener(PANEL_DOMAIN_EVENT, onSetDomain);
				return () => window.removeEventListener(PANEL_DOMAIN_EVENT, onSetDomain);
			}, []);
			(0, react.useEffect)(() => {
				let alive = true;
				const update = () => {
					if (!alive) return;
					setWorkspace(api.workspaceLabel());
					setProjects(api.projects());
					setPinned(api.selectedProject());
				};
				const unsub = api.subscribeWorkspace(update);
				update();
				return () => {
					alive = false;
					unsub();
				};
			}, [api]);
			const counts = {
				skills: skillsCount,
				mcp: mcpCount,
				tools: toolsCount,
				jev: void 0
			};
			const jevActive = domain === "jev";
			/** Tools 是全局工具注册：不显示项目作用域 / 工作区列表（UX v1.8 §2.5）。 */
			const toolsActive = domain === "tools";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "skp-panel",
				"aria-label": "能力面板",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "skp-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-title-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-title-main",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "能力面板" }), jevActive ? null : toolsActive ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-workspace",
									title: "全局工具注册 · 不区分项目 / 工作区",
									children: "全局工具注册 · 不区分项目 / 工作区"
								}) : workspace !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-workspace",
									title: workspace,
									children: workspace
								})]
							}), !jevActive && (toolsActive ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-title-tools",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
									className: "skp-dd-scope",
									value: "",
									disabled: true,
									ariaLabel: "工具作用域",
									title: "全局工具注册 · 不区分项目 / 工作区",
									options: [{
										value: "",
										label: "全局工具"
									}],
									onChange: () => void 0
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-title-tools",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
									className: "skp-dd-scope",
									value: pinned ?? "",
									title: workspace,
									ariaLabel: "项目作用域",
									options: [
										{
											value: "",
											label: "跟随当前会话"
										},
										...projects.map((p) => ({
											value: p.path,
											label: p.title ?? p.path
										})),
										...pinned !== void 0 && !projects.some((p) => p.path === pinned) ? [{
											value: pinned,
											label: pinned
										}] : []
									],
									onChange: (value) => api.selectProject(value === "" ? void 0 : value)
								})
							}))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-header-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-tabs",
								role: "tablist",
								children: DOMAIN_ORDER.map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									role: "tab",
									"aria-selected": domain === d,
									className: domain === d ? "skp-tab skp-tab-active" : "skp-tab",
									onClick: () => {
										setDomain(d);
										setQuery("");
										if (d === "jev") setJevMounted(true);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: DOMAIN_LABEL[d] }), d !== "jev" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-tab-count",
										children: counts[d] ?? "—"
									})]
								}, d))
							}), domain !== "jev" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "skp-search skp-header-search",
								type: "search",
								"aria-label": DOMAIN_SEARCH_PLACEHOLDER[domain],
								placeholder: DOMAIN_SEARCH_PLACEHOLDER[domain],
								value: query,
								onChange: (event) => setQuery(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Escape" && query.length > 0) {
										event.preventDefault();
										setQuery("");
									}
								}
							})]
						})]
					}),
					jevActive ? null : domain === "tools" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsView, {
						api,
						workspace,
						query,
						onCount: setToolsCount
					}) : domain === "skills" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillsView, {
						api,
						workspace,
						projects,
						query,
						pinned,
						onSelectWorkspace: (path) => api.selectProject(path),
						onCount: setSkillsCount
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpView, {
						api,
						workspace,
						projects,
						query,
						pinned,
						onSelectWorkspace: (path) => api.selectProject(path),
						onCount: setMcpCount
					}),
					jevMounted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JevPanel, {
						api,
						active: jevActive
					})
				]
			});
		}
		/** 技能行的复合 key：同名技能可能同时存在于两个作用域，必须带分组前缀。 */
		function skillRowKey(item) {
			return `${isProjectSource(item.source) ? "project" : "global"}:${item.source}:${item.name}`;
		}
		/** 调用状态三分：全启用 / 全禁用 / 部分禁用（仅其中一个方向被关）。 */
		function invocationState(item) {
			if (item.modelInvocable && item.userInvocable) return "full";
			if (!item.modelInvocable && !item.userInvocable) return "none";
			return "partial";
		}
		/** 注入来源的展示文案（与 Figma v12 标签语义一致）。 */
		function originLabel(item) {
			return item.origin === "bundled" ? "内置" : item.origin === "preset" ? "预设" : "插件";
		}
		/** 注入来源标签的配色类（内置琥珀 / 插件紫 / 预设灰）。 */
		function originTagClass(item) {
			return item.origin === "bundled" ? "skp-tag skp-tag-bundled" : item.origin === "preset" ? "skp-tag skp-tag-preset" : "skp-tag skp-tag-plugin";
		}
		/** 注入行的「来源 + 渠道」说明（详情页 meta 用）。 */
		function injectedOriginText(item) {
			if (item.origin === "bundled") return "DSH 内置（随包提供）";
			if (item.origin === "preset") return `Agent 预设 · 仅在「${item.channel ?? "未知预设"}」的会话可见`;
			return item.channel !== void 0 && item.channel.length > 0 ? `${item.channel} 运行时注入（不落盘）` : "插件运行时注入（不落盘）";
		}
		/** 注入行的只读原因条文案（详情页顶部）。 */
		function injectedReadonlyNote(item) {
			const channel = item.channel !== void 0 && item.channel.length > 0 ? item.channel : "插件";
			if (item.origin === "bundled") return "内容只读 · DSH 内置 Skills（无磁盘副本）；可在列表 / 会话中启用或禁用，不可编辑或删除。";
			if (item.origin === "preset") return `内容只读 · 由 Agent 预设「${channel}」提供（无磁盘副本，仅该预设的会话可见）；只能在会话中启用或禁用，不可编辑或删除。`;
			return `内容只读 · 由插件 ${channel} 运行时注册（无磁盘副本）；可在列表 / 会话中启用或禁用，不可编辑或删除。`;
		}
		/** 行左标签的排序与文案：scope → 格式 → 关系（最多 3 个）。 */
		function skillTags(item, hasGlobal) {
			const tags = [];
			if (item.injected === true) {
				tags.push({
					key: "origin",
					label: originLabel(item),
					className: originTagClass(item),
					title: item.origin === "bundled" ? "DSH 随包提供的 Skills（只读）" : item.origin === "preset" ? "由当前 Agent 预设渠道提供，只在绑定该预设的会话里可见" : "由插件在运行时注册的 Skills（只读）"
				});
				tags.push({
					key: "format",
					label: item.format === "directory" ? "目录" : ".md",
					className: "skp-tag skp-tag-flat",
					title: item.format === "directory" ? "目录型 Skills（SKILL.md + 其他文件）" : "单文件 Skills"
				});
				if (item.channel !== void 0 && item.channel.length > 0) tags.push({
					key: "channel",
					label: item.channel,
					className: "skp-tag skp-tag-channel",
					title: "注入方 / 渠道名（只读来源：没有可编辑的磁盘副本）"
				});
				return tags;
			}
			const isProject = isProjectSource(item.source);
			tags.push({
				key: "scope",
				label: isProject ? "项目" : "全局",
				className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
				title: isProject ? "本项目内的 Skills，只在本项目生效" : "全局 Skills，对所有项目生效"
			}, {
				key: "format",
				label: item.format === "directory" ? "目录" : ".md",
				className: "skp-tag skp-tag-flat",
				title: item.format === "directory" ? "目录型 Skills（SKILL.md + 其他文件）" : "单文件 Skills"
			});
			if (item.readOnly) tags.push({
				key: "readonly",
				label: "只读",
				className: "skp-tag skp-tag-readonly",
				title: "只读来源，无法修改或删除"
			});
			else if (isProject && item.shadowStub === true) tags.push({
				key: "stub",
				label: "屏蔽占位",
				className: "skp-tag skp-tag-warn",
				title: "已生成屏蔽占位，使同名全局 Skills 在本项目不可用；删除占位即恢复"
			});
			else if (isProject && hasGlobal) tags.push({
				key: "override",
				label: "覆盖全局",
				className: "skp-tag skp-tag-relation",
				title: "本项目生效的是这份项目副本；同名全局 Skills 被遮蔽"
			});
			else if (!isProject && item.projectShadow === "stub") tags.push({
				key: "disabled-in-project",
				label: "本项目已禁用",
				className: "skp-tag skp-tag-warn",
				title: "本项目内已放置屏蔽占位，此 Skills 在本项目不可用（不影响其它项目）"
			});
			else if (!isProject && item.projectShadow === "skill") tags.push({
				key: "project-copy",
				label: "项目副本生效中",
				className: "skp-tag skp-tag-readonly",
				title: "本项目内已有同名 Skills，按优先级本项目中生效的是项目副本"
			});
			return tags;
		}
		/** 行开关的勾选态（语义见任务规格 / docs/ux/panel-upgrade.md §3.5、§5.3）。 */
		function skillSwitchChecked(item) {
			if (item.injected === true) return item.disabledInProject !== true;
			if (isProjectSource(item.source)) {
				if (item.shadowStub === true) return false;
				return item.modelInvocable && item.userInvocable;
			}
			return item.projectShadow !== "stub";
		}
		/** 行开关是否置灰 + tooltip（只读 / 项目副本生效中 / 无工作区）。 */
		function skillSwitchDisabled(item, hasWorkspace) {
			if (item.injected === true) {
				if (!hasWorkspace) return {
					disabled: true,
					title: "先选择工作区，才能设置此注入 Skills 在本项目的默认启停"
				};
				return {
					disabled: false,
					title: skillSwitchChecked(item) ? "关闭：在本项目默认禁用此注入 Skills（写入 .agents/capability-overrides.json，不影响其它项目与其它会话）" : "打开：恢复此注入 Skills 在本项目默认可用"
				};
			}
			if (item.readOnly) return {
				disabled: true,
				title: "只读来源（.claude 兼容目录），无法修改或删除"
			};
			if (!hasWorkspace) return {
				disabled: true,
				title: "需要可写的工作区才能修改 Skills"
			};
			if (isProjectSource(item.source)) {
				if (item.shadowStub === true) return {
					disabled: false,
					title: "打开：删除屏蔽占位，恢复同名全局 Skills 在本项目可用"
				};
				return {
					disabled: false,
					title: skillSwitchChecked(item) ? "关闭：模型与用户都不可调用" : "打开：恢复模型与用户调用（写入项目副本 frontmatter）"
				};
			}
			if (item.projectShadow === "skill") return {
				disabled: true,
				title: "本项目已有同名 Skills（项目副本生效中），请在项目副本上操作"
			};
			if (item.projectShadow === "stub") return {
				disabled: false,
				title: "打开：删除本项目内的屏蔽占位，恢复此全局 Skills 在本项目可用"
			};
			return {
				disabled: false,
				title: skillSwitchChecked(item) ? "关闭：在本项目内禁用此全局 Skills（生成屏蔽占位，不影响其它项目）" : "打开：恢复此全局 Skills 在本项目可用"
			};
		}
		/** 取路径最后一段作为工作区显示名（兼容 POSIX / Windows 分隔符）。 */
		function basenameOf(path) {
			const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
			return segments[segments.length - 1] ?? path;
		}
		/**
		* Skills 视图：左侧 ScopeNav（全局 / 项目）+ 中间列 + 右侧详情。
		*
		*  - 全局：中间列显示全部全局技能（含只读/被本项目遮蔽状态标签）；
		*  - 项目：未选工作区时先列全部工作区（点击 = api.selectProject，进入该
		*    工作区的项目技能）；已选工作区时显示「‹ 工作区」返回行 + 该项目技能。
		*
		* 搜索词由根组件头部的同一输入框提供（query），按当前列表过滤：技能名称/
		* 描述，或工作区名/完整路径。行内只有状态点、标签、两行描述与行尾「启用」
		* 开关；导出/导入/删除等动作全部在右侧详情（含文件树与阅读器）。
		*/
		function SkillsView({ api, workspace, projects, query, pinned, onSelectWorkspace, onCount }) {
			const skillsApi = api.skills;
			const [scope, setScope] = (0, react.useState)("project");
			const [selected, setSelected] = (0, react.useState)(void 0);
			/** 关系标签互跳的目标行：切 scope / 选工作区后待列表出现再选中。 */
			const [pendingSelect, setPendingSelect] = (0, react.useState)(void 0);
			const [installOpen, setInstallOpen] = (0, react.useState)(false);
			const [installScope, setInstallScope] = (0, react.useState)("project");
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [busyRow, setBusyRow] = (0, react.useState)(void 0);
			/** 写操作计数：传给 SkillContent，变化时清空文件缓存并重拉。 */
			const [contentVersion, setContentVersion] = (0, react.useState)(0);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const { data: allItems, loading, error, reload } = useAsyncList(() => skillsApi.list(), [skillsApi, workspace]);
			const items = allItems ?? [];
			const projectItems = (0, react.useMemo)(() => items.filter((item) => isProjectSource(item.source)), [items]);
			const injectedItems = (0, react.useMemo)(() => items.filter((item) => item.injected === true), [items]);
			const diskGlobalItems = (0, react.useMemo)(() => items.filter((item) => !isProjectSource(item.source) && item.injected !== true), [items]);
			const globalItems = (0, react.useMemo)(() => [...diskGlobalItems, ...injectedItems], [diskGlobalItems, injectedItems]);
			(0, react.useEffect)(() => {
				if (!loading && error === void 0) onCount?.(items.length);
			}, [
				items.length,
				loading,
				error,
				onCount
			]);
			const q = query.trim().toLowerCase();
			const matchesSkill = (item) => q.length === 0 || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.channel !== void 0 && item.channel.toLowerCase().includes(q);
			const diskGlobalVisible = (0, react.useMemo)(() => diskGlobalItems.filter(matchesSkill), [diskGlobalItems, q]);
			const injectedVisible = (0, react.useMemo)(() => injectedItems.filter(matchesSkill), [injectedItems, q]);
			const globalVisible = (0, react.useMemo)(() => [...diskGlobalVisible, ...injectedVisible], [diskGlobalVisible, injectedVisible]);
			const projectVisible = (0, react.useMemo)(() => projectItems.filter(matchesSkill), [projectItems, q]);
			const workspaceVisible = (0, react.useMemo)(() => projects.filter((project) => q.length === 0 || basenameOf(project.path).toLowerCase().includes(q) || project.path.toLowerCase().includes(q)), [projects, q]);
			/** 项目 scope 且尚未选择工作区 → 中间列只显示空态，工作区列表在左导航内。 */
			const showWorkspacePicker = scope === "project" && pinned === void 0;
			/** 当前中间列可选的技能行（决定键盘导航与关系互跳的落点）。 */
			const visibleSkills = (0, react.useMemo)(() => showWorkspacePicker ? [] : scope === "global" ? globalVisible : projectVisible, [
				showWorkspacePicker,
				scope,
				globalVisible,
				projectVisible
			]);
			const visibleKeys = (0, react.useMemo)(() => visibleSkills.map(skillRowKey), [visibleSkills]);
			const selectedItem = items.find((item) => skillRowKey(item) === selected);
			(0, react.useEffect)(() => {
				setSelected(void 0);
			}, [workspace, pinned]);
			(0, react.useEffect)(() => {
				if (pendingSelect === void 0) return;
				if (!visibleKeys.includes(pendingSelect)) return;
				setSelected(pendingSelect);
				setPendingSelect(void 0);
			}, [pendingSelect, visibleKeys]);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
					const active = document.activeElement;
					const tagName = active?.tagName.toLowerCase();
					if (tagName === "input" || tagName === "textarea" || active?.isContentEditable === true) return;
					event.preventDefault();
					document.querySelector(".skp-header-search")?.focus();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, []);
			const selectRow = (key) => {
				setSelected(key);
				setOpError(void 0);
			};
			const focusRow = (key) => {
				const element = rowRefs.current.get(key);
				if (element === void 0) return;
				element.focus();
				element.scrollIntoView({ block: "nearest" });
			};
			/** 切 scope：清空选中与待跳目标（搜索结果保留，作用域切换后仍可沿用）。 */
			const switchScope = (next) => {
				if (scope === next) return;
				setScope(next);
				setSelected(void 0);
				setPendingSelect(void 0);
				setOpError(void 0);
			};
			/** 选择 / 清除工作区：清空选中，写回面板钉选状态（列表随 workspace 重拉）。 */
			const chooseWorkspace = (path) => {
				setScope("project");
				setSelected(void 0);
				setPendingSelect(void 0);
				onSelectWorkspace(path);
			};
			/**
			* 关系标签互跳：项目行「覆盖全局」→ 全局同名行；全局行「项目副本生效中 /
			* 本项目已禁用」→ 项目行。跨 scope 时先切换 scope；项目侧尚未选工作区时
			* 自动钉选当前工作区（若在已知项目列表里），等列表刷新后再选中目标行。
			*/
			const jumpToRelated = (item) => {
				if (item.injected === true) return;
				const isProject = isProjectSource(item.source);
				let target;
				if (isProject) {
					if (item.shadowStub === true) return;
					target = globalItems.find((globalItem) => globalItem.name === item.name);
				} else if (item.projectShadow === "stub") target = projectItems.find((entry) => entry.name === item.name && entry.shadowStub === true);
				else if (item.projectShadow === "skill") target = projectItems.find((entry) => entry.name === item.name && entry.shadowStub !== true);
				if (target === void 0) return;
				const targetKey = skillRowKey(target);
				if (!isProject) {
					if (pinned !== void 0) {
						setScope("project");
						setSelected(void 0);
						setPendingSelect(targetKey);
						return;
					}
					const match = projects.find((project) => project.path === workspace);
					if (match === void 0) return;
					setScope("project");
					setSelected(void 0);
					setPendingSelect(targetKey);
					onSelectWorkspace(match.path);
					return;
				}
				setScope("global");
				setSelected(void 0);
				setPendingSelect(targetKey);
			};
			/** 行内统一开关：按行类型分派到 setEnabled / enableInProject / disableInProject / overrides.toggle。 */
			const toggleRow = async (item, next) => {
				const key = skillRowKey(item);
				if (busyRow !== void 0) return;
				setBusyRow(key);
				setOpError(void 0);
				try {
					const isProject = isProjectSource(item.source);
					if (item.injected === true) {
						if (skillSwitchChecked(item) === next) return;
						const result = await api.overrides.toggle("skills", item.name);
						if (!result.ok) {
							setOpError(result.errors.join("; "));
							return;
						}
					} else {
						const result = isProject ? item.shadowStub === true ? next ? await skillsApi.enableInProject({ name: item.name }) : { ok: true } : await skillsApi.setEnabled({
							...skillRefOf(item),
							enabled: next
						}) : next ? await skillsApi.enableInProject({ name: item.name }) : await skillsApi.disableInProject({
							name: item.name,
							fromRoot: item.root
						});
						if (!result.ok) {
							setOpError(result.errors.join("; "));
							return;
						}
					}
					setContentVersion((value) => value + 1);
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusyRow(void 0);
					reload({ silent: true });
				}
			};
			const onRowKeyDown = (event, key) => {
				if (visibleKeys.length === 0) return;
				const index = visibleKeys.indexOf(key);
				if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
					event.preventDefault();
					const next = event.key === "Home" ? 0 : event.key === "End" ? visibleKeys.length - 1 : event.key === "ArrowDown" ? Math.min(visibleKeys.length - 1, index + 1) : Math.max(0, index - 1);
					const nextKey = visibleKeys[next];
					if (nextKey !== void 0) {
						selectRow(nextKey);
						requestAnimationFrame(() => focusRow(nextKey));
					}
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					selectRow(key);
				}
			};
			const openInstall = (target) => {
				setInstallScope(target);
				setInstallOpen(true);
			};
			/** ScopeNav 一行：作用域名 + 计数 + 右侧「+」安装入口。 */
			const renderScopeItem = (target, label, count) => {
				const addDisabled = target === "project" && pinned === void 0;
				const addTitle = addDisabled ? "先选择工作区" : target === "global" ? "安装 Skills 到全局" : "安装 Skills 到本项目";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: scope === target ? "skp-scope-item skp-scope-item-active" : "skp-scope-item",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "skp-scope-main",
						"aria-pressed": scope === target,
						onClick: () => switchScope(target),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-scope-label",
							children: label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-scope-count",
							children: count
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-scope-add",
						disabled: addDisabled,
						title: addTitle,
						"aria-label": addTitle,
						onClick: () => openInstall(target),
						children: "+"
					})]
				});
			};
			/** 当前 scope 的技能列表（空态区分「没有」与搜索「无匹配」）。 */
			const renderSkillList = (list, group) => {
				if (list.length === 0) {
					if (q.length > 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-empty",
						children: [
							"没有匹配「",
							query.trim(),
							"」的 Skills。"
						]
					});
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: group === "global" ? "还没有全局 Skills。" : "本项目还没有 Skills。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn",
							style: { marginTop: 10 },
							onClick: () => openInstall(group),
							children: group === "global" ? "安装到全局" : "安装到本项目"
						})]
					});
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-group-scroll",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "skp-list",
						role: "listbox",
						"aria-label": group === "global" ? "全局 Skills" : "本项目 Skills",
						children: list.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							role: "presentation",
							children: renderRow(item)
						}, skillRowKey(item)))
					})
				});
			};
			/** 一组技能行（列表容器 + 可访问性标签）。 */
			const renderRows = (list, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: "skp-list",
				role: "listbox",
				"aria-label": label,
				children: list.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
					role: "presentation",
					children: renderRow(item)
				}, skillRowKey(item)))
			});
			/**
			* 全局 scope 的技能列表：磁盘全局行 + 单独的「注入技能」分组
			* （Figma v12：注入行带来源标签与「内容只读 · 可启停」说明）。
			*/
			const renderGlobalList = () => {
				if (diskGlobalVisible.length === 0 && injectedVisible.length === 0) return renderSkillList([], "global");
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-group-scroll",
					children: [diskGlobalVisible.length > 0 && renderRows(diskGlobalVisible, "全局 Skills"), injectedVisible.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-list-group-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-list-group-title",
								children: "注入 Skills"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-group-count",
								children: injectedItems.length
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-list-group-note",
								children: "内容只读 · 可启停"
							})
						]
					}), renderRows(injectedVisible, "注入 Skills")] })]
				});
			};
			/**
			* ScopeNav「项目」行下方的工作区列表（仅 project scope 渲染，nav 内自身滚动）。
			* 未选工作区时跟随搜索词过滤名称/路径；已选中工作区时保持完整列表方便切换。
			*/
			const renderScopeWorkspaces = () => {
				const list = pinned === void 0 ? workspaceVisible : projects;
				if (list.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-scope-empty",
					children: pinned === void 0 && q.length > 0 ? "无匹配" : "没有工作区"
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-scope-workspaces",
					role: "listbox",
					"aria-label": "工作区",
					children: list.map((project) => {
						const active = project.path === pinned;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "option",
							"aria-selected": active,
							className: active ? "skp-scope-workspace skp-scope-workspace-active" : "skp-scope-workspace",
							title: project.path,
							onClick: () => chooseWorkspace(project.path),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-scope-workspace-name",
								children: basenameOf(project.path)
							})
						}, project.path);
					})
				});
			};
			const renderRow = (item) => {
				const key = skillRowKey(item);
				const isProject = isProjectSource(item.source);
				const isInjected = item.injected === true;
				const state = invocationState(item);
				const checked = skillSwitchChecked(item);
				const tags = skillTags(item, diskGlobalItems.some((global) => global.name === item.name));
				const switcher = skillSwitchDisabled(item, pinned !== void 0);
				const dotClass = isInjected ? checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow" : item.shadowStub === true || item.readOnly ? "skp-dot skp-dot-hollow" : state === "full" ? "skp-dot skp-dot-enabled" : state === "partial" ? "skp-dot skp-dot-partial" : "skp-dot";
				const dotText = isInjected ? checked ? "已启用" : "本项目已禁用" : item.shadowStub === true ? "屏蔽占位" : item.readOnly ? "只读" : state === "full" ? "已启用" : state === "partial" ? "部分禁用" : "已禁用";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "option",
					"aria-selected": selected === key,
					tabIndex: selected === key ? 0 : -1,
					className: selected === key ? "skp-row skp-row-active" : "skp-row",
					ref: (element) => {
						if (element === null) rowRefs.current.delete(key);
						else rowRefs.current.set(key, element);
					},
					onClick: () => selectRow(key),
					onKeyDown: (event) => onRowKeyDown(event, key),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-row-name",
							children: [(isProject || isInjected) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: dotClass,
								"aria-hidden": "true"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-sr-only",
								children: dotText
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-row-title",
								title: item.name,
								children: item.name
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-row-mid",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-row-tags",
								children: tags.map((tag) => tag.key === "override" || tag.key === "disabled-in-project" || tag.key === "project-copy" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: tag.className,
									title: tag.title,
									onClick: (event) => {
										event.stopPropagation();
										jumpToRelated(item);
									},
									children: tag.label
								}, tag.key) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: tag.className,
									title: tag.title,
									children: tag.label
								}, tag.key))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "skp-row-toggle",
								title: switcher.title,
								onClick: (event) => event.stopPropagation(),
								onKeyDown: (event) => event.stopPropagation(),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-row-default-label",
									children: "启用"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-switch",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										role: "switch",
										"aria-label": `启用 ${item.name}`,
										checked: skillSwitchChecked(item),
										disabled: switcher.disabled || busyRow === key,
										onChange: (event) => void toggleRow(item, event.target.checked)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-row-desc",
							children: item.description.length > 0 ? item.description : "（无描述）"
						})
					]
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-domain",
				children: [
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: opError
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-error",
						children: ["读取失败：", error]
					}),
					loading && allItems === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-status",
						children: "加载中…"
					}),
					allItems !== void 0 && error === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
								className: "skp-scope-nav",
								"aria-label": "Skills 作用域",
								children: [
									renderScopeItem("global", "全局", globalItems.length),
									renderScopeItem("project", "项目", pinned === void 0 ? "—" : projectItems.length),
									renderScopeWorkspaces()
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-workspace-pane",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-title",
									children: scope === "global" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										children: "全局 Skills"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-group-count",
										children: globalVisible.length
									})] }) : pinned === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										children: "项目"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-pane-title-text",
										title: pinned,
										children: basenameOf(pinned)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-group-count",
										children: projectVisible.length
									})] })
								}), scope === "global" ? renderGlobalList() : pinned === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-empty",
									children: "请选择左侧工作区"
								}) : renderSkillList(projectVisible, "project")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-detail skp-detail-fixed",
								children: selectedItem !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillDetail, {
									summary: selectedItem,
									api: skillsApi,
									hasWorkspace: pinned !== void 0,
									contentVersion,
									onChanged: () => {
										setContentVersion((value) => value + 1);
										reload({ silent: true });
									},
									onRemoved: () => {
										setSelected(void 0);
										setContentVersion((value) => value + 1);
										reload({ silent: true });
									}
								}, skillRowKey(selectedItem)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-detail-empty",
									children: items.length === 0 ? "还没有任何 Skills。Skills 让 agent 在特定任务上按固定做法工作。" : scope === "project" && showWorkspacePicker ? "请选择左侧工作区，再查看或安装本项目 Skills。" : "选择一个条目查看说明与全部文件内容。"
								})
							})
						]
					}),
					installOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallDialog, {
						api: skillsApi,
						hasWorkspace: pinned !== void 0,
						defaultScope: installScope,
						onClose: () => setInstallOpen(false),
						onInstalled: () => {
							setInstallOpen(false);
							setContentVersion((value) => value + 1);
							reload({ silent: true });
						}
					})
				]
			});
		}
		/**
		* 详情卡片：标题 / 动作区 / 元信息 + **文件树与阅读器**（本版新增）。
		*
		* 动作与元信息沿用旧实现（启用/禁用、模型/用户调用开关、导入到本项目、
		* 在本项目禁用/恢复、导出、导出到路径…、删除），删除确认从「两击」改为
		* 模态对话框；内容区见 skill-content.tsx。
		*/
		function SkillDetail({ summary, api, hasWorkspace, contentVersion, onChanged, onRemoved }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [confirmImport, setConfirmImport] = (0, react.useState)(false);
			const [exportPathOpen, setExportPathOpen] = (0, react.useState)(false);
			const [deleteOpen, setDeleteOpen] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const isGlobal = isGlobalSkillSource(summary.source);
			const injected = summary.injected === true;
			const state = invocationState(summary);
			(0, react.useEffect)(() => {
				if (!deleteOpen) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setDeleteOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [deleteOpen]);
			/** 一键启用/禁用：开关状态 = 模型与用户都可用（两者任一被关即视为禁用）。 */
			const doSetEnabled = async (next) => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.setEnabled({
						...skillRefOf(summary),
						enabled: next
					});
					if (!result.ok) {
						setOpError(result.errors.join("; "));
						return;
					}
					onChanged();
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusy(false);
				}
			};
			/** 细粒度切换其中一个调用方向（另一个方向保持原样）。 */
			const doSetInvocation = async (modelInvocable, userInvocable) => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.setInvocation({
						...skillRefOf(summary),
						modelInvocable,
						userInvocable
					});
					if (!result.ok) {
						setOpError(result.errors.join("; "));
						return;
					}
					onChanged();
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusy(false);
				}
			};
			/** 导出为浏览器下载：flat ⇒ 单个 .md；directory ⇒ 打 zip（store-only）。 */
			const doExportDownload = async () => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.exportFiles(skillRefOf(summary));
					if (!result.ok) {
						setOpError(result.errors.join("; "));
						return;
					}
					if (result.format === "flat" && result.files.length === 1) downloadBytes(`${result.name}.md`, base64ToBytes(result.files[0].content), "text/markdown");
					else {
						const zip = buildZip(result.files.map((file) => ({
							name: `${result.name}/${file.path}`,
							data: base64ToBytes(file.content)
						})));
						downloadBytes(`${result.name}.zip`, zip, "application/zip");
					}
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusy(false);
				}
			};
			/** 确认后删除（对话框已收集用户确认，不再两击）。 */
			const doRemove = async () => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.remove(skillRefOf(summary));
					if (!result.ok) {
						setOpError(result.errors.join("; "));
						setDeleteOpen(false);
						return;
					}
					setDeleteOpen(false);
					onRemoved();
				} catch (failure) {
					setOpError(String(failure));
					setDeleteOpen(false);
				} finally {
					setBusy(false);
				}
			};
			/** 导入这个全局 skill 到当前项目（项目内已有同名时二次确认覆盖）。 */
			const doImport = async (overwrite) => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.importToProject({
						name: summary.name,
						fromRoot: summary.root,
						overwrite
					});
					if (!result.ok) {
						if (result.existed === true) {
							setConfirmImport(true);
							return;
						}
						setOpError(result.errors.join("; "));
						return;
					}
					onChanged();
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusy(false);
				}
			};
			/** 在本项目内禁用这个全局 skill：生成 shadow stub（不影响其它项目）。 */
			const doDisableInProject = async () => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.disableInProject({
						name: summary.name,
						fromRoot: summary.root
					});
					if (!result.ok) {
						setOpError(result.errors.join("; "));
						return;
					}
					onChanged();
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusy(false);
				}
			};
			/** 恢复：删除本项目内的 shadow stub，该全局技能重新对本项目可见。 */
			const doEnableInProject = async () => {
				setBusy(true);
				setOpError(void 0);
				try {
					const result = await api.enableInProject({ name: summary.name });
					if (!result.ok) {
						setOpError(result.errors.join("; "));
						return;
					}
					onChanged();
				} catch (failure) {
					setOpError(String(failure));
				} finally {
					setBusy(false);
				}
			};
			const copyPath = async () => {
				if (summary.path === void 0) return;
				try {
					await navigator.clipboard?.writeText(summary.path);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				} catch {}
			};
			const deleteBody = summary.shadowStub === true ? "将删除本项目内的屏蔽占位，同名全局 Skills 在本项目恢复可用。" : isGlobal ? "将删除全局 Skills，所有项目都将不再可用。此操作不可撤销。" : "将删除本项目中的这份 Skills（含目录下的所有文件）。此操作不可撤销。";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-detail-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								title: summary.name,
								children: summary.name
							}),
							injected ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: originTagClass(summary),
									title: "注入来源类别（内置 / 插件 / 预设渠道）",
									children: originLabel(summary)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: summary.format === "directory" ? "目录" : ".md"
								}),
								summary.channel !== void 0 && summary.channel.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-channel",
									title: "注入方 / 渠道名（只读来源，无磁盘副本）",
									children: summary.channel
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project",
									title: isGlobal ? "全局 Skills（对所有项目生效）" : "本项目内的 Skills",
									children: isGlobal ? "全局" : "项目"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: summary.format === "directory" ? "目录" : ".md"
								}),
								summary.readOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-badge",
									children: "只读"
								})
							] }),
							!injected && summary.shadowStub === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								title: "屏蔽占位：使同名全局 Skills 在本项目不可用；删除本条目即可恢复",
								children: "屏蔽占位"
							}),
							isGlobal && summary.projectShadow === "stub" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								title: "本项目内已放置屏蔽占位，此 Skills 在本项目不可用（不影响其它项目）",
								children: "本项目已禁用"
							}),
							isGlobal && summary.projectShadow === "skill" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								title: "项目区有同名 Skills，按宿主优先级在本项目生效的是项目副本",
								children: "项目副本生效中"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
							summary.path !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-link-btn",
								title: summary.path,
								onClick: () => void copyPath(),
								children: copied ? "已复制" : "复制路径"
							})
						]
					}),
					injected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-readonly",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-detail-readonly-icon",
							"aria-hidden": "true",
							children: "i"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: injectedReadonlyNote(summary) })]
					}),
					!summary.readOnly && !injected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-actions",
						children: [
							!isGlobal && summary.shadowStub !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `skp-btn ${state === "full" ? "skp-state-on" : state === "partial" ? "skp-state-partial" : "skp-state-off"}`,
								disabled: busy,
								title: state === "full" ? "点击禁用（用户与模型都不可调用）" : "点击启用（恢复用户与模型调用）",
								onClick: () => void doSetEnabled(state !== "full"),
								children: state === "full" ? "已启用" : state === "none" ? "已禁用" : "部分禁用"
							}),
							isGlobal && state !== "full" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-state-off",
								disabled: busy,
								title: "此全局 Skills 当前为禁用状态；点击恢复启用（对所有项目生效）",
								onClick: () => void doSetEnabled(true),
								children: "已禁用"
							}),
							hasWorkspace && isGlobal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: confirmImport ? "skp-btn skp-btn-danger" : "skp-btn",
								disabled: busy,
								title: confirmImport ? "项目内已有同名 Skills，再次点击将覆盖为全局副本" : "复制到本项目（.agents/skills），此后可在本项目内独立启停",
								onClick: () => void doImport(confirmImport),
								children: confirmImport ? "确认覆盖项目内的同名 Skills？" : "导入到本项目"
							}),
							hasWorkspace && isGlobal && summary.projectShadow === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: busy,
								title: "在本项目内禁用此全局 Skills（生成屏蔽占位，模型与用户调用都被宿主原生拒绝；不影响其它项目，可随时恢复）",
								onClick: () => void doDisableInProject(),
								children: "在本项目禁用"
							}),
							hasWorkspace && isGlobal && summary.projectShadow === "stub" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: busy,
								title: "删除本项目内的屏蔽占位，恢复此全局 Skills 在本项目可用",
								onClick: () => void doEnableInProject(),
								children: "在本项目恢复"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: busy,
								onClick: () => void doExportDownload(),
								children: "导出"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: busy,
								onClick: () => setExportPathOpen(true),
								children: "导出到路径…"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-btn-danger-ghost",
								disabled: busy,
								title: deleteBody,
								onClick: () => setDeleteOpen(true),
								children: "删除"
							})
						]
					}),
					(summary.description.length > 0 || summary.whenToUse !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-desc",
						children: [summary.description.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "skp-detail-desc-text",
							children: summary.description
						}), summary.whenToUse !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "skp-detail-desc-text",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-detail-meta-strong",
									children: "使用时机"
								}),
								" ",
								summary.whenToUse
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-meta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-detail-meta-item",
								children: [
									"来源",
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-detail-meta-strong",
										children: injected ? summary.channel !== void 0 && summary.channel.length > 0 ? summary.channel : originLabel(summary) : summary.source
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-detail-meta-item",
								children: injected ? injectedOriginText(summary) : summary.format === "directory" ? "目录格式" : "单文件"
							}),
							(injected || summary.readOnly || !isGlobal) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-detail-meta-item",
								children: ["调用方式", injected || summary.readOnly || summary.shadowStub === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-detail-meta-strong",
									children: [
										"模型 ",
										summary.modelInvocable ? "✓" : "✗",
										" · 用户 ",
										summary.userInvocable ? "✓" : "✗"
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-invoke-btns",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: `skp-btn ${summary.modelInvocable ? "skp-state-on" : "skp-state-off"}`,
										disabled: busy,
										title: summary.modelInvocable ? "点击关闭模型调用（agent 不再自动触发；用户仍可 /name 调用）" : "点击开启模型调用（agent 可自动触发）",
										onClick: () => void doSetInvocation(!summary.modelInvocable, summary.userInvocable),
										children: ["模型 ", summary.modelInvocable ? "✓" : "✗"]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: `skp-btn ${summary.userInvocable ? "skp-state-on" : "skp-state-off"}`,
										disabled: busy,
										title: summary.userInvocable ? "点击关闭用户调用（输入框 /name 不再注入此 Skills；模型仍可自动触发）" : "点击开启用户调用（输入框 /name 可注入此 Skills）",
										onClick: () => void doSetInvocation(summary.modelInvocable, !summary.userInvocable),
										children: ["用户 ", summary.userInvocable ? "✓" : "✗"]
									})]
								})]
							}),
							summary.path !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-detail-path",
								title: summary.path,
								onClick: () => void copyPath(),
								children: summary.path
							})
						]
					}),
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: opError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillContent, {
						summary,
						api,
						refreshKey: contentVersion
					}),
					exportPathOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExportToPathDialog, {
						summary,
						api,
						onClose: () => setExportPathOpen(false)
					}),
					deleteOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
						title: `删除 Skills 「${summary.name}」？`,
						onClose: () => setDeleteOpen(false),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "skp-modal-text",
							children: deleteBody
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-modal-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								autoFocus: true,
								onClick: () => setDeleteOpen(false),
								children: "取消"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-btn-danger",
								disabled: busy,
								onClick: () => void doRemove(),
								children: busy ? "删除中…" : "删除"
							})]
						})]
					})
				]
			});
		}
		/** 安装对话框的来源模式与 Tab 文案。 */
		const INSTALL_MODE = {
			upload: "上传",
			path: "宿主路径",
			url: "URL"
		};
		/**
		* 安装对话框：三种来源——浏览器上传（单个 .md / 整个 skill 目录 / .zip
		* 压缩包）、宿主磁盘路径、URL 下载（GitHub 仓库 / .zip / raw .md）。
		*
		* 作用域默认「本项目」（无工作区时默认「全局」、项目项置灰），可手动切到
		* 全局——对应「同屏双组」后不再有当前区概念，安装入口统一在工具条 /
		* 空组引导行（`defaultScope` 决定预选项）。
		*/
		function InstallDialog({ api, hasWorkspace, defaultScope, onClose, onInstalled }) {
			const [mode, setMode] = (0, react.useState)("upload");
			const [scopeChoice, setScopeChoice] = (0, react.useState)(defaultScope === "global" || !hasWorkspace ? "global" : "project-agents");
			const [overwrite, setOverwrite] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [errors, setErrors] = (0, react.useState)([]);
			const [sourcePath, setSourcePath] = (0, react.useState)("");
			const [url, setUrl] = (0, react.useState)("");
			const [picked, setPicked] = (0, react.useState)(void 0);
			const fileInputRef = (0, react.useRef)(null);
			const dirInputRef = (0, react.useRef)(null);
			const zipInputRef = (0, react.useRef)(null);
			/** 选中单个 .md 文件（flat 安装）。 */
			const onPickFile = async (input) => {
				const file = input.files?.[0];
				input.value = "";
				if (file === void 0) return;
				setErrors([]);
				try {
					const content = await fileToBase64(file);
					setPicked({
						label: file.name,
						files: [{
							path: file.name,
							content
						}]
					});
				} catch (failure) {
					setErrors([String(failure)]);
				}
			};
			/**
			* 选中整个目录（directory 安装）：webkitRelativePath 形如
			* `<folder>/<rel>`，剥掉首段得到 skill 内部相对路径；根上必须有 SKILL.md。
			*/
			const onPickDirectory = async (input) => {
				const files = Array.from(input.files ?? []);
				input.value = "";
				if (files.length === 0) return;
				setErrors([]);
				try {
					const payload = [];
					let folder = "";
					for (const file of files) {
						const segments = (file.webkitRelativePath || file.name).split("/");
						folder = segments[0] ?? folder;
						const inner = segments.slice(1).join("/");
						if (inner.length === 0) continue;
						payload.push({
							path: inner,
							content: await fileToBase64(file)
						});
					}
					if (!payload.some((entry) => entry.path === "SKILL.md")) {
						setPicked(void 0);
						setErrors([`文件夹 "${folder}" 的根目录下没有 SKILL.md`]);
						return;
					}
					setPicked({
						label: `${folder}/（${payload.length} 个文件）`,
						files: payload
					});
				} catch (failure) {
					setErrors([String(failure)]);
				}
			};
			/**
			* 选中 .zip 压缩包：浏览器端解压 → 剥公共顶层文件夹 → 与宿主下载安装
			* 同一套 locate 口径定位 skill 根（唯一 SKILL.md 或单 flat .md）→
			* 重定根为上传清单。
			*/
			const onPickArchive = async (input) => {
				const file = input.files?.[0];
				input.value = "";
				if (file === void 0) return;
				setErrors([]);
				try {
					const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
					const stripped = stripCommonTopFolder(entries.map((entry) => entry.path));
					const normalized = entries.map((entry, i) => ({
						...entry,
						path: stripped[i]
					}));
					const located = locateSkillRoot(normalized.map((entry) => entry.path));
					if (!located.ok) {
						setPicked(void 0);
						setErrors([located.error]);
						return;
					}
					const payload = rerootEntries(normalized, located.root).map((entry) => ({
						path: entry.path,
						content: bytesToBase64(entry.data)
					}));
					setPicked({
						label: `${file.name}（${payload.length} 个文件）`,
						files: payload
					});
				} catch (failure) {
					setPicked(void 0);
					setErrors([String(failure)]);
				}
			};
			const doInstall = async () => {
				setBusy(true);
				setErrors([]);
				const scope = scopeChoice === "global" ? "global" : "project";
				const target = scopeChoice === "project-agents" ? ".agents" : scopeChoice === "project-dsh" ? ".dsh" : void 0;
				try {
					const result = mode === "upload" ? await api.installUpload({
						scope,
						target,
						files: picked?.files ?? [],
						overwrite
					}) : mode === "path" ? await api.installFromPath({
						scope,
						target,
						sourcePath: sourcePath.trim(),
						overwrite
					}) : await api.installFromUrl({
						scope,
						target,
						url: url.trim(),
						overwrite
					});
					if (!result.ok) {
						setErrors(result.errors);
						return;
					}
					onInstalled();
				} catch (failure) {
					setErrors([String(failure)]);
				} finally {
					setBusy(false);
				}
			};
			const canSubmit = !busy && (mode === "upload" ? picked !== void 0 : mode === "path" ? sourcePath.trim().length > 0 : url.trim().length > 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
				title: "安装 Skills",
				onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-form",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-tabs",
							role: "tablist",
							children: Object.keys(INSTALL_MODE).map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								role: "tab",
								"aria-selected": mode === m,
								className: mode === m ? "skp-tab skp-tab-active" : "skp-tab",
								onClick: () => setMode(m),
								children: INSTALL_MODE[m]
							}, m))
						}),
						mode === "upload" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-field",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "来源"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-subheader-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn",
											onClick: () => fileInputRef.current?.click(),
											children: "选择 .md 文件"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn",
											onClick: () => dirInputRef.current?.click(),
											children: "选择文件夹"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn",
											onClick: () => zipInputRef.current?.click(),
											children: "选择 .zip"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									ref: fileInputRef,
									type: "file",
									accept: ".md,text/markdown",
									hidden: true,
									onChange: (e) => void onPickFile(e.currentTarget)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									ref: (el) => {
										dirInputRef.current = el;
										el?.setAttribute("webkitdirectory", "");
									},
									type: "file",
									multiple: true,
									hidden: true,
									onChange: (e) => void onPickDirectory(e.currentTarget)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									ref: zipInputRef,
									type: "file",
									accept: ".zip,application/zip",
									hidden: true,
									onChange: (e) => void onPickArchive(e.currentTarget)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-note",
									children: picked !== void 0 ? `已选择：${picked.label}` : "选择单个 <名称>.md 文件、包含 SKILL.md 的文件夹，或 .zip 压缩包。"
								})
							]
						}),
						mode === "path" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-field-label",
								children: "宿主上的源路径"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "skp-input",
								type: "text",
								placeholder: "/path/to/skill 目录或 <名称>.md",
								value: sourcePath,
								onChange: (e) => setSourcePath(e.target.value)
							})]
						}),
						mode === "url" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-field",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "下载 URL"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "skp-input",
									type: "url",
									placeholder: "https://github.com/<owner>/<repo>[/tree/<branch>/<dir>] 或 .zip / .md 链接",
									value: url,
									onChange: (e) => setUrl(e.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-note",
									children: "支持 GitHub 仓库（整库或 /tree/… 子目录）、.zip 链接或 raw .md 链接。"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-field-label",
								children: "安装到"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
								value: scopeChoice,
								ariaLabel: "安装目标",
								options: [
									{
										value: "project-agents",
										label: "项目 — .agents/skills（默认）",
										disabled: !hasWorkspace
									},
									{
										value: "project-dsh",
										label: "项目 — .dsh/skills（旧）",
										disabled: !hasWorkspace
									},
									{
										value: "global",
										label: "全局 — ~/.agents/skills"
									}
								],
								onChange: (value) => setScopeChoice(value)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "skp-field skp-field-inline",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: overwrite,
								onChange: (e) => setOverwrite(e.target.checked)
							}), "同名 Skills 已存在时覆盖"]
						}),
						errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-error",
							children: errors.join("\n")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-modal-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								onClick: onClose,
								children: "取消"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-btn-primary",
								disabled: !canSubmit,
								onClick: doInstall,
								children: busy ? "安装中…" : "安装"
							})]
						})
					]
				})
			});
		}
		/** 导出到宿主路径的小对话框：目标目录 + 覆盖开关。 */
		function ExportToPathDialog({ summary, api, onClose }) {
			const [destDir, setDestDir] = (0, react.useState)("");
			const [overwrite, setOverwrite] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [errors, setErrors] = (0, react.useState)([]);
			const doExport = async () => {
				setBusy(true);
				setErrors([]);
				try {
					const result = await api.exportToPath({
						...skillRefOf(summary),
						destDir: destDir.trim(),
						overwrite
					});
					if (!result.ok) {
						setErrors(result.errors);
						return;
					}
					onClose();
				} catch (failure) {
					setErrors([String(failure)]);
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
				title: `将「${summary.name}」导出到路径`,
				onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-form",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-field-label",
								children: "宿主上的目标目录"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "skp-input",
								type: "text",
								placeholder: "/path/to/目标目录",
								value: destDir,
								onChange: (e) => setDestDir(e.target.value)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "skp-field skp-field-inline",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: overwrite,
								onChange: (e) => setOverwrite(e.target.checked)
							}), "目标已存在时覆盖"]
						}),
						errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-error",
							children: errors.join("\n")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-modal-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								onClick: onClose,
								children: "取消"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-btn-primary",
								disabled: busy || destDir.trim().length === 0,
								onClick: doExport,
								children: busy ? "导出中…" : "导出"
							})]
						})
					]
				})
			});
		}
		/** File → base64（readAsDataURL 剥掉 `data:…;base64,` 前缀）。 */
		function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error(`读取 ${file.name} 失败`));
				reader.onload = () => {
					const dataUrl = String(reader.result);
					resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
				};
				reader.readAsDataURL(file);
			});
		}
		/** 字节 → base64（分块避免 fromCharCode 参数过长）。 */
		function bytesToBase64(bytes) {
			let binary = "";
			const CHUNK = 32768;
			for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
			return btoa(binary);
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* 客户端插件注入的纯 CSS（自包含，不依赖未验证的原语组件）。
		* 所有类名以 `skp-` 前缀避免与外层样式冲突。
		*
		* 设计语言：现代 / 扁平 / 简约。
		*   - 颜色集中在 `.skp-panel` 上的一组 `--skp-*` 设计令牌（全部回退到
		*     `--dsw-alias-*` 主题变量，外壳未定义时用中性色兜底）；
		*   - 控件一律扁平：无渐变、无重阴影，边界用 8% 透明度的细线；
		*   - 强调色只出现在主按钮、选中态与 project 标签上，其余界面保持中性灰；
		*   - 下拉框（SkpSelect，见 select.tsx）完全自绘：按钮 + fixed 弹出列表，
		*     不使用原生 <select>（其选项列表不可定制样式）。
		*
		* 注意：样式正文是一个整体模板字符串。为避免向注入样式里混入无效内容，
		* 模板字符串内部不要写注释；需要说明某段样式时，加在本文件 JS 层
		* （字符串外）即可。
		*
		* @module dsh-capability-settings/client/styles
		*/
		const SKP_CSS = `
.skp-panel{--skp-accent:var(--dsw-alias-state-business-primary,#4176e6);--skp-accent-hover:var(--dsw-alias-button-info-hover,color-mix(in srgb,var(--skp-accent) 88%,#000));--skp-accent-soft:var(--dsw-alias-state-business-tertiary,color-mix(in srgb,var(--skp-accent) 10%,transparent));--skp-on-accent:var(--dsw-alias-label-primary-foreground,#fff);--skp-success-soft:var(--dsw-alias-state-success-tertiary,color-mix(in srgb,var(--dsw-alias-state-success-primary,#189a52) 12%,transparent));--skp-warn-soft:var(--dsw-alias-state-warn-tertiary,color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c26a0a) 12%,transparent));--skp-mask:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));--skp-text:var(--dsw-alias-label-primary,#1b1f26);--skp-text-2:var(--dsw-alias-label-secondary,#5b6472);--skp-text-3:var(--dsw-alias-label-tertiary,#8b95a1);--skp-border:var(--dsw-alias-border-l2,rgba(20,28,40,.08));--skp-border-strong:var(--dsw-alias-border-l3,rgba(20,28,40,.16));--skp-fill:var(--dsw-alias-bg-module-platform,#f2f4f7);--skp-hover:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));--skp-surface:var(--dsw-alias-bg-layer-1,#fff);--skp-success:var(--dsw-alias-state-success-primary,#189a52);--skp-warn:var(--dsw-alias-state-warn-primary,#c26a0a);--skp-error:var(--dsw-alias-state-error-primary,#d64545);--skp-radius:10px;--skp-radius-sm:8px;--skp-ease:cubic-bezier(.2,.8,.3,1);display:flex;flex-direction:column;height:100%;box-sizing:border-box;font:15px/1.55 var(--dsw-font-family,system-ui,sans-serif);color:var(--skp-text);background:var(--skp-surface);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,rgba(0,0,0,.28));}
.skp-panel *{box-sizing:border-box;}
.skp-main{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;}
.skp-main>.skp-panel{flex:1 1 auto;min-height:0;background:var(--dsw-alias-bg-base,var(--skp-surface));}
.skp-header{flex:none;display:flex;flex-direction:column;gap:14px;padding:18px 20px 14px;border-bottom:1px solid var(--skp-border);}
.skp-header-row{display:flex;align-items:center;gap:12px;min-width:0;}
.skp-header-row>.skp-tabs{flex:0 0 360px;min-width:280px;}
.skp-header-search{flex:0 1 420px;min-width:160px;width:auto;margin-left:auto;height:34px;}
.skp-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.skp-title-main{display:flex;align-items:baseline;gap:10px;min-width:0;}
.skp-title-main h2{margin:0;font-size:17px;font-weight:600;letter-spacing:.01em;}
.skp-title-tools{display:flex;align-items:center;gap:10px;flex:none;min-width:0;}
.skp-workspace{font-size:12.5px;color:var(--skp-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-backdrop{position:fixed;z-index:89;inset:0;background:var(--skp-mask);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.skp-tabs{display:flex;gap:2px;padding:3px;background:var(--skp-fill);border-radius:var(--skp-radius);}
.skp-tab{flex:1;background:none;border:none;border-radius:var(--skp-radius-sm);padding:7px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;color:var(--skp-text-3);white-space:nowrap;transition:color .15s var(--skp-ease),background-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease);}
.skp-tab:hover{color:var(--skp-text);}
.skp-tab-active{background:var(--skp-surface);color:var(--skp-text);box-shadow:0 1px 2px rgba(20,28,40,.08),0 0 0 1px var(--skp-border);}
.skp-search{width:100%;height:36px;padding:0 12px 0 36px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);font:inherit;font-size:13.5px;background:var(--skp-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%238b95a1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E") no-repeat 11px center/15px 15px;color:var(--skp-text);outline:none;transition:border-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease);}
.skp-search::placeholder{color:var(--skp-text-3);}
.skp-search:focus-visible{border-color:var(--skp-border-strong);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-search::-webkit-search-cancel-button{cursor:pointer;}
.skp-status,.skp-error{padding:12px 18px;font-size:13.5px;}
.skp-status{color:var(--skp-text-3);}
.skp-error{color:var(--skp-error);background:color-mix(in srgb,var(--skp-error) 7%,transparent);white-space:pre-wrap;}
.skp-body{display:flex;flex:1;min-height:0;}
.skp-list{margin:0;padding:10px;list-style:none;flex:none;width:320px;overflow:auto;border-right:1px solid var(--skp-border);scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
.skp-list li+li{margin-top:3px;}
/* 行 = 可点击的条目本体 + 右侧「默认」开关（并排，避免按钮里嵌交互元素）。
   hover/选中底色放在整行 wrapper 上，使右侧开关也落在同一块高亮里。 */
.skp-row-wrap{display:flex;align-items:center;gap:6px;border-radius:10px;padding-right:6px;transition:background-color .12s var(--skp-ease);}
.skp-row-wrap:hover{background:var(--skp-hover);}
.skp-row-wrap-active,.skp-row-wrap-active:hover{background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-row-wrap>.skp-row{flex:1 1 auto;min-width:0;}
.skp-row-wrap>.skp-row:hover,.skp-row-wrap>.skp-row-active,.skp-row-wrap>.skp-row-active:hover{background:none;}
.skp-row-default{display:flex;flex:none;align-items:center;gap:5px;cursor:pointer;}
.skp-row-default-label{font-size:11px;color:var(--skp-text-3);white-space:nowrap;}
.skp-row{position:relative;display:flex;flex-direction:column;gap:5px;width:100%;text-align:left;background:none;border:none;border-radius:var(--skp-radius);padding:10px 14px;cursor:pointer;font:inherit;color:inherit;transition:background-color .12s var(--skp-ease);}
.skp-row:hover{background:var(--skp-hover);}
.skp-row-active,.skp-row-active:hover{background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-row-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;font-weight:600;color:var(--skp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* 行名旁的来源标记（全局/项目/引用/导入/外部·来源）不要被压缩。 */
.skp-row-name>.skp-tag{flex:none;}
.skp-row-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--skp-text-3);}
.skp-tag{flex:none;padding:0 8px;border-radius:6px;font-size:11px;font-weight:600;line-height:19px;letter-spacing:.02em;}
.skp-tag-project{color:var(--skp-accent);background:var(--skp-accent-soft);}
.skp-tag-global{color:var(--skp-success);background:var(--skp-success-soft);}
/* 注入技能来源标签（Figma v12）：内置琥珀 / 插件紫 / 预设灰；channel 用等宽小标签。 */
.skp-tag-bundled{color:var(--skp-warn);background:var(--skp-warn-soft);}
.skp-tag-plugin{color:#8b5cf6;background:color-mix(in srgb,#8b5cf6 15%,transparent);}
.skp-tag-preset{color:var(--skp-text-2);background:var(--skp-fill);}
.skp-tag-channel{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-weight:500;letter-spacing:0;color:var(--skp-text-2);background:var(--skp-fill);}
.skp-tag-flat{color:var(--skp-text-3);background:var(--skp-fill);}
.skp-tag-directory{color:var(--skp-warn);background:var(--skp-warn-soft);}
.skp-tag-readonly{color:var(--skp-text-3);background:var(--skp-fill);}
.skp-tag-error{color:var(--skp-error);background:color-mix(in srgb,var(--skp-error) 8%,transparent);}
.skp-tag-warn{color:var(--skp-warn);background:var(--skp-warn-soft);}
.skp-row-desc{font-size:13px;line-height:1.5;color:var(--skp-text-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.skp-empty{color:var(--skp-text-3);padding:28px 12px;font-size:13.5px;text-align:center;list-style:none;}
.skp-detail{flex:1;min-width:0;overflow:auto;padding:22px 24px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
.skp-detail-empty{height:100%;display:grid;place-items:center;text-align:center;font-size:13.5px;color:var(--skp-text-3);}
.skp-detail-card{font-size:14px;color:var(--skp-text-2);}
.skp-detail-card>h3{margin:0 0 16px;font-size:18px;font-weight:600;color:var(--skp-text);}
.skp-detail-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px;}
.skp-detail-head h3{margin:0;font-size:18px;font-weight:600;color:var(--skp-text);min-width:0;overflow:hidden;text-overflow:ellipsis;}
.skp-detail-fields{margin:0;display:flex;flex-direction:column;gap:2px;}
.skp-detail-fields dt{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--skp-text-3);}
.skp-detail-fields dd{margin:0 0 14px;min-width:0;}
.skp-detail-fields dd+dt{margin-top:6px;padding-top:14px;border-top:1px solid var(--skp-border);}
.skp-detail-fields dd:last-child{margin-bottom:0;}
.skp-path{display:inline-block;word-break:break-all;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:13px;background:var(--skp-fill);border-radius:6px;padding:4px 8px;}
.skp-detail-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:18px;}
.skp-form .skp-detail-actions{margin-top:6px;}
.skp-invoke-btns{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.skp-badge{flex:none;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;background:var(--skp-fill);color:var(--skp-text-2);}
.skp-domain{display:flex;flex-direction:column;flex:1;min-height:0;container-type:inline-size;}
.skp-subheader{flex:none;display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--skp-border);}
.skp-subheader .skp-tabs{flex:none;}
.skp-subheader .skp-search{flex:1;min-width:0;}
.skp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border:1px solid var(--skp-border);border-radius:999px;background:transparent;color:var(--skp-text);font:inherit;font-size:12.5px;font-weight:500;line-height:18px;cursor:pointer;white-space:nowrap;transition:background-color .15s var(--skp-ease),color .15s var(--skp-ease),border-color .15s var(--skp-ease),opacity .15s var(--skp-ease);}
.skp-btn:hover:not(:disabled){background:var(--skp-hover);}
.skp-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-btn:disabled{opacity:.4;cursor:default;}
.skp-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--skp-text));border-color:transparent;color:var(--skp-on-accent);}
.skp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#2a2f3a);color:var(--skp-on-accent);}
.skp-btn-danger-ghost{border-color:transparent;color:var(--skp-error);}
.skp-btn-danger-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,color-mix(in srgb,var(--skp-error) 8%,transparent));color:var(--skp-error);}
.skp-btn-danger{background:var(--skp-error);border-color:transparent;color:#fff;}
.skp-btn-danger:hover:not(:disabled){background:var(--skp-error);color:#fff;filter:brightness(.94);}
.skp-state-on{color:var(--skp-success);background:var(--skp-success-soft);border-color:transparent;}
.skp-state-on:hover:not(:disabled){background:color-mix(in srgb,var(--skp-success) 18%,transparent);}
.skp-state-off{color:var(--skp-text-3);background:var(--skp-fill);border-color:transparent;}
.skp-state-off:hover:not(:disabled){background:var(--skp-hover);}
.skp-state-partial{color:var(--skp-accent);background:var(--skp-accent-soft);border-color:transparent;}
.skp-state-partial:hover:not(:disabled){background:color-mix(in srgb,var(--skp-accent) 18%,transparent);}
.skp-subheader .skp-btn{height:32px;padding:0 14px;font-size:13px;}
.skp-form .skp-btn,.skp-modal-actions .skp-btn{height:32px;padding:0 14px;font-size:13px;}
.skp-dot{display:inline-block;flex:none;width:9px;height:9px;border-radius:50%;margin-right:9px;background:var(--dsw-alias-border-l2,rgba(20,28,40,.2));}
.skp-dot-enabled{background:var(--skp-success);box-shadow:0 0 0 3px color-mix(in srgb,var(--skp-success) 18%,transparent);}
.skp-dot-partial{background:var(--skp-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--skp-accent) 18%,transparent);}
.skp-dd{position:relative;display:inline-block;min-width:0;}
.skp-dd-scope{max-width:250px;}
.skp-dd-btn{display:inline-flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 30px 0 12px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);font:inherit;font-size:13px;background:var(--skp-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b95a1' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center/12px 12px;color:var(--skp-text-2);cursor:pointer;outline:none;text-align:left;transition:border-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease),color .15s var(--skp-ease);}
.skp-dd-btn:hover:not(:disabled){border-color:var(--skp-border-strong);color:var(--skp-text);}
.skp-dd-btn:focus-visible{border-color:var(--skp-border-strong);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-dd-btn:disabled{background:var(--skp-fill);color:var(--skp-text-3);cursor:default;}
.skp-dd-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-dd-pop{position:fixed;z-index:120;padding:5px;border:1px solid var(--skp-border);border-radius:10px;background:var(--skp-surface);box-shadow:0 12px 32px rgba(15,20,30,.16),0 2px 8px rgba(15,20,30,.08);overflow:auto;scrollbar-width:thin;max-width:calc(100vw - 16px);}
.skp-dd-opt{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border:none;border-radius:7px;background:none;font:inherit;font-size:13.5px;color:var(--skp-text-2);cursor:pointer;text-align:left;transition:background-color .12s var(--skp-ease),color .12s var(--skp-ease);}
.skp-dd-opt:hover:not(:disabled){background:var(--skp-hover);color:var(--skp-text);}
.skp-dd-opt-active{color:var(--skp-text);background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));font-weight:500;}
.skp-dd-opt:disabled{opacity:.45;cursor:default;}
.skp-dd-opt-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-dd-hint{margin-left:auto;flex:none;font-size:11.5px;color:var(--skp-text-3);}
.skp-dd-check{margin-left:auto;flex:none;font-size:12px;line-height:1;}
.skp-dd-hint+.skp-dd-check{margin-left:0;}
.skp-form{display:flex;flex-direction:column;gap:12px;}
.skp-form>.skp-tabs{align-self:stretch;}
.skp-field{display:flex;flex-direction:column;gap:5px;}
.skp-field .skp-dd{display:block;width:100%;}
.skp-field .skp-dd-btn{height:36px;font-size:13.5px;}
.skp-field-inline{flex-direction:row;align-items:center;gap:8px;font-size:13.5px;color:var(--skp-text-2);}
.skp-field-inline input[type="checkbox"]{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary,var(--skp-text));cursor:pointer;}
.skp-field-label{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--skp-text-3);}
.skp-input{width:100%;padding:8px 12px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);font:inherit;font-size:13.5px;background:var(--skp-surface);color:var(--skp-text);outline:none;transition:border-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease);}
.skp-input:focus-visible{border-color:var(--skp-border-strong);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-input:disabled{background:var(--skp-fill);color:var(--skp-text-3);}
.skp-textarea{min-height:72px;resize:vertical;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:13px;line-height:1.5;}
.skp-subheader-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.skp-note{font-size:13px;color:var(--skp-text-3);word-break:break-all;}
.skp-modal-overlay{position:fixed;z-index:95;inset:0;background:var(--skp-mask);display:grid;place-items:center;}
.skp-modal{width:520px;max-width:92vw;max-height:84vh;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:22px;border:1px solid var(--skp-border);border-radius:14px;background:var(--skp-surface);box-shadow:0 24px 64px rgba(15,20,30,.22),0 4px 16px rgba(15,20,30,.1);scrollbar-width:thin;}
.skp-modal h3{margin:0;font-size:16px;font-weight:600;color:var(--skp-text);}
.skp-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px;}
.skp-json-field{min-height:150px;font-size:12.5px;line-height:1.6;}
.skp-import-list{margin:0;padding:8px;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);scrollbar-width:thin;}
.skp-import-item{display:flex;align-items:center;gap:8px;min-width:0;}
.skp-import-name{flex:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--skp-text);}
.skp-import-desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--skp-text-3);}
/* 「测试连接」/「查看工具与参数」的报告：状态行 + 服务器提示（可展开）+ 工具卡片列表。
   工具列表自身滚动（不超过半个视口），避免把表单按钮或详情字段顶出屏幕；
   参数名/类型/必填收成一行徽标，说明另起一行并允许任意换行（长 URL、长英文不撑破布局）。 */
.skp-test{display:flex;flex-direction:column;gap:10px;min-width:0;}
.skp-test-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.skp-test-stat{font-size:12px;color:var(--skp-text-3);}
.skp-test-instruction{border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);padding:8px 10px;background:var(--skp-fill);min-width:0;}
.skp-test-instruction-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.skp-test-instruction-body{margin:4px 0 0;font-size:12.5px;line-height:1.55;color:var(--skp-text-2);white-space:pre-wrap;overflow-wrap:anywhere;}
.skp-test-tools{display:flex;flex-direction:column;gap:8px;max-height:min(46vh,420px);overflow:auto;padding:8px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);scrollbar-width:thin;}
.skp-tool{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-radius:var(--skp-radius-sm);background:var(--skp-fill);min-width:0;}
.skp-tool-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0;}
.skp-tool-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;color:var(--skp-text);overflow-wrap:anywhere;}
.skp-tool-desc{margin:0;font-size:12.5px;line-height:1.55;color:var(--skp-text-3);overflow-wrap:anywhere;}
.skp-params{margin:0;padding:6px 0 0;list-style:none;display:flex;flex-direction:column;gap:7px;border-top:1px dashed var(--skp-border);}
.skp-param{display:flex;flex-direction:column;gap:2px;min-width:0;}
.skp-param-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}
.skp-param-name{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;font-weight:600;color:var(--skp-text-2);overflow-wrap:anywhere;}
.skp-param-desc{margin:0;padding-left:2px;font-size:12px;line-height:1.5;color:var(--skp-text-3);overflow-wrap:anywhere;}
/* 默认折叠到 3 行，配合「展开/收起」（服务器提示与工具描述都可能很长）。 */
.skp-clamp-3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.skp-link-btn{border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--skp-accent);cursor:pointer;white-space:nowrap;}
.skp-link-btn:hover{text-decoration:underline;}
/* MCP 视图上方的「外部注入（只读）」条：默认折叠一行，展开后按 serverName 列工具。 */
.skp-runtime{display:flex;flex-direction:column;gap:8px;margin:8px 0 0;}
.skp-runtime-head{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:1px dashed var(--skp-border);border-radius:var(--skp-radius-sm);background:var(--skp-fill);font:inherit;font-size:12.5px;color:var(--skp-text-2);cursor:pointer;text-align:left;}
.skp-runtime-head:hover{border-color:var(--skp-accent);}
.skp-runtime-chevron{margin-left:auto;color:var(--skp-accent);white-space:nowrap;}
.skp-runtime-body{display:flex;flex-direction:column;gap:8px;padding:8px 10px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);}
.skp-runtime-tools{display:flex;flex-wrap:wrap;gap:4px;}
/* 详情页「使用记录」列表：时间 / 会话标题 / 工具名三列，等宽数字对齐；
   自身滚动（不超过 40vh），不把详情页顶太长。 */
.skp-usage{margin:0;padding:6px 8px;list-style:none;display:flex;flex-direction:column;gap:4px;max-height:min(40vh,320px);overflow:auto;scrollbar-width:thin;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);}
.skp-usage-row{display:flex;align-items:baseline;gap:10px;min-width:0;font-size:12.5px;}
.skp-usage-time{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:var(--skp-text-3);}
.skp-usage-session{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--skp-text-2);}
.skp-usage-tool{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;color:var(--skp-text);}
/* 详情页的「查看工具与参数」结果区：与上方字段用一条分隔线隔开。 */
.skp-detail-inspect{margin-top:14px;padding-top:14px;border-top:1px solid var(--skp-border);display:flex;flex-direction:column;gap:8px;min-width:0;}
.skp-detail-inspect-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
/* 工具参数手风琴：每行只显示工具名 + 参数个数，点击展开参数表（再点收起）。
   行按钮显式 outline:none + focus-visible 内描边，避免鼠标点击后留下白色焦点竖条。 */
.skp-tool-accordion{display:flex;flex-direction:column;gap:4px;min-width:0;max-height:min(52vh,520px);overflow:auto;padding:4px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);scrollbar-width:thin;}
.skp-tool-item{border-radius:8px;border:1px solid transparent;min-width:0;}
.skp-tool-item-open{border-color:var(--skp-border);background:var(--skp-fill);}
.skp-tool-trigger{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;background:none;border:0;border-radius:8px;font:inherit;color:var(--skp-text);text-align:left;cursor:pointer;outline:none;transition:background-color .12s var(--skp-ease);}
.skp-tool-trigger:hover{background:var(--skp-hover);}
.skp-tool-trigger:focus{outline:none;}
.skp-tool-trigger:focus-visible{outline:none;box-shadow:inset 0 0 0 1px var(--skp-accent);}
.skp-tool-trigger .skp-tool-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;}
.skp-tool-chevron{flex:none;width:12px;font-size:10px;line-height:1;text-align:center;color:var(--skp-text-3);}
.skp-tool-count{flex:none;font-size:11px;color:var(--skp-text-3);white-space:nowrap;}
.skp-tool-body{padding:2px 10px 10px;}
.skp-import-note{margin-left:10px;flex:none;font-size:12px;color:var(--skp-text-3);}
.skp-import-note-add{color:var(--skp-success);}
.skp-import-note-over{color:var(--skp-warn);}
.skp-import-note-skip{color:var(--skp-text-3);}
.skp-composer-tools{display:inline-flex;align-items:center;gap:6px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,rgba(20,28,40,.04));}
.skp-nav-glyph{display:inline-flex;align-items:center;justify-content:center;color:inherit;}
.skp-nav-glyph svg{display:block;}
.skp-nav-glyph-active{color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-composer-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);cursor:pointer;transition:color .15s ease,background-color .15s ease;}
.skp-composer-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-composer-btn svg{display:block;}
.skp-composer-btn-open{color:var(--dsw-alias-brand-primary,#4176e6);background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-composer-btn-active{color:var(--dsw-alias-state-success-primary,#189a52);}
/* 弹层底色用"层级底色"（不透明），不用宿主菜单底色 --dsw-specific-menu：
   0.2.0-rc.1 起该菜单底色本身是半透明的（light #f8f9fa94≈58% / dark
   #43454a73≈45%，且只有 html[data-platform=darwin] 被覆盖成近不透明），
   宿主靠配套的 backdrop-filter: var(--dsw-menu-backdrop-filter) 磨砂兜底。
   本弹层不做磨砂，只抄 background 会直接透出下层文字。 */
.skp-composer-pop{position:absolute;bottom:calc(100% + 8px);left:0;z-index:119;width:280px;min-width:min(260px,100%);max-height:320px;display:flex;flex-direction:column;padding:4px;border:1px solid var(--dsw-alias-border-inverted,rgba(20,28,40,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,20,30,.16),0 2px 8px rgba(15,20,30,.08));font:14px/22px var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#1b1f26);overflow:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18));--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,rgba(0,0,0,.28));}
.skp-composer-pop *{box-sizing:border-box;}
.skp-composer-head{flex:none;display:flex;align-items:center;min-height:26px;padding:6px 10px 2px;}
.skp-composer-title{flex:1;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a93a3);}
.skp-composer-body{min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
.skp-composer-group{min-height:26px;padding:6px 10px 2px;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a93a3);}
.skp-composer-group:not(:first-child){margin-top:4px;}
.skp-composer-row{display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 10px;border-radius:10px;font-size:14px;line-height:22px;}
.skp-composer-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-composer-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-border-l2,rgba(20,28,40,.16));}
.skp-composer-dot-mounted{background:var(--dsw-alias-state-success-primary,#189a52);}
.skp-composer-dot-failed{background:var(--dsw-alias-state-error-primary,#d64545);}
.skp-composer-dot-conflict{background:var(--dsw-alias-state-warn-primary,#c26a0a);}
.skp-composer-name{flex:1;min-width:0;display:flex;align-items:center;gap:6px;font-size:14px;color:var(--dsw-alias-label-primary,#1b1f26);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* 外部注入条目的来源插件名（弱化、可截断）。 */
.skp-composer-source{flex:none;max-width:96px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-switch{position:relative;flex:none;width:30px;height:18px;}
.skp-switch input{position:absolute;inset:0;z-index:1;margin:0;opacity:0;cursor:pointer;}
.skp-switch-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(20,28,40,.16));transition:background-color .15s ease;}
.skp-switch-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(15,20,30,.2);transition:transform .15s ease;}
.skp-switch input:checked + .skp-switch-track{background:var(--dsw-alias-brand-primary,#4176e6);}
.skp-switch input:checked + .skp-switch-track::after{transform:translateX(12px);}
.skp-switch input:disabled{cursor:default;}
.skp-switch input:disabled + .skp-switch-track{opacity:.45;}
.skp-composer-empty{padding:12px 10px 14px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-dimmed,#9aa3b2);}
.skp-composer-empty code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));border-radius:4px;padding:1px 4px;}
.skp-composer-banner{margin:2px 6px 4px;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 8%,transparent);color:var(--dsw-alias-state-error-primary,#d64545);font-size:12px;line-height:18px;white-space:pre-wrap;}
.skp-composer-pop-skills{width:340px;}
.skp-composer-search{flex:none;width:calc(100% - 8px);height:30px;margin:2px 4px 4px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:8px;background:transparent;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1b1f26);outline:none;transition:border-color .15s ease;}
.skp-composer-search::placeholder{color:var(--dsw-alias-label-dimmed,#9aa3b2);}
.skp-composer-search:focus-visible{border-color:var(--dsw-alias-border-l3,rgba(20,28,40,.16));}
.skp-composer-search::-webkit-search-cancel-button{cursor:pointer;}
.skp-composer-skill-row{display:flex;align-items:center;border-radius:10px;}
.skp-composer-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-composer-skill{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 6px 8px 10px;border:none;border-radius:10px;background:none;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#1b1f26);text-align:left;cursor:pointer;transition:background-color .12s ease;}
.skp-composer-skill:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-composer-skill:disabled{opacity:.45;cursor:default;}
.skp-composer-skill-name{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-composer-skill-desc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#8a93a3);}
.skp-composer-skill-send{flex:none;display:grid;place-items:center;width:28px;height:28px;margin:0 4px 0 0;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .12s ease,background-color .12s ease;}
.skp-composer-skill-row:hover .skp-composer-skill-send,.skp-composer-skill-row:focus-within .skp-composer-skill-send{opacity:1;pointer-events:auto;}
.skp-composer-skill-send:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-composer-skill-send:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(20,28,40,.16));}
.skp-composer-skill-send svg{display:block;}
.skp-dock{display:flex;justify-content:center;width:100%;min-width:0;}
.skp-dock>*{width:100%;max-width:var(--dsh-composer-card-max-width,952px);margin:0 auto;}
.skp-dock-hero-anchor{display:block;height:0;width:100%;}
.skp-dock-fixed{position:fixed;z-index:118;display:flex;justify-content:center;min-width:0;}
.skp-dock-fixed>.skp-dock-panel{width:100%;max-height:100%;}
.skp-dock-bar{display:flex;align-items:center;gap:8px;height:40px;min-width:0;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,20,30,.16));font:12px/18px var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#1b1f26);cursor:pointer;transition:border-color .15s ease,background-color .15s ease;}
.skp-dock-bar:hover{border-color:var(--dsw-alias-border-l3,rgba(20,28,40,.16));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#fff));}
.skp-dock-bar:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-title-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-bar-title{flex:none;font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-dock-bar-divider{flex:none;width:1px;height:16px;background:var(--dsw-alias-border-l2,rgba(20,28,40,.08));}
.skp-dock-bar-hint{flex:none;color:var(--dsw-alias-label-tertiary,#8b95a1);font-size:12px;}
.skp-dock-chips{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;}
.skp-dock-chip{display:inline-flex;align-items:center;gap:5px;flex:none;height:24px;padding:0 9px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));color:var(--dsw-alias-label-secondary,#5b6472);font-size:12px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;}
.skp-dock-chip-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#22c55e);}
.skp-dock-chip-mcp .skp-dock-chip-dot{background:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-chip-more{color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-spacer{flex:1 1 auto;min-width:0;}
.skp-dock-count{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);white-space:nowrap;}
.skp-dock-config-btn{flex:none;display:inline-flex;align-items:center;gap:3px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l3,rgba(20,28,40,.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#1b1f26);font:inherit;font-size:11.5px;font-weight:500;cursor:pointer;transition:background-color .15s ease;}
.skp-dock-config-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-dock-panel{display:flex;flex-direction:column;gap:8px;max-height:340px;container-type:inline-size;padding:10px 14px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,20,30,.16));font:12px/18px var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#1b1f26);overflow:hidden;box-sizing:border-box;}
.skp-dock-panel *{box-sizing:border-box;}
.skp-dock-head{flex:none;display:flex;align-items:center;gap:8px;min-height:28px;min-width:0;}
.skp-dock-title{flex:none;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-dock-scope{flex:none;padding:0 6px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-size:10.5px;font-weight:600;line-height:18px;}
.skp-dock-head-right{display:flex;align-items:center;gap:8px;margin-left:auto;min-width:0;}
.skp-dock-search{position:relative;display:inline-flex;align-items:center;width:150px;height:26px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:8px;background:var(--dsw-alias-bg-module-platform,rgba(20,28,40,.04));color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-search-icon{position:absolute;left:8px;display:inline-flex;align-items:center;justify-content:center;pointer-events:none;}
.skp-dock-search input{width:100%;height:100%;padding:0 8px 0 26px;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary,#1b1f26);font:inherit;font-size:11px;}
.skp-dock-search input::placeholder{color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:14px;cursor:pointer;}
.skp-dock-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-dock-icon-btn:disabled{opacity:.4;cursor:default;}
.skp-dock-tab-row{flex:none;display:flex;align-items:center;gap:8px;min-width:0;}
.skp-dock-tabs{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-module-platform,rgba(20,28,40,.04));}
.skp-dock-tab{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b95a1);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap;transition:background-color .12s ease,color .12s ease;}
.skp-dock-tab:hover{color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-dock-tab-active,.skp-dock-tab-active:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 9%,transparent);color:var(--dsw-alias-label-primary,#1b1f26);font-weight:600;}
.skp-dock-tab-count{font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-tab-active .skp-dock-tab-count{color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-link{border:none;background:none;padding:0 2px;color:var(--dsw-alias-state-business-primary,#4176e6);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;}
.skp-dock-link:hover{text-decoration:underline;}
.skp-dock-banner{flex:none;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);color:var(--dsw-alias-state-error-primary,#ef4444);font-size:11px;line-height:16px;}
.skp-dock-banner>span{flex:1;min-width:0;overflow-wrap:anywhere;}
.skp-dock-grid{flex:1 1 auto;min-height:0;max-height:174px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-content:start;overflow-y:auto;padding:1px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
.skp-dock-card{display:flex;flex-direction:column;gap:4px;min-height:82px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:10px;background:transparent;cursor:pointer;min-width:0;transition:background-color .12s ease,border-color .12s ease;}
.skp-dock-card:hover{border-color:var(--dsw-alias-border-l3,rgba(20,28,40,.16));background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.04));}
.skp-dock-card:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-card-on{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 8%,transparent);}
.skp-dock-card-on:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);}
.skp-dock-card-disabled{cursor:default;opacity:.68;}
.skp-dock-card-disabled:hover{border-color:var(--dsw-alias-border-l2,rgba(20,28,40,.08));background:transparent;}
.skp-dock-card-head{display:flex;align-items:center;gap:6px;min-width:0;}
.skp-dock-card-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-card-on .skp-dock-card-icon{color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-card-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-dock-card-desc{margin:0;min-height:28px;font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8b95a1);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}
.skp-dock-card-foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin-top:auto;min-width:0;}
.skp-dock-tag{flex:none;padding:0 5px;border-radius:4px;font-size:9.5px;font-weight:600;line-height:16px;letter-spacing:.02em;}
.skp-dock-tag-project{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);}
.skp-dock-tag-global{color:var(--dsw-alias-state-success-primary,#189a52);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#189a52) 12%,transparent);}
.skp-dock-tag-external{color:var(--dsw-alias-state-warn-primary,#f59e0b);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 14%,transparent);}
/* 注入来源标签（内置琥珀 / 插件紫 / 预设灰）与渠道小标签（等宽、按内容自适应宽度）。 */
.skp-dock-tag-bundled{color:var(--dsw-alias-state-warn-primary,#c26a0a);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c26a0a) 14%,transparent);}
.skp-dock-tag-plugin{color:#a78bfa;background:color-mix(in srgb,#8b5cf6 18%,transparent);}
.skp-dock-tag-preset{color:var(--dsw-alias-label-tertiary,#8b95a1);background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
/* 渠道名要能完整读出：原先 CSS 里写死 max-width:92px，把「DSH 内置（Office）」(105px)
   /「DSH 内置（随包技能目录）」(128px) /「dsh-diff-approval」(107px) 都截成半截。
   现在按内容自适应（上限 = 卡片可用宽度），只有真的放不下才 shrink + 省略；
   foot 允许换行，窄卡片上渠道名整体掉到第二行显示全文。 */
.skp-dock-tag-channel{flex:0 1 auto;min-width:0;max-width:100%;padding:0 5px;border-radius:4px;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:9.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b95a1);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 8%,transparent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-dock-card-meta{margin-left:auto;flex:none;font-size:9.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-dot{flex:none;width:6px;height:6px;margin-left:auto;border-radius:50%;background:var(--dsw-alias-border-l3,rgba(20,28,40,.16));}
.skp-dock-dot-mounted{background:var(--dsw-alias-state-success-primary,#22c55e);}
.skp-dock-dot-failed{background:var(--dsw-alias-state-error-primary,#ef4444);}
.skp-dock-dot-conflict{background:var(--dsw-alias-state-warn-primary,#f59e0b);}
.skp-dock-switch{position:relative;flex:none;width:30px;height:18px;}
.skp-dock-switch input{position:absolute;inset:0;z-index:1;margin:0;opacity:0;cursor:pointer;}
.skp-dock-switch input:disabled{cursor:default;}
.skp-dock-switch-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l3,rgba(20,28,40,.16));transition:background-color .15s ease;}
.skp-dock-switch-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(15,20,30,.2);transition:transform .15s ease;}
.skp-dock-switch input:checked+.skp-dock-switch-track{background:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-switch input:checked+.skp-dock-switch-track::after{transform:translateX(12px);}
.skp-dock-switch input:disabled+.skp-dock-switch-track{opacity:.45;}
.skp-dock-switch input:focus-visible+.skp-dock-switch-track{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);}
.skp-dock-empty{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:8px;min-height:120px;padding:12px;border:1px dashed var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:10px;color:var(--dsw-alias-label-tertiary,#8b95a1);font-size:11.5px;text-align:center;}
.skp-dock-foot{flex:none;display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(20,28,40,.05));}
.skp-dock-foot-note{flex:1 1 auto;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-dock-btn{flex:none;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3,rgba(20,28,40,.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#1b1f26);font:inherit;font-size:11px;cursor:pointer;}
.skp-dock-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-dock-btn:disabled{opacity:.5;cursor:default;}
.skp-dock-btn-primary{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);}
@container (max-width:820px){.skp-dock-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}
@container (max-width:600px){.skp-dock-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}

.skp-dock-fixed .skp-dock{max-width:none;}
.skp-dock-fixed .skp-dock>*{max-width:none;}
.skp-cap-view-host [data-composer-seat]{display:none !important;}
.skp-dock-subtitle{margin-left:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.skp-dock-panel-overlay{max-height:100%;}
.skp-cap-view{height:100%;overflow-y:auto;padding:22px 64px 32px 26px;background:transparent;box-sizing:border-box;}
.skp-cap-view *{box-sizing:border-box;}
.skp-cap-view-inner{max-width:1240px;margin:0 auto;min-height:100%;display:flex;flex-direction:column;}
.skp-dock-panel-view{max-height:none;background:transparent;border:none;box-shadow:none;padding:0;gap:12px;width:100%;min-height:100%;flex:1 1 auto;}
.skp-dock-panel-view .skp-dock-head{min-height:34px;}
.skp-dock-panel-view .skp-dock-title{font-size:15px;}
.skp-dock-panel-view .skp-dock-search{width:220px;height:30px;}
/* FINDING-02：会话「能力」Tab 1080 容器内宽 990 → 4 列需要 min ≤ (990-3×12)/4 = 238.5。
   卡片最小宽 240→228，1fr 拉伸后实际 ≈238（帧 05 的 4 列）；hero 模式仍是固定 4 列，不受影响。 */
.skp-dock-panel-view .skp-dock-grid{max-height:none;overflow:visible;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:12px;padding:0;}
.skp-dock-panel-view .skp-dock-card{min-height:100px;padding:10px 12px;border-radius:12px;}
.skp-dock-panel-view .skp-dock-card-name{font-size:12.5px;}
.skp-dock-panel-view .skp-dock-card-desc{min-height:32px;font-size:11px;line-height:16px;}
.skp-dock-panel-view .skp-dock-card-foot{margin-top:6px;}
.skp-dock-panel-view .skp-dock-foot{border-top:1px solid var(--dsw-alias-border-l1,rgba(20,28,40,.05));padding-top:12px;}
.skp-dock-panel-view .skp-dock-tabs{padding:3px;}
.skp-dock-panel-view .skp-dock-empty{min-height:220px;}
@container (max-width:900px){.skp-dock-panel-view .skp-dock-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}}
@container (min-width:1180px){.skp-dock-panel-view .skp-dock-grid{grid-template-columns:repeat(5,minmax(0,1fr));}}
@container (min-width:1180px){.skp-dock-panel-hero .skp-dock-grid{grid-template-columns:repeat(5,minmax(0,1fr));}}
.skp-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}
.skp-tab{display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.skp-tab-count{font-size:11px;font-weight:600;color:var(--skp-text-3);}
.skp-tab-active .skp-tab-count{color:var(--skp-accent);}
.skp-group{display:flex;flex-direction:column;flex:1 1 0;min-height:168px;min-width:0;}
.skp-group+.skp-group{border-top:1px solid var(--skp-border);padding-top:5px;}
.skp-group-empty{flex:0 0 auto;min-height:0;}
.skp-group-empty>.skp-group-empty{display:flex;align-items:center;gap:10px;height:48px;padding:0 8px;font-size:12.5px;color:var(--skp-text-3);}
.skp-group-head{flex:none;display:flex;align-items:center;gap:8px;height:36px;padding:0 4px;min-width:0;}
.skp-group-title{flex:none;font-size:13px;font-weight:600;color:var(--skp-text);}
.skp-group-count{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 7px;border-radius:999px;background:var(--skp-fill);font-size:11px;font-weight:600;line-height:18px;color:var(--skp-text-2);font-variant-numeric:tabular-nums;}
.skp-group-count-warn{background:var(--skp-warn-soft);color:var(--skp-warn);}
.skp-group-note{margin-left:auto;min-width:0;font-size:11px;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.skp-group-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 2px 4px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
/* 全局列表里的「注入技能」分组头（宿主 registry 条目单独成组）。 */
.skp-list-group-head{display:flex;align-items:center;gap:8px;height:34px;margin-top:6px;padding:6px 10px 0;border-top:1px solid var(--skp-border);min-width:0;}
.skp-list-group-title{flex:none;font-size:12px;font-weight:600;color:var(--skp-text-2);}
.skp-list-group-note{margin-left:auto;min-width:0;font-size:11px;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* 注入技能详情顶部的只读原因条（不是错误，弱提示）。 */
.skp-detail-readonly{flex:none;display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;padding:8px 12px;border-radius:8px;background:var(--skp-fill);font-size:12px;line-height:18px;color:var(--skp-text-3);}
.skp-detail-readonly-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-top:2px;border-radius:50%;background:var(--skp-border-strong);color:var(--skp-surface);font-size:9px;font-weight:700;line-height:1;font-style:normal;}
.skp-group-empty-row{display:flex;align-items:center;gap:10px;height:48px;padding:0 8px;font-size:12.5px;color:var(--skp-text-3);}
.skp-group-empty-row>span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-group-empty-row>.skp-btn{flex:none;height:26px;padding:0 10px;font-size:11.5px;}
.skp-group-nomatch{height:36px;}
.skp-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;width:auto;overflow:visible;border-right:none;}
.skp-row{min-height:76px;gap:3px;padding:8px 10px 8px 12px;border-radius:8px;outline:none;}
.skp-row:focus-visible{box-shadow:inset 0 0 0 1px var(--skp-accent),0 0 0 2px var(--skp-accent-soft);}
.skp-row-active{position:relative;}
.skp-row-active::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--skp-accent);}
.skp-row-name{font-size:13.5px;}
.skp-row-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-row-mid{display:flex;align-items:center;gap:6px;min-width:0;}
.skp-row-tags{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0;overflow:hidden;}
.skp-row-toggle{display:inline-flex;align-items:center;gap:5px;flex:none;margin-left:auto;cursor:pointer;}
.skp-row-default-label{font-size:11px;color:var(--skp-text-3);white-space:nowrap;}
.skp-row-desc{font-size:12.5px;line-height:18px;color:var(--skp-text-3);}
button.skp-tag{border:0;appearance:none;cursor:pointer;font-family:inherit;line-height:19px;}
button.skp-tag:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-accent-soft);}
.skp-tag-relation{color:var(--skp-accent);background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--skp-accent) 45%,transparent);}
.skp-tag-relation:hover{background:var(--skp-accent-soft);}
.skp-dot-hollow{background:transparent;box-shadow:inset 0 0 0 1.5px var(--skp-text-3);}
.skp-dot{margin-right:6px;}
.skp-detail-fixed{display:flex;padding:20px 24px;overflow:hidden;}
.skp-detail-fixed .skp-detail-empty{flex:1 1 auto;width:100%;}
.skp-detail-fixed .skp-detail-card{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;gap:0;font-size:14px;color:var(--skp-text-2);}
.skp-detail-fixed .skp-detail-head{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex:none;min-height:40px;margin-bottom:10px;min-width:0;}
.skp-detail-fixed .skp-detail-head h3{flex:0 1 auto;min-width:0;margin:0;font-size:18px;font-weight:600;color:var(--skp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-detail-fixed .skp-detail-head>.skp-badge{font-size:11px;padding:2px 10px;}
.skp-detail-head-spacer{flex:1 1 auto;min-width:0;}
.skp-detail-desc{flex:none;max-height:36px;overflow:hidden;margin:-2px 0 8px;font-size:12.5px;line-height:18px;color:var(--skp-text-3);}
.skp-detail-desc-text{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-detail-actions{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.skp-detail-meta{flex:none;display:flex;align-items:center;gap:8px;min-width:0;height:36px;margin-bottom:10px;font-size:12px;color:var(--skp-text-3);}
.skp-detail-meta-item{flex:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}
.skp-detail-meta-strong{color:var(--skp-text-2);}
.skp-detail-meta .skp-invoke-btns{flex-wrap:nowrap;gap:5px;}
.skp-detail-meta .skp-invoke-btns .skp-btn{height:24px;padding:0 8px;font-size:11px;}
.skp-detail-path{flex:1 1 auto;min-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:none;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;color:var(--skp-text-3);text-align:left;cursor:pointer;}
.skp-detail-path:hover{color:var(--skp-text-2);}
.skp-detail-path:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);border-radius:4px;}
.skp-skill-content{flex:1 1 auto;min-height:320px;display:flex;gap:16px;min-width:0;overflow:hidden;}
.skp-skill-content-collapsed{flex-direction:column;gap:8px;}
.skp-file-tree{flex:none;display:flex;flex-direction:column;min-height:0;min-width:0;border:1px solid var(--skp-border);border-radius:var(--skp-radius);overflow:hidden;outline:none;}
.skp-file-tree:focus-visible{box-shadow:inset 0 0 0 1px var(--skp-accent);}
.skp-file-tree-head{flex:none;display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-bottom:1px solid var(--skp-border);}
.skp-file-tree-title{flex:1 1 auto;font-size:12px;font-weight:600;color:var(--skp-text-2);}
.skp-file-tree-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 4px 8px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
.skp-file-tree-error,.skp-file-tree-empty{display:flex;align-items:center;gap:8px;padding:12px;font-size:12px;color:var(--skp-text-3);}
.skp-tree-row{display:flex;align-items:center;gap:6px;min-height:30px;padding:0 6px 0 0;border-radius:6px;min-width:0;font-size:12.5px;color:var(--skp-text-2);cursor:default;}
.skp-tree-row:hover{background:var(--skp-hover);}
.skp-tree-file{cursor:pointer;}
.skp-tree-row-active,.skp-tree-row-active:hover{position:relative;background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));color:var(--skp-text);}
.skp-tree-row-active::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:2px;border-radius:2px;background:var(--skp-accent);}
.skp-file-tree:focus-visible .skp-tree-row-focus{outline:1px solid var(--skp-accent);outline-offset:-1px;}
.skp-tree-chevron{flex:none;width:12px;font-size:10px;line-height:1;color:var(--skp-text-3);text-align:center;}
.skp-tree-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-tree-count,.skp-tree-size{flex:none;font-size:11px;color:var(--skp-text-3);font-variant-numeric:tabular-nums;}
.skp-tree-badge{flex:none;min-width:26px;padding:0 4px;border-radius:4px;background:var(--skp-fill);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:9.5px;font-weight:600;line-height:16px;text-align:center;color:var(--skp-text-3);}
.skp-tree-root{color:var(--skp-text-2);font-weight:500;}
.skp-tree-note{padding:6px 8px;font-size:11px;color:var(--skp-text-3);}
.skp-file-picker{flex:none;display:flex;align-items:center;gap:8px;min-width:0;height:36px;}
.skp-file-picker-label{flex:none;font-size:12px;color:var(--skp-text-3);}
.skp-file-picker-dd{flex:1 1 auto;min-width:0;}
.skp-file-picker-dd .skp-dd{width:100%;}
.skp-file-picker-dd .skp-dd-btn{height:36px;}
.skp-reader{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--skp-border);border-radius:var(--skp-radius);overflow:hidden;}
.skp-reader-head{flex:none;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-bottom:1px solid var(--skp-border);min-width:0;}
.skp-reader-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--skp-text);}
.skp-reader-meta{flex:none;font-size:11px;color:var(--skp-text-3);}
.skp-reader-seg{display:inline-flex;gap:2px;padding:2px;margin-left:auto;flex:none;border-radius:7px;background:var(--skp-fill);}
.skp-reader-seg-btn{height:22px;padding:0 8px;border:none;border-radius:5px;background:none;font:inherit;font-size:11.5px;color:var(--skp-text-3);cursor:pointer;}
.skp-reader-seg-btn:hover{color:var(--skp-text-2);}
.skp-reader-seg-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-reader-seg-active,.skp-reader-seg-active:hover{background:var(--skp-surface);color:var(--skp-text);box-shadow:0 0 0 1px var(--skp-border);}
.skp-reader-copy{flex:none;}
.skp-reader-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 18px;font-size:12.5px;line-height:1.7;color:var(--skp-text-2);scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;overflow-wrap:anywhere;outline:none;}
.skp-reader-body:focus-visible{box-shadow:inset 0 0 0 1px var(--skp-border-strong);}
.skp-reader-text{margin:0;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:1.6;color:var(--skp-text-2);white-space:pre-wrap;overflow-wrap:anywhere;}
.skp-reader-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:100%;padding:20px;text-align:center;color:var(--skp-text-3);}
.skp-reader-state-muted{color:var(--skp-text-3);font-size:12.5px;}
.skp-reader-badge{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:28px;padding:0 10px;border-radius:6px;background:var(--skp-fill);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;font-weight:600;color:var(--skp-text-2);}
.skp-reader-binary-title{margin:0;font-size:13.5px;font-weight:500;color:var(--skp-text-2);}
.skp-reader-error{color:var(--skp-error);font-size:12.5px;margin:0;}
.skp-reader-truncated{display:flex;align-items:center;gap:10px;margin-top:12px;padding:8px 10px;border-radius:6px;background:var(--skp-fill);font-size:11.5px;color:var(--skp-text-3);}
.skp-skeleton-tree{display:flex;flex-direction:column;gap:10px;padding:10px 6px;}
.skp-skeleton-reader{display:flex;flex-direction:column;gap:10px;}
.skp-skeleton-line{display:block;height:12px;border-radius:4px;background:var(--skp-fill);animation:skp-breathe 1.2s ease-in-out infinite;}
@keyframes skp-breathe{0%,100%{opacity:.55;}50%{opacity:1;}}
@media (prefers-reduced-motion:reduce){.skp-skeleton-line{animation:none;}}
.skp-md{font-size:12.5px;line-height:1.7;color:var(--skp-text-2);overflow-wrap:anywhere;}
.skp-md>:first-child{margin-top:0;}
.skp-md-h1{margin:16px 0 8px;font-size:15px;line-height:1.5;font-weight:600;color:var(--skp-text);}
.skp-md-h2{margin:14px 0 7px;font-size:13.5px;line-height:1.5;font-weight:600;color:var(--skp-text);}
.skp-md-h3{margin:12px 0 6px;font-size:13px;line-height:1.5;font-weight:600;color:var(--skp-text);}
.skp-md-p{margin:0 0 10px;}
.skp-md-ul,.skp-md-ol{margin:0 0 10px;padding-left:20px;}
.skp-md-ul li,.skp-md-ol li{margin:2px 0;}
.skp-md-pre{margin:0 0 12px;padding:10px;border-radius:6px;background:var(--skp-fill);overflow-x:auto;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:1.6;color:var(--skp-text-2);white-space:pre;}
.skp-md-pre code{font-family:inherit;font-size:inherit;}
.skp-md-inline-code{padding:1px 4px;border-radius:4px;background:var(--skp-fill);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;color:var(--skp-text);}
.skp-md-quote{margin:0 0 12px;padding:2px 0 2px 12px;border-left:2px solid var(--skp-border-strong);color:var(--skp-text-3);}
.skp-md-quote p{margin:0 0 4px;}
.skp-md-hr{margin:14px 0;border:0;border-top:1px solid var(--skp-border);}
.skp-md-warn{margin:0 0 8px;font-size:11.5px;color:var(--skp-warn);}
.skp-modal-text{margin:0;font-size:13.5px;line-height:1.6;color:var(--skp-text-2);}

.skp-scope-nav{flex:none;width:208px;display:flex;flex-direction:column;gap:2px;padding:8px;min-height:0;overflow:hidden;border-right:1px solid var(--skp-border);}
.skp-scope-item{flex:none;display:flex;align-items:center;gap:4px;min-height:36px;padding:0 4px 0 8px;border-radius:8px;color:var(--skp-text-2);min-width:0;}
.skp-scope-item:hover{background:var(--skp-hover);}
.skp-scope-item-active,.skp-scope-item-active:hover{background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));color:var(--skp-text);}
.skp-scope-main{flex:1 1 auto;display:flex;align-items:center;gap:8px;min-width:0;height:36px;padding:0;border:0;background:none;font:inherit;font-size:13.5px;font-weight:600;color:inherit;text-align:left;cursor:pointer;}
.skp-scope-main:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-accent-soft);border-radius:6px;}
.skp-scope-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-scope-count{flex:none;font-size:11px;font-weight:600;color:var(--skp-text-3);font-variant-numeric:tabular-nums;}
.skp-scope-item-active .skp-scope-count{color:var(--skp-accent);}
.skp-scope-add{flex:none;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--skp-text-3);font:inherit;font-size:15px;line-height:1;cursor:pointer;transition:background-color .12s var(--skp-ease),color .12s var(--skp-ease);}
.skp-scope-add:hover:not(:disabled){background:var(--skp-hover);color:var(--skp-text);}
.skp-scope-add:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-scope-add:disabled{opacity:.4;cursor:default;}
.skp-scope-workspaces{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:1px;margin-top:4px;padding-top:4px;overflow-y:auto;overflow-x:hidden;border-top:1px solid var(--skp-border);scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
.skp-scope-workspace{position:relative;display:block;flex:none;width:100%;height:34px;line-height:34px;padding:0 8px 0 12px;border:0;border-radius:6px;background:none;font:inherit;font-size:12.5px;color:var(--skp-text-2);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:background-color .12s var(--skp-ease),color .12s var(--skp-ease);}
.skp-scope-workspace:hover{background:var(--skp-hover);color:var(--skp-text);}
.skp-scope-workspace:focus-visible{outline:none;box-shadow:inset 0 0 0 1px var(--skp-accent);}
.skp-scope-workspace-active,.skp-scope-workspace-active:hover{background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));color:var(--skp-text);font-weight:500;}
.skp-scope-workspace-active::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:2px;border-radius:2px;background:var(--skp-accent);}
.skp-scope-workspace-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-scope-empty{padding:8px 12px;font-size:11.5px;line-height:16px;color:var(--skp-text-3);}
.skp-workspace-pane{flex:none;width:280px;display:flex;flex-direction:column;min-height:0;min-width:0;padding:8px;overflow:hidden;border-right:1px solid var(--skp-border);}
.skp-pane-back{flex:none;display:flex;align-items:center;gap:4px;height:30px;padding:0 8px;margin-bottom:2px;border:0;border-radius:6px;background:none;font:inherit;font-size:12.5px;color:var(--skp-text-3);text-align:left;cursor:pointer;}
.skp-pane-back:hover{background:var(--skp-hover);color:var(--skp-text-2);}
.skp-pane-back:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-pane-title{flex:none;display:flex;align-items:center;gap:8px;height:36px;padding:0 6px;min-width:0;font-size:13px;font-weight:600;color:var(--skp-text);overflow:hidden;white-space:nowrap;}
.skp-pane-title-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-workspace-row{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;min-width:0;padding:8px 10px;border:0;border-radius:8px;background:none;font:inherit;text-align:left;cursor:pointer;}
.skp-workspace-row:hover{background:var(--skp-hover);}
.skp-workspace-row:focus-visible{outline:none;box-shadow:inset 0 0 0 1px var(--skp-accent);}
.skp-workspace-name{width:100%;font-size:13px;font-weight:600;color:var(--skp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-workspace-path{width:100%;font-size:11.5px;color:var(--skp-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@container (max-width:1050px){.skp-scope-nav{width:180px;}.skp-workspace-pane{width:250px;}}
@container (max-width:900px){.skp-scope-nav{width:160px;}.skp-workspace-pane{width:230px;}}
.skp-jev{flex:1 1 auto;min-height:0;overflow:auto;container-type:inline-size;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;background:var(--dsw-alias-bg-base,var(--skp-surface));}
.skp-jev-inner{display:flex;flex-direction:column;align-items:center;padding:40px 24px 48px;}
.skp-jev-top{display:flex;flex-direction:column;gap:10px;width:100%;max-width:820px;margin-bottom:12px;}
.skp-jev-card{display:flex;flex-direction:column;gap:16px;width:100%;max-width:820px;padding:28px;border:1px solid var(--skp-border);border-radius:14px;background:var(--skp-surface);}
.skp-jev-title{margin:0;font-size:18px;font-weight:600;color:var(--skp-text);}
.skp-jev-subtitle{margin:0;font-size:13px;line-height:1.6;color:var(--skp-text-2);}
.skp-jev-banner{padding:10px 14px;border-radius:10px;background:var(--skp-warn-soft);color:var(--skp-warn);font-size:12.5px;line-height:1.55;}
.skp-jev-loading{padding:20px 0;text-align:center;font-size:13px;color:var(--skp-text-3);}
.skp-jev-field{display:flex;flex-direction:column;gap:5px;min-width:0;}
.skp-jev-label{font-size:12px;color:var(--skp-text-2);}
.skp-jev-label-strong{font-size:13px;color:var(--skp-text);}
.skp-jev-hint{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;line-height:1.55;color:var(--skp-text-3);}
.skp-jev-key-meta{color:var(--skp-text-2);}
.skp-jev-err{font-size:12px;line-height:1.5;color:var(--skp-error);}
.skp-jev-input{width:100%;height:34px;padding:0 12px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);background:var(--skp-surface);color:var(--skp-text);font:inherit;font-size:13.5px;outline:none;transition:border-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease);}
.skp-jev-input::placeholder{color:var(--skp-text-3);}
.skp-jev-input:focus-visible{border-color:var(--skp-border-strong);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-jev-input:disabled{background:var(--skp-fill);color:var(--skp-text-3);cursor:default;}
.skp-jev-input-invalid,.skp-jev-input-invalid:focus-visible{border-color:var(--skp-error);}
.skp-jev-input-row{display:flex;align-items:center;gap:8px;min-width:0;}
.skp-jev-input-row>.skp-jev-input{flex:1 1 auto;min-width:0;}
.skp-jev-btn-icon{flex:none;height:34px;padding:0 10px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);background:transparent;color:var(--skp-text-2);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background-color .15s var(--skp-ease),color .15s var(--skp-ease),border-color .15s var(--skp-ease);}
.skp-jev-btn-icon:hover:not(:disabled){background:var(--skp-hover);color:var(--skp-text);}
.skp-jev-btn-icon:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-jev-btn-icon:disabled{opacity:.45;cursor:default;}
.skp-jev-seg{display:inline-flex;align-self:flex-start;padding:3px;border-radius:var(--skp-radius-sm);background:var(--skp-fill);}
.skp-jev-seg-btn{height:28px;padding:0 16px;border:none;border-radius:6px;background:none;font:inherit;font-size:12.5px;font-weight:500;color:var(--skp-text-3);cursor:pointer;white-space:nowrap;transition:color .15s var(--skp-ease),background-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease);}
.skp-jev-seg-btn:hover:not(:disabled){color:var(--skp-text);}
.skp-jev-seg-btn-active,.skp-jev-seg-btn-active:hover{background:var(--skp-surface);color:var(--skp-text);box-shadow:0 0 0 1px var(--skp-border);}
.skp-jev-seg-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-jev-seg-btn:disabled{opacity:.5;cursor:default;}
.skp-jev-section{display:flex;flex-direction:column;gap:14px;padding-top:16px;border-top:1px solid var(--skp-border);}
.skp-jev-section-title{margin:0;font-size:14px;font-weight:600;color:var(--skp-text);}
.skp-jev-switch-row{display:flex;align-items:center;gap:14px;min-height:34px;}
.skp-jev-switch-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;}
.skp-jev-num-row{display:flex;align-items:center;gap:10px;min-width:0;}
.skp-jev-num-row>.skp-jev-label{flex:1 1 auto;min-width:0;}
.skp-jev-num{flex:none;width:104px;height:34px;text-align:right;font-variant-numeric:tabular-nums;}
.skp-jev-unit{flex:none;font-size:12.5px;color:var(--skp-text-3);white-space:nowrap;}
.skp-jev-callout{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:10px;background:var(--skp-fill);font-size:12px;line-height:1.6;color:var(--skp-text-3);}
.skp-jev-test{display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:1px solid var(--skp-border);}
.skp-jev-test-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.skp-jev-test-running{font-size:12.5px;color:var(--skp-text-3);}
.skp-jev-test-ok{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;line-height:1.5;color:var(--skp-success);}
.skp-jev-test-ok>.skp-jev-hint{color:var(--skp-text-3);}
.skp-jev-test-err{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;line-height:1.5;color:var(--skp-error);}
.skp-jev-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:16px;border-top:1px solid var(--skp-border);}
.skp-jev-actions-left,.skp-jev-actions-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;}
.skp-jev-actions-note{font-size:12px;color:var(--skp-text-3);white-space:nowrap;}
.skp-jev-dirty{font-size:12px;color:var(--skp-warn);white-space:nowrap;}
.skp-jev-saved-note{font-size:12.5px;color:var(--skp-success);white-space:nowrap;}
.skp-jev-actions .skp-btn,.skp-jev-test .skp-btn{height:32px;padding:0 16px;font-size:13px;}
.skp-jev-error-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--skp-error) 8%,transparent);color:var(--skp-error);font-size:12.5px;line-height:1.55;}
.skp-jev-error-bar>span{flex:1 1 240px;min-width:0;overflow-wrap:anywhere;}
@container (max-width:900px){.skp-jev-inner{padding:24px 16px 32px;}.skp-jev-card{padding:22px;}}
@container (max-width:720px){.skp-jev-inner{padding:14px 10px 24px;}.skp-jev-card{padding:16px;gap:14px;}.skp-jev-actions{flex-direction:column;align-items:stretch;}.skp-jev-actions-right{justify-content:space-between;}.skp-jev-num{width:88px;}.skp-jev-num-row{flex-wrap:wrap;}}
.skp-decision-entry{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;width:112px;height:28px;padding:0 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,opacity .15s ease;}
.skp-decision-entry:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);}
.skp-decision-entry:active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 24%,transparent);}
.skp-decision-entry:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);}
.skp-decision-entry[aria-disabled="true"]{opacity:.45;cursor:default;}
.skp-decision-entry[aria-disabled="true"]:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 35%,transparent);}
.skp-decision-entry-bar{height:26px;}
.skp-decision-entry-star{font-size:11px;line-height:1;}
.skp-decision-entry-label{font-size:12px;font-weight:500;}
.skp-decision-entry-dot{position:absolute;top:2px;right:2px;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-decision-hint{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.skp-decision-panel{display:flex;flex-direction:column;gap:8px;width:100%;min-height:0;max-height:100%;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,20,30,.16));font:12px/18px var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#1b1f26);container-type:inline-size;box-sizing:border-box;overflow:hidden;}
.skp-decision-panel *{box-sizing:border-box;}
.skp-decision-head{flex:none;display:flex;align-items:center;gap:8px;min-width:0;}
.skp-decision-title{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#1b1f26);outline:none;white-space:nowrap;}
.skp-decision-title:focus-visible{outline:none;}
.skp-decision-star{font-size:12px;color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-decision-badge{flex:none;max-width:180px;padding:1px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-size:10.5px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-decision-badge-auto{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#189a52) 14%,transparent);color:var(--dsw-alias-state-success-primary,#189a52);}
.skp-decision-close{margin-left:auto;flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:15px;line-height:1;cursor:pointer;}
.skp-decision-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-decision-close[aria-disabled="true"]{opacity:.4;cursor:default;}
.skp-decision-close[aria-disabled="true"]:hover{background:transparent;}
.skp-decision-threshold{flex:none;display:flex;align-items:center;gap:8px;min-width:0;}
.skp-decision-threshold-label{flex:none;font-size:11.5px;color:var(--dsw-alias-label-secondary,#5b6472);white-space:nowrap;}
.skp-decision-range{flex:1 1 auto;min-width:120px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4176e6);cursor:pointer;}
.skp-decision-range:disabled{cursor:default;opacity:.5;}
.skp-decision-threshold-value{flex:none;font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-decision-count{flex:none;margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b95a1);font-variant-numeric:tabular-nums;white-space:nowrap;}
.skp-decision-nomatch{flex:none;margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#c26a0a);}
.skp-decision-banner{flex:none;padding:5px 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 8%,transparent);color:var(--dsw-alias-label-secondary,#5b6472);font-size:11px;line-height:16px;overflow-wrap:anywhere;}
.skp-decision-list{flex:1 1 auto;min-height:48px;margin:0;padding:1px;list-style:none;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
/* FINDING-03：结果列表的滚动容器与“还有更多”的底部渐隐提示（仅内容溢出时渲染）。 */
.skp-decision-list-wrap{position:relative;flex:1 1 auto;min-height:48px;display:flex;min-width:0;}
.skp-decision-list-wrap>.skp-decision-list{flex:1 1 auto;min-width:0;}
.skp-decision-list-fade{position:absolute;left:0;right:0;bottom:0;height:20px;pointer-events:none;background:linear-gradient(to bottom,transparent,var(--dsw-alias-bg-layer-1,#fff));}
.skp-decision-row{display:grid;grid-template-columns:18px 34px minmax(0,1fr) minmax(0,1.2fr) 72px 44px;align-items:center;gap:8px;min-height:44px;padding:4px 8px;border-left:2px solid transparent;border-radius:8px;transition:background-color .12s ease,opacity .12s ease;}
.skp-decision-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.04));}
.skp-decision-row-selected{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 8%,transparent);}
.skp-decision-row-manual{border-left-color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-decision-row-below{opacity:.55;}
.skp-decision-row-unavailable{opacity:.45;}
.skp-decision-check{display:inline-flex;align-items:center;justify-content:center;margin:0;}
.skp-decision-check input{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4176e6);cursor:pointer;}
.skp-decision-check input:disabled{cursor:default;}
.skp-decision-kind{justify-self:start;flex:none;min-width:34px;padding:0 5px;border-radius:4px;font-size:10px;font-weight:600;line-height:16px;text-align:center;white-space:nowrap;}
.skp-decision-kind-skill{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);}
.skp-decision-kind-mcp{color:var(--dsw-alias-state-success-primary,#189a52);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#189a52) 12%,transparent);}
.skp-decision-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#1b1f26);}
/* 名称 + 来源小标签（Figma v12-03）：标签紧跟名称，窄容器截断标签。 */
.skp-decision-name-cell{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;}
.skp-decision-name-cell .skp-decision-name{flex:0 1 auto;min-width:0;}
.skp-decision-src{flex:none;max-width:96px;padding:0 5px;border-radius:4px;font-size:9.5px;font-weight:600;line-height:16px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.skp-decision-src-project{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);}
.skp-decision-src-global{color:var(--dsw-alias-state-success-primary,#189a52);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#189a52) 12%,transparent);}
.skp-decision-src-bundled{color:var(--dsw-alias-state-warn-primary,#c26a0a);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c26a0a) 14%,transparent);}
.skp-decision-src-plugin{color:#a78bfa;background:color-mix(in srgb,#8b5cf6 18%,transparent);}
.skp-decision-src-preset{color:var(--dsw-alias-label-tertiary,#8b95a1);background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-decision-src-external{color:var(--dsw-alias-label-secondary,#5b6472);background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.06));}
.skp-decision-desc-cell{min-width:0;display:flex;flex-direction:column;overflow:hidden;}
.skp-decision-desc{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-decision-reason{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-decision-bar{position:relative;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2,rgba(20,28,40,.08));overflow:hidden;}
.skp-decision-bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-decision-score{font-size:11.5px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-decision-empty{display:flex;align-items:center;justify-content:center;min-height:96px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-decision-foot{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(20,28,40,.05));}
.skp-decision-btn{flex:none;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3,rgba(20,28,40,.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#1b1f26);font:inherit;font-size:11.5px;white-space:nowrap;cursor:pointer;transition:background-color .15s ease,opacity .15s ease;}
.skp-decision-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-decision-btn:disabled{opacity:.5;cursor:default;}
.skp-decision-btn:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);}
.skp-decision-btn-primary{min-width:120px;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-decision-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 20%,transparent);}
.skp-decision-loading{flex:none;display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-decision-spinner{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 25%,transparent);border-top-color:var(--dsw-alias-state-business-primary,#4176e6);animation:skp-spin .8s linear infinite;}
@keyframes skp-spin{to{transform:rotate(360deg);}}
.skp-decision-skeleton{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px;min-height:60px;}
.skp-decision-skel-row{display:flex;align-items:center;gap:8px;height:30px;}
.skp-decision-skel-dot{flex:none;width:14px;height:14px;border-radius:4px;background:var(--dsw-alias-border-l2,rgba(20,28,40,.08));}
.skp-decision-skel-line{height:10px;border-radius:4px;background:var(--dsw-alias-border-l2,rgba(20,28,40,.08));animation:skp-breathe 1.2s ease-in-out infinite;}
.skp-decision-skel-line-a{flex:0 0 24%;}
.skp-decision-skel-line-b{flex:1 1 auto;}
.skp-decision-skel-line-c{flex:0 0 12%;}
@media (prefers-reduced-motion:reduce){.skp-decision-spinner{animation:none;}.skp-decision-skel-line{animation:none;}}
.skp-decision-error{flex:1 1 auto;min-height:120px;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 8%,transparent);}
.skp-decision-error-title{margin:0;font-size:12.5px;font-weight:600;line-height:18px;color:var(--dsw-alias-state-error-primary,#d64545);}
.skp-decision-error-body{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-decision-applyerr{flex:none;display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 9%,transparent);color:var(--dsw-alias-state-error-primary,#d64545);font-size:11px;line-height:16px;}.skp-decision-applyerr-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;}.skp-decision-link{flex:none;border:none;background:none;padding:0;color:inherit;font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;}
.skp-decision-toast{position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);z-index:2;max-width:calc(100% - 16px);padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,20,30,.16));font:11.5px/16px var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#1b1f26);overflow-wrap:anywhere;}
.skp-decision-toast-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#189a52) 40%,transparent);}
.skp-decision-toast-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c26a0a) 40%,transparent);}
.skp-dock-fixed>.skp-decision-panel{max-height:100%;}
@container (max-width:720px){.skp-decision-hint{display:none;}.skp-decision-row{grid-template-columns:18px 34px minmax(0,1fr) 72px 44px;grid-template-areas:"check kind name name score" "check kind desc desc bar";row-gap:2px;min-height:56px;}.skp-decision-check{grid-area:check;}.skp-decision-kind{grid-area:kind;}.skp-decision-name{grid-area:name;}.skp-decision-desc-cell{grid-area:desc;}.skp-decision-bar{grid-area:bar;align-self:center;}.skp-decision-score{grid-area:score;align-self:start;}.skp-decision-threshold{flex-wrap:wrap;row-gap:4px;}.skp-decision-count{flex:1 1 100%;margin-left:0;text-align:right;}}
@container (max-width:720px){.skp-decision-name-cell{grid-area:name;}.skp-decision-src{max-width:64px;}}
@container (max-width:560px){.skp-decision-desc{display:none;}.skp-decision-foot{flex-wrap:wrap;}.skp-decision-btn{flex:1 1 auto;}.skp-decision-btn-primary{flex:1 1 100%;order:3;min-width:0;}.skp-decision-badge-auto{display:none;}}
.skp-decision-bar-wrap{display:flex;flex-direction:column;width:100%;min-width:0;}

/* v13 R1：本会话控制条（行 3）。左批量 + 计数 + 范围说明；右侧预留给 R2 派生
   继承（本批零实现，不渲染控件），因此本块只定义已用到的结构。 */
.skp-dock-rail{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-height:36px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,rgba(20,28,40,.04));}
.skp-dock-rail-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:64px;height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3,rgba(20,28,40,.16));border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:11px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,color .12s ease;}
.skp-dock-rail-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-dock-rail-btn:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);}
.skp-dock-rail-btn-primary{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-rail-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-rail-btn:disabled,.skp-dock-rail-btn[aria-disabled="true"]{border-color:var(--dsw-alias-border-l2,rgba(20,28,40,.08));background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 4%,transparent);color:var(--dsw-alias-label-tertiary,#8b95a1);cursor:default;}
.skp-dock-rail-count{flex:none;font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#5b6472);white-space:nowrap;}
.skp-dock-rail-note{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b95a1);white-space:nowrap;}
.skp-dock-rail-progress{flex:none;font-size:11px;color:var(--dsw-alias-state-business-primary,#4176e6);white-space:nowrap;}
.skp-dock-rail-fail{flex:none;padding:0;border:none;background:none;font:inherit;font-size:11px;color:var(--dsw-alias-state-error-primary,#d64545);white-space:nowrap;}
button.skp-dock-rail-fail{cursor:pointer;text-decoration:underline;}
button.skp-dock-rail-fail:hover{filter:brightness(.9);}
/* Tools 域：来源未识别（琥珀）/ 行内工具数（灰）。 */
.skp-dock-tag-unattributed{color:var(--dsw-alias-state-warn-primary,#c26a0a);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#c26a0a) 14%,transparent);}
.skp-dock-tag-count{flex:none;padding:0 5px;border-radius:4px;font-size:9.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b95a1);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 8%,transparent);}
.skp-dock-chip-tool .skp-dock-chip-dot{background:var(--dsw-alias-state-warn-primary,#c26a0a);}
/* 决策结果行：Tools 行（插件）标签 / N 个工具 / 底部说明。 */
.skp-decision-kind-tool{color:#a78bfa;background:color-mix(in srgb,#8b5cf6 18%,transparent);}
.skp-decision-toolcount{flex:none;padding:0 5px;border-radius:4px;font-size:9.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b95a1);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 8%,transparent);white-space:nowrap;}
.skp-decision-note{flex:none;margin:0;font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
/* v13 R3：能力面板 · Tools 页（两栏；无左导航）。 */
.skp-tools-body{overflow:hidden;}
.skp-tools-pane{width:420px;}
.skp-pane-title-note{min-width:0;margin-left:auto;font-size:11px;font-weight:400;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.skp-tools-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;min-width:0;}
.skp-tools-item{display:flex;flex-direction:column;gap:2px;padding:7px 10px;border-radius:6px;min-width:0;}
.skp-tools-item:nth-child(odd){background:var(--skp-fill);}
.skp-tools-name{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;font-weight:600;color:var(--skp-text);overflow-wrap:anywhere;}
.skp-tools-desc{font-size:12px;line-height:1.5;color:var(--skp-text-3);overflow-wrap:anywhere;}
.skp-tools-impact{padding:8px 12px;border-radius:8px;background:var(--skp-warn-soft);color:var(--skp-warn);font-size:12px;line-height:1.55;}
/* v13 R5：Jev 配置页副标题第二行 + API Key ⓘ（安全承诺收进 tooltip）。 */
.skp-jev-subtitle-sub{font-size:11.5px;color:var(--skp-text-3);}
.skp-jev-label-row{display:flex;align-items:center;gap:6px;min-width:0;}
.skp-jev-info{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--skp-text-3);font:inherit;font-size:12px;line-height:1;cursor:help;}
.skp-jev-info:hover{color:var(--skp-text-2);}
.skp-jev-info:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-jev-key-safety{font-size:11.5px;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
@container (max-width:1100px){.skp-tools-pane{width:340px;}}
@container (max-width:900px){.skp-tools-pane{width:280px;}}

`;
		/**
		* 注入样式表（幂等：已存在同 id 的 style 标签则不重复注入）。
		* 返回清理函数，用于插件 stop / 卸载时移除标签。
		*/
		function installStyles() {
			const id = "dsh-capability-panel-css";
			if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${id}"]`) === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-capability-settings";
				tag.dataset.pluginCss = id;
				tag.textContent = SKP_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}
			return () => void 0;
		}
		//#endregion
		//#region src/client/panel-entry.tsx
		/**
		* 主区域页面：把面板本体铺满 layout 的主区域。
		*
		* `.skp-panel` 自带 `height:100%;display:flex;flex-direction:column`；外面这层
		* `.skp-main` 负责在主区域的 flex 列里撑满高度并把内部滚动限制在页面内
		* （`min-height:0` 让 `.skp-body` 的 `flex:1` 能收缩、列表/详情各自滚动，
		* 而不是把整页顶高）。背景改用宿主的基色，避免"卡片底色"被当成整页底色。
		*/
		function CapabilityPanelPage({ api }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-main",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityPanel$1, { api })
			});
		}
		/**
		* 侧栏「全局面板」图标（`sidebar.panellist` 的注册组件）。
		*
		* 只渲染图标本身，放在侧栏的 `panelGlyph` span 内：
		*   - `size` 由侧栏给出（展开 16 / 收起 18），兜底 18 并夹在 16–20px；
		*   - 颜色继承 `currentColor`（侧栏 `panelRow` 设为 label-primary，选中背景
		*     由侧栏的 `panelActive` 处理）；`active === true` 时再加一层强调色
		*     作为选中态提示。
		*
		* 注意该子树位于 `.skp-panel` **之外**，拿不到本插件的 `--skp-*` 令牌，
		* 样式只能用宿主 `--dsw-alias-*`（与 styles.ts 里 `.skp-composer-*` 同约定）。
		*/
		function CapabilityPanelNavIcon({ size, active }) {
			const px = typeof size === "number" && Number.isFinite(size) ? Math.min(20, Math.max(16, size)) : 18;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: active === true ? "skp-nav-glyph skp-nav-glyph-active" : "skp-nav-glyph",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: px,
					height: px,
					viewBox: "0 0 24 24",
					fill: "none",
					focusable: "false",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M12 2.2 14.1 9.9 21.8 12 14.1 14.1 12 21.8 9.9 14.1 2.2 12 9.9 9.9Z",
						fill: "currentColor"
					})
				})
			});
		}
		//#endregion
		//#region src/client/composer-common.ts
		/**
		* 输入框工具行两个弹层的共用存储与交互辅助（composer-skills /
		* composer-mcp 各自建一份独立实例，互不影响）。
		*
		* 三个弹层原本各自复制了一份等价的模块级"开合存储"（listeners +
		* openState + openToken + anchorRect）、Esc/外部点击关闭逻辑与锚定样式
		* 计算；这里把三种模式收敛成一套：
		*
		*   - `createComposerStore`：开合状态 + 数据修订号 + 视口锚点 + 可选的分
		*     享数据槽（见 setData 说明）；
		*   - `useComposerStore`：订阅存储（useState + 手动订阅，等价于 mini
		*     useSyncExternalStore）；
		*   - `useWorkspaceLabel`：项目作用域跟随传入 api 的**会话工作区**（composer
		*     必须传不带面板钉选的 `composerApi`，见 client.ts 的串味说明）；
		*   - `useComposerDismiss`：打开期间的 Esc / 点击弹层外部关闭（捕获阶段
		*     只关闭、不拦截该次点击）；
		*   - `composerPopStyle`：弹层右下角贴能力工具组右上角的定位样式。
		*
		* 共享数据槽（setData / isFresh）用来消除"按钮与弹层对同一份列表各拉一次"
		* 的重复 RPC：弹层打开时拉取并写回数据槽，按钮直接读这份数据（数据修订
		* 号 + 工作区都命中时才算新鲜），只有弹层关闭且数据过期时才自行兜底拉取。
		*
		* @module dsh-capability-settings/client/composer-common
		*/
		/**
		* 项目作用域（.agents/skills、.mcp.json 等）跟随**传入 api 的工作区解析**：
		* 订阅工作区变化并触发重渲染（数据源是 SnapshotStore，本身不具备响应性）。
		*
		* 注意：composer 传进来的必须是不带面板钉选的 `composerApi`（见 client.ts），
		* 否则在能力面板里钉选 A 工作区后，B 工作区的输入框弹层会列出 A 的项目级条目。
		*/
		function useWorkspaceLabel(api) {
			const [workspace, setWorkspace] = (0, react.useState)(() => api.workspaceLabel());
			(0, react.useEffect)(() => {
				setWorkspace(api.workspaceLabel());
				return api.subscribeWorkspace(() => setWorkspace(api.workspaceLabel()));
			}, [api]);
			return workspace;
		}
		//#endregion
		//#region src/client/composer-capability.tsx
		/**
		* 输入框下方的「本会话能力」配置区（Composer Capability Dock）。
		*
		* 两个入口（在 src/client.ts 注册）：
		* 三个入口（在 src/client.ts 注册）：
		*   - 首屏（hero）：`conversation.input.dock` 里的零高锚点 + `position: fixed`
		*     面板，位置跟随输入卡（[data-composer-card] 的 rect + ResizeObserver），
		*     视觉上落在输入框下方、默认展开；active 相位该组件返回 null。
		*   - 会话中（conversation.view，顶部 Tab「能力」）：整页管理本会话能力；
		*     进入该 Tab 时会临时隐藏输入框（不需要对话输入），切回其它 Tab 恢复。
		*
		* 语义：所有开关只写入**当前会话**（内存态、不落盘），不改项目默认。
		*   - Skills：关闭 = 宿主 agent 作用域注册同名 runtime shadow（只可关闭/恢复，
		*     不能强制开启文件级禁用项）；
		*   - MCP：复用既有会话开关（项目条目挂载/卸载，global/外部实例 restrict）。
		*
		* 组件完全自绘：样式在 styles.ts 的 `skp-dock-*` 类（只用宿主 `--dsw-*` token，
		* 因为 composer 子树拿不到 `.skp-panel` 的 `--skp-*`）。
		*
		* @module dsh-capability-settings/client/composer-capability
		*/
		function SparkleIcon({ size = 14 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 2l1.5 3.8L13.5 7l-4 1.2L8 12 6.5 8.2 2.5 7l4-1.2L8 2z",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinejoin: "round"
				})
			});
		}
		function ChevronIcon({ up = false, size = 12 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: up ? "m5 10 3-3 3 3" : "m5 6 3 3 3-3",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function SearchIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: "4.5",
					stroke: "currentColor",
					strokeWidth: "1.3"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M10.5 10.5L14 14",
					stroke: "currentColor",
					strokeWidth: "1.3",
					strokeLinecap: "round"
				})]
			});
		}
		const EMPTY_SNAPSHOT = {
			skills: [],
			servers: [],
			externals: [],
			tools: [],
			mounts: {},
			settling: false
		};
		/** 项目来源判定（与 shared/skill-sources 的语义一致，客户端侧保持轻量）。 */
		function sourceIsProject(source) {
			return source.startsWith("project-");
		}
		/**
		* 技能卡片的来源标签：
		*   - 注入行按 `origin` 显示 内置 / 插件 / 预设（配色见 tone），渠道名单独成小标签；
		*   - 磁盘行仍是 项目 / 全局（只读兼容根加「只读」后缀）。
		*/
		function skillTag(skill) {
			if (skill.injected === true) return skill.origin === "bundled" ? "内置" : skill.origin === "preset" ? "预设" : "插件";
			return sourceIsProject(skill.source) ? "项目" : skill.readOnly ? "全局 · 只读" : "全局";
		}
		/** 技能卡片来源标签的配色。 */
		function skillTone(skill) {
			if (skill.injected === true) return skill.origin === "bundled" ? "bundled" : skill.origin === "preset" ? "preset" : "plugin";
			return sourceIsProject(skill.source) ? "project" : "global";
		}
		function skillEnabled(skill) {
			if (skill.injected === true && typeof skill.enabledInSession !== "boolean") return skill.disabledInProject !== true;
			return skill.enabledInSession !== false;
		}
		function defaultMcpEnabled(server) {
			return server.enabled && server.disabledInProject !== true;
		}
		function mcpEnabled(server) {
			return server.enabledInSession ?? defaultMcpEnabled(server);
		}
		function externalEnabled(server) {
			const fallback = server.restrictable ? server.disabledInProject !== true : true;
			return server.enabledInSession ?? fallback;
		}
		async function fetchSnapshot(api, workspace) {
			const skillsPromise = api.skills.sessionList().catch(async () => {
				return (await api.skills.list()).map((row) => ({
					...row,
					enabledInSession: true,
					canToggleInSession: false
				}));
			});
			const [skills, mcp, statuses, runtime, tools] = await Promise.all([
				skillsPromise,
				api.mcp.list(),
				api.mcp.status().catch(() => []),
				api.mcp.runtime({ cwd: workspace }).catch(() => ({ servers: [] })),
				api.tools.list().then((view) => view.units).catch(() => [])
			]);
			return {
				skills: skills.filter((skill) => skill.shadowStub !== true),
				servers: mcp.servers,
				externals: runtime.servers,
				tools,
				mounts: aggregateMounts(statuses),
				settling: statuses.some((status) => status.settling === true)
			};
		}
		/** 能力区数据：首次加载 + 写后刷新 + MCP settling 静默轮询收敛。 */
		function useCapabilitySnapshot(api, workspace, enabled = true) {
			const [snapshot, setSnapshot] = (0, react.useState)(EMPTY_SNAPSHOT);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(void 0);
			const [version, setVersion] = (0, react.useState)(0);
			const seqRef = (0, react.useRef)(0);
			const mountedRef = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!enabled) {
					setLoading(false);
					return;
				}
				const seq = ++seqRef.current;
				setLoading(true);
				fetchSnapshot(api, workspace).then((next) => {
					if (!mountedRef.current || seq !== seqRef.current) return;
					setSnapshot(next);
					setError(void 0);
				}).catch((err) => {
					if (!mountedRef.current || seq !== seqRef.current) return;
					setError(String(err instanceof Error ? err.message : err));
				}).finally(() => {
					if (!mountedRef.current || seq !== seqRef.current) return;
					setLoading(false);
				});
			}, [
				api,
				workspace,
				version,
				enabled
			]);
			(0, react.useEffect)(() => {
				if (!snapshot.settling) return;
				let cancelled = false;
				let attempts = 0;
				const timer = setInterval(() => {
					if (cancelled) return;
					attempts += 1;
					if (attempts > 20) {
						clearInterval(timer);
						return;
					}
					setVersion((value) => value + 1);
				}, 800);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [snapshot.settling]);
			return {
				snapshot,
				loading,
				error,
				setError,
				refresh: (0, react.useCallback)(() => setVersion((value) => value + 1), [])
			};
		}
		/** 会话相位（hero / active）：只用于 hero 固定面板的挂载判定。 */
		function useConversationPhase() {
			const ref = (0, react.useRef)(null);
			const [phase, setPhase] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				const el = ref.current;
				if (el === null) return;
				const root = el.closest("[data-phase]");
				const read = () => setPhase(root?.getAttribute("data-phase") ?? void 0);
				read();
				if (root === null) return;
				const observer = new MutationObserver(read);
				observer.observe(root, {
					attributes: true,
					attributeFilter: ["data-phase"]
				});
				return () => observer.disconnect();
			}, []);
			return {
				ref,
				phase
			};
		}
		/** hero 固定面板：跟随输入卡的视口位置（ResizeObserver + 滚动/resize 重算）。 */
		function useComposerCardRect(active, hostRef) {
			const [rect, setRect] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (!active) return;
				const root = hostRef.current?.closest("[data-phase]");
				if (root === null) return;
				let frame = 0;
				const read = () => {
					const card = root.querySelector("[data-composer-card]");
					if (card === null) return;
					const box = card.getBoundingClientRect();
					const next = {
						left: box.left,
						top: box.bottom + 8,
						width: box.width
					};
					setRect((prev) => prev !== void 0 && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next);
				};
				const schedule = () => {
					cancelAnimationFrame(frame);
					frame = requestAnimationFrame(read);
				};
				read();
				const observer = new ResizeObserver(schedule);
				observer.observe(root);
				const card = root.querySelector("[data-composer-card]");
				if (card !== null) observer.observe(card);
				window.addEventListener("resize", schedule);
				document.addEventListener("scroll", schedule, true);
				return () => {
					cancelAnimationFrame(frame);
					observer.disconnect();
					window.removeEventListener("resize", schedule);
					document.removeEventListener("scroll", schedule, true);
				};
			}, [active, hostRef]);
			return rect;
		}
		/** 结果面板阈值默认值与步长（UX §6.5）。 */
		const DECISION_DEFAULT_THRESHOLD = .5;
		const DECISION_THRESHOLD_STEP = .05;
		const DISABLED_AUTO_PREFS = {
			enabled: false,
			pauseMs: 1e3,
			minChars: 10,
			minEditChars: 4
		};
		/** 宿主 chip / 附件占位符（与架构 §9.3 REFERENCE_PLACEHOLDER_RE 一致）。 */
		const CHIP_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu;
		/** 零宽字符（从 contenteditable innerText 里剔除）。 */
		const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/gu;
		/** 草稿清洗：去 chip/附件占位符与零宽字符，再 `trim()`。 */
		function cleanDraft(text) {
			return text.replace(CHIP_PLACEHOLDER_RE, "").replace(ZERO_WIDTH_RE, "").trim();
		}
		/** 按 Unicode 码点计字符数（中文计 1）。 */
		function draftLength(text) {
			return Array.from(text).length;
		}
		/** 编辑量：前后缀对齐后的「删除 + 插入」码点数（架构 §9.4）。 */
		function diffAmount(prev, next) {
			const a = Array.from(prev);
			const b = Array.from(next);
			let p = 0;
			while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
			let s = 0;
			while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
			return a.length - p - s + (b.length - p - s);
		}
		/** 停顿/倒计时的秒数显示（1 位小数）。 */
		function formatSeconds(ms) {
			return (ms / 1e3).toFixed(1);
		}
		/** 取消（abort）不应进入错误态。 */
		function isAbortError(error) {
			return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** window focus 兜底刷新的最小间隔，避免窗口反复聚焦触发密集 getConfig。 */
		const JEV_CONFIG_FOCUS_REFRESH_MS = 2e3;
		function useJevConfig(api) {
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const seqRef = (0, react.useRef)(0);
			const mountedRef = (0, react.useRef)(true);
			const lastLoadAtRef = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
				};
			}, []);
			/** `silent`：后台刷新——成功前保留旧配置，失败也保留（异常静默）。 */
			const refresh = (0, react.useCallback)((options) => {
				const silent = options?.silent === true;
				lastLoadAtRef.current = Date.now();
				const seq = ++seqRef.current;
				if (!silent) setState({ status: "loading" });
				api.jev.getConfig().then((view) => {
					if (!mountedRef.current || seq !== seqRef.current) return;
					setState({
						status: "ready",
						view
					});
				}).catch((error) => {
					if (!mountedRef.current || seq !== seqRef.current) return;
					setState((prev) => silent && prev.status !== "loading" ? prev : {
						status: "error",
						message: messageOf(error)
					});
				});
			}, [api]);
			const reload = (0, react.useCallback)(() => refresh(), [refresh]);
			const refreshSilently = (0, react.useCallback)(() => refresh({ silent: true }), [refresh]);
			(0, react.useEffect)(() => {
				reload();
			}, [reload]);
			(0, react.useEffect)(() => {
				if (typeof window === "undefined") return;
				const onConfigChanged = () => refreshSilently();
				const onFocus = () => {
					if (Date.now() - lastLoadAtRef.current < JEV_CONFIG_FOCUS_REFRESH_MS) return;
					refreshSilently();
				};
				window.addEventListener(JEV_CONFIG_CHANGED_EVENT, onConfigChanged);
				window.addEventListener("focus", onFocus);
				return () => {
					window.removeEventListener(JEV_CONFIG_CHANGED_EVENT, onConfigChanged);
					window.removeEventListener("focus", onFocus);
				};
			}, [refreshSilently]);
			return {
				state,
				reload,
				refreshSilently
			};
		}
		/**
		* DOM 兜底草稿读取（contenteditable 没有 `value`，只能读 innerText）。
		*
		* - `observeDraft=false` 时（槽 props 已给草稿）仍监听 composition，
		*   用于自动触发时的 IME 门槛；
		* - 监听整棵文档的 characterData/childList 变化并按内容去重，避免高频 setState；
		* - 元素找不到时返回 `draft: undefined`（入口据此禁用）。
		*/
		function useDomDraftReader(anchorRef, observeDraft) {
			const [reading, setReading] = (0, react.useState)({ isComposing: false });
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const read = () => {
					const input = (anchorRef.current?.closest("[data-phase]") ?? document.body).querySelector("[data-composer-card] [data-composer-input]");
					const next = input === null ? void 0 : cleanDraft(input.innerText ?? input.textContent ?? "");
					setReading((prev) => prev.draft === next ? prev : {
						...prev,
						draft: next
					});
				};
				let observer;
				if (observeDraft) {
					read();
					observer = new MutationObserver(read);
					observer.observe(document.body, {
						childList: true,
						subtree: true,
						characterData: true
					});
				}
				const onStart = () => setReading((prev) => prev.isComposing ? prev : {
					...prev,
					isComposing: true
				});
				const onEnd = () => {
					setReading((prev) => ({
						...prev,
						isComposing: false
					}));
					if (observeDraft) window.setTimeout(read, 0);
				};
				document.addEventListener("compositionstart", onStart, true);
				document.addEventListener("compositionend", onEnd, true);
				return () => {
					observer?.disconnect();
					document.removeEventListener("compositionstart", onStart, true);
					document.removeEventListener("compositionend", onEnd, true);
				};
			}, [anchorRef, observeDraft]);
			return reading;
		}
		const CONFIG_ERROR_INFO = {
			code: "config-error",
			title: "读取 Jev 配置失败",
			body: "请稍后重试，或到「Jev 模型」Tab 检查。",
			primary: "retry",
			secondary: "config"
		};
		/** rank 业务错误码 → UX §6.11 文案。 */
		function rankErrorInfo(code, errors) {
			switch (code) {
				case "auth": return {
					code,
					title: "评分失败：API Key 无效或无权限",
					body: "请到「Jev 模型」Tab 检查 API Key 或环境变量。",
					primary: "config",
					secondary: "cancel"
				};
				case "no-config": return {
					code,
					title: "评分失败：尚未配置 Jev 模型",
					body: "请先完成配置。",
					primary: "config",
					secondary: "cancel"
				};
				case "context-too-long": return {
					code,
					title: "评分失败：输入内容超出模型上下文上限",
					body: "请缩短输入框草稿后重试。",
					primary: "retry",
					secondary: "cancel"
				};
				case "timeout": return {
					code,
					title: "评分失败：请求超时",
					body: "Jev 服务响应超时，请稍后重试。",
					primary: "retry",
					secondary: "cancel"
				};
				case "network": return {
					code,
					title: "评分失败：无法连接 Jev 服务",
					body: "请检查网络后重试；若使用代理，请确认宿主可访问。",
					primary: "retry",
					secondary: "cancel"
				};
				case "rate-limit": return {
					code,
					title: "评分失败：请求过于频繁",
					body: "请稍后重试。",
					primary: "retry",
					secondary: "cancel"
				};
				case "overloaded": return {
					code,
					title: "评分失败：Jev 服务暂时不可用",
					body: "这是服务端问题，请稍后重试。",
					primary: "retry",
					secondary: "cancel"
				};
				case "empty-capabilities": return {
					code,
					title: "当前会话没有可评分的 Skills / MCP / Tools",
					body: "切换项目或稍后重试。",
					primary: "retry",
					secondary: "cancel"
				};
				default: return {
					code: code === "bad-request" ? code : "unknown",
					title: "评分失败：请求无法完成",
					body: errors[0] ?? "请稍后重试。",
					primary: "retry",
					secondary: "cancel"
				};
			}
		}
		/** rank item 的不可切换原因（UX §6.8 / 架构 §7.3）。 */
		const RANK_REASON_TEXT = {
			"hard-disabled": "该能力已在配置中禁用",
			"not-restrictable": "不可在当前对话关闭",
			"not-toggleable": "当前会话无法切换该能力",
			shadowed: "被同名能力覆盖",
			"no-answer": "未获得评分"
		};
		/** 预勾选口径：手改优先；否则「可切换且分数 ≥ 阈值」（含等于）。 */
		function isCheckedItem(item, manual, threshold) {
			const override = manual[item.id];
			if (override !== void 0) return override;
			return item.applicable && item.score >= threshold;
		}
		/**
		* 决策结果行的来源小标签（Figma v12-03）：
		* 全局（绿）/ 项目（蓝）/ 内置（琥珀）/ 注入插件（紫，显示渠道名）/
		* 预设渠道（灰，`预设 <channel>`）。
		*
		* 字段全部是宿主 additive：旧宿主没有 `origin` / `channel` 时按 `source`
		* 回落（注入行缺 `source` 时只显示 kind，不猜来源）。
		*/
		function rankSourceTag(item) {
			if (item.kind === "tool") return void 0;
			if (item.origin === "bundled") return {
				label: "内置",
				tone: "bundled"
			};
			if (item.origin === "plugin") return {
				label: item.channel !== void 0 && item.channel.length > 0 ? item.channel : "插件注入",
				tone: "plugin"
			};
			if (item.origin === "preset") return {
				label: item.channel !== void 0 && item.channel.length > 0 ? `预设 ${item.channel}` : "预设渠道",
				tone: "preset"
			};
			if (item.source === "external") return {
				label: "注入",
				tone: "external"
			};
			if (item.source === "project") return {
				label: "项目",
				tone: "project"
			};
			if (item.source === "global") return {
				label: "全局",
				tone: "global"
			};
		}
		/** 当前勾选项（不可切换项永不进入计划）。 */
		function checkedItems(state) {
			if (state.data === void 0) return [];
			return state.data.items.filter((item) => item.applicable && isCheckedItem(item, state.manual, state.threshold));
		}
		/**
		* 冷会话排队目标数（宿主 pending 支的 enabled/disabled = 已写入条数，恒为 0）。
		*
		* 用 rank 快照推算「若现在开始对话」会发生什么：勾选且当前关闭 → 将启用；
		* 未勾选且当前开启 → 将关闭（筛选语义）。仅统计 applicable 项。
		*/
		function plannedApplyCounts(items, selected) {
			const selectedIds = new Set(selected.map((item) => item.id));
			let enabled = 0;
			let disabled = 0;
			for (const item of items) {
				if (!item.applicable) continue;
				if (selectedIds.has(item.id)) {
					if (item.enabledInSession !== true) enabled += 1;
				} else if (item.enabledInSession === true) disabled += 1;
			}
			return {
				enabled,
				disabled
			};
		}
		/**
		* 应用结果 → toast 文案（筛选语义：启用 X / 关闭 Y；冷会话排队 + 跳过数合并）。
		*
		* - live：宿主返回 `enabled` / `disabled`；旧宿主只有 `applied`（只启用、不关闭），
		*   缺失时 `enabled` 回退 `applied`、`disabled` 回退 0。
		* - pending：新宿主已写入数为 0（排队），若宿主回传的非零计数则优先采用；
		*   否则用 `planned`（rank 快照推算的目标计数），避免出现「启用 0 · 关闭 0」。
		*/
		function applyToastText(result, skipped, planned) {
			const hostEnabled = typeof result.enabled === "number" && Number.isFinite(result.enabled) ? result.enabled : void 0;
			const hostDisabled = typeof result.disabled === "number" && Number.isFinite(result.disabled) ? result.disabled : void 0;
			let counts;
			if (result.pending) counts = (hostEnabled ?? 0) + (hostDisabled ?? 0) > 0 ? {
				enabled: hostEnabled ?? 0,
				disabled: hostDisabled ?? 0
			} : {
				enabled: planned?.enabled ?? result.applied,
				disabled: planned?.disabled ?? 0
			};
			else counts = {
				enabled: hostEnabled ?? result.applied,
				disabled: hostDisabled ?? 0
			};
			const skippedSuffix = skipped > 0 ? `；${skipped} 项不可切换已跳过` : "";
			const { enabled, disabled } = counts;
			if (result.pending) return `已加入本会话，发送首条消息后生效（${enabled === 0 && disabled > 0 ? `关闭 ${disabled} 项，当前会话未启用任何能力` : disabled === 0 && enabled > 0 ? `启用 ${enabled} 项` : `启用 ${enabled} · 关闭 ${disabled}`}）${skippedSuffix}`;
			if (enabled === 0 && disabled > 0) return `已应用：关闭 ${disabled} 项（当前会话未启用任何能力）${skippedSuffix}`;
			if (disabled === 0 && enabled > 0) return `已应用：启用 ${enabled} 项（仅当前会话）${skippedSuffix}`;
			return `已应用：启用 ${enabled} 项、关闭 ${disabled} 项（仅当前会话）${skippedSuffix}`;
		}
		/** 排队结果回执（pendingOutcome）的一次性提示文案。 */
		function pendingOutcomeText(outcome) {
			const parts = [`上次排队应用：成功 ${outcome.applied} 项`];
			if (outcome.failed > 0) parts.push(`失败 ${outcome.failed} 项`);
			if (outcome.errors.length > 0) parts.push(outcome.errors[0]);
			return parts.join(" · ");
		}
		function useDecision(options) {
			const { api, enabled, draft, isComposing, config, reloadConfig, capabilitiesReady, onManage, onRefreshCapabilities, onOptimisticApplied, onClosed } = options;
			const [state, setState] = (0, react.useState)(void 0);
			const [toast, setToast] = (0, react.useState)(void 0);
			const [liveMessage, setLiveMessage] = (0, react.useState)("");
			const timerRef = (0, react.useRef)(void 0);
			const lastDraftRef = (0, react.useRef)(void 0);
			const editCharsRef = (0, react.useRef)(0);
			const silentDraftRef = (0, react.useRef)(void 0);
			const inFlightRef = (0, react.useRef)(void 0);
			const runIdRef = (0, react.useRef)(0);
			const beginRef = (0, react.useRef)(() => void 0);
			const stateRef = (0, react.useRef)(void 0);
			const prefs = config.status === "ready" ? { ...config.view.autoTrigger } : DISABLED_AUTO_PREFS;
			const configured = config.status === "ready" && config.view.hasApiKey;
			const clearTimer = (0, react.useCallback)(() => {
				if (timerRef.current !== void 0) {
					window.clearTimeout(timerRef.current);
					timerRef.current = void 0;
				}
			}, []);
			const pushToast = (0, react.useCallback)((text, tone = "ok") => setToast({
				text,
				tone
			}), []);
			(0, react.useEffect)(() => {
				if (toast === void 0) return;
				const timer = window.setTimeout(() => setToast(void 0), 4400);
				return () => window.clearTimeout(timer);
			}, [toast]);
			(0, react.useEffect)(() => () => {
				if (timerRef.current !== void 0) window.clearTimeout(timerRef.current);
				inFlightRef.current?.controller.abort();
			}, []);
			function begin(origin, threshold) {
				const snapshot = draft;
				if (snapshot === void 0 || snapshot === "") return;
				if (inFlightRef.current !== void 0) return;
				const runId = ++runIdRef.current;
				const controller = new AbortController();
				inFlightRef.current = {
					runId,
					controller
				};
				editCharsRef.current = 0;
				setState({
					phase: "loading",
					origin,
					pauseMs: prefs.pauseMs,
					threshold,
					manual: {}
				});
				if (origin === "auto") setLiveMessage("停顿时长已达，已自动发起评分");
				(async () => {
					try {
						const result = await api.jev.rank({ draft: snapshot }, controller.signal);
						if (runId !== runIdRef.current) return;
						if (!result.ok) {
							setState({
								phase: "error",
								origin,
								pauseMs: prefs.pauseMs,
								threshold,
								manual: {},
								error: rankErrorInfo(result.code, result.errors)
							});
							return;
						}
						const items = result.items;
						const checkedCount = items.filter((item) => item.applicable && item.score >= threshold).length;
						setState({
							phase: "results",
							origin,
							pauseMs: prefs.pauseMs,
							threshold,
							manual: {},
							data: {
								items,
								model: result.model,
								total: typeof result.capabilitiesTotal === "number" && Number.isFinite(result.capabilitiesTotal) ? result.capabilitiesTotal : items.length,
								...result.pendingOutcome !== void 0 ? { pendingOutcome: result.pendingOutcome } : {}
							}
						});
						setLiveMessage(`评分完成，共 ${items.length} 个能力，已勾选 ${checkedCount} 项`);
					} catch (error) {
						if (runId !== runIdRef.current) return;
						if (isAbortError(error)) return;
						setState({
							phase: "error",
							origin,
							pauseMs: prefs.pauseMs,
							threshold,
							manual: {},
							error: {
								code: "network",
								title: "评分失败：无法连接 Jev 服务",
								body: "请检查网络后重试；若使用代理，请确认宿主可访问。",
								primary: "retry",
								secondary: "cancel"
							}
						});
					} finally {
						if (runId === runIdRef.current) inFlightRef.current = void 0;
					}
				})();
			}
			beginRef.current = begin;
			stateRef.current = state;
			(0, react.useEffect)(() => {
				if (draft === void 0) {
					clearTimer();
					lastDraftRef.current = void 0;
					editCharsRef.current = 0;
					return;
				}
				const previous = lastDraftRef.current;
				editCharsRef.current += previous === void 0 ? draftLength(draft) : diffAmount(previous, draft);
				lastDraftRef.current = draft;
				if (draft === "") {
					editCharsRef.current = 0;
					silentDraftRef.current = void 0;
				} else if (silentDraftRef.current !== void 0 && silentDraftRef.current !== draft) silentDraftRef.current = void 0;
				clearTimer();
				if (!enabled) return;
				const phase = stateRef.current?.phase;
				if (phase !== void 0 && phase !== "results") return;
				if (!capabilitiesReady) return;
				if (!prefs.enabled || !configured) return;
				if (draft === "") return;
				if (draftLength(draft) < prefs.minChars) return;
				if (editCharsRef.current < prefs.minEditChars) return;
				if (isComposing) return;
				if (inFlightRef.current !== void 0) return;
				if (silentDraftRef.current !== void 0) return;
				const pauseMs = prefs.pauseMs;
				timerRef.current = window.setTimeout(() => {
					timerRef.current = void 0;
					const current = stateRef.current;
					beginRef.current("auto", current !== void 0 && current.phase === "results" ? current.threshold : DECISION_DEFAULT_THRESHOLD);
				}, pauseMs);
				return clearTimer;
			}, [
				draft,
				enabled,
				config.status,
				capabilitiesReady,
				isComposing,
				clearTimer,
				prefs.enabled,
				prefs.pauseMs,
				prefs.minChars,
				prefs.minEditChars,
				configured,
				state?.phase
			]);
			(0, react.useEffect)(() => {
				if (enabled) return;
				clearTimer();
				if (inFlightRef.current !== void 0) {
					inFlightRef.current.controller.abort();
					inFlightRef.current = void 0;
					runIdRef.current += 1;
				}
				lastDraftRef.current = void 0;
				editCharsRef.current = 0;
				silentDraftRef.current = void 0;
				setState(void 0);
			}, [enabled, clearTimer]);
			function startManual() {
				if (draft === void 0 || draft === "") return;
				begin("manual", stateRef.current?.threshold ?? DECISION_DEFAULT_THRESHOLD);
			}
			function startConfigError() {
				setState({
					phase: "error",
					origin: "manual",
					pauseMs: prefs.pauseMs,
					threshold: DECISION_DEFAULT_THRESHOLD,
					manual: {},
					error: CONFIG_ERROR_INFO
				});
			}
			function cancelScoring() {
				const current = stateRef.current;
				if (current?.phase !== "loading") return;
				const inFlight = inFlightRef.current;
				if (inFlight !== void 0) {
					inFlight.controller.abort();
					inFlightRef.current = void 0;
				}
				runIdRef.current += 1;
				silentDraftRef.current = draft;
				editCharsRef.current = 0;
				setState(void 0);
				setLiveMessage("已取消本次能力决策");
				onClosed(current.origin === "manual");
			}
			function close(returnFocus = true) {
				const current = stateRef.current;
				if (current === void 0) return;
				if (current.phase === "loading" || current.phase === "applying") return;
				setState(void 0);
				onClosed(returnFocus);
			}
			function rescore() {
				const current = stateRef.current;
				if (current === void 0) return;
				begin("manual", current.threshold);
			}
			function goConfig() {
				onManage?.("jev");
				setState(void 0);
				onClosed(false);
			}
			function retry() {
				const current = stateRef.current;
				if (current === void 0 || current.phase !== "error" || current.error === void 0) return;
				if (current.error.code === "config-error") {
					reloadConfig();
					setState(void 0);
					onClosed(false);
					return;
				}
				if (current.error.code === "no-config") {
					goConfig();
					return;
				}
				begin(current.origin, current.threshold);
			}
			function setThreshold(value) {
				const rounded = Math.round(value / DECISION_THRESHOLD_STEP) * DECISION_THRESHOLD_STEP;
				const next = Math.min(1, Math.max(0, Number(rounded.toFixed(2))));
				setState((current) => current === void 0 ? current : {
					...current,
					threshold: next
				});
			}
			function toggleItem(id) {
				setState((current) => {
					if (current === void 0 || current.data === void 0) return current;
					const item = current.data.items.find((candidate) => candidate.id === id);
					if (item === void 0 || !item.applicable) return current;
					const checked = isCheckedItem(item, current.manual, current.threshold);
					return {
						...current,
						manual: {
							...current.manual,
							[id]: !checked
						}
					};
				});
			}
			function apply() {
				const current = stateRef.current;
				if (current === void 0 || current.phase !== "results" || current.data === void 0) return;
				const selected = checkedItems(current);
				const plan = selected.map((item) => ({
					id: item.id,
					kind: item.kind,
					name: item.name,
					enabled: true
				}));
				setState({
					...current,
					phase: "applying",
					applyError: void 0
				});
				(async () => {
					try {
						const result = await api.jev.apply({ plan });
						if (!result.ok) {
							setState((latest) => latest === void 0 ? latest : {
								...latest,
								phase: "results",
								applyError: `应用失败：${result.errors[0] ?? result.code}`
							});
							return;
						}
						const failed = result.failed ?? [];
						if (failed.length > 0) {
							setState((latest) => latest === void 0 ? latest : {
								...latest,
								phase: "results",
								applyError: `应用失败：${failed[0]?.reason ?? "写入失败"}`
							});
							return;
						}
						if (result.pending) onOptimisticApplied(selected.map((item) => ({
							kind: item.kind,
							name: item.name
						})));
						onRefreshCapabilities();
						const notableSkipped = result.skipped.filter((item) => item.reason !== "already-applied").length;
						const baseText = applyToastText(result, notableSkipped, result.pending && current.data !== void 0 ? plannedApplyCounts(current.data.items, selected) : void 0);
						const voidText = result.pendingOutcome === void 0 ? baseText : `${baseText} · ${pendingOutcomeText(result.pendingOutcome)}`;
						setState(void 0);
						pushToast(voidText, "ok");
						setLiveMessage(voidText);
						onClosed(true);
					} catch (error) {
						if (isAbortError(error)) return;
						setState((latest) => latest === void 0 ? latest : {
							...latest,
							phase: "results",
							applyError: `应用失败：${messageOf(error)}`
						});
					}
				})();
			}
			return {
				state,
				toast,
				liveMessage,
				start: startManual,
				startConfigError,
				cancelScoring,
				close,
				rescore,
				retry,
				goConfig,
				setThreshold,
				toggleItem,
				apply
			};
		}
		/** 两态入口按钮（展开面板 tabs 行 / 收起能力条右侧，视觉必须一致）。 */
		function DecisionEntryButton({ inBar, label, tooltip, disabled, guide, onClick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `skp-decision-entry${inBar ? " skp-decision-entry-bar" : ""}`,
				title: tooltip,
				"aria-label": "根据输入框草稿为本会话能力做能力决策",
				"aria-disabled": disabled ? true : void 0,
				onClick: (event) => {
					event.stopPropagation();
					if (disabled) return;
					onClick();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-decision-entry-star",
						"aria-hidden": "true",
						children: "✦"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-decision-entry-label",
						children: label
					}),
					guide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
						className: "skp-decision-entry-dot",
						"aria-hidden": "true"
					})
				]
			});
		}
		/** 评分中骨架（5 行，与结果行同高）。 */
		function DecisionSkeleton() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-decision-skeleton",
				"aria-hidden": "true",
				children: [
					0,
					1,
					2,
					3,
					4
				].map((index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-decision-skel-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-decision-skel-dot" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-decision-skel-line skp-decision-skel-line-a" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-decision-skel-line skp-decision-skel-line-b" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-decision-skel-line skp-decision-skel-line-c" })
					]
				}, index))
			});
		}
		/**
		* 「✦ 能力决策」结果面板（fixed 容器内替换 hero 内容）。
		*
		* a11y（UX §9）：`role="dialog"` + `aria-modal="false"`（不阻断输入框）、
		* `aria-labelledby` 标题；倒计时不播报；评分完成、应用结果由 hero 的 polite
		* live 节点播报；Esc 只在结果/错误态关闭。
		*/
		function DecisionPanel(props) {
			const { state, config, draft, estimateTotal, titleRef } = props;
			const loading = state.phase === "loading";
			const applying = state.phase === "applying";
			const errorPhase = state.phase === "error";
			const data = state.data;
			const items = data?.items ?? [];
			const total = data?.total ?? estimateTotal;
			const model = data?.model ?? (config.status === "ready" ? config.view.model : "");
			const selectedCount = checkedItems(state).length;
			const draftCleared = !loading && !errorPhase && !applying && draft === "";
			const noMatch = !loading && !errorPhase && items.length > 0 && items.every((item) => !item.applicable || item.score < state.threshold);
			const pendingOutcome = data?.pendingOutcome;
			const errorInfo = state.error;
			const titleId = "skp-decision-title";
			const listRef = (0, react.useRef)(null);
			const [listScrollable, setListScrollable] = (0, react.useState)(false);
			const updateListScrollable = (0, react.useCallback)(() => {
				const element = listRef.current;
				if (element === null) return;
				setListScrollable(element.scrollHeight - element.clientHeight > 2);
			}, []);
			(0, react.useEffect)(() => {
				updateListScrollable();
				const element = listRef.current;
				if (element === null || typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(updateListScrollable);
				observer.observe(element);
				return () => observer.disconnect();
			}, [
				updateListScrollable,
				items.length,
				loading
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-decision-panel",
				role: "dialog",
				"aria-modal": false,
				"aria-labelledby": titleId,
				onKeyDown: (event) => {
					if (event.key !== "Escape") return;
					if (loading || applying) return;
					event.preventDefault();
					props.onClose(true);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-decision-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-decision-title",
								id: titleId,
								ref: titleRef,
								tabIndex: -1,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-decision-star",
									"aria-hidden": "true",
									children: "✦"
								}), "能力决策"]
							}),
							model.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-decision-badge",
								title: model,
								children: ["Jev · ", model]
							}),
							state.origin === "auto" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-decision-badge skp-decision-badge-auto",
								title: `停顿 ${formatSeconds(state.pauseMs)}s 后自动发起`,
								children: "自动"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-close",
								"aria-label": "关闭",
								title: loading ? "评分中，取消请点「取消评分」" : applying ? "正在应用所选能力" : "关闭",
								"aria-disabled": loading || applying ? true : void 0,
								onClick: () => {
									if (loading || applying) return;
									props.onClose(true);
								},
								children: "×"
							})
						]
					}),
					errorPhase && errorInfo !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-decision-error",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "skp-decision-error-title",
							children: errorInfo.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "skp-decision-error-body",
							children: errorInfo.body
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-decision-threshold",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-decision-threshold-label",
								children: "相关度阈值"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "skp-decision-range",
								type: "range",
								min: 0,
								max: 1,
								step: DECISION_THRESHOLD_STEP,
								value: state.threshold,
								"aria-label": "相关度阈值",
								"aria-valuetext": state.threshold.toFixed(2),
								disabled: loading || applying,
								onChange: (event) => props.onThreshold(Number(event.target.value))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-decision-threshold-value",
								children: state.threshold.toFixed(2)
							}),
							!loading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-decision-count",
								children: [
									"已选 ",
									selectedCount,
									" / ",
									total
								]
							})
						]
					}), noMatch && selectedCount === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "skp-decision-nomatch",
						children: [
							"没有达到阈值 ",
							state.threshold.toFixed(2),
							" 的能力；可直接应用，当前会话将不启用任何能力（可调低阈值或手动勾选）"
						]
					})] }),
					pendingOutcome !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-decision-banner",
						children: pendingOutcomeText(pendingOutcome)
					}),
					loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-decision-loading",
						role: "status",
						"aria-live": "off",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-decision-spinner",
								"aria-hidden": "true"
							}),
							"正在评分… · 1 次请求 · ",
							total,
							" 个能力"
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DecisionSkeleton, {})] }) : errorPhase ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-decision-list-wrap",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
							className: "skp-decision-list",
							ref: listRef,
							onScroll: updateListScrollable,
							children: [items.map((item) => {
								const checked = isCheckedItem(item, state.manual, state.threshold);
								const unavailable = !item.applicable;
								const manual = state.manual[item.id] !== void 0;
								const below = !unavailable && !checked && !manual && item.score < state.threshold;
								const reasonText = item.reason === void 0 ? void 0 : RANK_REASON_TEXT[item.reason] ?? item.reason;
								const reasonId = `skp-decision-reason-${item.id.slice(4)}`;
								const srcTag = rankSourceTag(item);
								const descText = item.kind === "tool" ? "插件注入 · 能力决策以插件整体计分" : item.description;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: `skp-decision-row${checked ? " skp-decision-row-selected" : ""}${manual ? " skp-decision-row-manual" : ""}${below ? " skp-decision-row-below" : ""}${unavailable ? " skp-decision-row-unavailable" : ""}`,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
											className: "skp-decision-check",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked,
												disabled: unavailable || applying,
												"aria-label": `选择 ${item.name}`,
												"aria-disabled": unavailable ? true : void 0,
												"aria-describedby": unavailable && reasonText !== void 0 ? reasonId : void 0,
												onChange: () => props.onToggle(item.id)
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `skp-decision-kind skp-decision-kind-${item.kind}`,
											children: item.kind === "skill" ? "Skills" : item.kind === "mcp" ? "MCP" : "插件"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-decision-name-cell",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-decision-name",
													title: item.name,
													children: item.name
												}),
												item.kind === "tool" && typeof item.toolCount === "number" && item.toolCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "skp-decision-toolcount",
													title: "该插件提供的工具数（以插件整体计分/启用）",
													children: [item.toolCount, " 个工具"]
												}),
												srcTag !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: `skp-decision-src skp-decision-src-${srcTag.tone}`,
													title: "能力来源",
													children: srcTag.label
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-decision-desc-cell",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-decision-desc",
												title: item.description.length > 0 ? item.description : descText,
												children: descText.length > 0 ? descText : "—"
											}), reasonText !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-decision-reason",
												id: reasonId,
												children: reasonText
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-decision-bar",
											"aria-hidden": "true",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { width: `${Math.round(Math.min(1, Math.max(0, item.score)) * 100)}%` } })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-decision-score",
											"aria-label": `相关度 ${item.score.toFixed(2)}`,
											children: item.score.toFixed(2)
										})
									]
								}, item.id);
							}), items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								className: "skp-decision-empty",
								children: "没有可评分的能力"
							})]
						}), listScrollable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-decision-list-fade",
							"aria-hidden": "true"
						})]
					}),
					!loading && !errorPhase && items.some((item) => item.kind === "tool") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "skp-decision-note",
						children: "Tools 以插件整体计分与启用：选中即开启该插件全部工具；Jev 只收窄，不重新打开已关闭的能力。"
					}),
					state.applyError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-decision-applyerr",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-decision-applyerr-text",
							children: state.applyError
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-decision-link",
							onClick: props.onApply,
							children: "重试"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-decision-foot",
						children: errorPhase ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-btn skp-decision-btn-primary",
								disabled: errorInfo?.primary === "retry" && errorInfo.code !== "config-error" && (draft === void 0 || draft === ""),
								title: errorInfo?.primary === "retry" && errorInfo.code !== "config-error" && (draft === void 0 || draft === "") ? "输入框已清空" : void 0,
								onClick: errorInfo?.primary === "config" ? props.onGoConfig : props.onRetry,
								children: errorInfo?.primary === "config" ? "去配置" : "重试"
							}),
							errorInfo?.secondary === "config" && errorInfo.primary !== "config" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-btn",
								onClick: props.onGoConfig,
								children: "去配置"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-btn",
								onClick: () => props.onClose(true),
								children: "取消"
							})
						] }) : loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-decision-btn skp-decision-btn-primary",
							onClick: props.onCancel,
							children: "取消评分"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-btn",
								disabled: applying || draftCleared || draft === void 0,
								title: draftCleared || draft === void 0 ? "输入框已清空" : void 0,
								onClick: props.onRescore,
								children: "重新评分"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-btn",
								disabled: applying,
								onClick: () => props.onClose(true),
								children: "取消"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-decision-btn skp-decision-btn-primary",
								disabled: applying,
								onClick: props.onApply,
								children: applying ? "应用中…" : selectedCount === 0 ? "应用（关闭全部）" : `应用所选（${selectedCount}）`
							})
						] })
					})
				]
			});
		}
		function buildSkillRows(snapshot, pending) {
			const seen = /* @__PURE__ */ new Set();
			return snapshot.skills.filter((skill) => {
				if (seen.has(skill.name)) return false;
				seen.add(skill.name);
				return true;
			}).map((skill) => {
				const id = `skill:${skill.name}`;
				const canToggle = skill.canToggleInSession !== false;
				return {
					id,
					kind: "skill",
					name: skill.name,
					description: skill.description,
					tag: skillTag(skill),
					tone: skillTone(skill),
					...skill.injected === true ? { injected: true } : {},
					...skill.injected === true && skill.channel !== void 0 && skill.channel.length > 0 ? { channel: skill.channel } : {},
					enabled: pending[id] ?? skillEnabled(skill),
					disabled: !canToggle,
					...canToggle ? {} : { meta: "会话未激活" }
				};
			});
		}
		function buildMcpRows(snapshot, pending) {
			const rows = [];
			const project = snapshot.servers.filter((server) => server.scope === "project");
			const global = snapshot.servers.filter((server) => server.scope === "global" && server.enabled);
			for (const server of [...project, ...global]) {
				const id = `mcp:${server.scope}:${server.key}`;
				const mounted = snapshot.mounts[server.key];
				const meta = server.scope === "global" ? "共享实例" : mounted === void 0 ? "未挂载" : mounted.error ?? MOUNT_LABEL[mounted.state];
				rows.push({
					id,
					kind: "mcp",
					name: server.key,
					tag: server.scope === "project" ? "项目" : "全局",
					tone: server.scope === "project" ? "project" : "global",
					meta,
					enabled: pending[id] ?? mcpEnabled(server),
					disabled: false,
					dot: server.scope === "global" ? mcpEnabled(server) ? "mounted" : "none" : mounted?.state ?? "none",
					target: server.scope === "project" ? server.key : server.serverName,
					writeKind: server.scope === "project" ? "project" : "server",
					locked: false
				});
			}
			for (const server of snapshot.externals) {
				const id = `mcp:external:${server.serverName}`;
				const hasChannel = typeof server.channel === "string" && server.channel.length > 0;
				const synthesized = server.synthesized === true || server.origin === "namespace";
				const tag = hasChannel ? "插件" : synthesized ? "未识别" : "外部注入";
				const tone = hasChannel ? "plugin" : synthesized ? "unattributed" : "external";
				const meta = server.restrictable !== true ? "不可在当前对话关闭" : hasChannel ? server.tools.length > 0 ? `${server.tools.length} 个工具` : server.source ?? server.channel : server.tools.length > 0 ? synthesized ? `${server.tools.length} 个工具 · 来源未识别` : `${server.tools.length} 个工具` : typeof server.source === "string" && server.source.length > 0 ? server.source : "外部实例";
				rows.push({
					id,
					kind: "mcp",
					name: server.serverName,
					tag,
					tone,
					meta,
					enabled: pending[id] ?? externalEnabled(server),
					disabled: server.restrictable !== true,
					dot: server.restrictable ? "mounted" : "none",
					target: server.serverName,
					writeKind: "server",
					locked: server.restrictable !== true,
					...hasChannel ? { channel: server.channel } : {},
					...synthesized ? { synthesized: true } : {}
				});
			}
			return rows;
		}
		/**
		* Tools 域行（v13 R3）：一个插件 = 一行；来源未识别合并成一个单元排最后。
		* `pending` 覆盖会话态（乐观回显 / 批量执行中）。
		*/
		function buildToolRows(snapshot, pending) {
			return snapshot.tools.map((unit) => {
				const id = `tool:${unit.unit}`;
				const unattributed = unit.kind === "unattributed";
				const locked = unit.lockedReason !== void 0;
				const toolCount = unit.toolCount;
				return {
					id,
					kind: "tool",
					name: unit.name,
					tag: unattributed ? "未识别" : "插件",
					tone: unattributed ? "unattributed" : "plugin",
					description: `${toolCount} 个工具 · ${unattributed ? "来源未识别" : "插件注入"}`,
					meta: `${toolCount} 个工具`,
					enabled: pending[id] ?? unit.enabledInSession,
					disabled: locked,
					unit: unit.unit,
					...locked ? { lockedReason: unit.lockedReason } : {}
				};
			}).sort((a, b) => {
				const aUn = a.tone === "unattributed" ? 1 : 0;
				const bUn = b.tone === "unattributed" ? 1 : 0;
				if (aUn !== bUn) return aUn - bUn;
				return a.name.localeCompare(b.name);
			});
		}
		/**
		* 卡片内的整插件 / 单条开关。
		*
		* **必须阻断冒泡**（FINDING-01）：卡片外层也可点（`onClick` = 切换），若不阻断，
		* 点一次开关会同时触发 input 的 `onChange` 与卡片的 `onClick`，发出两条相同 RPC。
		* label 上的 onClick/onKeyDown 覆盖「点轨道」「键盘 Space」两种激活路径。
		*/
		function DockSwitch({ checked, disabled, title, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "skp-dock-switch",
				title,
				onClick: (event) => event.stopPropagation(),
				onKeyDown: (event) => event.stopPropagation(),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked,
					disabled,
					"aria-label": title,
					onChange
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-switch-track" })]
			});
		}
		/** 事件目标是否落在卡片内的开关上（FINDING-01 的兜底短路，兼容键盘触发）。 */
		function isSwitchEventTarget(target) {
			const element = target;
			return typeof element?.closest === "function" && element.closest(".skp-dock-switch") !== null;
		}
		function Tag({ label, tone }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `skp-dock-tag skp-dock-tag-${tone}`,
				children: label
			});
		}
		function CapabilityCard({ row, busy, onToggle }) {
			const desc = row.kind === "skill" ? row.description : row.kind === "tool" ? row.description : row.meta;
			const title = row.kind === "tool" ? row.disabled ? row.lockedReason ?? "该插件无法在当前会话切换" : row.enabled ? "在当前会话关闭该插件（关闭后其全部工具不可见，不改项目默认）" : "在当前会话开启该插件（恢复其全部工具）" : row.disabled ? "该能力无法在当前会话切换，请到能力面板管理" : row.name;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `skp-dock-card${row.enabled ? " skp-dock-card-on" : ""}${row.disabled ? " skp-dock-card-disabled" : ""}`,
				role: "button",
				tabIndex: 0,
				"aria-pressed": row.enabled,
				title,
				onClick: (event) => {
					if (isSwitchEventTarget(event.target)) return;
					if (!row.disabled && !busy) onToggle();
				},
				onKeyDown: (event) => {
					if (isSwitchEventTarget(event.target)) return;
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						if (!row.disabled && !busy) onToggle();
					}
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-icon",
								children: row.kind === "skill" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleIcon, { size: 13 }) : row.kind === "tool" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-name",
								children: row.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DockSwitch, {
								checked: row.enabled,
								disabled: row.disabled || busy,
								title: row.enabled ? "在当前会话关闭（不落盘）" : "在当前会话恢复",
								onChange: () => {
									if (!row.disabled && !busy) onToggle();
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "skp-dock-card-desc",
						children: desc
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, {
								label: row.tag,
								tone: row.tone
							}),
							row.kind === "skill" && row.channel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-tag-channel",
								title: `${row.channel} · 注入方 / 渠道名（内容只读，开关只作用于当前会话）`,
								children: row.channel
							}),
							row.kind === "mcp" && row.channel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-tag-channel",
								title: `${row.channel} · 插件来源（命名空间 / 注入方归一后的展示名）`,
								children: row.channel
							}),
							row.kind === "skill" ? row.meta !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-meta",
								children: row.meta
							}) : row.kind === "mcp" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `skp-dock-dot skp-dock-dot-${row.dot}`,
								title: row.meta
							}) : null
						]
					})
				]
			});
		}
		function McpIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6 3v4a2 2 0 0 0 4 0V3",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinecap: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 9v4",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinecap: "round"
				})]
			});
		}
		/** Tools 域卡片的图标（插件单元；与 skill / MCP 区分）。 */
		function ToolIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M9.5 2.5a3.2 3.2 0 0 0-4.2 4.2L2.6 9.4a1.4 1.4 0 0 0 2 2l2.7-2.7a3.2 3.2 0 0 0 4.2-4.2l-2 2-1.4-1.4 2-2z",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinejoin: "round"
				})
			});
		}
		/** 批量动作的三域执行顺序（与宿主 §6.2-6 一致：skills → mcp → tools）。 */
		const BULK_DOMAINS = [
			"skills",
			"mcp",
			"tools"
		];
		const IDLE_BULK = {
			phase: "idle",
			doneDomains: 0,
			totalDomains: BULK_DOMAINS.length,
			failed: [],
			failedDomains: []
		};
		function CapabilityPanel(props) {
			const { mode, loading, error, skillRows, mcpRows, toolRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, onBulk, onRetryBulk, bulkState, initialTab, decisionEntry, decisionHint } = props;
			const [tab, setTab] = (0, react.useState)(initialTab ?? "skills");
			const [query, setQuery] = (0, react.useState)("");
			const [resetBusy, setResetBusy] = (0, react.useState)(false);
			const skillsOn = skillRows.filter((row) => row.enabled).length;
			const mcpOn = mcpRows.filter((row) => row.enabled).length;
			const toolsOn = toolRows.filter((row) => row.enabled).length;
			const injectedOn = skillRows.filter((row) => row.injected === true && row.enabled).length;
			const rows = tab === "skills" ? skillRows : tab === "mcp" ? mcpRows : toolRows;
			const filtered = (0, react.useMemo)(() => {
				const q = query.trim().toLowerCase();
				if (q === "") return rows;
				return rows.filter((row) => {
					return `${row.name} ${row.kind === "skill" ? row.description : row.kind === "tool" ? row.description : row.meta}`.toLowerCase().includes(q);
				});
			}, [rows, query]);
			const totalOn = skillsOn + mcpOn + toolsOn;
			const total = skillRows.length + mcpRows.length + toolRows.length;
			const switchableRows = [
				...skillRows,
				...mcpRows,
				...toolRows
			].filter((row) => !row.disabled);
			const canEnable = switchableRows.some((row) => !row.enabled);
			const canDisable = switchableRows.some((row) => row.enabled);
			const bulkRunning = bulkState.phase === "running";
			const bulkAction = bulkState.action;
			const bulkError = bulkState.error;
			const bulkFailed = bulkState.failed.length;
			const actionLabel = (action, running) => {
				if (running && bulkAction === action) return action === "enable" ? "全部开启中…" : "全部关闭中…";
				return action === "enable" ? "全部开启" : "全部关闭";
			};
			const progressText = bulkRunning && bulkAction !== void 0 ? `${bulkAction === "enable" ? "正在开启" : bulkAction === "disable" ? "正在关闭" : "正在恢复"} ${bulkState.doneDomains} / ${bulkState.totalDomains} 个域…` : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `skp-dock-panel skp-dock-panel-${mode}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-title-icon",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-title",
								children: "本会话能力"
							}),
							mode === "view" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-subtitle",
								children: "开关只作用于当前会话，不修改项目默认"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-dock-head-right",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "skp-dock-search",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-dock-search-icon",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, {})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "search",
										value: query,
										placeholder: "搜索能力",
										"aria-label": "搜索能力",
										onChange: (event) => setQuery(event.target.value)
									})]
								}), mode !== "view" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-dock-icon-btn",
									title: "收起",
									"aria-label": "收起",
									onClick: onCollapse,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, { up: true })
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-tab-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-dock-tabs",
								role: "tablist",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										role: "tab",
										"aria-selected": tab === "skills",
										className: `skp-dock-tab${tab === "skills" ? " skp-dock-tab-active" : ""}`,
										onClick: () => setTab("skills"),
										children: ["Skills", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-dock-tab-count",
											children: [
												skillsOn,
												" / ",
												skillRows.length
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										role: "tab",
										"aria-selected": tab === "mcp",
										className: `skp-dock-tab${tab === "mcp" ? " skp-dock-tab-active" : ""}`,
										onClick: () => setTab("mcp"),
										children: ["MCP", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-dock-tab-count",
											children: [
												mcpOn,
												" / ",
												mcpRows.length
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										role: "tab",
										"aria-selected": tab === "tools",
										className: `skp-dock-tab${tab === "tools" ? " skp-dock-tab-active" : ""}`,
										onClick: () => setTab("tools"),
										children: ["Tools", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-dock-tab-count",
											children: [
												toolsOn,
												" / ",
												toolRows.length
											]
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-spacer" }),
							decisionHint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-decision-hint",
								children: decisionHint
							}),
							decisionEntry,
							onManage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-link",
								onClick: onManage,
								children: "管理全部 ↗"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-rail",
						role: "group",
						"aria-label": "本会话全局开关",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-rail-btn skp-dock-rail-btn-primary",
								"aria-disabled": bulkRunning || !canEnable ? true : void 0,
								disabled: bulkRunning || !canEnable,
								title: bulkRunning ? "批量执行中" : !canEnable ? "已全部开启" : "作用于本会话的 Skills · MCP · Tools 三域整体",
								onClick: () => onBulk("enable"),
								children: actionLabel("enable", bulkRunning)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-rail-btn",
								"aria-disabled": bulkRunning || !canDisable ? true : void 0,
								disabled: bulkRunning || !canDisable,
								title: bulkRunning ? "批量执行中" : !canDisable ? "已全部关闭" : "作用于本会话的 Skills · MCP · Tools 三域整体",
								onClick: () => onBulk("disable"),
								children: actionLabel("disable", bulkRunning)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-dock-rail-count",
								children: [
									"已启用 ",
									totalOn,
									" / ",
									total
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-rail-note",
								children: "仅当前会话 · 不改项目默认"
							}),
							progressText !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-rail-progress",
								children: progressText
							}),
							!bulkRunning && bulkFailed > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "skp-dock-rail-fail",
								title: "只重放失败域",
								onClick: onRetryBulk,
								children: [bulkFailed, " 项失败 · 重试"]
							}),
							!bulkRunning && bulkError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-rail-fail",
								children: bulkError
							})
						]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-banner",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), onRetry !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-dock-link",
							onClick: onRetry,
							children: "重试"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-dock-grid",
						role: "tabpanel",
						children: loading && filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-dock-empty",
							children: "加载中…"
						}) : filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-dock-empty",
							children: [query.trim() !== "" ? `没有匹配「${query.trim()}」的能力` : tab === "skills" ? "本会话暂无可配置的 Skills" : tab === "mcp" ? "本会话暂无可配置的 MCP" : "本会话暂无可配置的 Tools", query.trim() !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-link",
								onClick: () => setQuery(""),
								children: "清空搜索"
							})]
						}) : filtered.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityCard, {
							row,
							busy: bulkRunning || busy[row.id] === true,
							onToggle: () => onToggle(row)
						}, row.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-dock-foot-note",
								children: [
									totalOn,
									" / ",
									total,
									" 项已启用",
									injectedOn > 0 ? ` · 其中 ${injectedOn} 项来自插件 / DSH 内置 / Agent 预设` : "",
									" · 开关只作用于当前对话"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-btn",
								disabled: resetBusy || bulkRunning,
								title: "清除本会话的显式开关，恢复默认（Skills / MCP / Tools 三域）",
								onClick: () => {
									setResetBusy(true);
									Promise.resolve(onReset()).finally(() => setResetBusy(false));
								},
								children: "恢复默认"
							}),
							mode !== "view" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-btn skp-dock-btn-primary",
								onClick: onCollapse,
								children: "完成"
							})
						]
					})
				]
			});
		}
		function CapabilityBar({ skillRows, mcpRows, toolRows, loading, onExpand, decisionEntry }) {
			const mcpEnabled = mcpRows.filter((row) => row.enabled).map((row) => ({
				id: row.id,
				name: row.name,
				kind: "mcp"
			}));
			const toolEnabled = toolRows.filter((row) => row.enabled).map((row) => ({
				id: row.id,
				name: row.name,
				kind: "tool"
			}));
			const enabled = [
				...mcpEnabled.slice(0, 2),
				...skillRows.filter((row) => row.enabled).map((row) => ({
					id: row.id,
					name: row.name,
					kind: "skill"
				})),
				...toolEnabled,
				...mcpEnabled.slice(2)
			];
			const visible = enabled.slice(0, 5);
			const overflow = enabled.length - visible.length;
			const total = skillRows.length + mcpRows.length + toolRows.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-dock-bar",
				role: "button",
				tabIndex: 0,
				"aria-label": "展开本会话能力配置",
				onClick: onExpand,
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onExpand();
					}
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dock-title-icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleIcon, {})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dock-bar-title",
						children: "本会话能力"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-bar-divider" }),
					loading && enabled.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dock-bar-hint",
						children: "加载中…"
					}) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dock-bar-hint",
						children: "未启用任何能力"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-dock-chips",
						children: [visible.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: `skp-dock-chip skp-dock-chip-${item.kind}`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { className: "skp-dock-chip-dot" }), item.name]
						}, item.id)), overflow > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-dock-chip skp-dock-chip-more",
							children: ["+", overflow]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-spacer" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-dock-count",
						children: [
							enabled.length,
							" / ",
							total,
							" 启用"
						]
					}),
					decisionEntry,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "skp-dock-config-btn",
						onClick: onExpand,
						children: ["配置", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, {})]
					})
				]
			});
		}
		function useCapabilityController(api, workspace, enabled = true) {
			const { snapshot, loading, error, setError, refresh } = useCapabilitySnapshot(api, workspace, enabled);
			const [pending, setPending] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)({});
			const [optimistic, setOptimistic] = (0, react.useState)({
				skills: {},
				mcp: {},
				tools: {}
			});
			const [bulkState, setBulkState] = (0, react.useState)(IDLE_BULK);
			const bulkRef = (0, react.useRef)(IDLE_BULK);
			bulkRef.current = bulkState;
			const skillRows = (0, react.useMemo)(() => buildSkillRows(snapshot, pending).map((row) => {
				if (pending[row.id] !== void 0) return row;
				const value = optimistic.skills[row.name];
				return value === void 0 ? row : {
					...row,
					enabled: value
				};
			}), [
				snapshot,
				pending,
				optimistic.skills
			]);
			const mcpRows = (0, react.useMemo)(() => buildMcpRows(snapshot, pending).map((row) => {
				if (pending[row.id] !== void 0) return row;
				const value = optimistic.mcp[row.name];
				return value === void 0 ? row : {
					...row,
					enabled: value
				};
			}), [
				snapshot,
				pending,
				optimistic.mcp
			]);
			const toolRows = (0, react.useMemo)(() => buildToolRows(snapshot, pending).map((row) => {
				if (pending[row.id] !== void 0) return row;
				const value = optimistic.tools[row.unit];
				return value === void 0 ? row : {
					...row,
					enabled: value
				};
			}), [
				snapshot,
				pending,
				optimistic.tools
			]);
			const applyOptimistic = (0, react.useCallback)((items) => {
				setOptimistic((prev) => {
					const skills = { ...prev.skills };
					const mcp = { ...prev.mcp };
					const tools = { ...prev.tools };
					for (const item of items) {
						if (item.kind === "skill") {
							skills[item.name] = true;
							continue;
						}
						if (item.kind === "tool") {
							const unit = snapshot.tools.find((candidate) => candidate.name === item.name) ?? snapshot.tools.find((candidate) => candidate.unit === item.name);
							if (unit !== void 0) tools[unit.unit] = true;
							continue;
						}
						const server = snapshot.servers.find((candidate) => candidate.serverName === item.name) ?? snapshot.servers.find((candidate) => candidate.key === item.name);
						mcp[server?.key ?? item.name] = true;
					}
					return {
						skills,
						mcp,
						tools
					};
				});
			}, [snapshot.servers, snapshot.tools]);
			(0, react.useEffect)(() => {
				setPending({});
			}, [snapshot]);
			const toggle = (0, react.useCallback)(async (row) => {
				const next = !row.enabled;
				setPending((prev) => ({
					...prev,
					[row.id]: next
				}));
				setBusy((prev) => ({
					...prev,
					[row.id]: true
				}));
				setError(void 0);
				try {
					if (row.kind === "skill") {
						const result = await api.skills.setSessionEnabled({
							name: row.name,
							enabled: next
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
					} else if (row.kind === "mcp") await api.mcp.setSessionEnabled({
						target: row.target,
						kind: row.writeKind,
						enabled: next
					});
					else await api.tools.setSessionEnabled({
						units: [row.unit],
						enabled: next
					});
				} catch (err) {
					setPending((prev) => ({
						...prev,
						[row.id]: !next
					}));
					setError(String(err instanceof Error ? err.message : err));
				} finally {
					setBusy((prev) => {
						const copy = { ...prev };
						delete copy[row.id];
						return copy;
					});
					refresh();
				}
			}, [
				api,
				refresh,
				setError
			]);
			/**
			* 行 3 控制条的三域批量（R1）：**按域串行**调用 `session.setBulk` 取粗粒度进度，
			* 部分失败只进 `failed[]`（宿主不回滚），这里聚合成 `{n} 项失败 · 重试`。
			* 重试只重放失败域（同一 action）。
			*/
			const runBulk = (0, react.useCallback)(async (action, retryDomains) => {
				if (bulkRef.current.phase === "running") return;
				const domains = retryDomains !== void 0 && retryDomains.length > 0 ? retryDomains : BULK_DOMAINS;
				const optimisticTarget = action === "enable" ? true : action === "disable" ? false : void 0;
				const targetRows = [
					...domains.includes("skills") ? skillRows : [],
					...domains.includes("mcp") ? mcpRows : [],
					...domains.includes("tools") ? toolRows : []
				].filter((row) => !row.disabled && optimisticTarget !== void 0);
				const optimisticMap = {};
				for (const row of targetRows) optimisticMap[row.id] = optimisticTarget === true;
				if (targetRows.length > 0) setPending((prev) => ({
					...prev,
					...optimisticMap
				}));
				const nextState = {
					phase: "running",
					action,
					doneDomains: 0,
					totalDomains: domains.length,
					failed: [],
					failedDomains: []
				};
				setBulkState(nextState);
				setError(void 0);
				const collectedFailed = [];
				const failedDomains = [];
				let bulkError;
				let done = 0;
				for (const domain of domains) try {
					const result = await api.session.setBulk({
						action,
						domains: [domain]
					});
					if (!result.ok) {
						bulkError = result.errors.join("; ");
						failedDomains.push(domain);
					} else if (result.failed.length > 0) {
						collectedFailed.push(...result.failed);
						failedDomains.push(domain);
					}
				} catch (err) {
					bulkError = String(err instanceof Error ? err.message : err);
					failedDomains.push(domain);
				} finally {
					done += 1;
					setBulkState((prev) => prev.phase === "running" ? {
						...prev,
						doneDomains: done
					} : prev);
				}
				if (failedDomains.length > 0) {
					const failedIds = new Set(collectedFailed.map((failure) => rowIdOfBulkFailure(failure, snapshot)).filter((id) => id !== void 0));
					setPending((prev) => {
						const copy = { ...prev };
						for (const id of failedIds) delete copy[id];
						return copy;
					});
				}
				const finalState = {
					phase: collectedFailed.length > 0 || failedDomains.length > 0 ? "partial" : "idle",
					action,
					doneDomains: done,
					totalDomains: domains.length,
					failed: collectedFailed,
					failedDomains,
					...bulkError !== void 0 ? { error: bulkError } : {}
				};
				setBulkState(finalState);
				refresh();
			}, [
				api,
				refresh,
				setError,
				skillRows,
				mcpRows,
				toolRows,
				snapshot
			]);
			return {
				snapshot,
				loading,
				error,
				refresh,
				skillRows,
				mcpRows,
				toolRows,
				pending,
				busy,
				bulkState,
				toggle,
				onBulk: (action) => void runBulk(action),
				retryBulk: (0, react.useCallback)(() => {
					const state = bulkRef.current;
					if (state.action === void 0 || state.failedDomains.length === 0) return;
					runBulk(state.action, state.failedDomains);
				}, [runBulk]),
				reset: (0, react.useCallback)(async () => {
					await runBulk("reset");
				}, [runBulk]),
				applyOptimistic
			};
		}
		/** 批量失败项 → composer 行 id（`failed[]` 的 target 按域映射回行）。 */
		function rowIdOfBulkFailure(failure, snapshot) {
			if (failure.domain === "skills") return `skill:${failure.target}`;
			if (failure.domain === "tools") return `tool:${failure.target}`;
			if (failure.kind === "mcp-project") {
				const server = snapshot.servers.find((candidate) => candidate.key === failure.target);
				return server !== void 0 ? `mcp:project:${server.key}` : void 0;
			}
			const server = snapshot.servers.find((candidate) => candidate.key === failure.target) ?? snapshot.servers.find((candidate) => candidate.serverName === failure.target);
			if (server !== void 0) return server.scope === "project" ? `mcp:project:${server.key}` : `mcp:global:${server.key}`;
			if (snapshot.externals.some((candidate) => candidate.serverName === failure.target)) return `mcp:external:${failure.target}`;
		}
		function ComposerCapabilityHero(props) {
			const { api, onManage } = props;
			const slot = props.slotProps;
			if (slot !== void 0 && typeof slot.useInput === "function") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeroWithSubscribedDraft, {
				api,
				onManage,
				slotProps: slot,
				useInput: slot.useInput
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeroBody, {
				api,
				onManage,
				slotProps: slot,
				slotDraft: void 0
			});
		}
		/**
		* 槽 standardProps 可用分支：`useInput` 是订阅式 hook，草稿变化即重渲染。
		* 单独成组件是为了避免在 props 形态切换时改变 HeroBody 的 hooks 顺序。
		*/
		function HeroWithSubscribedDraft({ api, onManage, slotProps, useInput }) {
			const draft = useInput((state) => typeof state?.draft === "string" ? state.draft : "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeroBody, {
				api,
				onManage,
				slotProps,
				slotDraft: draft
			});
		}
		function HeroBody({ api, onManage, slotProps, slotDraft }) {
			const { ref, phase } = useConversationPhase();
			const isHero = phase === "hero";
			const controller = useCapabilityController(api, useWorkspaceLabel(api), isHero);
			const rect = useComposerCardRect(isHero, ref);
			const [open, setOpen] = (0, react.useState)(true);
			const contentRef = (0, react.useRef)(null);
			const titleRef = (0, react.useRef)(null);
			const staticDraft = typeof slotProps?.input?.draft === "string" ? slotProps.input.draft : void 0;
			const dom = useDomDraftReader(ref, slotDraft === void 0 && staticDraft === void 0);
			const rawDraft = slotDraft !== void 0 ? slotDraft : staticDraft !== void 0 ? staticDraft : dom.draft;
			const draft = rawDraft === void 0 ? void 0 : cleanDraft(rawDraft);
			const jevConfig = useJevConfig(api);
			const lastPhaseRef = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				const previous = lastPhaseRef.current;
				lastPhaseRef.current = phase;
				if (previous !== void 0 && previous !== "hero" && phase === "hero") jevConfig.refreshSilently();
			}, [phase, jevConfig.refreshSilently]);
			const totalCapabilities = controller.skillRows.length + controller.mcpRows.length + controller.toolRows.length;
			const switchableCapabilities = controller.skillRows.length + controller.mcpRows.filter((row) => !row.locked).length + controller.toolRows.filter((row) => !row.disabled).length;
			const returnFocusToEntry = (0, react.useCallback)((returnFocus) => {
				if (!returnFocus) return;
				requestAnimationFrame(() => {
					contentRef.current?.querySelector(".skp-decision-entry")?.focus();
				});
			}, []);
			const decision = useDecision({
				api,
				enabled: isHero,
				draft,
				isComposing: dom.isComposing,
				config: jevConfig.state,
				reloadConfig: jevConfig.reload,
				capabilitiesReady: !controller.loading && totalCapabilities > 0 && switchableCapabilities > 0,
				onManage,
				onRefreshCapabilities: controller.refresh,
				onOptimisticApplied: controller.applyOptimistic,
				onClosed: returnFocusToEntry
			});
			const previousPhaseRef = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				const currentPhase = decision.state?.phase;
				const wasInactive = previousPhaseRef.current === void 0;
				previousPhaseRef.current = currentPhase;
				if (!wasInactive || currentPhase === void 0) return;
				if (decision.state?.origin !== "manual") return;
				requestAnimationFrame(() => titleRef.current?.focus());
			}, [decision.state]);
			const configured = jevConfig.state.status === "ready" && jevConfig.state.view.hasApiKey;
			const autoOff = jevConfig.state.status === "ready" && !jevConfig.state.view.autoTrigger.enabled;
			let entryDisabled = false;
			let entryGuide = jevConfig.state.status === "ready" && !configured;
			let entryLabel = "能力决策";
			let entryTooltip = configured ? autoOff ? "自动触发默认关闭 · 可在 Jev 模型 Tab 开启" : "根据输入框草稿，为 Skills、MCP 与 Tools 打分并勾选相关能力（仅当前会话）" : "尚未配置 Jev 模型，点击去配置";
			if (decision.state?.phase === "applying") {
				entryDisabled = true;
				entryGuide = false;
				entryLabel = "应用中…";
				entryTooltip = "正在应用所选能力";
			} else if (decision.state?.phase === "loading") {
				entryDisabled = true;
				entryGuide = false;
				entryLabel = "评分中…";
				entryTooltip = "正在评分，请稍候";
			} else if (jevConfig.state.status === "loading") {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "正在读取 Jev 配置…";
			} else if (controller.loading) {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "正在加载本会话能力…";
			} else if (draft === void 0) {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "无法读取输入框内容";
			} else if (draft === "") {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "先在输入框写下你要做的事";
			} else if (totalCapabilities === 0) {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "当前会话没有可评分的 Skills / MCP / Tools";
			} else if (switchableCapabilities === 0) {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "当前会话没有可切换的能力";
			} else if (jevConfig.state.status === "error") {
				entryGuide = false;
				entryTooltip = "读取 Jev 配置失败，点击查看详情";
			}
			const onEntryClick = () => {
				if (entryDisabled) return;
				if (jevConfig.state.status === "error") {
					decision.startConfigError();
					return;
				}
				if (jevConfig.state.status !== "ready") return;
				if (!jevConfig.state.view.hasApiKey) {
					onManage?.("jev");
					return;
				}
				decision.start();
			};
			const decisionHint = jevConfig.state.status === "ready" && jevConfig.state.view.hasApiKey && autoOff ? "自动触发默认关闭 · 可在 Jev 模型 Tab 开启" : void 0;
			const entryButton = (inBar) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DecisionEntryButton, {
				inBar,
				label: entryLabel,
				tooltip: entryTooltip,
				disabled: entryDisabled,
				guide: entryGuide,
				onClick: onEntryClick
			});
			const placeholder = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref,
				className: "skp-dock-hero-anchor",
				"aria-hidden": "true"
			});
			if (!isHero || rect === void 0) return placeholder;
			const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
			const maxPanelHeight = decision.state !== void 0 ? 560 : 360;
			const maxHeight = Math.max(180, Math.min(maxPanelHeight, viewportHeight - rect.top - 24));
			const style = {
				left: `${rect.left}px`,
				top: `${rect.top}px`,
				width: `${rect.width}px`,
				maxHeight: `${maxHeight}px`
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref,
				className: "skp-dock-hero-anchor",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: contentRef,
					className: "skp-dock-fixed",
					style,
					children: [
						decision.state !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DecisionPanel, {
							state: decision.state,
							config: jevConfig.state,
							draft,
							estimateTotal: totalCapabilities,
							titleRef,
							onClose: decision.close,
							onCancel: decision.cancelScoring,
							onRescore: decision.rescore,
							onRetry: decision.retry,
							onGoConfig: decision.goConfig,
							onThreshold: decision.setThreshold,
							onToggle: decision.toggleItem,
							onApply: decision.apply
						}) : open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityPanel, {
							mode: "hero",
							loading: controller.loading,
							error: controller.error,
							snapshot: controller.snapshot,
							skillRows: controller.skillRows,
							mcpRows: controller.mcpRows,
							toolRows: controller.toolRows,
							pending: controller.pending,
							busy: controller.busy,
							onToggle: (row) => void controller.toggle(row),
							onReset: controller.reset,
							onBulk: controller.onBulk,
							onRetryBulk: controller.retryBulk,
							bulkState: controller.bulkState,
							onRefresh: controller.refresh,
							onCollapse: () => setOpen(false),
							...onManage !== void 0 ? { onManage } : {},
							onRetry: controller.refresh,
							decisionEntry: entryButton(false),
							...decisionHint !== void 0 ? { decisionHint } : {}
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-decision-bar-wrap",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityBar, {
								skillRows: controller.skillRows,
								mcpRows: controller.mcpRows,
								toolRows: controller.toolRows,
								loading: controller.loading,
								onExpand: () => setOpen(true),
								decisionEntry: entryButton(true)
							})
						}),
						decision.toast !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `skp-decision-toast skp-decision-toast-${decision.toast.tone}`,
							role: "status",
							children: decision.toast.text
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-sr-only",
							role: "status",
							"aria-live": "polite",
							children: decision.liveMessage
						})
					]
				})
			});
		}
		function SessionCapabilityView({ apiFor, sessionId: initialSessionId, onManage }) {
			const rootRef = (0, react.useRef)(null);
			const [sessionId, setSessionId] = (0, react.useState)(initialSessionId);
			(0, react.useEffect)(() => {
				if (sessionId !== void 0) return;
				const value = (rootRef.current?.closest("[data-conversation-session]"))?.getAttribute("data-conversation-session");
				if (typeof value === "string" && value !== "") setSessionId(value);
			}, [sessionId]);
			(0, react.useEffect)(() => {
				if (initialSessionId !== void 0) setSessionId(initialSessionId);
			}, [initialSessionId]);
			(0, react.useEffect)(() => {
				const host = rootRef.current?.closest("[data-conversation-content]");
				if (!(host instanceof HTMLElement)) return;
				host.classList.add("skp-cap-view-host");
				return () => {
					host.classList.remove("skp-cap-view-host");
				};
			}, []);
			const api = (0, react.useMemo)(() => apiFor(sessionId), [apiFor, sessionId]);
			const controller = useCapabilityController(api, useWorkspaceLabel(api), true);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: "skp-cap-view",
				"data-capability-view-session": sessionId ?? "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-cap-view-inner",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityPanel, {
						mode: "view",
						loading: controller.loading,
						error: controller.error,
						snapshot: controller.snapshot,
						skillRows: controller.skillRows,
						mcpRows: controller.mcpRows,
						toolRows: controller.toolRows,
						pending: controller.pending,
						busy: controller.busy,
						onToggle: (row) => void controller.toggle(row),
						onReset: controller.reset,
						onBulk: controller.onBulk,
						onRetryBulk: controller.retryBulk,
						bulkState: controller.bulkState,
						onRefresh: controller.refresh,
						onCollapse: () => void 0,
						...onManage !== void 0 ? { onManage } : {},
						onRetry: controller.refresh
					})
				})
			});
		}
		//#endregion
		//#region src/client.ts
		/** locale 字典的命名空间。 */
		const NS = "capabilityPanel";
		/**
		* 简体中文词典。
		* 注意：当前面板组件直接使用硬编码文案（见 panel.tsx / mcp-panel.tsx），
		* 这组 dictionary 注册后暂无组件读取，属于后续接入本地化的预留脚手架，
		* 两边内容暂时一致。
		*/
		const zh = {
			"panel.title": "能力面板",
			"panel.domain.skills": "Skills",
			"panel.domain.mcp": "MCP",
			"panel.scope.all": "全部",
			"panel.scope.project": "项目",
			"panel.scope.global": "全局",
			"panel.search": "搜索…",
			"panel.loading": "加载中…",
			"panel.empty": "没有匹配项。",
			"panel.readonly": "只读",
			"panel.none": "（无工作区）"
		};
		/** 英文词典，键集合与 zh 完全一致（类型上互相约束，防止漏键）。 */
		const en = {
			"panel.title": "Capabilities",
			"panel.domain.skills": "Skills",
			"panel.domain.mcp": "MCP",
			"panel.scope.all": "All",
			"panel.scope.project": "Project",
			"panel.scope.global": "Global",
			"panel.search": "Search…",
			"panel.loading": "Loading…",
			"panel.empty": "Nothing matches.",
			"panel.readonly": "Read-only",
			"panel.none": "(no workspace)"
		};
		/** 客户端强依赖的服务。 */
		const inject = [
			"connection",
			"slots",
			"locale",
			"workspaces"
		];
		/**
		* 客户端插件主体：注入样式、注册 locale、构造传输适配器、注册侧栏入口。
		*/
		function apply(ctx) {
			const disposers = [];
			disposers.push(installStyles());
			if (ctx.locale?.register) disposers.push(ctx.locale.register(NS, {
				zh,
				en
			}));
			const workspaceListeners = /* @__PURE__ */ new Set();
			const notifyWorkspaceListeners = () => {
				for (const listener of workspaceListeners) try {
					listener();
				} catch {}
			};
			const selection = { cwd: void 0 };
			/** 两个 api 共用同一份订阅集合（各自订阅时都进这里）。 */
			const subscribeWorkspace = (listener) => {
				workspaceListeners.add(listener);
				return () => {
					workspaceListeners.delete(listener);
				};
			};
			const api = createPanelApi({
				rpc: ctx.get("connection")?.rpc,
				currentWorkspaceCwd: () => selection.cwd ?? currentWorkspaceCwd(ctx),
				subscribeWorkspace,
				listProjects: () => listWorkspaceOptions(ctx),
				selectedProject: () => selection.cwd,
				selectProject: (path) => {
					if (selection.cwd === path) return;
					selection.cwd = path;
					notifyWorkspaceListeners();
				},
				sessionTitle: (sessionId) => sessionTitleOf(ctx, sessionId),
				currentSessionId: () => resolveCurrentSessionId(ctx)
			});
			const composerApiFallback = createPanelApi({
				rpc: ctx.get("connection")?.rpc,
				currentWorkspaceCwd: () => currentWorkspaceCwd(ctx),
				subscribeWorkspace,
				listProjects: () => listWorkspaceOptions(ctx),
				selectedProject: () => void 0,
				selectProject: () => {},
				sessionTitle: (sessionId) => sessionTitleOf(ctx, sessionId)
			});
			const sessionApiCache = /* @__PURE__ */ new Map();
			/** 取该 session 自己的 composer api；拿不到 sessionId 时退回无钉选实例。 */
			const composerApiFor = (sessionId) => {
				if (typeof sessionId !== "string" || sessionId.length === 0) return composerApiFallback;
				const cached = sessionApiCache.get(sessionId);
				if (cached !== void 0) return cached;
				const created = createPanelApi({
					rpc: ctx.get("connection")?.rpc,
					currentWorkspaceCwd: () => currentWorkspaceCwd(ctx, sessionId),
					subscribeWorkspace,
					listProjects: () => listWorkspaceOptions(ctx),
					selectedProject: () => void 0,
					selectProject: () => {},
					sessionTitle: (id) => sessionTitleOf(ctx, id),
					sessionId
				});
				sessionApiCache.set(sessionId, created);
				return created;
			};
			let lastPanelCwd = selection.cwd ?? currentWorkspaceCwd(ctx);
			let lastSessionCwd = currentWorkspaceCwd(ctx);
			let lastItemsKey = workspaceItemsKey(ctx);
			const onGraphChange = () => {
				const sessionCwd = currentWorkspaceCwd(ctx);
				const panelCwd = selection.cwd ?? sessionCwd;
				const itemsKey = workspaceItemsKey(ctx);
				if (panelCwd === lastPanelCwd && sessionCwd === lastSessionCwd && itemsKey === lastItemsKey) return;
				lastPanelCwd = panelCwd;
				lastSessionCwd = sessionCwd;
				lastItemsKey = itemsKey;
				notifyWorkspaceListeners();
			};
			const unsubSessions = ctx.get("sessions")?.list?.subscribe?.(onGraphChange);
			const unsubWorkspaces = ctx.get("workspaces")?.list?.subscribe?.(onGraphChange);
			if (typeof unsubSessions === "function") disposers.push(unsubSessions);
			if (typeof unsubWorkspaces === "function") disposers.push(unsubWorkspaces);
			if (ctx.slots?.inject && ctx.slots.register) {
				const disposeMain = ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: "capability-panel"
				}, () => CapabilityPanelPage({ api })));
				if (typeof disposeMain === "function") disposers.push(disposeMain);
				const disposePanellist = ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: "capability-panel",
					order: 30,
					label: "能力面板"
				}, (props) => CapabilityPanelNavIcon({
					size: props?.size,
					active: props?.active
				})));
				if (typeof disposePanellist === "function") disposers.push(disposePanellist);
			}
			if (ctx.slots?.inject && ctx.slots.register) {
				/**
				* 打开能力面板（可指定落点域）。
				*
				* `domain` 省略 = 保持面板当前域（旧行为）；传 "jev" 时先经
				* `setPanelDomain` 记录 pending / 广播事件，再切主区域——面板已挂载则立即
				* 切到「Jev 模型」Tab，尚未挂载则首次渲染直接落在该 Tab（未配置引导
				* AC-ENT-4：hero 的「去配置」走 `onManage("jev")`）。
				*/
				const openCapabilityPanel = (domain) => {
					setPanelDomain(domain);
					try {
						ctx.get("layout")?.selectPanel?.("capability-panel");
					} catch {}
				};
				const disposeCapabilityView = ctx.slots.inject("conversation.view", () => ctx.slots.register({
					name: "conversation.view",
					id: "capability",
					order: 40,
					label: "能力"
				}, (props) => {
					const sessionId = resolveViewSessionId(ctx, props);
					return SessionCapabilityView({
						apiFor: composerApiFor,
						sessionId,
						onManage: openCapabilityPanel
					});
				}));
				if (typeof disposeCapabilityView === "function") disposers.push(disposeCapabilityView);
				const disposeCapabilityHero = ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
					name: "conversation.input.dock",
					id: "capability-panel-hero",
					order: 60,
					label: "本会话能力（首屏）"
				}, (props) => ComposerCapabilityHero({
					api: composerApiFor(props?.sessionId),
					onManage: openCapabilityPanel,
					slotProps: props
				})));
				if (typeof disposeCapabilityHero === "function") disposers.push(disposeCapabilityHero);
			}
			ctx.effect?.(() => () => {
				for (const dispose of disposers) dispose();
			}, "capability-panel: client");
		}
		/**
		* 把 session id 解析成**侧栏显示的会话标题**（本地同步读客户端会话快照，不产生 RPC）。
		*
		* 主机侧 `SessionHeader` 只有 id/cwd 等字段、没有标题（标题由客户端按会话事件
		* 派生），所以 MCP「使用记录」里的 sessionId 只能在客户端这一步换成标题。
		* 依次尝试 `displayTitle`（侧栏用的就是它）→ `title` → `summary`；都拿不到时
		* 返回 undefined，面板退化为显示会话 id 尾部。
		*/
		/**
		* 解析「当前会话」id（v13 A5：能力面板 Tools 页要按会话写开关）。
		*
		* 优先 `sessions.list` 快照的 `current`；该外壳（0.2.0-rc.2）没有 `current` 时
		* 退而用「被主视图保留且唯一」的会话（`byId[id].retainedBy.mainView > 0`），
		* 再退而用唯一 id。多会话同时保留且无 current 时返回 undefined——宁可只读，
		* 也不写错会话。
		*/
		function resolveCurrentSessionId(ctx) {
			try {
				const snapshot = ctx.get("sessions")?.list?.getSnapshot?.();
				if (typeof snapshot?.current === "string" && snapshot.current.length > 0) return snapshot.current;
				const byId = snapshot?.byId;
				if (byId !== null && typeof byId === "object") {
					const mainViewIds = Object.keys(byId).filter((id) => {
						const retained = byId[id]?.retainedBy;
						return typeof retained?.mainView === "number" && retained.mainView > 0;
					});
					if (mainViewIds.length === 1) return mainViewIds[0];
				}
				const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
				if (ids.length === 1 && typeof ids[0] === "string") return ids[0];
			} catch {}
		}
		/**
		* 解析 `conversation.view` 条目的当前会话 id：优先用标准 props，其次用
		* sessions 快照的 current / 唯一 ids 兜底（0.2.0-rc.2 的 sessions 快照没有
		* current 字段时，view 条目仍能绑定到正确会话）。
		*/
		function resolveViewSessionId(ctx, props) {
			if (typeof props?.sessionId === "string") return props.sessionId;
			try {
				const snapshot = ctx.get("sessions")?.list?.getSnapshot?.();
				if (typeof snapshot?.current === "string") return snapshot.current;
				const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
				if (ids.length === 1 && typeof ids[0] === "string") return ids[0];
			} catch {}
		}
		function sessionTitleOf(ctx, sessionId) {
			if (typeof sessionId !== "string" || sessionId.length === 0) return void 0;
			try {
				const record = ctx.get("sessions")?.list?.getSnapshot?.()?.byId?.[sessionId];
				for (const field of [
					"displayTitle",
					"title",
					"summary"
				]) {
					const value = record?.[field];
					if (typeof value === "string" && value.trim().length > 0) return value.trim();
				}
				return;
			} catch {
				return;
			}
		}
		/**
		* 推导某个工作区的目录（若存在）。
		*
		* 解析顺序（第一个命中即返回）：
		*
		*   1. **显式 sessionId**（composer 槽的 standardProps 直接提供）→ 若
		*      `sessions.byId[sessionId].cwd` 有值就直接用它（session 自己的工作目录），
		*      否则找 `workspaces.list` 快照里 `sessionIds` 含它的那个 Workspace 的 path。
		*      这是唯一在 dsh 0.2.0-rc.2 外壳上可靠的一步：该版本的
		*      `sessions.list` 快照形状是 `{ ids, byId, phase, projectionsBySession }`
		*      （**没有 `current`**，且真机上 `byId[session]` 也**没有 `cwd`**，所以
		*      sessionId 实际走的是 Workspace 归属那一路），`workspaces.list` 快照是
		*      `{ items, archivedSessionIds, pinnedSessionIds, state, phase, error }`
		*      （**没有 `recentWorkspaceId`**）。
		*   2. `sessions.list.current` → `byId[current].cwd`（老外壳的字段；有就用，
		*      它是 session 的工作目录本身）。
		*   3. 该外壳没有 `current` 时：`byId` 里**唯一**被主视图保留
		*      （`retainedBy.mainView > 0`）的会话（前台会话）→ 其 `cwd`。
		*   4. `sessions.list.current` / 上面的前台会话 → 包含它的 Workspace 的 path。
		*   5. `workspaces.list.recentWorkspaceId`（老外壳字段）。
		*   6. `items[0]`（第一个注册的工作区）——**只作为最后兜底**：在前五步都
		*      拿不到时它会给出一个与会话无关的工作区，所以 composer 一律通过第 1 步
		*      的 sessionId 走精确解析，绝不落到这里。
		*/
		function currentWorkspaceCwd(ctx, sessionId) {
			let current = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : void 0;
			try {
				const snap = ctx.get("sessions")?.list?.getSnapshot?.();
				if (current === void 0) {
					const active = snap?.current;
					if (typeof active === "string") current = active;
				}
				if (current === void 0) {
					const byId = snap?.byId;
					if (byId !== null && typeof byId === "object") {
						const mainViewIds = Object.keys(byId).filter((id) => {
							const retained = byId[id]?.retainedBy;
							return typeof retained?.mainView === "number" && retained.mainView > 0;
						});
						if (mainViewIds.length === 1) current = mainViewIds[0];
					}
				}
				if (current !== void 0) {
					const cwd = snap?.byId?.[current]?.cwd;
					if (typeof cwd === "string" && cwd.length > 0) return cwd;
				}
			} catch {}
			try {
				const snapshot = ctx.get("workspaces")?.list?.getSnapshot?.();
				const items = snapshot?.items ?? [];
				if (current !== void 0) {
					const owned = items.find((w) => w.sessionIds?.includes?.(current));
					if (owned?.path) return owned.path;
				}
				const recent = snapshot?.recentWorkspaceId;
				if (typeof recent === "string") {
					const item = items.find((w) => w.workspaceId === recent);
					if (item?.path) return item.path;
				}
				return items[0]?.path;
			} catch {
				return;
			}
		}
		/** 读取已知工作区，供面板的项目下拉框使用。 */
		function listWorkspaceOptions(ctx) {
			try {
				return (ctx.get("workspaces")?.list?.getSnapshot?.()?.items ?? []).filter((w) => typeof w.path === "string" && w.path.length > 0).map((w) => ({
					id: String(w.workspaceId ?? w.path),
					path: w.path,
					...typeof w.title === "string" && w.title.length > 0 ? { title: w.title } : {}
				}));
			} catch {
				return [];
			}
		}
		/**
		* 工作区列表的廉价变更检测键（用于判断是否需要刷新下拉框与 composer 标签）。
		*
		* **必须包含每个 Workspace 的 `sessionIds`**：新建会话时宿主会先把会话登记进
		* Workspace（`items[].sessionIds` 变化），composer 随后才按 sessionId 解析所属
		* 工作区。若 key 只看 `id:path:title`，这次变化不触发通知，新建会话的弹层会
		* 停在旧值（真机形状下表现为退化成 `items[0]`）。
		*/
		function workspaceItemsKey(ctx) {
			try {
				return (ctx.get("workspaces")?.list?.getSnapshot?.()?.items ?? []).map((w) => `${String(w.workspaceId ?? w.path)}:${w.path ?? ""}:${w.title ?? ""}:${(w.sessionIds ?? []).join(",")}`).join("|");
			} catch {
				return "";
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.map