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
						return toSkillList(result.value).skills;
					},
					/**
					* v21：列表 + 工作区视图的 hiddenCount（RPC value 为
					* `{skills, hiddenCount}`；兼容旧宿主的纯数组响应）。
					*/
					async listView() {
						const result = await rpc("skills.list", { cwd: deps.currentWorkspaceCwd() });
						if (!result.ok) throw new Error(result.errors.join("; "));
						return toSkillList(result.value);
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
						return toSkillList(result.value).skills;
					},
					/**
					* v21：会话视角列表 + hiddenCount（RPC value 为 `{skills, hiddenCount}`；
					* 兼容旧宿主的纯数组响应）。首屏「不可见 N 项已隐藏」用它。
					*/
					async sessionListView() {
						if (deps.sessionId === void 0) throw new Error("skills.sessionList 只能在会话作用域的 api 上调用");
						const result = await rpc("skills.sessionList", {
							cwd: deps.currentWorkspaceCwd(),
							sessionId: deps.sessionId
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						return toSkillList(result.value);
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
					* 运行时注入的 MCP（**配置只读**，默认开关可写）：宿主的
					* `{servers:[{serverName,tools,calls}]}` 直接投影成客户端类型；脏数据丢弃。
					* v13 R4 额外透传 channel / attribution / synthesized，并把
					* `origin:"namespace"`（工具命名空间合成行）原样保留；v20.2 再透传
					* `disabledGlobally`（全局默认关闭）与语义扩展后的 `disabledInProject`
					* （本工作区有效默认关闭）。
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
						const servers = Array.isArray(view.servers) ? view.servers : [];
						return {
							...view.attributionSettling === true ? { attributionSettling: true } : {},
							...typeof view.hiddenCount === "number" && Number.isFinite(view.hiddenCount) ? { hiddenCount: view.hiddenCount } : {},
							servers: servers.map((raw) => {
								const server = raw ?? {};
								const tools = Array.isArray(server.tools) ? server.tools : [];
								return {
									serverName: typeof server.serverName === "string" ? server.serverName : "",
									...toVisibilityFields(server),
									...typeof server.source === "string" && server.source.length > 0 ? { source: server.source } : {},
									origin: server.origin === "entry" ? "entry" : server.origin === "namespace" ? "namespace" : "fiber",
									...typeof server.channel === "string" && server.channel.length > 0 ? { channel: server.channel } : {},
									...toAttribution(server.attribution) !== void 0 ? { attribution: toAttribution(server.attribution) } : {},
									...server.synthesized === true ? { synthesized: true } : {},
									...server.transport === "stdio" || server.transport === "http" ? { transport: server.transport } : {},
									...typeof server.summary === "string" && server.summary.length > 0 ? { summary: server.summary } : {},
									...server.disabledInProject === true ? { disabledInProject: true } : {},
									...server.disabledGlobally === true ? { disabledGlobally: true } : {},
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
							}).filter((server) => server.serverName.length > 0)
						};
					}
				},
				tools: {
					/**
					* 列出插件单元（v13）。宿主把「服务缺失 / schemas() 失败」包成空 units +
					* errors（不阻断其它域）；适配器原样投影，界面据此显示空态说明。
					*/
					async list(input) {
						const sessionId = input?.sessionId ?? deps.sessionId;
						const cwd = input?.cwd ?? deps.currentWorkspaceCwd();
						const result = await rpc("tools.list", {
							...cwd !== void 0 ? { cwd } : {},
							...sessionId !== void 0 ? { sessionId } : {}
						});
						if (!result.ok) return {
							units: [],
							totalGlobalTools: 0,
							excludedBuiltinCount: 0,
							errors: result.errors
						};
						return toToolsList(result.value);
					},
					/**
					* 按需读取工具定义（含 parameters）：只在详情选中单元时调用，按 unit 缓存。
					* 业务失败抛错，UI 降级为「仅名称 + 说明」并提示参数不可用。
					*/
					async inspect(input) {
						const sessionId = input.sessionId ?? deps.sessionId;
						const result = await rpc("tools.inspect", {
							unit: input.unit,
							...sessionId !== void 0 ? { sessionId } : {}
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value;
						if (value !== null && typeof value === "object" && value.ok === false) {
							const errors = value.errors;
							throw new Error(Array.isArray(errors) ? errors.join("; ") : "tools.inspect failed");
						}
						const inspected = toToolsInspect(value);
						if (inspected.unit.length === 0 && inspected.tools.length === 0) throw new Error("tools.inspect 返回了空结果（unit/tools 缺失）");
						return {
							unit: inspected.unit.length > 0 ? inspected.unit : input.unit,
							tools: inspected.tools
						};
					},
					/**
					* 设置插件的**全局默认**开关（能力面板 Tools 页）：影响所有会话的默认，
					* 不写任何会话覆盖。业务失败抛错（页面显示错误并回滚开关）。
					*/
					async setGlobalEnabled(input) {
						const result = unwrap(await rpc("tools.setGlobalEnabled", {
							units: input.units,
							enabled: input.enabled
						}));
						if (!result.ok) throw new Error(result.errors.join("; "));
						return {
							ok: true,
							applied: typeof result.applied === "number" ? result.applied : input.units.length
						};
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
				prompt: {
					/**
					* 列表：全局 + 项目候选（只含已存在文件）、策略默认、会话显式选择、冻结清单。
					* 服务缺失 / 降级错误收在 `errors` 里，不抛（与 tools.list 同口径）。
					*/
					async list(input) {
						const cwd = input?.cwd ?? deps.currentWorkspaceCwd();
						const sessionId = input?.sessionId ?? deps.sessionId;
						const result = await rpc("prompt.list", {
							...cwd !== void 0 ? { cwd } : {},
							...sessionId !== void 0 ? { sessionId } : {}
						});
						if (!result.ok) return {
							files: [],
							cwd: cwd ?? "",
							projectRoot: cwd ?? "",
							budget: {
								maxBytes: 65536,
								maxSourceBytes: 1048576
							},
							engineAvailable: false,
							visibility: {},
							errors: result.errors
						};
						return toPromptList(result.value);
					},
					/** 读取正文：业务失败抛错（含 too-large / unknown-file 的文案）。 */
					async read(input) {
						const result = await rpc("prompt.read", { path: input.path });
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value;
						if (value !== void 0 && value !== null && value.ok === false) {
							const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["读取失败"];
							throw new Error(errors.join("; "));
						}
						if (value === void 0 || value === null || typeof value.content !== "string") throw new Error("prompt.read 返回为空");
						return {
							ok: true,
							id: typeof value.id === "string" ? value.id : input.path,
							path: typeof value.path === "string" ? value.path : input.path,
							size: typeof value.size === "number" ? value.size : value.content.length,
							content: value.content,
							truncated: value.truncated === true
						};
					},
					/** 保存正文：业务失败抛错（原子写由宿主完成）。 */
					async save(input) {
						const result = await rpc("prompt.save", {
							path: input.path,
							content: input.content
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value;
						if (value !== void 0 && value !== null && value.ok === false) {
							const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
							throw new Error(errors.join("; "));
						}
					},
					async setVisibility(input) {
						const result = await rpc("prompt.setVisibility", {
							scope: input.scope,
							mode: input.mode,
							...input.workspaces !== void 0 ? { workspaces: input.workspaces } : {}
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value;
						if (value !== void 0 && value !== null && value.ok === false) {
							const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
							throw new Error(errors.join("; "));
						}
					},
					async setProjectDefault(input) {
						const result = await rpc("prompt.setProjectDefault", {
							...input.cwd !== void 0 ? { cwd: input.cwd } : {},
							...input.projectRoot !== void 0 ? { projectRoot: input.projectRoot } : {},
							path: input.path,
							enabled: input.enabled
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value;
						if (value !== void 0 && value !== null && value.ok === false) {
							const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
							throw new Error(errors.join("; "));
						}
					},
					async setSessionSelection(input) {
						const sessionId = input.sessionId ?? deps.sessionId;
						if (sessionId === void 0 || sessionId.length === 0) throw new Error("缺少 sessionId");
						const result = await rpc("prompt.setSessionSelection", {
							sessionId,
							selected: input.selected,
							...input.cwd !== void 0 ? { cwd: input.cwd } : {}
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const value = result.value;
						if (value !== void 0 && value !== null && value.ok === false) {
							const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
							throw new Error(errors.join("; "));
						}
					},
					async manifest(input) {
						const result = await rpc("prompt.manifest", { sessionId: input.sessionId });
						if (!result.ok) return void 0;
						const value = result.value;
						if (value === void 0 || value === null) return void 0;
						if (value.manifest === void 0) return void 0;
						return toPromptManifest(value.manifest);
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
				derive: {
					/** 读取当前会话的派生模式 + 自身作为派生会话时的创建快照。 */
					async get() {
						if (deps.sessionId === void 0) throw new Error("session.deriveGet 只能在会话作用域的 api 上调用");
						const result = await rpc("session.deriveGet", { sessionId: deps.sessionId });
						if (!result.ok) throw new Error(result.errors.join("; "));
						const raw = unwrap(result);
						const mode = raw.mode === "workspace" ? "workspace" : "session";
						const derivedRaw = raw.derived !== null && typeof raw.derived === "object" ? raw.derived : void 0;
						const derived = derivedRaw === void 0 ? void 0 : {
							mode: derivedRaw.mode === "workspace" ? "workspace" : "session",
							...typeof derivedRaw.from === "string" && derivedRaw.from.length > 0 ? { from: derivedRaw.from } : {},
							...typeof derivedRaw.at === "number" && Number.isFinite(derivedRaw.at) ? { at: derivedRaw.at } : {}
						};
						return {
							mode,
							...derived !== void 0 ? { derived } : {}
						};
					},
					/** 设置当前会话之后创建 child 时的继承模式；业务失败返回 errors。 */
					async set(mode) {
						if (deps.sessionId === void 0) throw new Error("session.deriveSet 只能在会话作用域的 api 上调用");
						const result = await rpc("session.deriveSet", {
							sessionId: deps.sessionId,
							mode
						});
						if (!result.ok) return {
							ok: false,
							errors: result.errors
						};
						const raw = unwrap(result);
						if (raw.ok === false) return {
							ok: false,
							errors: Array.isArray(raw.errors) ? raw.errors : []
						};
						return { ok: true };
					}
				},
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
							...Array.isArray(view.enabledSkills) ? { enabledSkills: listOf(view.enabledSkills) } : {},
							...Array.isArray(view.enabledMcp) ? { enabledMcp: listOf(view.enabledMcp) } : {},
							...Array.isArray(view.tools) ? { tools: listOf(view.tools) } : {},
							...Array.isArray(view.enabledTools) ? { enabledTools: listOf(view.enabledTools) } : {},
							...typeof view.filePath === "string" ? { filePath: view.filePath } : {},
							...typeof view.projectRoot === "string" ? { projectRoot: view.projectRoot } : {}
						};
					},
					/**
					* 切换某个全局能力在本项目的禁用状态（写回后由面板重拉列表刷新标记）。
					*
					* v20.2：`domain: "mcp"` 走 B2 三态（`mcp` / `enabledMcp`），面板显式传
					* `options.enabled`；不传时沿用宿主的旧翻转语义（翻转有效默认）。
					*/
					async toggle(domain, key, options) {
						return unwrap(await rpc("overrides.toggle", {
							cwd: deps.currentWorkspaceCwd(),
							domain,
							key,
							...options?.enabled !== void 0 ? { enabled: options.enabled } : {}
						}));
					},
					/**
					* v20.1（B2）：显式设置 skill 在本项目的默认启用/禁用（不是翻转）。
					* 复用 `overrides.toggle` 的新增可选参数 `enabled`（与 backend 对齐；
					* 不传 `enabled` 时保持旧的翻转语义）。写盘成功后宿主对同项目 live
					* 会话 reconcile，UI 重拉 skills.list 即可。
					*/
					async setSkillDefault(input) {
						return unwrap(await rpc("overrides.toggle", {
							cwd: deps.currentWorkspaceCwd(),
							domain: "skills",
							key: input.key,
							enabled: input.enabled
						}));
					},
					/** v20.1（B2）/ v21：读取全局默认关闭层 + 三域可见性（损坏时降级空 + errors）。 */
					async globalGet() {
						const result = await rpc("overrides.globalGet", {});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const view = result.value ?? {};
						const errors = Array.isArray(view.errors) ? view.errors.filter((item) => typeof item === "string") : [];
						const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
						return {
							skills: listOf(view.skills),
							mcp: listOf(view.mcp),
							tools: listOf(view.tools),
							visibility: toVisibilitySets(view.visibility),
							...typeof view.filePath === "string" ? { filePath: view.filePath } : {},
							...errors.length > 0 ? { errors } : {}
						};
					},
					/**
					* v20.1（B2）/ v20.2：切换全局默认开关（写 capability-global-overrides.json）。
					* `domain` 与 `key` / `disabled` 原样透传；只写配置，已有会话不受影响。
					*/
					async globalToggle(input) {
						return unwrap(await rpc("overrides.globalToggle", input));
					},
					/**
					* v21：保存某个能力的可见性 + 每工作区默认开/关（写全局文件 v2）。
					* `workspaces` 为完整映射原样透传；业务失败返回 `{ok:false,errors}`（不抛）。
					*/
					async setVisibility(input) {
						return unwrap(await rpc("overrides.setVisibility", input));
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
		/** 投影全局 prompt 的完整可见性映射（坏值丢弃，不抛）。 */
		function toPromptVisibilityMap(value) {
			const out = {};
			if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
			for (const [scope, entry] of Object.entries(value)) {
				if (entry === null || typeof entry !== "object") continue;
				const raw = entry;
				const workspaces = {};
				if (raw.workspaces !== null && typeof raw.workspaces === "object" && !Array.isArray(raw.workspaces)) for (const [root, ws] of Object.entries(raw.workspaces)) {
					if (ws === null || typeof ws !== "object") continue;
					const item = ws;
					workspaces[root] = {
						...typeof item.visible === "boolean" ? { visible: item.visible } : {},
						...typeof item.defaultEnabled === "boolean" ? { defaultEnabled: item.defaultEnabled } : {}
					};
				}
				out[scope] = {
					mode: raw.mode === "selected" || raw.mode === "none" ? raw.mode : "all",
					workspaces
				};
			}
			return out;
		}
		/** 把宿主 `prompt.list` 返回值投影成客户端类型（字段级容错）。 */
		function toPromptList(value) {
			const raw = value ?? {};
			const files = (Array.isArray(raw.files) ? raw.files : []).map((item) => toPromptFile(item)).filter((item) => item !== void 0);
			const rawBudget = raw.budget ?? {};
			const frozen = raw.frozen === void 0 ? void 0 : toPromptManifest(raw.frozen);
			return {
				files,
				cwd: typeof raw.cwd === "string" ? raw.cwd : "",
				projectRoot: typeof raw.projectRoot === "string" ? raw.projectRoot : "",
				...typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {},
				...Array.isArray(raw.sessionSelected) ? { sessionSelected: raw.sessionSelected.filter((item) => typeof item === "string") } : {},
				...frozen !== void 0 ? { frozen } : {},
				budget: {
					maxBytes: typeof rawBudget.maxBytes === "number" ? rawBudget.maxBytes : 65536,
					maxSourceBytes: typeof rawBudget.maxSourceBytes === "number" ? rawBudget.maxSourceBytes : 1048576
				},
				engineAvailable: raw.engineAvailable !== false,
				visibility: toPromptVisibilityMap(raw.visibility),
				errors: Array.isArray(raw.errors) ? raw.errors.map(String) : []
			};
		}
		/** 单条 prompt 文件投影。 */
		function toPromptFile(value) {
			if (value === null || typeof value !== "object") return void 0;
			const raw = value;
			if (typeof raw.id !== "string" || typeof raw.path !== "string") return void 0;
			const scope = raw.scope === "user-global" || raw.scope === "agents-global" ? raw.scope : "project";
			const state = [
				"injected",
				"truncated",
				"omitted",
				"disabled",
				"invisible",
				"duplicate",
				"too-large",
				"unreadable"
			].includes(raw.state) ? raw.state : "injected";
			const visibility = raw.visibility ?? void 0;
			return {
				id: raw.id,
				name: typeof raw.name === "string" ? raw.name : raw.path.split("/").pop() ?? raw.path,
				path: raw.path,
				displayPath: typeof raw.displayPath === "string" ? raw.displayPath : raw.path,
				scope,
				kind: raw.kind === "local" ? "local" : "base",
				directory: typeof raw.directory === "string" ? raw.directory : "",
				size: typeof raw.size === "number" ? raw.size : 0,
				mtimeMs: typeof raw.mtimeMs === "number" ? raw.mtimeMs : 0,
				enabled: raw.enabled === true,
				defaultEnabled: raw.defaultEnabled !== false,
				...typeof raw.projectDefault === "boolean" ? { projectDefault: raw.projectDefault } : {},
				...typeof raw.sessionExplicit === "boolean" ? { sessionExplicit: raw.sessionExplicit } : {},
				...visibility !== void 0 && typeof visibility.mode === "string" ? { visibility: {
					mode: visibility.mode,
					visible: visibility.visible === true,
					defaultEnabled: visibility.defaultEnabled !== false
				} } : {},
				state,
				...typeof raw.duplicateOf === "string" ? { duplicateOf: raw.duplicateOf } : {},
				...typeof raw.order === "number" ? { order: raw.order } : {}
			};
		}
		/** 会话冻结清单投影。 */
		function toPromptManifest(value) {
			if (value === null || typeof value !== "object") return void 0;
			const raw = value;
			if (typeof raw.sessionId !== "string" || typeof raw.at !== "number") return void 0;
			const files = (Array.isArray(raw.files) ? raw.files : []).filter((item) => item !== null && typeof item === "object").map((item, index) => ({
				id: typeof item.id === "string" ? item.id : "",
				path: typeof item.path === "string" ? item.path : "",
				displayPath: typeof item.displayPath === "string" ? item.displayPath : "",
				scope: item.scope === "user-global" || item.scope === "agents-global" ? item.scope : "project",
				order: typeof item.order === "number" ? item.order : index + 1,
				bytes: typeof item.bytes === "number" ? item.bytes : 0,
				digest: typeof item.digest === "string" ? item.digest : ""
			}));
			return {
				sessionId: raw.sessionId,
				cwd: typeof raw.cwd === "string" ? raw.cwd : "",
				at: raw.at,
				renderer: "host",
				files,
				omitted: Array.isArray(raw.omitted) ? raw.omitted.filter((item) => item !== null && typeof item === "object").map((item) => ({ displayPath: typeof item.displayPath === "string" ? item.displayPath : "" })) : [],
				truncated: Array.isArray(raw.truncated) ? raw.truncated.filter((item) => item !== null && typeof item === "object").map((item) => ({
					displayPath: typeof item.displayPath === "string" ? item.displayPath : "",
					originalBytes: typeof item.originalBytes === "number" ? item.originalBytes : 0,
					includedBytes: typeof item.includedBytes === "number" ? item.includedBytes : 0
				})) : [],
				...typeof raw.text === "string" ? { text: raw.text } : {}
			};
		}
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
					const attribution = toAttribution(unit.attribution) ?? { matchedBy: "unknown" };
					const legacyEnabled = typeof unit.enabledInSession === "boolean" ? unit.enabledInSession : void 0;
					const defaultEnabled = typeof unit.defaultEnabled === "boolean" ? unit.defaultEnabled : legacyEnabled ?? true;
					const enabled = typeof unit.enabled === "boolean" ? unit.enabled : legacyEnabled ?? defaultEnabled;
					const restriction = unit.restriction ?? {};
					const restrictionState = restriction.state === "applied" || restriction.state === "skipped" || restriction.state === "failed" ? restriction.state : void 0;
					return {
						unit: unit.unit,
						...toVisibilityFields(unit),
						name: typeof unit.name === "string" && unit.name.length > 0 ? unit.name : unit.unit,
						kind: unit.kind === "unattributed" ? "unattributed" : "plugin",
						tools,
						toolCount: typeof unit.toolCount === "number" && Number.isFinite(unit.toolCount) ? unit.toolCount : tools.length,
						attribution,
						defaultEnabled,
						enabled,
						enabledInSession: legacyEnabled ?? enabled,
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
				...typeof raw.hiddenCount === "number" && Number.isFinite(raw.hiddenCount) ? { hiddenCount: raw.hiddenCount } : {},
				...typeof raw.sessionId === "string" && raw.sessionId.length > 0 ? { sessionId: raw.sessionId } : {},
				...raw.attributionSettling === true ? { attributionSettling: true } : {}
			};
		}
		/** `tools.inspect` 的防御性投影（兼容 `{unit,tools}` / `{ok:true,unit,tools}` 两种外壳）。 */
		function toToolsInspect(value) {
			const raw = value ?? {};
			const inner = raw.value !== null && typeof raw.value === "object" ? raw.value : raw;
			return {
				unit: typeof inner.unit === "string" ? inner.unit : typeof raw.unit === "string" ? raw.unit : "",
				tools: (Array.isArray(inner.tools) ? inner.tools : []).map((item) => {
					const tool = item ?? {};
					if (typeof tool.name !== "string" || tool.name.length === 0) return void 0;
					return {
						name: tool.name,
						...typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {},
						...tool.parameters !== null && typeof tool.parameters === "object" && !Array.isArray(tool.parameters) ? { parameters: tool.parameters } : {}
					};
				}).filter((tool) => tool !== void 0)
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
		/** 已知的归属依据取值（task-32 additive；未知值统一回落 `unknown`）。 */
		const ATTRIBUTION_MATCHED_BY = /* @__PURE__ */ new Set([
			"runtime",
			"literal",
			"table",
			"similarity",
			"namespace",
			"prefix",
			"exact",
			"source",
			"unknown"
		]);
		/**
		* 置信度归一：宿主 D4 契约是 `"high" | "medium" | "low"` 字符串；兼容旧数字口径
		* （0–1 或 0–100 → 统一归一到 0–1）。其它形状丢弃（不展示）。
		*/
		function normalizeConfidence(value) {
			if (value === "high" || value === "medium" || value === "low") return value;
			if (typeof value === "number" && Number.isFinite(value)) {
				const normalized = value > 1 ? value / 100 : value;
				return Math.max(0, Math.min(1, normalized));
			}
		}
		/**
		* 归属判定投影（Tools 单元 / MCP 运行时实例共用）：
		* - `matchedBy` 只收已知值，未知/缺失回落 `unknown`；
		* - 其余 additive 字段（confidence / conflictsWithTable / ambiguous / mixed /
		*   legacyUnit）逐项容错：类型不对就丢弃，不影响开关语义；
		* - 传入非对象返回 undefined（调用方决定是否补 `{matchedBy:"unknown"}`）。
		*/
		function toAttribution(value) {
			if (value === null || typeof value !== "object") return void 0;
			const raw = value;
			const matchedBy = ATTRIBUTION_MATCHED_BY.has(raw.matchedBy) ? raw.matchedBy : "unknown";
			const legacyUnit = raw.legacyUnit === true ? true : typeof raw.legacyUnit === "string" && raw.legacyUnit.length > 0 ? raw.legacyUnit : void 0;
			return {
				matchedBy,
				...typeof raw.pattern === "string" && raw.pattern.length > 0 ? { pattern: raw.pattern } : {},
				...typeof raw.packageName === "string" && raw.packageName.length > 0 ? { packageName: raw.packageName } : {},
				...normalizeConfidence(raw.confidence) !== void 0 ? { confidence: normalizeConfidence(raw.confidence) } : {},
				...raw.conflictsWithTable === true ? { conflictsWithTable: true } : {},
				...raw.ambiguous === true ? { ambiguous: true } : {},
				...raw.mixed === true ? { mixed: true } : {},
				...legacyUnit !== void 0 ? { legacyUnit } : {}
			};
		}
		/**
		* v21：可见性行字段的防御性投影（skills / mcp / tools 三域共用）。
		* 旧宿主缺省 ⇒ 整组字段不出现（UI 按「全部可见」渲染）。
		*/
		function toVisibilityFields(value) {
			const mode = value.visibilityMode === "all" || value.visibilityMode === "selected" || value.visibilityMode === "none" ? value.visibilityMode : void 0;
			return {
				...mode !== void 0 ? { visibilityMode: mode } : {},
				...typeof value.visibleWorkspaceCount === "number" && Number.isFinite(value.visibleWorkspaceCount) ? { visibleWorkspaceCount: value.visibleWorkspaceCount } : {},
				...typeof value.visibleInWorkspace === "boolean" ? { visibleInWorkspace: value.visibleInWorkspace } : {},
				...value.disabledByVisibility === true ? { disabledByVisibility: true } : {}
			};
		}
		/** v21：`skills.list` / `skills.sessionList` 的 value 归一（`{skills, hiddenCount}` 或旧数组）。 */
		function toSkillList(value) {
			const raw = Array.isArray(value) ? { skills: value } : value !== null && typeof value === "object" ? value : {};
			return {
				skills: (Array.isArray(raw.skills) ? raw.skills : []).filter((item) => item !== null && typeof item === "object").map(toSummary),
				...typeof raw.hiddenCount === "number" && Number.isFinite(raw.hiddenCount) ? { hiddenCount: raw.hiddenCount } : {}
			};
		}
		/**
		* v21：`overrides.globalGet.visibility` 的防御性投影。
		* 三域恒为对象；条目 mode 非法按 all；workspaces 非对象按空、字段只收布尔。
		*/
		function toVisibilitySets(value) {
			const source = value !== null && typeof value === "object" ? value : {};
			const domainOf = (domain) => {
				const raw = source[domain];
				if (raw === null || typeof raw !== "object") return {};
				const result = {};
				for (const [key, entry] of Object.entries(raw)) {
					if (key.length === 0 || entry === null || typeof entry !== "object") continue;
					const record = entry;
					const mode = record.mode === "selected" || record.mode === "none" ? record.mode : "all";
					const workspaces = {};
					if (record.workspaces !== null && typeof record.workspaces === "object") for (const [path, rawVisibility] of Object.entries(record.workspaces)) {
						if (path.length === 0 || rawVisibility === null || typeof rawVisibility !== "object") continue;
						const visibility = rawVisibility;
						const projected = {
							...typeof visibility.visible === "boolean" ? { visible: visibility.visible } : {},
							...typeof visibility.defaultEnabled === "boolean" ? { defaultEnabled: visibility.defaultEnabled } : {}
						};
						if (projected.visible !== void 0 || projected.defaultEnabled !== void 0) workspaces[path] = projected;
					}
					result[key] = {
						mode,
						workspaces
					};
				}
				return result;
			};
			return {
				skills: domainOf("skills"),
				mcp: domainOf("mcp"),
				tools: domainOf("tools")
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
				...toVisibilityFields(value),
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
				...value.activationPending === true ? { activationPending: true } : {},
				...injected ? { injected: true } : {},
				...origin !== void 0 ? { origin } : {},
				...typeof value.channel === "string" && value.channel.length > 0 ? { channel: value.channel } : {},
				...typeof value.provider === "string" && value.provider.length > 0 ? { provider: value.provider } : {},
				...typeof value.registrySource === "string" && value.registrySource.length > 0 ? { registrySource: value.registrySource } : {},
				...resourceBaseKind !== void 0 ? { resourceBaseKind } : {},
				...value.contentReadOnly === true ? { contentReadOnly: true } : {},
				...typeof value.disabledInProject === "boolean" ? { disabledInProject: value.disabledInProject } : {},
				...typeof value.globalDefaultDisabled === "boolean" ? { globalDefaultDisabled: value.globalDefaultDisabled } : {},
				...typeof value.projectDefaultEnabled === "boolean" ? { projectDefaultEnabled: value.projectDefaultEnabled } : {},
				...typeof value.projectDefaultDisabled === "boolean" ? { projectDefaultDisabled: value.projectDefaultDisabled } : {},
				...typeof value.effectiveDefaultEnabled === "boolean" ? { effectiveDefaultEnabled: value.effectiveDefaultEnabled } : {},
				...typeof value.canToggleGlobal === "boolean" ? { canToggleGlobal: value.canToggleGlobal } : {},
				...typeof value.globalToggleBlockedReason === "string" && value.globalToggleBlockedReason.length > 0 ? { globalToggleBlockedReason: value.globalToggleBlockedReason } : {}
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
		/**
		* 敏感 flag：命中时把它后面的**一个值**整体掩码。
		*
		* 覆盖 `--header` / `--api-key` / `--token` / `--secret` / `--password`
		* 等常见形态；`-H` / `-e` 单独处理（避免把 `-h/--help` 误伤）。
		*/
		const SENSITIVE_FLAG_PATTERN = /(--?(?:header|api[-_]?key|apikey|token|secret|password|passwd|authorization|auth|cookie|key)\b(?:=|\s+))("[^"]*"|'[^']*'|[^\s"']+)/gi;
		/** `-H "Header: value"`（curl 风格）。 */
		const SHORT_HEADER_PATTERN = /(\s-H\s+)("[^"]*"|'[^']*'|[^\s"']+)/g;
		/** `Bearer <token>`（大小写不敏感；token 至少 4 个字符才掩码）。 */
		const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=:-]{4,}/gi;
		/** `Authorization: <value>` / `Authorization=<value>`。 */
		const AUTHORIZATION_PATTERN = /(\bAuthorization\s*[:=]\s*)(?:Bearer\s+)?[^\s"',;]+/gi;
		/** `Basic <base64>`（HTTP Basic 凭据）。 */
		const BASIC_AUTH_PATTERN = /(\bBasic\s+)[A-Za-z0-9+/=]{4,}/gi;
		/** 通用 `api_key=…` / `token: …` 形态（大小写不敏感，值为引号内或到空白）。 */
		const ASSIGNMENT_SECRET_PATTERN = /\b(api[-_]?key|apikey|token|secret|password|passwd|auth|authorization)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"'&]+)/gi;
		/** 环境变量式 `FOO_TOKEN=…` / `BAR_API_KEY=…`（值为非空白）。 */
		const ENV_SECRET_PATTERN = /\b([A-Z0-9_]{2,}(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH)[A-Z0-9_]*=)[^\s"'&]+/g;
		/** 常见 API Key 前缀（`sk-` / `as_sk_` / `tvly-` / `ctx7sk-` / GitHub token…）。 */
		const TOKEN_PREFIX_PATTERN = /\b(?:sk|as_sk|ctx7sk|tvly|pk|rk|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{8,}\b/gi;
		/** URL query 里的凭据参数（`?api_key=…` / `&token=…`）。 */
		const URL_QUERY_SECRET_PATTERN = /([?&](?:api[-_]?key|apikey|key|token|access_token|auth)=)[^&\s"']+/gi;
		/**
		* 对可能含凭据的文本做掩码（幂等；非字符串/空串返回空串）。
		*
		* 注意：这里**只做文本替换**，不做结构化解析；调用方不要依赖它保留
		* 原始格式。需要保留 URL / 包名等结构信息时，用 `jev/descriptors.ts`
		* 的推导函数，而不是直接展示原文。
		*/
		function sanitizeDescriptorText(text) {
			if (typeof text !== "string" || text.length === 0) return "";
			let out = text;
			out = out.replace(SENSITIVE_FLAG_PATTERN, `$1***`);
			out = out.replace(SHORT_HEADER_PATTERN, `$1***`);
			out = out.replace(BEARER_PATTERN, `$1***`);
			out = out.replace(BASIC_AUTH_PATTERN, `$1***`);
			out = out.replace(AUTHORIZATION_PATTERN, `$1***`);
			out = out.replace(ASSIGNMENT_SECRET_PATTERN, `$1$2***`);
			out = out.replace(ENV_SECRET_PATTERN, `$1***`);
			out = out.replace(TOKEN_PREFIX_PATTERN, "***");
			out = out.replace(URL_QUERY_SECRET_PATTERN, `$1***`);
			out = out.replace(/(?:\*{3}[ \t]+)+(?:\*{3})/gu, "***");
			out = out.replace(/\*{3}\s+(?:Bearer|Basic)\s+\*{3}/giu, "***");
			return out;
		}
		/**
		* 这些 flag 的下一个**参数**是敏感值（`--header` / `--api-key` / `-H` …）。
		*
		* 用结构化（按单个 arg）掩码，而不是在拼好的字符串上做正则：`--header`
		* 的值本身可能含空格（`authorization: Bearer …`），只有按参数边界才能
		* 精确替换整段值。
		*/
		const SENSITIVE_ARG_FLAGS = /* @__PURE__ */ new Set([
			"--header",
			"--headers",
			"--api-key",
			"--apikey",
			"--api_key",
			"--token",
			"--secret",
			"--password",
			"--passwd",
			"--authorization",
			"--auth",
			"--cookie",
			"--key",
			"-h",
			"-e",
			"--env"
		]);
		/** arg 是否 `--flag=value` 形态的敏感 flag（返回 flag 名，否则 undefined）。 */
		function sensitiveFlagName(arg) {
			const lower = arg.toLowerCase();
			const equal = lower.indexOf("=");
			const name = equal >= 0 ? lower.slice(0, equal) : lower;
			return SENSITIVE_ARG_FLAGS.has(name) ? name : void 0;
		}
		/**
		* 按参数边界掩码敏感 flag 的值（保留 flag 本身，值替换成 `***`）。
		*
		* 只掩码**下一个参数**；`--header=Authorization: Bearer x` 这类内联值也覆盖。
		* 非敏感参数原样保留，交给 {@link sanitizeDescriptorText} 做文本兜底。
		*/
		function maskSensitiveArgs(args) {
			const out = [];
			let maskNext = false;
			for (const arg of args) {
				if (typeof arg !== "string") continue;
				if (maskNext) {
					out.push("***");
					maskNext = false;
					continue;
				}
				if (sensitiveFlagName(arg) !== void 0) {
					const equal = arg.indexOf("=");
					if (equal >= 0) {
						out.push(`${arg.slice(0, equal)}=***`);
						continue;
					}
					out.push(arg);
					maskNext = true;
					continue;
				}
				out.push(arg);
			}
			return out;
		}
		/** 把参数数组按 shell 风格拼成一行（敏感值已掩码），再整体做文本兜底。 */
		function formatMaskedArgs(args) {
			return sanitizeDescriptorText(maskSensitiveArgs(args).join(" "));
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
		/**
		* 生成面板列表用的一行摘要：http 显示 URL，stdio 显示"命令 参数"。
		*
		* **凭据掩码（P0 安全修复）**：args / URL 里常内联 token（本机活例
		* `--header "Authorization: Bearer …"`、`--api-key …`）。该摘要在两处使用：
		*   - 面板列表/详情直接显示；
		*   - Jev 能力决策用它当能力描述（会把字符串原样发给第三方 Jev API）。
		* 因此在**源头**就做脱敏；需要结构信息的地方（Jev 描述推导）再从条目
		* 的 command/args/url 推导，绝不回拼原文。
		*/
		function summarizeEntry(entry) {
			return sanitizeDescriptorText(transportOf(entry) === "http" ? entry.url ?? "(missing url)" : [entry.command ?? "(missing command)", formatMaskedArgs(entry.args ?? [])].filter((part) => part.length > 0).join(" "));
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
			if (entry.description !== void 0 && typeof entry.description !== "string") errors.push("\"description\" must be a string");
			return errors;
		}
		//#endregion
		//#region src/client/modal.tsx
		/** 模态框外壳：标题 + 内容；点遮罩关闭（内容区点击已拦截）。 */
		function Modal({ title, children, header, footer, wide = false, onClose }) {
			const fixed = header !== void 0 || footer !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-modal-overlay",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: (fixed ? "skp-modal skp-modal-fixed" : "skp-modal") + (wide ? " skp-modal-wide" : ""),
					role: "dialog",
					"aria-label": title,
					onClick: (e) => e.stopPropagation(),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: title }), fixed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						header !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-modal-header",
							children: header
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-modal-scroll",
							children
						}),
						footer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-modal-footer",
							children: footer
						})
					] }) : children]
				})
			});
		}
		//#endregion
		//#region src/client/scope-chain.tsx
		/**
		* v20.1 两段作用域链（全局 → 工作区）。
		*
		* 全局视图的第二段不是「直接跳到某个工作区」——先展开一个工作区下拉，
		* 用户选中具体工作区后才切换。避免把「最近工作区 / 第一项」当成隐式落点，
		* 也避免用户不知道即将去哪个工作区（用户反馈 2026-11-01）。
		*
		* 工作区视图的第二段是纯展示（真实 effective 状态）。
		*
		* 下拉复用 `.skp-dd-pop` 的 fixed 定位与视口钳制思路；这里不直接复用
		* `SkpSelect`，因为触发按钮是三行卡片（label/title/note），而 `SkpSelect`
		* 的触发区只有单行 label。
		*
		* @module dsh-capability-settings/client/scope-chain
		*/
		/** 从路径取 basename（兼容 POSIX / Windows 分隔符）。 */
		function basenameOf$1(path) {
			const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
			return segments[segments.length - 1] ?? path;
		}
		/**
		* 渲染两段作用域链。
		*
		* @param scope 当前面板作用域
		* @param projectName 工作区展示名（工作区视图第二段）
		* @param globalSeg 全局段文案
		* @param workspaceSeg 工作区段文案（工作区视图）
		* @param workspaces 全部工作区；全局视图点击第二段后展示
		* @param onSelectWorkspace 选中工作区后切换面板作用域
		*/
		function ScopeChain({ scope, projectName, globalSeg, workspaceSeg, workspaces, onSelectWorkspace, compact = false }) {
			const [anchor, setAnchor] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const buttonRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const open = anchor !== null;
			const toggle = () => {
				if (open) {
					setAnchor(null);
					return;
				}
				const rect = buttonRef.current?.getBoundingClientRect();
				if (rect === void 0) return;
				const width = Math.max(280, Math.min(rect.width, 420));
				const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
				const spaceBelow = window.innerHeight - rect.bottom - 8;
				const spaceAbove = rect.top - 8;
				const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
				const maxHeight = Math.min(360, Math.max(120, openUp ? spaceAbove : spaceBelow));
				const top = openUp ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6;
				setAnchor({
					left,
					top,
					width,
					maxHeight
				});
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) setAnchor(null);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setAnchor(null);
				};
				const closeOnViewportChange = () => setAnchor(null);
				const onScroll = (event) => {
					if (popRef.current !== null && event.target instanceof Node && popRef.current.contains(event.target)) return;
					setAnchor(null);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				window.addEventListener("resize", closeOnViewportChange);
				window.addEventListener("scroll", onScroll, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("resize", closeOnViewportChange);
					window.removeEventListener("scroll", onScroll, true);
				};
			}, [open]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: compact ? "skp-scope-chain skp-scope-chain-compact" : "skp-scope-chain",
				"aria-label": "作用域链",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-scope-chain-seg",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-scope-chain-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: globalSeg.on ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow",
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-scope-chain-label",
									children: "全局"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-scope-chain-title",
								children: globalSeg.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-scope-chain-note",
								children: globalSeg.note
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-scope-chain-arrow",
						"aria-hidden": "true",
						children: "→"
					}),
					scope === "global" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: buttonRef,
						type: "button",
						className: "skp-scope-chain-seg skp-scope-chain-action",
						title: "选择要查看的工作区；选中后切到该工作区视图",
						"aria-haspopup": "listbox",
						"aria-expanded": open,
						onClick: toggle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-scope-chain-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dot skp-dot-partial",
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-scope-chain-label",
									children: "工作区覆盖"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-scope-chain-title",
								children: "在「工作区」作用域查看 ↗"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-scope-chain-note",
								children: "先选择工作区，再切到该工作区视图"
							})
						]
					}), open && anchor !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: popRef,
						className: "skp-dd-pop skp-scope-chain-pop",
						role: "listbox",
						"aria-label": "选择工作区",
						style: {
							left: anchor.left,
							top: anchor.top,
							width: anchor.width,
							maxHeight: anchor.maxHeight
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-scope-chain-pop-head",
							children: "选择工作区"
						}), workspaces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-empty skp-scope-chain-pop-empty",
							children: "还没有已知工作区"
						}) : workspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "option",
							className: "skp-dd-opt",
							title: workspace.path,
							onClick: () => {
								setAnchor(null);
								onSelectWorkspace(workspace.path);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dd-opt-label",
								children: workspace.title?.trim() || basenameOf$1(workspace.path)
							})
						}, workspace.path))]
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-scope-chain-seg",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-scope-chain-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: workspaceSeg.on ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow",
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-scope-chain-label",
									children: ["工作区 ", projectName ?? "当前选择"]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-scope-chain-title",
								children: workspaceSeg.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-scope-chain-note",
								children: workspaceSeg.note
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/tool-schema.tsx
		/**
		* 工具参数表（JSON Schema → 参数行）的**单一实现**。
		*
		* 两个面板共用：
		*   - `mcp-panel.tsx` 的「查看工具与参数」检视器（MCP 探测结果 / 外部注入实例的工具）；
		*   - `tools-panel.tsx` 的 Tools 详情手风琴（`tools.inspect` 按需返回的 schema）。
		*
		* 只负责「把 inputSchema 展开成参数/类型/必填/说明」与渲染这张表，不关心数据
		* 来源；样式一律复用 styles.ts 里的 `.skp-param-*` / `.skp-field-label` /
		* `.skp-test-stat` / `.skp-tag-*` 类（与 MCP 面板同形）。
		*
		* @module dsh-capability-settings/client/tool-schema
		*/
		/** 参数表栅格：参数 / 类型 / 必填 / 说明 四列。 */
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
		/** true = 该属性声明了非空 `enum`（对齐 dsh-context：类型列标 `(enum)`）。 */
		function hasEnum(property) {
			return Array.isArray(property.enum) && property.enum.length > 0;
		}
		/**
		* enum 允许值的展示文本（字符串原样、其余 JSON 化），用于类型列 title。
		* 无 enum 时返回 undefined。
		*/
		function enumOptions(property) {
			if (!hasEnum(property)) return void 0;
			return property.enum.map((value) => {
				if (typeof value === "string") return value;
				if (value === null) return "null";
				return JSON.stringify(value);
			});
		}
		/**
		* 一个 JSON Schema 属性的类型名（联合类型用 ` | ` 连接；缺 type 时给结构提示）。
		*
		* 含 `enum` 时补 ` (enum)` 指示（如 `string (enum)`）——dsh-context 的检视器
		* 同样把可选值的约束放在类型列；允许值明细走 {@link enumOptions} 的 title。
		*/
		function schemaType(property) {
			const type = property.type;
			let base;
			if (typeof type === "string") base = type;
			else if (Array.isArray(type)) {
				const parts = type.filter((part) => typeof part === "string");
				if (parts.length > 0) base = parts.join(" | ");
			}
			if (base === void 0) {
				if (hasEnum(property)) return "enum";
				if (property.anyOf !== void 0 || property.oneOf !== void 0) return "union";
				return "unknown";
			}
			return hasEnum(property) ? `${base} (enum)` : base;
		}
		/**
		* 从工具的 `parameters`（JSON Schema 原样）展开参数行。
		* 无 `properties`（或形状不对）时返回空数组。
		*/
		function toolParameters(parameters) {
			if (parameters === void 0 || parameters === null) return [];
			const properties = parameters.properties;
			if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
			const required = Array.isArray(parameters.required) ? parameters.required.filter((name) => typeof name === "string") : [];
			return Object.entries(properties).map(([name, raw]) => {
				const property = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
				const description = typeof property.description === "string" ? property.description : void 0;
				const options = enumOptions(property);
				return {
					name,
					type: schemaType(property),
					required: required.includes(name),
					...description !== void 0 ? { description } : {},
					...options !== void 0 ? { options } : {}
				};
			});
		}
		/**
		* 参数表（参数 / 类型 / 必填 / 说明）；无参数时渲染 `emptyText` 弱说明。
		*
		* 两个面板的 DOM 结构与类名完全一致，tester 的 `.skp-param-name` 等断言在
		* MCP 检视器与 Tools 详情里通用。
		*/
		function ToolParameterTable({ parameters, emptyText = "无参数" }) {
			if (parameters.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-note",
				children: emptyText
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						title: parameter.options !== void 0 && parameter.options.length > 0 ? `允许值：${parameter.options.join(" / ")}` : void 0,
						"aria-label": parameter.options !== void 0 && parameter.options.length > 0 ? `${parameter.type}，允许值：${parameter.options.join(" / ")}` : void 0,
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
		//#region src/client/detail-shell.tsx
		/**
		* v22 详情页外壳：能力中心「Skills / MCP」两个详情页共用的头部与菜单原语。
		*
		* 设计目标（见 `docs/figma/preview/v22-*`，页面 `Capability Panel · 详情页内容优先 v22 草案`）：
		* 把详情页从「整列滚动 + 元数据堆叠」改成「固定头部三段 + 内容区独立滚动」：
		*
		* ```
		* 标题行（名称 / 徽章 / 开关 / ⋯ 菜单）
		* 状态条（作用域链摘要 · 来源 · 命名空间 … | 使用记录 · 元数据 ⌄）
		* 内容工具条（由各域自己渲染）
		* 内容区（flex:1，内部滚动）
		* ```
		*
		* 长元数据（URL / 配置文件 / frontmatter / 可见范围 …）点状态条右侧「元数据」
		* 以宽弹窗打开（`Modal wide`）；低频与破坏性动作收进 `MoreMenu`。
		*
		* 纯展示组件，不含业务状态；MCP / Skills 两个域各自传入数据与回调。
		*
		* @module dsh-capability-settings/client/detail-shell
		*/
		/** 详情页根容器：固定头部 + 可滚动内容（样式见 `.skp-detail-page`）。 */
		function DetailPage({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-detail-page",
				children
			});
		}
		/** 标题行：名称 + 徽章；右侧由调用方放开关 / 菜单。 */
		function DetailTitleBar({ title, tags, right }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-detail-title-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						title,
						children: title
					}),
					tags !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-detail-title-tags",
						children: tags
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
					right
				]
			});
		}
		/** 状态条：单行摘要；超宽省略，不换行。 */
		function DetailStrip({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-detail-strip",
				children
			});
		}
		/** 状态条里的分隔竖线。 */
		function StripSeparator() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "skp-strip-sep",
				"aria-hidden": "true"
			});
		}
		/**
		* 启用开关（详情页常驻）：`checked` / `partial` 表达三态（全开 / 部分 / 全关）。
		* 语义由调用方决定（Skills = 模型与用户都可调用；MCP = 配置内启用）。
		*/
		function ToggleSwitch({ checked, partial = false, disabled = false, title, label, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "skp-switch-wrap",
				title,
				children: [label !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-switch-label",
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: [
						"skp-switch",
						checked ? "skp-switch-on" : "",
						partial ? "skp-switch-partial" : ""
					].filter(Boolean).join(" "),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						role: "switch",
						"aria-checked": checked,
						"aria-label": label ?? title ?? "启用",
						checked,
						disabled,
						onChange: (event) => onChange(event.target.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-switch-knob",
						"aria-hidden": "true"
					})]
				})]
			});
		}
		/**
		* 低频 / 破坏性动作收进 `⋯` 菜单：点外部或 Esc 关闭；菜单项点击后自动收起。
		*/
		function MoreMenu({ items, label = "更多操作" }) {
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			const visible = items.filter((item) => item.label.length > 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-more",
				ref: rootRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "skp-more-btn",
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-label": label,
					title: label,
					onClick: () => setOpen((value) => !value),
					children: "⋯"
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-more-pop",
					role: "menu",
					"aria-label": label,
					children: visible.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "menuitem",
						disabled: item.disabled,
						title: item.title,
						className: item.danger ? "skp-more-item skp-more-item-danger" : "skp-more-item",
						onClick: () => {
							if (item.disabled === true) return;
							setOpen(false);
							item.onSelect();
						},
						children: item.label
					}, item.key))
				})]
			});
		}
		/** 元数据网格（3 列；窄容器降为 2 列 / 1 列）。 */
		function MetaGrid({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-meta-grid",
				children
			});
		}
		/** 元数据单元：小标题 + 值（单行省略，完整值走 title）。 */
		function MetaCell({ label, mono = false, title, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-meta-cell",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-meta-label",
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: mono ? "skp-meta-value skp-meta-mono" : "skp-meta-value",
					title,
					children
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
		const asyncListCache = /* @__PURE__ */ new Map();
		/**
		* 两域视图共用的"拉取 + 重拉"状态机（v21.3 带可选缓存）。
		*
		* `load` 由调用方组装（Skills 直接 list；MCP 把 list+status+runtime 合并
		* 投影成单个结果对象），返回的结果整体存进 `data`，视图从 `data` 派生
		* 各自的行/错误。依赖变化（挂载、工作区切换）与显式 `reload()` 都会触发
		* 拉取。
		*
		* **`cacheKey`（可选）**：
		* - 同 key 的最近结果缓存在模块级 Map；依赖变化时，若新 key 有缓存则
		*   **渲染阶段同步**返回缓存数据，同时后台刷新（stale-while-revalidate）；
		* - 新 key 无缓存时保留旧 `data`（不清空、不闪「加载中」），刷新完成后替换；
		* - `data` 是否为「本 key 的新鲜结果」由 `loading` 单独表达，视图可据此显示
		*   轻量「刷新中…」而不是整屏 loading。
		*
		* 内部用请求序号守卫：并发触发（连点写操作、工作区快速切换）时只让
		* **最新一次**请求的结果落地，防乱序旧响应覆盖新状态。
		*/
		function useAsyncList(load, deps, options) {
			const cacheKey = options?.cacheKey;
			/** 渲染期读取缓存：deps 变化后第一次 render 就能拿到新 key 的缓存（同步渲染）。 */
			const cached = cacheKey !== void 0 ? asyncListCache.get(cacheKey) : void 0;
			const [state, setState] = (0, react.useState)(() => {
				if (cacheKey !== void 0 && cached !== void 0) return {
					key: cacheKey,
					data: cached
				};
				return {};
			});
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(void 0);
			const seq = (0, react.useRef)(0);
			const loadRef = (0, react.useRef)(load);
			loadRef.current = load;
			/**
			* 当前应渲染的数据：
			* - 已对齐到当前 key ⇒ state.data（含后台刷新中的旧值）；
			* - 未对齐但有缓存 ⇒ 缓存（同步渲染，不等 effect）；
			* - 未对齐且无缓存 ⇒ 保留上一次数据（stale-while-revalidate）。
			*/
			const data = cacheKey !== void 0 && state.key !== cacheKey && cached !== void 0 ? cached : state.data;
			const reload = (0, react.useCallback)((options) => {
				const run = ++seq.current;
				const key = cacheKey;
				if (options?.silent !== true) setLoading(true);
				setError(void 0);
				loadRef.current().then((value) => {
					if (run !== seq.current) return;
					if (key !== void 0) asyncListCache.set(key, value);
					setState({
						key,
						data: value
					});
				}).catch((err) => {
					if (run !== seq.current) return;
					setError(String(err));
				}).finally(() => {
					if (run !== seq.current) return;
					setLoading(false);
				});
			}, [cacheKey, ...deps]);
			(0, react.useEffect)(() => {
				if (cacheKey !== void 0) {
					const hit = asyncListCache.get(cacheKey);
					if (hit !== void 0) setState({
						key: cacheKey,
						data: hit
					});
				}
				reload();
				return () => {
					seq.current += 1;
				};
			}, [reload]);
			return {
				data,
				loading,
				error,
				reload
			};
		}
		//#endregion
		//#region src/client/visibility.tsx
		/**
		* 能力可见性（v21）三域共用的展示与编辑组件。
		*
		* 契约：`notes/redesign/visibility-contract.md` §4 / §6。
		* - 可见性是**全局唯一控制**（按工作区），只有全局视图能改：
		*   `mode`（全部 / 指定 / 不可见）+ `workspaces[项目根]`（可见 + 默认开/关）。
		* - 每工作区默认开/关是「该工作区的初始默认」，工作区视图仍可再覆盖（三态），
		*   会话显式开关优先级最高；这些更下层逻辑不在本文件。
		* - 行内标签 / 默认摘要吃宿主投影的 `visibilityMode` / `visibleWorkspaceCount`；
		*   缺省（旧宿主）时用 `overrides.globalGet().visibility` 自行计算。
		*
		* 存储与 RPC：`overrides.globalGet` 读 `visibility`，`overrides.setVisibility`
		* 提交**整份** workspaces 映射（key = 项目根，与 workspaces[].path 原样对应）。
		*
		* @module dsh-capability-settings/client/visibility
		*/
		/** 空可见性集合（旧宿主 / v1 全局文件缺省）。 */
		const EMPTY_VISIBILITY_SETS = {
			skills: {},
			mcp: {},
			tools: {}
		};
		/**
		* v21.2：可见性 / 每工作区默认的**生效范围**说明（用户要求确认语义）。
		* 改动只影响新建对话；已有对话保持原状态（会话「能力」Tab 可单独调整）。
		*/
		const VISIBILITY_EFFECT_NOTE = "可见性与默认改动只对新建对话生效；已有对话保持原状态，可在会话「能力」Tab 单独调整";
		/**
		* 防御性读取全局层（旧宿主 / 测试夹具可能没有 `overrides.globalGet`）：
		* 失败返回 undefined，调用方按「全部可见 / 空名单」降级。
		*/
		function safeGlobalGet(api) {
			const overrides = api.overrides;
			if (overrides === void 0 || typeof overrides.globalGet !== "function") return Promise.resolve(void 0);
			try {
				return Promise.resolve(overrides.globalGet()).catch(() => void 0);
			} catch {
				return Promise.resolve(void 0);
			}
		}
		/** 防御性读取项目 overrides（旧宿主 / 测试夹具可能没有 `overrides.get`）。 */
		function safeOverridesGet(api) {
			const overrides = api.overrides;
			if (overrides === void 0 || typeof overrides.get !== "function") return Promise.resolve(void 0);
			try {
				return Promise.resolve(overrides.get()).catch(() => void 0);
			} catch {
				return Promise.resolve(void 0);
			}
		}
		/** 工作区展示名：优先 title，其次目录 basename。 */
		function visibilityWorkspaceTitle(workspace) {
			if (workspace.title !== void 0 && workspace.title.trim().length > 0) return workspace.title;
			const segments = workspace.path.split(/[\\/]/).filter((segment) => segment.length > 0);
			return segments[segments.length - 1] ?? workspace.path;
		}
		/** 取某个能力的可见性配置（不存在 = 未配置 ⇒ 全部可见、走兜底默认）。 */
		function visibilityEntryOf(sets, domain, key) {
			return sets?.[domain]?.[key];
		}
		/** 可见性模式（缺省 = all，兼容旧宿主 / v1 文件）。 */
		function visibilityModeOf(entry) {
			return entry?.mode ?? "all";
		}
		/** 某工作区是否可见（与宿主 `visibleIn` 同构：mode + visible:false 覆盖）。 */
		function isWorkspaceVisible(entry, workspacePath) {
			const mode = visibilityModeOf(entry);
			if (mode === "none") return false;
			if ((entry?.workspaces?.[workspacePath])?.visible === false) return false;
			if (mode === "selected") return entry !== void 0 && Object.hasOwn(entry.workspaces, workspacePath);
			return true;
		}
		/** 可见的工作区数；`workspaces` 缺省时用配置里显式出现的 key。 */
		function visibleWorkspaceCountOf(entry, workspaces) {
			if (visibilityModeOf(entry) === "none") return 0;
			return (workspaces.length > 0 ? workspaces.map((workspace) => workspace.path) : Object.keys(entry?.workspaces ?? {})).filter((path) => isWorkspaceVisible(entry, path)).length;
		}
		/**
		* 能力是否「不可见」（行尾默认开关应禁用 + 标「不可见 · 不参与默认」）：
		* mode=none，或 selected 模式下没有任何可见工作区。
		*/
		function isInvisibleCapability(entry, workspaces) {
			const mode = visibilityModeOf(entry);
			if (mode === "none") return true;
			if (mode !== "selected") return false;
			return visibleWorkspaceCountOf(entry, workspaces) === 0;
		}
		/**
		* 行级不可见判定：宿主行字段优先（`disabledByVisibility` / `visibilityMode` +
		* `visibleWorkspaceCount`），缺省时回落到可见性配置 + 工作区列表计算。
		*/
		function isRowInvisible(row, entry, workspaces) {
			if (row.disabledByVisibility === true) return true;
			if (row.visibilityMode === "none") return true;
			if (row.visibilityMode === "selected" && (row.visibleWorkspaceCount ?? 0) === 0) return true;
			return isInvisibleCapability(entry, workspaces);
		}
		/** 某工作区的默认开/关：显式 defaultEnabled 优先，否则走兜底 `!globalOff`。 */
		function workspaceDefaultOf(entry, workspacePath, globalOff) {
			const explicit = entry?.workspaces?.[workspacePath]?.defaultEnabled;
			return typeof explicit === "boolean" ? explicit : !globalOff;
		}
		/** 全局视图行内的默认摘要（只在可见工作区上统计；不可见时 undefined）。 */
		function defaultSummaryOf(entry, workspaces, globalOff) {
			if (isInvisibleCapability(entry, workspaces)) return void 0;
			const paths = workspaces.length > 0 ? workspaces.map((workspace) => workspace.path) : Object.keys(entry?.workspaces ?? {});
			let on = 0;
			let off = 0;
			for (const path of paths) {
				if (!isWorkspaceVisible(entry, path)) continue;
				if (workspaceDefaultOf(entry, path, globalOff)) on += 1;
				else off += 1;
			}
			return {
				on,
				off
			};
		}
		/** 详情一行式可见范围摘要（v21 UX 修订：详情不再内联表格/分段）。 */
		function visibilitySummaryText$1(entry, workspaces, globalOff) {
			const mode = visibilityModeOf(entry);
			if (mode === "none") return "可见范围：不可见（所有工作区与对话首屏都不出现）";
			const scopeText = mode === "selected" ? `指定 ${visibleWorkspaceCountOf(entry, workspaces)} 个工作区` : "全部工作区";
			const summary = defaultSummaryOf(entry, workspaces, globalOff);
			return summary === void 0 ? `可见范围：${scopeText}` : `可见范围：${scopeText} · 默认：${summary.on} 开 / ${summary.off} 关`;
		}
		/** 从项目 overrides 判断某能力在本工作区是否有显式默认覆盖。 */
		function workspaceOverrideOf(overrides, domain, key) {
			if (overrides === void 0) return "inherit";
			const enabledOf = () => domain === "skills" ? overrides.enabledSkills : domain === "mcp" ? overrides.enabledMcp : overrides.enabledTools;
			const disabledOf = () => domain === "skills" ? overrides.skills : domain === "mcp" ? overrides.mcp : overrides.tools;
			if (enabledOf()?.includes(key) === true) return "on";
			if (disabledOf()?.includes(key) === true) return "off";
			return "inherit";
		}
		/** 行内可见性标签（全部工作区 / 指定 N / 不可见）。 */
		function VisibilityBadge({ entry, workspaces, mode, count }) {
			const resolvedMode = mode ?? visibilityModeOf(entry);
			const resolvedCount = count ?? visibleWorkspaceCountOf(entry, workspaces);
			const label = resolvedMode === "none" ? "不可见" : resolvedMode === "selected" ? `指定 ${resolvedCount} 个工作区` : "全部工作区";
			const className = resolvedMode === "none" ? "skp-tag skp-tag-warn" : "skp-tag skp-tag-flat";
			const title = resolvedMode === "none" ? "不可见：工作区列表 / 对话首屏都不出现，运行时强制关闭" : resolvedMode === "selected" ? `仅 ${resolvedCount} 个工作区可见；其它工作区与对话首屏完全不出现` : "全部工作区可见（可在可见范围里单独隐藏某个工作区）";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className,
				title,
				children: label
			});
		}
		/** 行内「默认：N 开 / M 关」摘要 + 可见性标签（三域行 meta 区共用）。 */
		function VisibilityRowMeta({ entry, workspaces, globalOff, mode, count, invisible, summaryClassName = "skp-vis-summary" }) {
			const summary = invisible === true ? void 0 : defaultSummaryOf(entry, workspaces, globalOff);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityBadge, {
				entry,
				workspaces,
				mode,
				count
			}), summary !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: summaryClassName,
				title: "每个工作区的默认开/关（可在「可见范围」里按工作区设置；工作区仍可覆盖）",
				children: [
					"默认：",
					summary.on,
					" 开 / ",
					summary.off,
					" 关"
				]
			})] });
		}
		/**
		* 详情「可见范围」摘要 + 编辑入口（全局视图用；v21 UX 修订）。
		*
		* 详情不再内联分段控件与工作区表格（太长、把详情裁掉），只保留一行摘要：
		* 「可见范围：全部工作区 · 默认：N 开 / M 关」；模式与每工作区默认都在
		* 「编辑可见范围」弹层里配置（弹层内已有分段 + 表格）。
		*/
		function VisibilityDetailFields({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onSaved, summaryOnly = false }) {
			const [open, setOpen] = (0, react.useState)(false);
			const summary = visibilitySummaryText$1(entry, workspaces, globalOff);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "可见范围" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-vis-detail-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-vis-detail-summary",
						title: summary,
						children: summary
					}), !summaryOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn",
						onClick: () => setOpen(true),
						children: "编辑可见范围"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-vis-tip",
					children: VISIBILITY_EFFECT_NOTE
				}),
				open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityModal, {
					api,
					domain,
					capabilityKey,
					name,
					entry,
					workspaces,
					globalOff,
					onClose: () => setOpen(false),
					onSaved: () => {
						setOpen(false);
						onSaved();
					}
				})
			] })] });
		}
		/**
		* v22：全局条目的「编辑可见范围」外层入口（详情状态条右侧，不用先展开元数据面板）。
		*
		* 只渲染一个胶囊按钮（tooltip = 可见范围摘要）+ 保存成功回调；摘要本身仍在
		* 元数据面板的「可见范围」行（`VisibilityDetailFields summaryOnly`）。
		*/
		function VisibilityEditControl({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onSaved }) {
			const [open, setOpen] = (0, react.useState)(false);
			const summary = visibilitySummaryText$1(entry, workspaces, globalOff);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "skp-strip-meta-btn",
				title: `可见范围：${summary}（点击按工作区配置可见与默认开关）`,
				onClick: () => setOpen(true),
				children: "编辑可见范围"
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityModal, {
				api,
				domain,
				capabilityKey,
				name,
				entry,
				workspaces,
				globalOff,
				onClose: () => setOpen(false),
				onSaved: () => {
					setOpen(false);
					onSaved();
				}
			})] });
		}
		/** 由现有配置初始化弹层状态。 */
		function initEditState(entry, workspaces) {
			const state = {};
			for (const workspace of workspaces) {
				const explicit = entry?.workspaces?.[workspace.path]?.defaultEnabled;
				state[workspace.path] = {
					visible: isWorkspaceVisible(entry, workspace.path),
					...typeof explicit === "boolean" ? { defaultEnabled: explicit } : {}
				};
			}
			return state;
		}
		/**
		* 可见范围编辑弹层（v21.1）：
		* - **没有模式分段**：模式在保存时由行状态推导（全可见 ⇒ all；全不可见 ⇒ none；
		*   其余 ⇒ selected）；新工作区语义在说明文案里说清。
		* - 工作区表格：每行 [可见 checkbox] + [默认开/关]；表头的「全选/全不选」「全部
		*   默认开/关」是批量切换按钮（默认列只作用于可见行）。
		* - 固定 footer + dirty 态（无改动时保存置灰且不发 RPC）。
		* - 冲突决策：保存返回 `code:"visibility-conflicts"` 时弹二级确认框
		*   （取消 / 保留工作区配置 keep / 清除工作区的开启配置 clear 后重试）。
		*/
		function VisibilityModal({ api, domain, capabilityKey, name, entry, workspaces, globalOff, onClose, onSaved }) {
			const [edit, setEdit] = (0, react.useState)(() => initEditState(entry, workspaces));
			/** 打开时的初始快照（用于 dirty 判定；弹层生命周期内不变）。 */
			const [initial] = (0, react.useState)(() => initEditState(entry, workspaces));
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			/** 冲突二级确认框的数据（非空 = 打开）；`conflictError` 是二级框内的错误位。 */
			const [conflict, setConflict] = (0, react.useState)(void 0);
			const [conflictError, setConflictError] = (0, react.useState)(void 0);
			const visibleOf = (path) => edit[path]?.visible === true;
			const defaultOnOf = (path) => edit[path]?.defaultEnabled ?? !globalOff;
			const visibleWorkspaces = workspaces.filter((workspace) => visibleOf(workspace.path));
			const allRowsVisible = workspaces.length > 0 && visibleWorkspaces.length === workspaces.length;
			const noRowsVisible = visibleWorkspaces.length === 0;
			/**
			* 保存时推导 mode（用户要求，v21.1）：所有行可见 ⇒ all；全部不可见 ⇒ none；
			* 其余 ⇒ selected。空工作区列表按 all（等价于删除条目）。
			*/
			const derivedMode = workspaces.length === 0 ? "all" : allRowsVisible ? "all" : noRowsVisible ? "none" : "selected";
			/** 所有可见行的默认是否都为开（决定默认列批量按钮的方向与文案）。 */
			const allVisibleDefaultsOn = visibleWorkspaces.length > 0 && visibleWorkspaces.every((workspace) => defaultOnOf(workspace.path));
			/** 状态规范化 key：按 workspaces 顺序遍历，顺序无关、等价映射即不 dirty。 */
			const stateKey = (state) => workspaces.map((workspace) => {
				const item = state[workspace.path];
				const visible = item?.visible === true;
				const fallback = item?.defaultEnabled === void 0 ? "-" : item.defaultEnabled ? "1" : "0";
				return `${workspace.path}:${visible ? 1 : 0}:${fallback}`;
			}).join("|");
			/** 有改动才允许保存（取消始终可用）。 */
			const dirty = stateKey(edit) !== stateKey(initial);
			/** 批量：可见列——按当前状态反转（半选时先全选）。 */
			const toggleVisibleAll = () => {
				const next = !allRowsVisible;
				setEdit((current) => {
					const copy = { ...current };
					for (const workspace of workspaces) copy[workspace.path] = {
						...copy[workspace.path] ?? { visible: next },
						visible: next
					};
					return copy;
				});
			};
			/** 批量：默认列——所有可见行按当前状态反转（有任一关闭则全开，全开则全关）。 */
			const toggleDefaultAll = () => {
				if (visibleWorkspaces.length === 0) return;
				const next = !allVisibleDefaultsOn;
				setEdit((current) => {
					const copy = { ...current };
					for (const workspace of visibleWorkspaces) copy[workspace.path] = {
						...copy[workspace.path] ?? { visible: true },
						defaultEnabled: next
					};
					return copy;
				});
			};
			const setWorkspaceVisible = (path, visible) => {
				setEdit((current) => ({
					...current,
					[path]: {
						...current[path] ?? { visible },
						visible
					}
				}));
			};
			const setWorkspaceDefault = (path, defaultEnabled) => {
				setEdit((current) => ({
					...current,
					[path]: {
						...current[path] ?? { visible: true },
						defaultEnabled
					}
				}));
			};
			/**
			* 提交载荷：**完整映射**（每个已知工作区都显式一行）：
			* - `visible` 恒写；不可见行 `visible:false`（不带 defaultEnabled）；
			* - `defaultEnabled` 只在「可见且用户显式设置过」时写。
			*/
			const buildWorkspaces = () => {
				const payload = {};
				for (const workspace of workspaces) {
					const item = edit[workspace.path];
					if (item === void 0) {
						payload[workspace.path] = { visible: false };
						continue;
					}
					const visible = item.visible;
					const explicitDefault = visible && typeof item.defaultEnabled === "boolean" ? { defaultEnabled: item.defaultEnabled } : {};
					payload[workspace.path] = {
						visible,
						...explicitDefault
					};
				}
				return payload;
			};
			/** 一次保存请求；`resolveConflicts` 用于冲突确认后的重试。 */
			const requestSave = async (resolveConflicts) => {
				if (saving || !dirty && resolveConflicts === void 0) return;
				setSaving(true);
				const isRetry = resolveConflicts !== void 0;
				if (isRetry) setConflictError(void 0);
				else setError(void 0);
				const showError = (message) => {
					if (isRetry) setConflictError(message);
					else setError(message);
				};
				try {
					const result = await api.overrides.setVisibility({
						domain,
						key: capabilityKey,
						mode: derivedMode,
						workspaces: buildWorkspaces(),
						...resolveConflicts !== void 0 ? { resolveConflicts } : {}
					});
					if (!result.ok) {
						const conflicts = result.conflicts ?? [];
						if (!isRetry && result.code === "visibility-conflicts" && conflicts.length > 0) {
							setConflict(conflicts);
							setConflictError(void 0);
							return;
						}
						showError(result.errors.join("; "));
						return;
					}
					setConflict(void 0);
					onSaved();
				} catch (failure) {
					showError(String(failure instanceof Error ? failure.message : failure));
				} finally {
					setSaving(false);
				}
			};
			/** 关闭冲突确认框（回到主弹层继续编辑）。 */
			const dismissConflict = () => {
				if (saving) return;
				setConflict(void 0);
				setConflictError(void 0);
			};
			const headerNote = derivedMode === "all" ? "全部工作区可见；新工作区默认可见、走兜底默认。可用表头批量按钮全选 / 全部默认开/关。" : derivedMode === "selected" ? "仅勾选的工作区可见；新工作区默认不可见，需手动勾选。" : "不可见：工作区列表 / 对话首屏都不出现，运行时强制关闭（会话开关不能打开）；旧覆盖保留不删。";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
				title: `可见范围 · ${name}`,
				onClose,
				header: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-vis-modal-note",
						children: headerNote
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-vis-tip",
						children: VISIBILITY_EFFECT_NOTE
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: error
					})
				] }),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "skp-btn",
					onClick: onClose,
					children: "取消"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: dirty && !saving ? "skp-btn skp-btn-primary" : "skp-btn",
					disabled: saving || !dirty,
					title: dirty ? "保存可见范围与每工作区默认" : "没有改动",
					onClick: () => void requestSave(),
					children: saving ? "保存中…" : "保存"
				})] }),
				children: workspaces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-note",
					children: "还没有已知工作区；新建工作区后再来配置。"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-vis-table",
					role: "table",
					"aria-label": "各工作区可见性与默认",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-vis-table-head",
						role: "row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								role: "columnheader",
								children: "工作区"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								role: "columnheader",
								className: "skp-vis-col-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "可见" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-vis-batch",
									disabled: saving,
									title: allRowsVisible ? "全部不勾选（当前已全选）" : "全部勾选（半选时先全选）",
									onClick: toggleVisibleAll,
									children: allRowsVisible ? "全不选" : "全选"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								role: "columnheader",
								className: "skp-vis-col-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "默认" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-vis-batch",
									disabled: saving || visibleWorkspaces.length === 0,
									title: visibleWorkspaces.length === 0 ? "没有可见工作区" : allVisibleDefaultsOn ? "所有可见工作区默认关" : "所有可见工作区默认开",
									onClick: toggleDefaultAll,
									children: allVisibleDefaultsOn ? "全部默认关" : "全部默认开"
								})]
							})
						]
					}), workspaces.map((workspace) => {
						const visible = visibleOf(workspace.path);
						const defaultOn = defaultOnOf(workspace.path);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-vis-table-row",
							role: "row",
							title: workspace.path,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-vis-ws-name",
									role: "cell",
									children: visibilityWorkspaceTitle(workspace)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									role: "cell",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "skp-vis-check",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: visible,
											disabled: saving,
											"aria-label": `${visibilityWorkspaceTitle(workspace)} 可见`,
											onChange: (event) => setWorkspaceVisible(workspace.path, event.target.checked)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "可见" })]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									role: "cell",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "skp-row-toggle skp-vis-default-toggle",
										title: "该工作区的默认开/关（工作区仍可覆盖）",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-row-default-label",
											children: defaultOn ? "默认开" : "默认关"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-switch",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												role: "switch",
												"aria-label": `${visibilityWorkspaceTitle(workspace)} 默认开启`,
												checked: defaultOn,
												disabled: saving || !visible,
												onChange: (event) => setWorkspaceDefault(workspace.path, event.target.checked)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
										})]
									})
								})
							]
						}, workspace.path);
					})]
				})
			}), conflict !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
				title: "可见性冲突",
				onClose: dismissConflict,
				header: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-note",
					children: "以下工作区显式开启了该能力，但本次将设为不可见："
				}),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn",
						disabled: saving,
						onClick: dismissConflict,
						children: "取消"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn",
						disabled: saving,
						onClick: () => void requestSave("keep"),
						children: saving ? "处理中…" : "保留工作区配置"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn skp-btn-danger-ghost",
						disabled: saving,
						title: "移除这些工作区的显式开启配置；其它默认不变",
						onClick: () => void requestSave("clear"),
						children: "清除工作区的开启配置"
					})
				] }),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "skp-vis-conflict-list",
						"aria-label": "冲突工作区",
						children: conflict.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: "skp-vis-conflict-row",
							title: item.projectRoot,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-vis-ws-name",
								children: visibilityWorkspaceTitle({ path: item.workspace })
							}), item.projectRoot !== item.workspace && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-vis-conflict-root",
								children: item.projectRoot
							})]
						}, `${item.workspace}|${item.projectRoot}`))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: "「保留工作区配置」保留这些工作区现有的显式开启；「清除工作区的开启配置」会移除它们的显式开启，其它默认不变。"
					}),
					conflictError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: conflictError
					})
				]
			})] });
		}
		//#endregion
		//#region src/client/mcp-panel.tsx
		/**
		* Capability Panel 的 MCP 域视图（v20.1 能力中心）。
		*
		* 与 Skills 域**同构的两栏**：列表 + 详情。作用域唯一入口在根组件 header
		* （全局 / 工作区 ▾，工作区下拉列出全部工作区），**左栏 ScopeNav 已删除**，
		* 面板与当前对话所在工作区解耦、默认进入全局。列表标题栏固定写
		* 「全局 MCP」/「HtDot · MCP」+ 计数 + 作用域提示 + 内联「＋ 添加 MCP」。
		*
		* - **全局作用域**：`~/.agents/mcp.json` 条目（行尾开关 = 全局默认，写配置
		*   文件 `disabled`）；「外部注入」（其它插件 / profile 在运行时挂载的
		*   mcp-client）作为第二组，**配置只读、默认开关可写**：全局视图写独立文件
		*   `capability-global-overrides.json` 的 `mcp` 名单（不改注入方配置、不卸载实例）；
		* - **工作区作用域**：该工作区 `.mcp.json` 条目 + 引用的全局配置；行尾开关 =
		*   该工作区的默认（写项目 overrides，仅此工作区生效）；
		* - 按契约 §3.6：**不展示某会话的挂载状态**；连接健康以详情「查看工具与参数」
		*   的真实探测结果为准（零副作用，见 `mcp/probe.ts`）；
		* - 详情用同款两段作用域链（全局 → 工作区），只到工作区。
		*
		* 搜索框在根组件头部，由 `query` prop 传入，只过滤当前列表。行内不提供文字
		* 按钮：启用/编辑/删除/引用/探测/使用记录都在详情卡。
		*
		* @module dsh-capability-settings/client/mcp-panel
		*/
		/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
		function rowId(server) {
			return `${server.scope}:${server.key}`;
		}
		/** 行摘要：单行省略（覆盖 `.skp-row-desc` 的两行 clamp，保证行高 72）。 */
		const ROW_SUMMARY_STYLE = {
			display: "block",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis",
			WebkitLineClamp: "unset"
		};
		/**
		* 一条配置条目行（v20.1：全局 / 工作区两种作用域共用同一行结构）。
		*
		* 点行 = 选中（详情卡跟着换）；行尾开关独立，不改变选中。开关语义由**当前
		* 作用域**决定：
		*   - 全局视图 = **全局默认**（写配置文件 `disabled`，所有工作区生效）；
		*   - 工作区视图 = **该工作区的默认**（写项目 overrides，仅此工作区生效）。
		* 行内不渲染文字按钮——启用/编辑/删除/导入/探测/使用记录全部在详情卡里。
		*/
		function McpServerRowImpl({ server, scope, projectName, toolCount, visibilityEntry, projects, globalOff, invisible, overrideState, selected, busy, onSelect, onToggleDefault }) {
			const isGlobal = server.scope === "global";
			const checked = scope === "global" ? server.enabled : server.disabledInProject !== true;
			const dotClass = checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow";
			/** 归属标签按「出身」：引用 / 旧版导入副本本质是全局条目，标「引用」「导入」。 */
			const scopeTag = server.reference === true ? {
				label: "引用",
				className: "skp-tag skp-tag-flat"
			} : server.importedFromGlobal === true ? {
				label: "导入",
				className: "skp-tag skp-tag-flat"
			} : isGlobal ? {
				label: "全局",
				className: "skp-tag skp-tag-global"
			} : {
				label: "本项",
				className: "skp-tag skp-tag-project"
			};
			const defaultOff = scope === "workspace" && isGlobal && server.disabledInProject === true;
			/** 项目原生条目没有「全局默认」可言：不显示「跟随全局/已覆盖」文案。 */
			const isProjectEntry = scope === "workspace" && !isGlobal;
			const switchLabel = invisible ? "不可见 · 不参与默认" : isProjectEntry ? "" : scope === "global" ? "全局默认" : `默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
			/** 只有全局视图的全局条目能编辑可见性（项目原生 / 引用不参与）。 */
			const showVisibility = scope === "global" && isGlobal;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: selected ? "skp-row skp-row-active" : "skp-row",
					style: { minHeight: 72 },
					onClick: () => onSelect(server),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-name",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: dotClass,
									title: checked ? "已启用" : "已关闭"
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
								!server.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: "配置文件里标记为 disabled；可在全局视图开关恢复",
									children: "配置已禁用"
								}),
								defaultOff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: "该工作区默认关闭；只影响本工作区，可在本工作区重新打开",
									children: "工作区默认关闭"
								}),
								server.shadowed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-directory",
									title: "被本工作区内的同名条目遮蔽：本工作区的条目优先生效",
									children: "被遮蔽"
								}),
								showVisibility && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityRowMeta, {
									entry: visibilityEntry,
									workspaces: projects,
									globalOff,
									mode: server.visibilityMode ?? visibilityModeOf(visibilityEntry),
									count: server.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects),
									invisible
								}),
								scope === "workspace" && overrideState !== "inherit" && isGlobal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: overrideState === "on" ? "本工作区显式打开（覆盖全局的每工作区默认）" : "本工作区显式关闭（覆盖全局的每工作区默认）",
									children: "已覆盖"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: toolCount !== void 0 ? `${toolCount} 个工具` : "工具数未知 · 详情可测试连接" })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-row-desc",
							style: ROW_SUMMARY_STYLE,
							title: server.summary,
							children: server.summary
						})
					]
				}), scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "skp-row-toggle",
					title: isProjectEntry ? checked ? "本项目默认：新建对话启用该 MCP；点击仅改本工作区默认" : "本项目默认：新建对话不启用该 MCP；点击仅改本工作区默认" : checked ? "关闭：仅此工作区默认不启用（写项目覆盖，其它工作区不受影响）" : "打开：仅此工作区默认启用（写项目覆盖）",
					children: [switchLabel.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-row-default-label",
						children: switchLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							role: "switch",
							"aria-label": `${isProjectEntry ? "本项目默认" : switchLabel} ${server.key}`,
							checked,
							disabled: busy,
							onChange: () => onToggleDefault(server)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
					})]
				})]
			});
		}
		/** v21.3：列表行 memo 化（160+ 行时避免整表重渲）；回调由父级稳定引用驱动。 */
		const McpServerRow = (0, react.memo)(McpServerRowImpl);
		/**
		* 一条「外部注入」实例行：**配置只读、默认开关可写**。
		*
		* - 全局视图：开关 = **全局默认**（写独立文件 `capability-global-overrides.json`
		*   的 `mcp` 名单，所有工作区新建对话生效；不改注入方配置、不卸载共享实例）；
		* - 工作区视图：开关 = **本工作区默认**（写项目 overrides 的 `mcp` / `enabledMcp`
		*   三态，可覆盖全局默认）。
		*
		* 能否写由 `restrictable` 决定（工具在全局注册表可见才能 `tools.restrict` 屏蔽；
		* 按 agent 作用域注入的实例置灰 + tooltip 说明宿主契约上限）。
		*/
		/** 注入方展示名（R4）：优先 `channel`，没有则 undefined（不猜）。 */
		function externalChannelOf(server) {
			return typeof server.channel === "string" && server.channel.length > 0 ? server.channel : void 0;
		}
		/** true = 命名空间合成行（没有 mcp-client 实例，工具来自 `mcp__<ns>__*` 命名空间）。 */
		function isSynthesized(server) {
			return server.synthesized === true || server.origin === "namespace";
		}
		/** 外部注入实例「不可写」的统一 tooltip（宿主 `tools.restrict` 契约上限）。 */
		const EXTERNAL_TOGGLE_BLOCKED_TITLE = "该实例按 agent 作用域注入，无法用 tools.restrict 屏蔽（宿主契约上限）";
		/**
		* 工作区视图下外部实例的**有效默认关闭**（决定行尾开关 checked）：
		* 优先宿主投影的 `disabledInProject`（v20.2 = 全局默认 ∪ 工作区默认 − 工作区重新打开）；
		* 旧宿主缺该字段时退化到 `disabledGlobally`（全局视图口径）。
		*/
		function disabledInWorkspaceOf(server) {
			return server.disabledInProject !== void 0 ? server.disabledInProject : server.disabledGlobally === true;
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
		/** 归属依据的人话标签（task-32：runtime/literal/table/similarity 等新依据）。 */
		function externalAttributionLabel(server) {
			switch (server.attribution?.matchedBy) {
				case "runtime": return "运行时捕获";
				case "literal": return "包扫描";
				case "table": return "人工映射";
				case "similarity": return "名字推测";
				default: return;
			}
		}
		/** true = 来源含推测成分（MCP 详情同样加「推测」标识，不改变「配置只读」语义）。 */
		function externalAttributionIsSpeculative(server) {
			const attribution = server.attribution;
			if (attribution === void 0) return false;
			return attribution.matchedBy === "similarity" || attribution.ambiguous === true || attribution.conflictsWithTable === true;
		}
		/** 详情「来源判定」文案（方案 §7.6；task-32 新依据优先用人话标签）。 */
		function externalAttributionText(server) {
			const channel = externalChannelOf(server);
			const matchedBy = server.attribution?.matchedBy;
			const basisLabel = externalAttributionLabel(server);
			if (basisLabel !== void 0) {
				const pattern = server.attribution?.pattern ?? server.attribution?.packageName;
				const target = channel ?? server.source;
				return `${basisLabel}${pattern !== void 0 ? `：${pattern}` : ""}${target !== void 0 && target !== pattern ? ` → ${target}` : ""}`;
			}
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
		function McpExternalRowImpl({ server, scope, projectName, globalDefaultDisabled, visibilityEntry, projects, invisible, overrideState, selected, busy, onSelect, onToggleDefault }) {
			/** 全局默认关闭（原始名单；宿主 `disabledGlobally` 为 true 时也必然是关闭）。 */
			const globalOff = globalDefaultDisabled || server.disabledGlobally === true;
			/** 当前视图的默认关闭态：全局视图看全局默认；工作区视图看本工作区有效默认。 */
			const defaultOff = scope === "global" ? globalOff : disabledInWorkspaceOf(server);
			/** 工具在全局注册表可见才可写（两种作用域同一判据；agent 作用域注入的不可）。 */
			const canToggle = server.restrictable;
			const checked = !defaultOff;
			const dot = checked ? {
				className: "skp-dot skp-dot-enabled",
				style: void 0
			} : {
				className: "skp-dot",
				style: { background: "var(--skp-warn)" }
			};
			const toolText = server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具数未知";
			const meta = server.calls > 0 ? `${toolText} · 调用 ${server.calls} 次` : toolText;
			const summary = isSynthesized(server) ? "由工具命名空间合成 · 无 mcp-client 实例（配置只读）" : server.summary ?? "运行时注入，由注入方管理（默认开关可写）";
			const switchLabel = invisible ? "不可见 · 不参与默认" : scope === "global" ? "全局默认" : `默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
			/** 行内状态标签：全局默认关闭 / 已覆盖全局默认 / 工作区默认关闭。 */
			const stateTag = scope === "global" ? globalOff ? {
				label: "全局默认关闭",
				title: "该实例在全局默认关闭名单里（所有工作区新建对话默认不启用）"
			} : void 0 : globalOff ? defaultOff ? {
				label: "全局默认关闭",
				title: "继承全局默认关闭；本工作区未重新打开"
			} : {
				label: "已覆盖全局默认",
				title: "全局默认关闭，但本工作区已显式重新打开"
			} : defaultOff ? {
				label: "工作区默认关闭",
				title: "该工作区默认关闭；只影响本工作区"
			} : void 0;
			const switchTitle = invisible ? "该实例对所有工作区都不可见：不参与默认开关；先在「可见范围」里打开可见性" : !canToggle ? EXTERNAL_TOGGLE_BLOCKED_TITLE : scope === "global" ? checked ? "关闭：写入全局默认关闭名单（所有工作区新建对话默认不启用；不改注入方配置、不卸载共享实例）" : "打开：从全局默认关闭名单移除（恢复所有工作区默认启用）" : checked ? "关闭：仅此工作区默认不启用（写工作区覆盖，其它工作区不受影响）" : globalOff ? "打开：本工作区显式重新打开（覆盖全局默认关闭，写 enabledMcp）" : "打开：仅此工作区默认启用（写工作区覆盖）";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: selected ? "skp-row skp-row-active" : "skp-row",
					style: { minHeight: 72 },
					onClick: () => onSelect(server),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-name",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: dot.className,
									style: dot.style,
									title: defaultOff ? globalOff ? "全局默认关闭" : "本工作区默认关闭" : "运行时注入的实例"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-row-title",
									title: server.serverName,
									children: server.serverName
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: "不是本插件配置文件里的条目：由其它插件 / profile 运行时注入（配置只读、默认开关可写）",
									children: "外部注入"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-meta",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExternalSourceTags, { server }),
								externalChannelOf(server) === void 0 && server.source !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: server.source
								}),
								server.transport !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-flat",
									children: server.transport
								}),
								stateTag !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: stateTag.title,
									children: stateTag.label
								}),
								scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityRowMeta, {
									entry: visibilityEntry,
									workspaces: projects,
									globalOff,
									mode: server.visibilityMode ?? visibilityModeOf(visibilityEntry),
									count: server.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects),
									invisible
								}),
								scope === "workspace" && overrideState !== "inherit" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: overrideState === "on" ? "本工作区显式打开（覆盖全局的每工作区默认）" : "本工作区显式关闭（覆盖全局的每工作区默认）",
									children: "已覆盖"
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
				}), scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "skp-row-toggle",
					title: canToggle ? switchTitle : EXTERNAL_TOGGLE_BLOCKED_TITLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-row-default-label",
						children: switchLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							role: "switch",
							"aria-label": `${switchLabel} ${server.serverName}`,
							checked,
							disabled: !canToggle || busy,
							onChange: () => onToggleDefault(server)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
					})]
				})]
			});
		}
		/** v21.3：外部注入行同样 memo 化。 */
		const McpExternalRow = (0, react.memo)(McpExternalRowImpl);
		/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
		function baseName$2(path) {
			const trimmed = path.replace(/[\\/]+$/, "");
			const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
			return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
		}
		/**
		* MCP 视图主组件（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav。
		*
		* - **全局作用域**：全局 `~/.agents/mcp.json` 条目（开关 = 全局默认，写配置文件
		*   `disabled`）+ 「外部注入」（配置只读，行尾开关写全局默认关闭名单）；
		* - **工作区作用域**：该工作区 `.mcp.json` 条目（本项目） + 引用的全局配置；
		*   行尾开关 = **该工作区的默认**（写项目 overrides，仅此工作区生效；外部注入
		*   行可覆盖全局默认）；
		* - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
		* - 列表标题栏固定「类型 + 作用域」+ 计数 + 内联「＋ 添加 MCP」，落点由
		*   当前作用域直接确定；行内没有文字按钮——启停/编辑/删除/导入/探测都在详情卡。
		* - 按契约 §3.6：不展示「某会话的挂载状态」（挂载是会话级事实），连接健康
		*   以详情页「查看工具与参数」的真实探测结果为准。
		*/
		function McpView({ api, query, projects, workspace, onSelectWorkspace, onCount }) {
			const mcpApi = api.mcp;
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [selected, setSelected] = (0, react.useState)(void 0);
			/** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
			const [selectedExternalName, setSelectedExternalName] = (0, react.useState)(void 0);
			/** 行尾默认开关最近一次操作失败的错误。 */
			const [defaultError, setDefaultError] = (0, react.useState)(void 0);
			const [editServer, setEditServer] = (0, react.useState)(void 0);
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			/** 正在写开关的行 id（同一时间只允许一个，防重复提交）。 */
			const [busyKey, setBusyKey] = (0, react.useState)(void 0);
			const [confirmImport, setConfirmImport] = (0, react.useState)(void 0);
			/** 本次运行内探测成功回填的工具数（serverName → 工具数）；不落盘、不新增宿主字段。 */
			const [toolCounts, setToolCounts] = (0, react.useState)({});
			/** v21：工作区视图的项目 overrides（判断「跟随全局默认 / 已覆盖」）。 */
			const [projectOverrides, setProjectOverrides] = (0, react.useState)(void 0);
			/** 写操作计数：overrides 变化后重读项目覆盖态。 */
			const [writeVersion, setWriteVersion] = (0, react.useState)(0);
			const scope = workspace === void 0 ? "global" : "workspace";
			const projectName = workspace === void 0 ? void 0 : projects.find((project) => project.path === workspace)?.title ?? baseName$2(workspace);
			/**
			* 拉取 list + runtime + 全局默认关闭名单（挂载时、作用域变化时自动执行，写操作后
			* 显式 reload）。不再拉 `mcp.status`：面板不展示某会话的挂载状态（契约 §3.6）。
			*
			* 额外读一次 `globalGet`：宿主 `disabledGlobally` 已是原始名单成员（v20.2），
			* 这里取同一份名单做防御（旧宿主缺字段 / 工作区视图需要区分「继承」与
			* 「已覆盖」），复用已有 RPC 的 `mcp` 字段，不新增端点；失败不影响主列表。
			*/
			const { data, loading, error, reload } = useAsyncList(async () => {
				const [list, runtime, globalOverrides] = await Promise.all([
					mcpApi.list(),
					mcpApi.runtime({ cwd: workspace }).catch(() => ({
						servers: [],
						hiddenCount: 0
					})),
					safeGlobalGet(api)
				]);
				return {
					servers: list.servers,
					listErrors: list.errors,
					listHiddenCount: list.hiddenCount ?? 0,
					runtimeServers: runtime.servers,
					runtimeHiddenCount: runtime.hiddenCount ?? 0,
					globalOverrides,
					projectRoot: list.projectRoot,
					projectFile: list.projectFile
				};
			}, [
				api,
				mcpApi,
				workspace
			], { cacheKey: `mcp:${workspace ?? "global"}` });
			const servers = data?.servers ?? [];
			const listErrors = data?.listErrors ?? [];
			const runtimeServers = data?.runtimeServers ?? [];
			const globalOverrides = data?.globalOverrides;
			const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
			/** v21：工作区视图被可见性隐藏的条目数（配置条目 + 外部实例）。 */
			const hiddenCount = scope === "workspace" ? (data?.listHiddenCount ?? 0) + (data?.runtimeHiddenCount ?? 0) : 0;
			/** 某 serverName 的可见性配置（配置条目与外部注入共用 serverName）。 */
			const visibilityOfName = (serverName) => visibilityEntryOf(visibilitySets, "mcp", serverName);
			/** 兜底默认是否关闭（全局默认关闭名单原始成员；外部实例也看 disabledGlobally）。 */
			const globalOffOf = (serverName, disabledGlobally) => globalOverrides?.mcp.includes(serverName) === true || disabledGlobally === true;
			const invisibleOf = (row, entry) => isRowInvisible(row, entry, projects);
			(0, react.useEffect)(() => {
				if (scope !== "workspace") {
					setProjectOverrides(void 0);
					return;
				}
				let alive = true;
				safeOverridesGet(api).then((value) => {
					if (alive) setProjectOverrides(value);
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				scope,
				workspace,
				writeVersion
			]);
			const globalServers = servers.filter((server) => server.scope === "global");
			const projectServers = servers.filter((server) => server.scope === "project");
			/** 工作区视图里因可见性被隐藏、不应渲染的全局配置条目（旧宿主自动过滤用）。 */
			const workspaceGlobalServers = scope === "workspace" ? globalServers.filter((server) => server.visibleInWorkspace !== false) : globalServers;
			/** 当前作用域总数（Tab 与列表标题共用同一口径；外部注入单独成组计数）。 */
			const scopeTotal = scope === "global" ? globalServers.length : projectServers.length + workspaceGlobalServers.length;
			(0, react.useEffect)(() => {
				if (data === void 0) return;
				onCount?.(scope === "global" ? globalServers.length : projectServers.length + workspaceGlobalServers.length);
			}, [
				data,
				scope,
				globalServers.length,
				projectServers.length,
				workspaceGlobalServers.length,
				onCount
			]);
			/** 作用域切换：清空选中与待确认态（详情跟走）。 */
			(0, react.useEffect)(() => {
				setSelected(void 0);
				setSelectedExternalName(void 0);
				setEditServer(void 0);
				setConfirmImport(void 0);
			}, [scope, workspace]);
			const trimmedQuery = query.trim();
			const q = trimmedQuery.toLowerCase();
			const matchesServer = (server) => q.length === 0 || server.key.toLowerCase().includes(q) || server.serverName.toLowerCase().includes(q) || server.summary.toLowerCase().includes(q);
			const matchesExternal = (server) => q.length === 0 || server.serverName.toLowerCase().includes(q) || (server.channel ?? "").toLowerCase().includes(q) || (server.source ?? "").toLowerCase().includes(q) || (server.summary ?? "").toLowerCase().includes(q);
			const visibleGlobal = workspaceGlobalServers.filter(matchesServer);
			const visibleProject = projectServers.filter(matchesServer);
			const scenarioRuntimes = scope === "workspace" ? runtimeServers.filter((server) => server.visibleInWorkspace !== false) : runtimeServers;
			const visibleExternal = scenarioRuntimes.filter(matchesExternal).sort((a, b) => {
				const aChannel = a.channel ?? "";
				const bChannel = b.channel ?? "";
				if (aChannel.length === 0 && bChannel.length > 0) return 1;
				if (bChannel.length === 0 && aChannel.length > 0) return -1;
				return aChannel.localeCompare(bChannel) || a.serverName.localeCompare(b.serverName);
			});
			const searching = trimmedQuery.length > 0;
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
			/**
			* 行尾默认开关（按作用域分派）：
			*   - 全局视图 → `mcp.setEnabled({scope:"global"})`（写配置文件 `disabled`）；
			*   - 工作区视图 → `overrides.toggle("mcp", key, { enabled })`（B2 三态，仅此工作区；
			*     显式传 enabled，避免宿主按「有效默认」翻转时写错名单）。
			*/
			const toggleRow = async (server) => {
				const id = rowId(server);
				if (busyKey !== void 0) return;
				const current = scope === "global" ? server.enabled : server.disabledInProject !== true;
				setBusyKey(id);
				setDefaultError(void 0);
				try {
					const result = scope === "global" ? await mcpApi.setEnabled({
						scope: "global",
						key: server.key,
						enabled: !server.enabled
					}) : await api.overrides.toggle("mcp", server.key, { enabled: !current });
					if (!result.ok) setDefaultError(result.errors.join("; "));
				} catch (failure) {
					setDefaultError(String(failure));
				} finally {
					setBusyKey(void 0);
					setWriteVersion((value) => value + 1);
					reload({ silent: true });
				}
			};
			/**
			* 外部注入实例的行尾默认开关（v20.2：两种作用域都可写，限制只看 `restrictable`）：
			*   - 全局视图 → `overrides.globalToggle({domain:"mcp"})`，写全局默认关闭名单；
			*   - 工作区视图 → `overrides.toggle("mcp", serverName, { enabled })`，写工作区覆盖
			*     （B2 三态：全局默认关闭时「打开」写 `enabledMcp`）。
			* 都是「不卸载共享实例、只按会话重新 restrict」的写入路径。
			*/
			const toggleExternal = async (server) => {
				const id = `external:${server.serverName}`;
				if (busyKey !== void 0 || !server.restrictable) return;
				const checked = scope === "global" ? server.disabledGlobally !== true : !disabledInWorkspaceOf(server);
				setBusyKey(id);
				setDefaultError(void 0);
				try {
					const result = scope === "global" ? await api.overrides.globalToggle({
						domain: "mcp",
						key: server.serverName,
						disabled: checked
					}) : await api.overrides.toggle("mcp", server.serverName, { enabled: !checked });
					if (!result.ok) setDefaultError(result.errors.join("; "));
				} catch (failure) {
					setDefaultError(String(failure));
				} finally {
					setBusyKey(void 0);
					setWriteVersion((value) => value + 1);
					reload({ silent: true });
				}
			};
			/**
			* 导入这条**全局** server 到当前工作区：登记工作区级引用（内容跟随全局，
			* 启停是引用上的工作区级标记）。工作区内已有同名引用时进入“确认覆盖”态。
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
			/**
			* 删除 / 移出：确认已经由详情页的确认弹窗完成，这里**直接执行**并清空选中。
			*
			* v22 起「删除」动作从行内按钮收进详情页 `⋯` 菜单 + 确认弹窗；旧实现还保留
			* 面板级的「第一次点击只进入确认态」状态机（`confirmDelete`），弹窗里的确认
			* 会被它吞掉——点一次「删除」不调 RPC、弹窗已关闭、界面无任何变化（用户反馈
			* 「点了删除没生效」）。这里删掉那层重复确认，与 Skills 详情页的删除口径一致。
			*/
			const onDelete = async (server) => {
				if (await runOp(mcpApi.remove({
					scope: server.scope,
					key: server.key
				}))) setSelected(void 0);
			};
			/** 选中一条配置条目：清掉外部实例选中与所有待确认态。 */
			const selectServer = (server) => {
				setSelected(rowId(server));
				setSelectedExternalName(void 0);
				setEditServer(void 0);
				setConfirmImport(void 0);
			};
			/** 选中一个外部注入实例：与配置条目选中互斥。 */
			const selectExternal = (server) => {
				setSelectedExternalName(server.serverName);
				setSelected(void 0);
				setEditServer(void 0);
				setConfirmImport(void 0);
			};
			/** 打开新增弹窗：落点由当前作用域固定（全局 / 此工作区），不再二次选择。 */
			const openAdd = () => {
				setEditServer(void 0);
				setAddOpen(true);
			};
			/**
			* v21.3：列表行 memo 需要稳定回调——用 ref 取最新实现，避免行组件因闭包
			* 函数每次重建而全量重渲。行组件把 server 回传给回调。
			*/
			const rowActionsRef = (0, react.useRef)({
				selectServer,
				selectExternal,
				toggleRow,
				toggleExternal
			});
			rowActionsRef.current = {
				selectServer,
				selectExternal,
				toggleRow,
				toggleExternal
			};
			const stableSelectServer = (0, react.useCallback)((server) => rowActionsRef.current.selectServer(server), []);
			const stableToggleServer = (0, react.useCallback)((server) => {
				rowActionsRef.current.toggleRow(server);
			}, []);
			const stableSelectExternal = (0, react.useCallback)((server) => rowActionsRef.current.selectExternal(server), []);
			const stableToggleExternal = (0, react.useCallback)((server) => {
				rowActionsRef.current.toggleExternal(server);
			}, []);
			/** 非空的服务器列表（组内滚动 + listbox 语义）。 */
			const renderServerScroll = (list, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-group-scroll",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "skp-list",
					role: "listbox",
					"aria-label": label,
					children: list.map((server) => {
						const isGlobal = server.scope === "global";
						const entry = isGlobal ? visibilityOfName(server.serverName) : void 0;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpServerRow, {
							server,
							scope,
							projectName,
							toolCount: toolCounts[server.serverName],
							visibilityEntry: entry,
							projects,
							globalOff: globalOffOf(server.serverName),
							invisible: isGlobal && invisibleOf(server, entry),
							overrideState: scope === "workspace" && isGlobal ? workspaceOverrideOf(projectOverrides, "mcp", server.serverName) : "inherit",
							selected: selected === rowId(server),
							busy: busyKey !== void 0,
							onSelect: stableSelectServer,
							onToggleDefault: stableToggleServer
						}, rowId(server));
					})
				})
			});
			/** 空态：区分「还没有」与搜索「无匹配」，并给原地添加入口。 */
			const renderEmpty = () => {
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
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: scope === "global" ? "全局还没有 MCP。" : `工作区 ${projectName ?? ""} 还没有 MCP。` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn",
						style: { marginTop: 10 },
						onClick: openAdd,
						children: scope === "global" ? "添加全局 MCP" : "添加到此工作区"
					})]
				});
			};
			/** 一个分组头（标题 + 计数 + 说明）。 */
			const renderGroupHead = (title, count, note) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-list-group-head",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-list-group-title",
						children: title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-group-count",
						children: count
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-list-group-note",
						children: note
					})
				]
			});
			/**
			* 「外部注入」组（全局 / 工作区两个视图共用）：配置只读、行尾默认开关可写。
			* 组头备注按作用域说明写入落点；保留组头与计数，为空时不占位。
			*/
			const renderExternalGroup = () => visibleExternal.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "skp-group",
				role: "group",
				"aria-label": `外部注入（${visibleExternal.length}）`,
				children: [renderGroupHead("外部注入", scenarioRuntimes.length, scope === "global" ? "运行时注入 · 可设全局默认" : "运行时注入 · 可设本工作区默认"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-group-scroll",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "skp-list",
						role: "listbox",
						"aria-label": "外部注入 MCP",
						children: visibleExternal.map((server) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpExternalRow, {
							server,
							scope,
							projectName,
							globalDefaultDisabled: globalOffOf(server.serverName, server.disabledGlobally),
							visibilityEntry: visibilityOfName(server.serverName),
							projects,
							invisible: invisibleOf(server, visibilityOfName(server.serverName)),
							overrideState: scope === "workspace" ? workspaceOverrideOf(projectOverrides, "mcp", server.serverName) : "inherit",
							selected: selectedExternalName === server.serverName,
							busy: busyKey !== void 0,
							onSelect: stableSelectExternal,
							onToggleDefault: stableToggleExternal
						}, `external:${server.serverName}`))
					})
				})]
			}) : null;
			/** 列表主体：全局 = 全局配置 + 外部注入；工作区 = 本项目 + 引用的全局配置 + 外部注入。 */
			const renderListBody = () => {
				if (loading && data === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-status",
					children: "加载中…"
				});
				if (error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-error",
					children: ["读取失败：", error]
				});
				if (scope === "global") {
					if (visibleGlobal.length === 0 && visibleExternal.length === 0) return renderEmpty();
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-group-scroll skp-group-scroll-plain",
						children: [visibleGlobal.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead("全局配置", globalServers.length, "~/.agents/mcp.json"), renderServerScroll(visibleGlobal, "全局配置 MCP")] }), renderExternalGroup()]
					});
				}
				if (visibleProject.length === 0 && visibleGlobal.length === 0 && visibleExternal.length === 0) {
					if (hiddenCount > 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-group-scroll skp-group-scroll-plain",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-empty",
							children: "本工作区没有可见的 MCP。"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-pane-note",
							children: [
								"另有 ",
								hiddenCount,
								" 个能力未对此外工作区开放"
							]
						})]
					});
					return renderEmpty();
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-group-scroll skp-group-scroll-plain",
					children: [
						visibleProject.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead(`本项目 · ${projectName ?? "工作区"}`, projectServers.length, "工作区独有"), renderServerScroll(visibleProject, "本项目 MCP")] }),
						visibleGlobal.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead("引用的全局配置", workspaceGlobalServers.length, `默认开关作用于 ${projectName ?? "此工作区"}`), renderServerScroll(visibleGlobal, "引用的全局 MCP")] }),
						renderExternalGroup(),
						hiddenCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-pane-note",
							title: "这些能力/实例在全局视图里未被开放给本工作区；请在全局视图的「可见范围」里开启",
							children: [
								"另有 ",
								hiddenCount,
								" 个能力未对此外工作区开放"
							]
						})
					]
				});
			};
			const listTitle = scope === "global" ? "全局 MCP" : `${projectName ?? "工作区"} · MCP`;
			const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
			const addTitle = scope === "global" ? "添加 MCP 到全局" : `添加 MCP 到工作区 ${projectName ?? "工作区"}`;
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
					defaultError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: defaultError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-list-pane",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-list-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-list-title",
											title: listTitle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-list-title-scope",
												children: scope === "global" ? "全局" : projectName ?? "工作区"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-list-title-type",
												children: scope === "global" ? " MCP" : " · MCP"
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-group-count",
											title: "当前作用域总数",
											children: searching ? `${visibleProject.length + visibleGlobal.length} / ${scopeTotal}` : scopeTotal
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-list-note",
											children: listNote
										}),
										loading && data !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-refresh-note",
											children: "刷新中…"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn skp-btn-primary skp-list-add",
											title: addTitle,
											"aria-label": addTitle,
											onClick: openAdd,
											children: "＋ 添加 MCP"
										})
									]
								}),
								scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									children: "全局配置写入 ~/.agents/mcp.json · 所有工作区生效"
								}),
								scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									children: "默认开关写入工作区覆盖 · 仅此工作区生效"
								}),
								renderListBody()
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail skp-detail-fixed skp-detail-flush",
							children: selectedExternal !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpExternalDetail, {
								api: mcpApi,
								panelApi: api,
								server: selectedExternal,
								scope,
								projectName,
								globalDefaultDisabled: globalOffOf(selectedExternal.serverName, selectedExternal.disabledGlobally),
								visibilityEntry: visibilityOfName(selectedExternal.serverName),
								projects,
								globalOff: globalOffOf(selectedExternal.serverName, selectedExternal.disabledGlobally),
								onVisibilitySaved: () => {
									setWriteVersion((value) => value + 1);
									reload({ silent: true });
								},
								workspaces: projects,
								onSelectWorkspace
							}, selectedExternal.serverName) : selectedServer ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpDetail, {
								api: mcpApi,
								panelApi: api,
								server: selectedServer,
								scope,
								workspace,
								projectName,
								visibilityEntry: selectedServer.scope === "global" ? visibilityOfName(selectedServer.serverName) : void 0,
								projects,
								globalOff: globalOffOf(selectedServer.serverName),
								onVisibilitySaved: () => {
									setWriteVersion((value) => value + 1);
									reload({ silent: true });
								},
								workspaces: projects,
								onSelectWorkspace,
								confirmingImport: confirmImport === rowId(selectedServer),
								onEdit: () => setEditServer(selectedServer),
								onToggle: () => {
									if (selectedServer.scope === "global") runOp(mcpApi.setEnabled({
										scope: "global",
										key: selectedServer.key,
										enabled: !selectedServer.enabled
									}));
									else runOp(mcpApi.setEnabled({
										scope: selectedServer.scope,
										key: selectedServer.key,
										enabled: !selectedServer.enabled
									}));
								},
								onDelete: () => void onDelete(selectedServer),
								onImport: () => void onImport(selectedServer),
								onToolCount: (count) => setToolCounts((prev) => prev[selectedServer.serverName] === count ? prev : {
									...prev,
									[selectedServer.serverName]: count
								})
							}, rowId(selectedServer)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-detail-empty",
								children: scopeTotal === 0 ? "此作用域还没有 MCP。用列表标题栏的「＋ 添加 MCP」添加一个。" : "选择一个服务器查看详情，或新增一个。"
							})
						})]
					}),
					addOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpAddDialog, {
						api: mcpApi,
						servers,
						scope: scope === "global" ? "global" : "project",
						workspace,
						projectName,
						projectRoot: data?.projectRoot,
						projectFile: data?.projectFile,
						onClose: () => setAddOpen(false),
						onMutated: () => reload({ silent: true })
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
		* v22 工具主从分栏（MCP 详情内容区）：左 262px 工具列表（搜索 + 参数数 + 选中态）
		* + 右常驻参数详情。切换工具只重绘右栏；搜索/选中都是本地状态，不触发探测。
		*/
		function ToolsSplitView({ tools, selectedName, onSelect, query, onQuery, loading = false }) {
			const filtered = (0, react.useMemo)(() => {
				const keyword = query.trim().toLowerCase();
				if (keyword.length === 0) return tools;
				return tools.filter((tool) => tool.name.toLowerCase().includes(keyword) || (tool.description ?? "").toLowerCase().includes(keyword));
			}, [tools, query]);
			const selected = tools.find((tool) => tool.name === selectedName);
			const move = (delta) => {
				if (filtered.length === 0) return;
				const index = filtered.findIndex((tool) => tool.name === selectedName);
				const next = filtered[Math.max(0, Math.min(filtered.length - 1, (index < 0 ? 0 : index) + delta))];
				if (next !== void 0) onSelect(next.name);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-tools-split",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-tools-list",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "skp-tools-search",
						type: "search",
						value: query,
						placeholder: "搜索工具…",
						"aria-label": "搜索工具",
						onChange: (event) => onQuery(event.target.value)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-tools-list-scroll",
						role: "listbox",
						"aria-label": "工具列表",
						tabIndex: 0,
						onKeyDown: (event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								move(1);
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								move(-1);
							}
						},
						children: [filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							children: loading ? "正在读取工具清单…" : tools.length === 0 ? "该服务器未暴露工具" : "没有匹配的工具"
						}), filtered.map((tool) => {
							const count = toolParameters(tool.parameters).length;
							const active = tool.name === selectedName;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								role: "option",
								"aria-selected": active,
								title: tool.name,
								className: active ? "skp-tool-row skp-tool-row-active" : "skp-tool-row",
								onClick: () => onSelect(tool.name),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-row-name",
									children: tool.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-row-count",
									children: count === 0 ? "无参数" : `${count} 个参数`
								})]
							}, tool.name);
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-tool-detail",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-tool-detail-scroll",
						children: selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							children: loading ? "正在连接并读取工具清单…" : "选择左侧工具查看参数"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-tool-detail-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-detail-name",
									children: selected.name
								}), selected.description !== void 0 && selected.description.trim().length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-detail-desc",
									children: selected.description
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolParameterTable, {
								parameters: toolParameters(selected.parameters),
								emptyText: "该工具无参数"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-tool-detail-note",
								children: "参数来自最近一次连接快照；服务器改动后点「重新测试」刷新。"
							})
						] })
					})
				})]
			});
		}
		/**
		* 「测试连接」成功报告（仅新增 / 编辑弹窗用）：状态行 + 服务器提示 + 工具名
		* 与参数个数。详情页已改为「工具列表 + 参数详情」主从分栏（见 ToolsSplitView），
		* 这里只保留轻量摘要，避免在弹窗里再嵌一套分栏。
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
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-test-tools",
						children: result.tools.map((tool) => {
							const count = toolParameters(tool.parameters).length;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-test-tool-row",
								title: tool.name,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: "skp-tool-name",
									children: tool.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tool-count",
									children: count === 0 ? "无参数" : `${count} 个参数`
								})]
							}, tool.name);
						})
					})
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
								children: entry.sessionTitle ?? (entry.sessionId.length > 0 ? `对话 ${entry.sessionId.slice(-8)}` : "—")
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
		* 「外部注入」MCP 的详情：**配置只读，默认开关可写**。
		*
		* 这些实例不在本插件配置文件里（其它插件/profile 在运行时挂的 mcp-client），
		* 配置与生命周期由注入方管理，能力面板不能编辑/删除/卸载；但**默认开关可写**：
		* 全局视图 = 全局默认关闭名单（独立文件 `capability-global-overrides.json`），
		* 工作区视图 = 本工作区默认（项目 overrides，可覆盖全局默认）；两者都不卸载
		* 共享实例，只按会话重新 `tools.restrict`。详情只展示能观察到的信息：来源插件、
		* 注入方式、命名空间、传输/命令摘要（能读到才有）、每个工具的说明与参数
		* （来自工具注册表，与「查看工具与参数」同源），以及使用记录。
		*/
		function McpExternalDetail({ api, panelApi, server, scope, projectName, globalDefaultDisabled, visibilityEntry, projects, globalOff: globalOffProp, onVisibilitySaved, workspaces, onSelectWorkspace }) {
			const [metaOpen, setMetaOpen] = (0, react.useState)(false);
			const [usageOpen, setUsageOpen] = (0, react.useState)(false);
			const [selectedTool, setSelectedTool] = (0, react.useState)(server.tools[0]?.name);
			const [toolQuery, setToolQuery] = (0, react.useState)("");
			const [copiedKey, setCopiedKey] = (0, react.useState)(void 0);
			const hasTools = server.tools.length > 0;
			/** 全局默认关闭（原始名单；宿主 `disabledGlobally` 为 true 时也必然是关闭）。 */
			const globalOff = globalOffProp || globalDefaultDisabled || server.disabledGlobally === true;
			/** 本工作区有效默认关闭（含全局默认继承；本工作区重新打开后为 false）。 */
			const workspaceOff = disabledInWorkspaceOf(server);
			const namespace = `mcp__${server.serverName}__*`;
			const sourceLabel = externalChannelOf(server) ?? server.source ?? "来源未识别";
			const copyText = (key, text) => {
				navigator.clipboard?.writeText(text).catch(() => void 0);
				setCopiedKey(key);
				window.setTimeout(() => setCopiedKey((current) => current === key ? void 0 : current), 1500);
			};
			const menuItems = [
				{
					key: "copy-namespace",
					label: copiedKey === "namespace" ? "已复制命名空间" : "复制命名空间",
					onSelect: () => copyText("namespace", namespace)
				},
				{
					key: "copy-source",
					label: "复制来源",
					onSelect: () => copyText("source", sourceLabel)
				},
				{
					key: "usage",
					label: "使用记录",
					onSelect: () => setUsageOpen(true)
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailPage, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-head-wrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTitleBar, {
						title: server.serverName,
						tags: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExternalSourceTags, { server }),
							externalAttributionIsSpeculative(server) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-warn",
								title: "来源为推测，请核对工具清单",
								children: "推测"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								title: "配置由注入方管理（只读）；默认开关可在列表行尾设置（可写）",
								children: "配置只读"
							})
						] }),
						right: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MoreMenu, { items: menuItems })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailStrip, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeChain, {
							compact: true,
							scope,
							projectName,
							globalSeg: {
								on: !globalOff,
								title: globalOff ? "全局默认关闭" : "全局默认启用",
								note: "全局默认写 capability-global-overrides.json · 不改注入方配置"
							},
							workspaceSeg: {
								on: !workspaceOff,
								title: !workspaceOff ? globalOff ? "已覆盖全局默认" : "默认启用" : globalOff ? "继承全局默认关闭" : "本工作区默认关闭",
								note: server.restrictable ? "行尾开关可写本工作区默认（不卸载共享实例）" : EXTERNAL_TOGGLE_BLOCKED_TITLE
							},
							workspaces,
							onSelectWorkspace
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item",
							children: ["来源 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-strip-strong",
								children: sourceLabel
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item skp-strip-ellipsis",
							title: namespace,
							children: ["命名空间 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-strip-strong",
								children: namespace
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-right",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-strip-meta-btn",
								onClick: () => setUsageOpen(true),
								children: "使用记录"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-strip-meta-btn",
								onClick: () => setMetaOpen((value) => !value),
								children: "元数据"
							})]
						})
					] })]
				}),
				metaOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
					wide: true,
					title: `元数据 · ${server.serverName}`,
					onClose: () => setMetaOpen(false),
					children: [
						externalAttributionIsSpeculative(server) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note skp-note-warn",
							children: "来源为推测，请核对工具清单"
						}),
						(server.attribution?.legacyUnit === true || typeof server.attribution?.legacyUnit === "string") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							title: typeof server.attribution.legacyUnit === "string" ? `旧版键：${server.attribution.legacyUnit}` : void 0,
							children: "旧版键已迁移"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							children: isSynthesized(server) ? `配置只读：该实例由工具命名空间 mcp__${server.serverName}__* 合成（没有 mcp-client 实例，无配置可编辑）；默认开关可写（全局默认 / 本工作区）。` : `配置只读：该 MCP 由 ${externalChannelOf(server) ?? server.source ?? "其它插件"} 在运行时注入，能力面板不能编辑或删除；默认开关可写（全局默认 / 本工作区），不卸载共享实例。`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								maxHeight: 300,
								overflow: "auto",
								marginTop: 10
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
								className: "skp-detail-fields",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "来源" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: sourceLabel }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "来源判定" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: externalAttributionText(server) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "注入方式" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [externalInjectionText(server), isSynthesized(server) ? "；无实例配置，传输方式未知" : ""] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "命名空间" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: namespace }) }),
									server.transport !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "传输方式" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [server.transport, server.summary !== void 0 ? ` · ${server.summary}` : ""] })] }),
									scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityDetailFields, {
										api: panelApi,
										domain: "mcp",
										capabilityKey: server.serverName,
										name: server.serverName,
										entry: visibilityEntry,
										workspaces: projects,
										globalOff,
										onSaved: onVisibilitySaved
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "全局默认" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: globalOff ? "关闭（在「全局」作用域用列表行尾开关恢复；不改注入方配置、不卸载共享实例）" : "启用" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "本工作区" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: !workspaceOff ? globalOff ? "已覆盖全局默认：本工作区显式重新打开" : "继承全局默认（启用）" : globalOff ? "继承全局默认（关闭）" : "本工作区默认关闭" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "默认开关" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: server.restrictable ? "列表行尾开关可写：全局视图 = 全局默认（独立文件，所有工作区生效）；工作区视图 = 本工作区默认（可覆盖全局默认）。均不卸载共享实例。" : EXTERNAL_TOGGLE_BLOCKED_TITLE }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "本次运行调用" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: server.calls > 0 ? `${server.calls} 次` : "还没有调用记录" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "管理" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: isSynthesized(server) ? "工具命名空间无法在这里编辑或卸载；请在注入方管理（默认开关仍可写）。" : "配置由注入方管理；能力面板不提供编辑/删除/卸载，但默认开关可写。" })
								]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-modal-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => copyText("namespace", namespace),
									children: copiedKey === "namespace" ? "已复制命名空间" : "复制命名空间"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => copyText("source", sourceLabel),
									children: copiedKey === "source" ? "已复制来源" : "复制来源"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => setMetaOpen(false),
									children: "关闭"
								})
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-toolbar",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-toolbar-title",
						children: "工具与参数"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-toolbar-stat",
						children: hasTools ? `${server.tools.length} 个工具 · 数据来自运行时工具注册表` : "工具清单不可见"
					})]
				}),
				hasTools ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsSplitView, {
					tools: server.tools,
					selectedName: selectedTool,
					onSelect: setSelectedTool,
					query: toolQuery,
					onQuery: setToolQuery
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-detail-loading",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: "工具清单不可见（该实例按作用域注入，只能统计调用次数）。"
					})
				}),
				usageOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
					title: `使用记录 · ${server.serverName}`,
					onClose: () => setUsageOpen(false),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpUsageSection, {
						api,
						serverName: server.serverName
					})
				})
			] });
		}
		/**
		* 配置条目详情：归属徽标 + 字段 + 写操作 + 「工具与参数」（真连一次探测，
		* 两栏工具/参数）/「使用记录」两个折叠区。
		*
		* 动作语义沿用现状：**项目条目** = 启用/禁用、编辑、删除（两击确认）；
		* **全局条目** = 「导入到本项目」（登记项目级引用，同名时两击确认）、编辑、
		* 删除；全局条目自身 disabled 时给一个直接的恢复入口。
		*/
		function McpDetail({ api, panelApi, server, scope, workspace, projectName, visibilityEntry, projects, globalOff, onVisibilitySaved, workspaces, onSelectWorkspace, confirmingImport, onEdit, onToggle, onDelete, onImport, onToolCount }) {
			const isGlobal = server.scope === "global";
			/** 工作区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
			const imported = !isGlobal && server.importedFromGlobal === true;
			/** 工作区级引用（内容跟随全局，启停是工作区级标记；不提供「编辑」）。 */
			const isReference = server.reference === true;
			/** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
			const removeVerb = imported ? "移出" : "删除";
			const hasWorkspace = workspace !== void 0;
			const [metaOpen, setMetaOpen] = (0, react.useState)(false);
			const [usageOpen, setUsageOpen] = (0, react.useState)(false);
			const [deleteOpen, setDeleteOpen] = (0, react.useState)(false);
			const [testing, setTesting] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(void 0);
			const [selectedTool, setSelectedTool] = (0, react.useState)(void 0);
			const [toolQuery, setToolQuery] = (0, react.useState)("");
			const [copiedKey, setCopiedKey] = (0, react.useState)(void 0);
			const copyText = (key, text) => {
				navigator.clipboard?.writeText(text).catch(() => void 0);
				setCopiedKey(key);
				window.setTimeout(() => setCopiedKey((current) => current === key ? void 0 : current), 1500);
			};
			/** 跑一次探测；失败以 `{ ok:false, errors }` 归一（不抛异常，就地展示）。 */
			const runInspect = (0, react.useCallback)(async () => {
				setTesting(true);
				try {
					const next = await api.test({
						entry: server.entry,
						key: server.key
					});
					setResult(next);
					if (next.ok) {
						onToolCount?.(next.tools.length);
						setSelectedTool((current) => current !== void 0 && next.tools.some((tool) => tool.name === current) ? current : next.tools[0]?.name);
					}
				} catch (error) {
					setResult({
						ok: false,
						errors: [String(error)]
					});
				} finally {
					setTesting(false);
				}
			}, [
				api,
				server.entry,
				server.key,
				onToolCount
			]);
			(0, react.useEffect)(() => {
				let alive = true;
				setResult(void 0);
				setSelectedTool(void 0);
				setToolQuery("");
				setTesting(true);
				api.test({
					entry: server.entry,
					key: server.key
				}).then((next) => {
					if (!alive) return;
					setResult(next);
					if (next.ok) {
						onToolCount?.(next.tools.length);
						setSelectedTool(next.tools[0]?.name);
					}
				}).catch((error) => {
					if (alive) setResult({
						ok: false,
						errors: [String(error)]
					});
				}).finally(() => {
					if (alive) setTesting(false);
				});
				return () => {
					alive = false;
				};
			}, [server.key, server.scope]);
			/** 两段作用域链：全局 → 工作区（不展示任何会话挂载状态）。 */
			const globalSeg = isGlobal ? {
				on: server.enabled,
				title: server.enabled ? "已配置 · 默认启用" : "已配置 · 配置内禁用",
				note: `来源：${server.filePath}`
			} : {
				on: false,
				title: "未配置",
				note: "本项只存在于所选工作区"
			};
			const workspaceSeg = isReference ? {
				on: server.enabled,
				title: server.enabled ? "已引用 · 默认启用" : "已引用 · 已禁用",
				note: "来源：工作区引用（内容跟随全局配置）"
			} : isGlobal ? {
				on: server.disabledInProject !== true,
				title: server.disabledInProject === true ? "已关闭（覆盖）" : "默认启用",
				note: server.disabledInProject === true ? "来源：工作区覆盖 · 仅此工作区默认关闭" : "未配置工作区覆盖 · 跟随全局配置"
			} : {
				on: server.enabled,
				title: server.enabled ? "已配置 · 默认启用" : "已配置 · 配置内禁用",
				note: "来源：工作区 .mcp.json"
			};
			const tools = result?.ok === true ? result.tools : [];
			const statText = testing ? "正在连接…" : result === void 0 ? "尚未连接" : result.ok ? `${result.tools.length} 个工具 · 连接正常 · ${result.elapsedMs}ms` : "连接失败";
			const instruction = result?.ok === true && typeof result.instruction === "string" ? result.instruction.trim() : "";
			const namespace = `mcp__${server.serverName}__*`;
			const sourceLabel = isReference ? "工作区引用" : isGlobal ? "全局 mcp.json" : "工作区 .mcp.json";
			const endpoint = server.transport === "stdio" ? `${server.entry.command ?? ""} ${formatMaskedArgs(server.entry.args ?? [])}`.trim() : sanitizeDescriptorText(server.entry.url ?? "");
			const canToggle = isReference ? false : isGlobal ? !server.enabled && scope === "global" : true;
			const toggleTitle = isReference ? "引用条目的默认开关在列表行尾设置" : isGlobal ? server.enabled ? "全局条目已启用；全局默认开关在列表行尾设置" : scope === "global" ? "此全局服务器当前禁用；点击恢复启用（对所有工作区生效）" : "请在「全局」视图恢复启用" : server.enabled ? "点击禁用（保留在配置文件中，不挂载）" : "点击启用（写入配置文件并挂载）";
			const deleteBody = isGlobal ? "删除此全局服务器；各工作区内的引用不受影响（变为悬空引用）。此操作不可撤销。" : isReference ? "移出本工作区（移除对全局服务器的引用，全局原版仍在全局区）。" : imported ? "移出本工作区（移除全局导入的副本，全局原版仍在全局区）。" : "删除本工作区中的这个服务器。此操作不可撤销。";
			const menuItems = [
				...!isReference ? [{
					key: "edit",
					label: "编辑配置",
					onSelect: onEdit
				}] : [],
				...isGlobal && hasWorkspace ? [{
					key: "import",
					label: confirmingImport ? "确认重复导入同名引用？" : "引用到本工作区",
					danger: confirmingImport,
					title: confirmingImport ? "工作区内已有同名引用，再次点击将重新登记（保留原启停状态，全局配置不变）" : "在本工作区登记对全局服务器的引用（内容跟随全局，可设置本工作区默认）",
					onSelect: onImport
				}] : [],
				{
					key: "copy-namespace",
					label: copiedKey === "namespace" ? "已复制命名空间" : "复制命名空间",
					onSelect: () => copyText("namespace", namespace)
				},
				{
					key: "copy-endpoint",
					label: server.transport === "stdio" ? "复制命令" : "复制 URL",
					onSelect: () => copyText("endpoint", endpoint)
				},
				{
					key: "copy-path",
					label: copiedKey === "path" ? "已复制路径" : "复制配置文件路径",
					onSelect: () => copyText("path", server.filePath)
				},
				{
					key: "usage",
					label: "使用记录",
					onSelect: () => setUsageOpen(true)
				},
				{
					key: "delete",
					label: `${removeVerb}服务器`,
					danger: true,
					title: deleteBody,
					onSelect: () => setDeleteOpen(true)
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailPage, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-head-wrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTitleBar, {
						title: server.key,
						tags: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project",
								title: isGlobal ? server.shadowed ? "全局服务器（对所有工作区生效）；当前被本工作区内的同名条目遮蔽" : "全局服务器（对所有工作区生效）" : isReference ? "本工作区内对全局服务器的引用（内容跟随全局，默认开关只作用于本工作区）" : imported ? "本工作区内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本工作区）" : "本工作区内的服务器（遮蔽全局同名条目）",
								children: isGlobal || imported ? "全局" : "本项"
							}),
							isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								title: "引用：内容跟随全局，默认开关只作用于本工作区",
								children: "引用"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								title: "传输方式",
								children: server.transport
							}),
							server.shadowed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								children: "被本工作区遮蔽"
							})
						] }),
						right: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleSwitch, {
							checked: server.enabled,
							disabled: !canToggle,
							label: server.enabled ? "已启用" : "已禁用",
							title: toggleTitle,
							onChange: () => onToggle()
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MoreMenu, { items: menuItems })] })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailStrip, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeChain, {
							compact: true,
							scope,
							projectName,
							globalSeg,
							workspaceSeg,
							workspaces,
							onSelectWorkspace
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item",
							children: ["来源 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-strip-strong",
								children: sourceLabel
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item skp-strip-ellipsis",
							title: namespace,
							children: ["命名空间 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-strip-strong",
								children: namespace
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-right",
							children: [
								scope === "global" && isGlobal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityEditControl, {
									api: panelApi,
									domain: "mcp",
									capabilityKey: server.serverName,
									name: server.key,
									entry: visibilityEntry,
									workspaces: projects,
									globalOff,
									onSaved: onVisibilitySaved
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-strip-meta-btn",
									onClick: () => setUsageOpen(true),
									children: "使用记录"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-strip-meta-btn",
									onClick: () => setMetaOpen((value) => !value),
									children: "元数据"
								})
							]
						})
					] })]
				}),
				metaOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
					wide: true,
					title: `元数据 · ${server.key}`,
					onClose: () => setMetaOpen(false),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MetaGrid, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "命名空间",
								mono: true,
								title: namespace,
								children: namespace
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: server.transport === "stdio" ? "命令" : "URL",
								mono: true,
								title: endpoint,
								children: endpoint.length > 0 ? endpoint : "—"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "配置文件",
								mono: true,
								title: server.filePath,
								children: server.filePath
							}),
							typeof server.entry.description === "string" && server.entry.description.trim().length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "用途描述",
								children: server.entry.description
							})
						] }),
						instruction.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-meta-wide",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-meta-label",
								children: "服务器提示"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "4px 0 0",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--skp-text-2)",
									whiteSpace: "pre-wrap"
								},
								children: instruction
							})]
						}),
						scope === "global" && isGlobal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
							className: "skp-detail-fields",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityDetailFields, {
								summaryOnly: true,
								api: panelApi,
								domain: "mcp",
								capabilityKey: server.serverName,
								name: server.key,
								entry: visibilityEntry,
								workspaces: projects,
								globalOff,
								onSaved: onVisibilitySaved
							})
						}),
						isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note",
							children: "引用：内容跟随全局配置，默认开关只作用于本工作区。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-modal-actions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => copyText("namespace", namespace),
									children: copiedKey === "namespace" ? "已复制命名空间" : "复制命名空间"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => copyText("endpoint", endpoint),
									children: copiedKey === "endpoint" ? "已复制" : server.transport === "stdio" ? "复制命令" : "复制 URL"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => copyText("path", server.filePath),
									children: copiedKey === "path" ? "已复制路径" : "复制配置文件路径"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-btn",
									onClick: () => setMetaOpen(false),
									children: "关闭"
								})
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-toolbar",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-toolbar-title",
							children: "工具与参数"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-toolbar-stat",
							children: statText
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-toolbar-right",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: testing,
								onClick: () => void runInspect(),
								children: testing ? "连接中…" : "重新测试"
							})
						})
					]
				}),
				result !== void 0 && result.ok === false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-tools-split",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-tool-detail-scroll",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-error",
							children: result.errors.join("\n")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-tool-detail-note",
							children: "连接失败不影响已挂载的连接；检查服务器配置后点「重新测试」。"
						})]
					})
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolsSplitView, {
					tools,
					selectedName: selectedTool,
					onSelect: setSelectedTool,
					query: toolQuery,
					onQuery: setToolQuery,
					loading: testing
				}),
				usageOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
					title: `使用记录 · ${server.key}`,
					onClose: () => setUsageOpen(false),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpUsageSection, {
						api,
						serverName: server.serverName
					})
				}),
				deleteOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
					title: `${removeVerb} MCP 「${server.key}」？`,
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
							onClick: () => {
								setDeleteOpen(false);
								onDelete();
							},
							children: removeVerb
						})]
					})]
				})
			] });
		}
		/**
		* 新增 / 编辑表单（分别内嵌在添加 / 编辑弹窗里，见 McpAddDialog / McpEditDialog）。
		*
		* 多行文本框承载 env / headers（每行 `KEY=VALUE`）与 args（每行一个参数），
		* 提交时解析成结构化字段。v20.1 起添加弹窗的**落点由当前作用域固定**
		* （`fixedScope`），表单不再二次选择类型/作用域；编辑态 scope 与 name 锁定
		* （改名 = 删除后重建）。
		*
		* `embedded` 为 true 时褪掉卡片外壳与自带标题，直接作为弹窗内容；
		* 此时按钮行由 `actionsClass` 指定落到弹窗底部的对齐方式。
		* onSave 抛错（如宿主校验/落盘失败）时把错误信息展示在表单顶部。
		*/
		function McpForm({ api, mode, server, workspace, embedded, actionsClass = "skp-detail-actions", fixedScope, onCancel, onSave }) {
			const entry = server?.entry ?? {};
			const [scope, setScope] = (0, react.useState)(server?.scope ?? fixedScope ?? (workspace !== void 0 ? "project" : "global"));
			const [key, setKey] = (0, react.useState)(server?.key ?? "");
			const [description, setDescription] = (0, react.useState)(typeof entry.description === "string" ? entry.description : "");
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
				const descriptionValue = description.trim();
				const descriptionField = descriptionValue.length > 0 ? { description: descriptionValue } : {};
				return {
					ok: true,
					entry: transport === "stdio" ? {
						type: "stdio",
						command: command.trim(),
						args: linesToArray(args),
						...descriptionField,
						...Object.keys(envRecord).length > 0 ? { env: envRecord } : {},
						...timeout !== void 0 ? { timeoutMs: timeout } : {},
						...disabled ? { disabled: true } : {},
						...importMarker
					} : {
						type: "http",
						url: url.trim(),
						...descriptionField,
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
							fixedScope === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
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
										label: "工作区（.mcp.json）",
										disabled: !hasWorkspaceLabel(workspace)
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
									children: "用途描述（可选，供 Jev 能力判断）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: "skp-input skp-textarea",
									value: description,
									placeholder: "例如：连接 GitHub 仓库，读写 issue / PR / 文件",
									onChange: (e) => setDescription(e.target.value)
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
		/**
		* 添加 MCP 服务器弹窗：与技能安装弹窗同构（Modal + 模式 Tab）。
		*
		* - 表单：沿用 McpForm（embedded 内嵌）逐字段填写单个条目；
		* - JSON：粘贴 .mcp.json 或裸服务器映射，实时预览后批量添加。
		*/
		function McpAddDialog({ api, servers, scope, workspace, projectName, projectRoot, projectFile, onClose, onMutated }) {
			const [tab, setTab] = (0, react.useState)("form");
			const isGlobal = scope === "global";
			const title = isGlobal ? "添加 MCP 到全局" : `添加 MCP 到工作区 ${projectName ?? "工作区"}`;
			const targetPath = isGlobal ? "~/.agents/mcp.json" : `${workspace ?? "<工作区>"}/.mcp.json`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
				title,
				onClose,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-landing",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-landing-head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-landing-icon",
									"aria-hidden": "true",
									children: "⌖"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-field-label",
									children: "落点"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project",
									children: isGlobal ? "全局" : `工作区 ${projectName ?? "工作区"}`
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-landing-note",
									children: "仅此作用域生效 · 与当前对话无关"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-landing-hint",
									children: "要换落点？先切换顶部作用域"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							className: "skp-landing-path",
							title: targetPath,
							children: targetPath
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-tabs",
						role: "tablist",
						children: ["form", "json"].map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							role: "tab",
							"aria-selected": tab === t,
							className: tab === t ? "skp-tab skp-tab-active" : "skp-tab",
							onClick: () => setTab(t),
							children: t === "form" ? "表单" : "JSON 粘贴"
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
							fixedScope: scope,
							onCancel: onClose,
							onSave: async (savedScope, key, entry) => {
								const result = await api.upsert({
									scope: savedScope,
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
							scope,
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
		function McpJsonImport({ api, servers, scope, onClose, onMutated }) {
			const [text, setText] = (0, react.useState)("");
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
					setOpErrors([`已导入 ${added} 个，失败 ${failures.length} 个：`, ...failures]);
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
								"将导入 ",
								addable.length,
								"/",
								preview.length,
								" 个服务器"
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
							children: busy ? "导入中…" : `导入 ${addable.length} 个服务器`
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
		* 能力面板 · Tools 域（v13 R3 / 帧 06；v21 纳入可见性与工作区默认）。
		*
		* Tools 是**全局工具注册**：一个插件 = 一个开关单元，无单工具开关。两栏布局：
		*   - 左：插件单元列表；
		*   - 右：插件详情 + 只读工具清单（手风琴；schema 由 `tools.inspect` 懒加载）。
		*
		* 三层开关（v21，与 Skills / MCP 同构）：
		*   1. **可见性（全局唯一控制，按工作区）**：全局视图行内标签 + 「可见范围」编辑
		*      （`overrides.globalGet().visibility.tools` / `overrides.setVisibility`）；
		*   2. **每工作区默认开/关**：可见性弹层里按工作区配置；某工作区没有单独配置时
		*      走兜底 `!全局默认关闭(unit)`（`capability-global-overrides.json` 的 `tools`
		*      ∪ legacy `tools-global.json`，宿主已合并进行字段 `defaultEnabled`）；
		*   3. **工作区覆盖**：工作区视图的行尾开关写项目三态
		*      （`overrides.toggle("tools", unit, {enabled})` → `tools` / `enabledTools`）。
		*
		* 全局视图的行尾开关仍是**全局默认兜底**（`tools.setGlobalEnabled`，写统一全局文件）；
		* 不可见行的默认开关禁用并标「不可见 · 不参与默认」。
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
		/** 详情底部弱说明的上外边距。 */
		const NOTE_STYLE = { margin: "10px 0 0" };
		/**
		* 单元的**全局默认**开关：新宿主给 `defaultEnabled`；旧宿主/夹具只有单层
		* `enabledInSession` 时回落到它，再缺省按默认开启（与宿主 `TOOLS_DEFAULT_ENABLED` 一致）。
		*/
		function defaultEnabledOf(unit) {
			return unit.defaultEnabled ?? unit.enabledInSession ?? true;
		}
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
		/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
		function baseName$1(path) {
			const trimmed = path.replace(/[\\/]+$/, "");
			const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
			return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
		}
		/** 归属依据的人话标签（task-32：运行时/包扫描/人工映射/名字推测/命名空间/未识别）。 */
		function attributionLabel(unit) {
			switch (unit.attribution.matchedBy) {
				case "runtime": return "运行时捕获";
				case "literal": return "包扫描";
				case "table":
				case "prefix":
				case "exact": return "人工映射";
				case "similarity": return "名字推测";
				case "namespace": return "命名空间";
				default: return "未识别";
			}
		}
		/** true = 来源含推测成分（UI 加琥珀「推测」标识与核对提示）。 */
		function attributionIsSpeculative(unit) {
			const attribution = unit.attribution;
			const runtimeFallback = attribution.matchedBy === "runtime" && attribution.confidence === "medium";
			return attribution.matchedBy === "similarity" || runtimeFallback || attribution.ambiguous === true || attribution.conflictsWithTable === true;
		}
		/** 详情「来源判定」的补充说明（依据原文 / 冲突 / 置信度 / 多来源合并）。 */
		function attributionDetail(unit) {
			const attribution = unit.attribution;
			const parts = [];
			const pattern = attribution.pattern ?? attribution.packageName;
			if (attribution.matchedBy === "prefix" && pattern !== void 0) parts.push(`前缀 ${pattern} → ${unit.name}（插件清单映射表）`);
			else if (attribution.matchedBy === "exact" && pattern !== void 0) parts.push(`精确匹配 ${pattern} → ${unit.name}（插件清单映射表）`);
			else if (pattern !== void 0 && pattern !== unit.name) parts.push(pattern);
			if (attribution.conflictsWithTable === true) parts.push("与人工映射冲突");
			if (attribution.ambiguous === true) parts.push("存在多个候选");
			if (attribution.mixed === true) parts.push("多来源合并");
			if (attribution.matchedBy === "runtime" && attribution.confidence === "medium") parts.push("注册栈兜底");
			const confidence = attribution.confidence;
			if (typeof confidence === "number" && Number.isFinite(confidence)) parts.push(`置信度 ${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`);
			else if (confidence === "high") parts.push("高置信");
			else if (confidence === "medium") parts.push("中置信");
			else if (confidence === "low") parts.push("低置信");
			return parts.length > 0 ? parts.join(" · ") : void 0;
		}
		/**
		* 一个工具的手风琴行：行 = 工具名 + `N 个参数/无参数`；展开后显示说明、
		* 参数表（参数/类型/必填/说明）与可折叠的原始 JSON（`parameters` pretty）。
		*/
		function ToolAccordionItem({ tool, open, onToggle }) {
			const [rawOpen, setRawOpen] = (0, react.useState)(false);
			const parameters = (0, react.useMemo)(() => toolParameters(tool.parameters), [tool.parameters]);
			const description = tool.description?.trim() ?? "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item",
				role: "listitem",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "skp-tool-trigger",
					"aria-expanded": open,
					title: tool.name,
					onClick: onToggle,
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
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-tool-body",
					children: [
						description.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "skp-tool-desc",
							children: description
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolParameterTable, { parameters }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-tools-raw",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-link-btn",
								"aria-expanded": rawOpen,
								onClick: () => setRawOpen((value) => !value),
								children: rawOpen ? "收起原始 JSON" : "查看原始 JSON"
							}), rawOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: "skp-tools-raw-json",
								children: JSON.stringify(tool.parameters ?? {}, null, 2)
							})]
						})
					]
				})]
			});
		}
		/**
		* Tools 列表单行（v21.3，`React.memo`）：避免切作用域 / 选中 / 刷新提示时整表重渲。
		* 行状态（checked/disabled/invisible/override）由父级计算后以原始值传入。
		*/
		const ToolListRow = (0, react.memo)(function ToolListRow({ unit, active, scope, projectName, projects, visibilityEntry, globalOff, checked, disabled, invisible, override, busy, rowRefs, onSelect, onToggle, onKeyDown }) {
			const locked = unit.lockedReason !== void 0;
			const visibilityMeta = scope === "global" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityRowMeta, {
				entry: visibilityEntry,
				workspaces: projects,
				globalOff,
				mode: unit.visibilityMode ?? visibilityModeOf(visibilityEntry),
				count: unit.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects),
				invisible,
				summaryClassName: "skp-vis-summary"
			}) : override !== "inherit" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "skp-tag skp-tag-warn",
				title: override === "on" ? "本工作区显式打开（覆盖全局的每工作区默认）" : "本工作区显式关闭（覆盖全局的每工作区默认）",
				children: "已覆盖"
			});
			const switchLabel = invisible ? "不可见 · 不参与默认" : scope === "global" ? "全局默认" : `默认 · ${override === "inherit" ? "跟随全局" : "已覆盖"}`;
			const switchTitle = invisible ? "该单元对所有工作区都不可见：不参与默认开关；先在「可见范围」里打开可见性" : locked ? unit.lockedReason ?? "该插件无法开关" : scope === "global" ? defaultEnabledOf(unit) ? "关闭：关闭后全局默认不可用；仍可在对话首屏为单个对话单独开启" : "开启：全局默认可用（仍可在对话首屏为单个对话单独关闭）" : checked ? "关闭：仅此工作区默认不启用（写工作区覆盖，其它工作区不受影响）" : "打开：仅此工作区默认启用（写工作区覆盖）";
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
					onClick: () => onSelect(unit),
					onKeyDown: (event) => onKeyDown(event, unit.unit),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-row-name",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow",
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-sr-only",
								children: checked ? "默认已启用" : "默认已关闭"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-row-title",
								title: unit.name,
								children: unit.name
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-row-meta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: unitTagClass(unit),
								title: unit.kind === "unattributed" ? "来源未识别：不是宿主内置工具" : "插件运行时注册（非 MCP）",
								children: unit.kind === "unattributed" ? "未识别" : "插件"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-tag skp-tag-flat",
								children: [unit.toolCount, " 个工具"]
							}),
							visibilityMeta
						]
					})]
				}), scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "skp-row-toggle",
					title: switchTitle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-row-default-label",
						children: switchLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							role: "switch",
							"aria-label": `默认启用 ${unit.name}`,
							checked,
							disabled: disabled || busy,
							onChange: (event) => onToggle(unit, event.target.checked)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
					})]
				})]
			});
		});
		/**
		* Tools 域视图：两栏（插件列表 + 详情/只读工具清单）。
		*
		* @param query 根组件头部搜索框的值（按插件名 / 工具名 / 工具说明本地过滤）。
		* @param workspace 当前工作区（undefined = 全局视图；v21 起有工作区维度）。
		* @param projects 全部已知工作区（可见性标签 / 弹层 / 每工作区默认用）。
		*/
		function ToolsView({ api, workspace, projects = [], query, onCount }) {
			const [version, setVersion] = (0, react.useState)(0);
			const [selectedUnit, setSelectedUnit] = (0, react.useState)(void 0);
			const [busyUnit, setBusyUnit] = (0, react.useState)(void 0);
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [copied, setCopied] = (0, react.useState)(false);
			/** `tools.inspect` 结果缓存（按 unit；选中时才拉，刷新列表不复用过期数据）。 */
			const [inspectCache, setInspectCache] = (0, react.useState)({});
			/** 手风琴当前展开的工具（同一时间只展开一个）。 */
			const [expandedTool, setExpandedTool] = (0, react.useState)(void 0);
			const mountedRef = (0, react.useRef)(true);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const scope = workspace === void 0 ? "global" : "workspace";
			const projectName = workspace === void 0 ? void 0 : projects.find((project) => project.path === workspace)?.title ?? baseName$1(workspace);
			(0, react.useEffect)(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
				};
			}, []);
			const { data: fetched, loading, error, reload } = useAsyncList(async () => {
				const [view, visibility, overrides] = await Promise.all([
					api.tools.list(),
					safeGlobalGet(api),
					scope === "workspace" ? safeOverridesGet(api) : Promise.resolve(void 0)
				]);
				return {
					view,
					globalOverrides: visibility,
					projectOverrides: overrides
				};
			}, [
				api,
				version,
				scope,
				workspace
			], { cacheKey: `tools:${workspace ?? "global"}` });
			const data = fetched?.view;
			const globalOverrides = fetched?.globalOverrides;
			const projectOverrides = fetched?.projectOverrides;
			const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
			/** 某单元的可见性配置（skills/mcp/tools 同构；tools key = unit）。 */
			const visibilityOf = (unit) => visibilityEntryOf(visibilitySets, "tools", unit.unit);
			/** 兜底默认是否关闭：legacy `tools-global.json` 已并入行字段 defaultEnabled。 */
			const globalOffOf = (unit) => !defaultEnabledOf(unit) || globalOverrides?.tools.includes(unit.unit) === true;
			const units = (0, react.useMemo)(() => sortUnits(data?.units ?? []), [data]);
			/** 工作区视图只渲染可见单元（宿主已过滤；这里防御旧宿主 / 脏数据）。 */
			const visibleUnits = (0, react.useMemo)(() => scope === "global" ? units : units.filter((unit) => unit.visibleInWorkspace !== false), [units, scope]);
			/** 工作区视图被可见性隐藏的单元数（全局视图恒 0）。 */
			const hiddenCount = scope === "workspace" ? data?.hiddenCount ?? 0 : 0;
			(0, react.useEffect)(() => {
				if (!loading && error === void 0) onCount?.(units.length);
			}, [
				units.length,
				loading,
				error,
				onCount
			]);
			(0, react.useEffect)(() => {
				if (visibleUnits.length === 0) {
					if (selectedUnit !== void 0) setSelectedUnit(void 0);
					return;
				}
				if (selectedUnit !== void 0 && visibleUnits.some((unit) => unit.unit === selectedUnit)) return;
				setSelectedUnit(visibleUnits[0]?.unit);
			}, [visibleUnits, selectedUnit]);
			const q = query.trim().toLowerCase();
			const visible = (0, react.useMemo)(() => visibleUnits.filter((unit) => {
				if (q === "") return true;
				if (unit.name.toLowerCase().includes(q)) return true;
				return unit.tools.some((tool) => tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q));
			}), [visibleUnits, q]);
			const selected = visibleUnits.find((unit) => unit.unit === selectedUnit);
			/** true = 宿主仍在解析归属：显示轻量提示，不阻塞开关。 */
			const attributionSettling = data?.attributionSettling === true;
			const inspectState = selectedUnit === void 0 ? void 0 : inspectCache[selectedUnit];
			(0, react.useEffect)(() => {
				if (selectedUnit === void 0) return;
				if (inspectCache[selectedUnit] !== void 0) return;
				setInspectCache((prev) => prev[selectedUnit] !== void 0 ? prev : {
					...prev,
					[selectedUnit]: { status: "loading" }
				});
				api.tools.inspect({ unit: selectedUnit }).then((view) => {
					if (!mountedRef.current) return;
					setInspectCache((prev) => ({
						...prev,
						[selectedUnit]: {
							status: "ready",
							tools: view.tools
						}
					}));
				}).catch((failure) => {
					if (!mountedRef.current) return;
					setInspectCache((prev) => ({
						...prev,
						[selectedUnit]: {
							status: "error",
							message: String(failure instanceof Error ? failure.message : failure)
						}
					}));
				});
			}, [
				api,
				selectedUnit,
				inspectCache
			]);
			(0, react.useEffect)(() => {
				setExpandedTool(void 0);
			}, [selectedUnit]);
			const inspectedTools = inspectState?.status === "ready" ? inspectState.tools : void 0;
			const inspectLoading = inspectState?.status === "loading";
			const inspectError = inspectState?.status === "error" ? inspectState.message : void 0;
			const displayTools = inspectedTools ?? (selected?.tools ?? []).map((tool) => ({
				name: tool.name,
				...tool.description !== void 0 ? { description: tool.description } : {}
			}));
			/** 当前行的开关勾选态与写路径（按作用域分派）。 */
			const switchStateOf = (unit) => {
				if (scope === "global") {
					const invisible = isRowInvisible(unit, visibilityOf(unit), projects);
					return {
						checked: defaultEnabledOf(unit),
						disabled: unit.lockedReason !== void 0 || invisible,
						invisible
					};
				}
				const entry = visibilityOf(unit);
				const override = workspaceOverrideOf(projectOverrides, "tools", unit.unit);
				const fallback = workspace === void 0 ? true : workspaceDefaultOf(entry, workspace, globalOffOf(unit));
				return {
					checked: override === "on" ? true : override === "off" ? false : fallback,
					disabled: unit.lockedReason !== void 0,
					invisible: false,
					override
				};
			};
			/**
			* 写开关：
			*   - 全局视图 → `tools.setGlobalEnabled`（全局兜底默认）；
			*   - 工作区视图 → `overrides.toggle("tools", unit, {enabled})`（项目三态覆盖）。
			*/
			const toggleDefault = (0, react.useCallback)(async (unit, next) => {
				if (switchStateOf(unit).disabled || busyUnit !== void 0) return;
				setBusyUnit(unit.unit);
				setOpError(void 0);
				try {
					if (scope === "global") await api.tools.setGlobalEnabled({
						units: [unit.unit],
						enabled: next
					});
					else {
						const result = await api.overrides.toggle("tools", unit.unit, { enabled: next });
						if (!result.ok) {
							setOpError(result.errors.join("; "));
							return;
						}
					}
				} catch (failure) {
					setOpError(String(failure instanceof Error ? failure.message : failure));
				} finally {
					if (mountedRef.current) setBusyUnit(void 0);
					setVersion((value) => value + 1);
				}
			}, [
				api,
				busyUnit,
				scope,
				projectOverrides,
				globalOverrides,
				projects
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
			/** v21.3：稳定回调（配合 `ToolListRow` memo，避免切作用域全量重渲）。 */
			const rowActionsRef = (0, react.useRef)({
				setSelectedUnit,
				toggleDefault,
				onRowKeyDown
			});
			rowActionsRef.current = {
				setSelectedUnit,
				toggleDefault,
				onRowKeyDown
			};
			const stableSelectUnit = (0, react.useCallback)((unit) => rowActionsRef.current.setSelectedUnit(unit.unit), []);
			const stableToggleUnit = (0, react.useCallback)((unit, next) => {
				rowActionsRef.current.toggleDefault(unit, next);
			}, []);
			const stableRowKeyDown = (0, react.useCallback)((event, unit) => rowActionsRef.current.onRowKeyDown(event, unit), []);
			const listTitle = scope === "global" ? "全局 Tools" : `${projectName ?? "工作区"} · Tools`;
			const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
			const defaultOnCount = visibleUnits.filter((unit) => defaultEnabledOf(unit)).length;
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
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-list-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-list-title",
											children: listTitle
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-group-count",
											title: "当前作用域可见单元数",
											children: visibleUnits.length
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-list-note",
											children: listNote
										}),
										loading && data !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-refresh-note",
											children: "刷新中…"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-pane-title-note",
											children: scope === "global" ? `${defaultOnCount} 默认启用` : "开关写工作区覆盖"
										})
									]
								}),
								scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									children: "全局默认写入统一全局文件 · 所有工作区生效；可见性按工作区控制"
								}),
								scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									children: "只列出本工作区可见的 Tools · 默认开关只作用于本工作区"
								}),
								attributionSettling && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									children: "来源解析中…"
								}),
								visibleUnits.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-empty",
									children: listErrors.length > 0 ? "当前外壳未提供工具注册表，无法列出 Tools。" : scope === "workspace" ? "本工作区没有可见的 Tools（可在全局视图调整可见范围）。" : "尚未发现 Tools。"
								}), hiddenCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-pane-note",
									children: [
										"另有 ",
										hiddenCount,
										" 个能力未对此外工作区开放"
									]
								})] }) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-empty",
									children: [
										"没有匹配「",
										query.trim(),
										"」的 Tools。"
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-group-scroll",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: "skp-list",
										role: "listbox",
										"aria-label": "Tools",
										children: visible.map((unit) => {
											const state = switchStateOf(unit);
											const entry = visibilityOf(unit);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolListRow, {
												unit,
												active: unit.unit === selectedUnit,
												scope,
												projectName,
												projects,
												visibilityEntry: entry,
												globalOff: globalOffOf(unit),
												checked: state.checked,
												disabled: state.disabled,
												invisible: state.invisible,
												override: state.override ?? "inherit",
												busy: busyUnit === unit.unit,
												rowRefs,
												onSelect: stableSelectUnit,
												onToggle: stableToggleUnit,
												onKeyDown: stableRowKeyDown
											}, unit.unit);
										})
									}), hiddenCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-pane-note",
										title: "这些单元在全局视图里未被开放给本工作区；请在全局视图的「可见范围」里开启",
										children: [
											"另有 ",
											hiddenCount,
											" 个能力未对此外工作区开放"
										]
									})]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail skp-detail-fixed",
							children: selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-detail-empty",
								children: "选择一个插件查看工具清单与参数。"
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
										className: "skp-detail-meta",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "skp-detail-meta-item",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "skp-detail-meta-strong",
														children: "来源判定："
													}),
													attributionLabel(selected),
													attributionDetail(selected) !== void 0 ? ` · ${attributionDetail(selected) ?? ""}` : ""
												]
											}),
											attributionIsSpeculative(selected) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-tag skp-tag-warn",
												title: "来源为推测，请核对工具清单",
												children: "推测"
											}),
											(selected.attribution.legacyUnit === true || typeof selected.attribution.legacyUnit === "string") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-note",
												title: typeof selected.attribution.legacyUnit === "string" ? `旧版键：${selected.attribution.legacyUnit}` : "旧版持久化键已迁移到新的插件单元",
												children: "旧版键已迁移"
											}),
											attributionSettling && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-note",
												children: "来源解析中…"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "skp-detail-meta-item",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-detail-meta-strong",
													children: "注入方式："
												}), "插件运行时注册的非 MCP 工具（不落盘）"]
											})
										]
									}),
									attributionIsSpeculative(selected) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "skp-note skp-note-warn",
										children: "来源为推测，请核对工具清单"
									}),
									selected.description !== void 0 && selected.description.trim().length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "skp-note",
										children: selected.description
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-note",
										children: [
											"工具数 ",
											selected.toolCount,
											" · 开关为插件级：关闭后该插件全部工具默认不可用（不改已有对话的显式覆盖）"
										]
									}),
									scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
										className: "skp-detail-fields",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityDetailFields, {
											api,
											domain: "tools",
											capabilityKey: selected.unit,
											name: selected.name,
											entry: visibilityOf(selected),
											workspaces: projects,
											globalOff: globalOffOf(selected),
											onSaved: () => setVersion((value) => value + 1)
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "skp-detail-inspect",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "skp-detail-inspect-head",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "skp-field-label",
													children: [
														"工具清单（",
														selected.toolCount,
														"）"
													]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-test-stat",
													children: inspectLoading ? "正在读取参数…" : "点击工具查看参数与原始 JSON"
												})]
											}),
											inspectError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "skp-note",
												children: [
													"参数不可用：",
													inspectError,
													"（仍可查看工具名称与说明）"
												]
											}),
											displayTools.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "skp-note",
												children: "工具清单不可见（该单元当前没有可见工具）。"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "skp-tool-accordion",
												role: "list",
												children: displayTools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolAccordionItem, {
													tool,
													open: expandedTool === tool.name,
													onToggle: () => setExpandedTool(expandedTool === tool.name ? void 0 : tool.name)
												}, tool.name))
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "skp-note",
										style: NOTE_STYLE,
										children: "插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。"
									})
								]
							})
						})]
					})
				]
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
		/** 按 `|` 拆分表格行（去首尾竖线、trim；支持 `\\|` 转义，不引入正则 lookbehind）。 */
		function splitTableRow(line) {
			let text = line.trim();
			if (text.startsWith("|")) text = text.slice(1);
			if (text.endsWith("|")) text = text.slice(0, -1);
			const cells = [];
			let current = "";
			for (let index = 0; index < text.length; index += 1) {
				const char = text[index];
				if (char === "\\" && text[index + 1] === "|") {
					current += "|";
					index += 1;
					continue;
				}
				if (char === "|") {
					cells.push(current.trim());
					current = "";
					continue;
				}
				current += char;
			}
			cells.push(current.trim());
			return cells;
		}
		/** 解析 GFM 对齐分隔行；不是分隔行时返回 undefined。 */
		function tableAlignments(line) {
			const trimmed = line.trim();
			if (!trimmed.includes("|") && !trimmed.includes("-")) return void 0;
			const cells = splitTableRow(trimmed);
			if (cells.length === 0) return void 0;
			const aligns = [];
			for (const cell of cells) {
				const match = /^(:?)-{3,}(:?)$/.exec(cell);
				if (match === null) return void 0;
				const left = match[1] === ":";
				const right = match[2] === ":";
				aligns.push(left && right ? "center" : left ? "left" : right ? "right" : void 0);
			}
			return aligns;
		}
		/** 当前行 + 下一行是否构成表格起始（表头行 → 分隔行）。 */
		function isTableStart(line, next) {
			if (next === void 0) return false;
			if (!line.includes("|")) return false;
			return tableAlignments(next) !== void 0;
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
				if (isTableStart(line, lines[i + 1])) {
					const headers = splitTableRow(line);
					const aligns = tableAlignments(lines[i + 1]) ?? [];
					const rows = [];
					i += 1;
					let rowCount = 0;
					while (i < lines.length) {
						const next = lines[i];
						if (next.trim().length === 0) break;
						if (rowCount > 0 && isBlockStart(next)) break;
						if (!next.includes("|")) break;
						if (tableAlignments(next) !== void 0) {
							i += 1;
							continue;
						}
						rows.push(splitTableRow(next));
						rowCount += 1;
						i += 1;
					}
					const alignStyle = (column) => {
						const align = aligns[column];
						return align === void 0 ? {} : { textAlign: align };
					};
					blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-md-table-wrap",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							className: "skp-md-table",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: headers.map((cell, column) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								style: alignStyle(column),
								children: renderInline(cell, `th-${blocks.length}-${column}`)
							}, `th-${blocks.length}-${column}`)) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row, rowIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: headers.map((_, column) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								style: alignStyle(column),
								children: renderInline(row[column] ?? "", `td-${blocks.length}-${rowIndex}-${column}`)
							}, `td-${blocks.length}-${rowIndex}-${column}`)) }, `tr-${blocks.length}-${rowIndex}`)) })]
						})
					}, `table-${blocks.length}`));
					continue;
				}
				const paragraph = [line.trim()];
				i += 1;
				while (i < lines.length && lines[i].trim().length > 0 && !isBlockStart(lines[i]) && !isTableStart(lines[i], lines[i + 1])) {
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
		//#region src/client/prompt-panel.tsx
		/**
		* 能力面板 · Prompt 域（v23）：首轮注入的指令文件（AGENTS.md / CLAUDE.md / *.local.md）。
		*
		* 语义边界（与宿主 `prompt/manager.ts` 对齐，客户端只展示与写策略）：
		*   - **全局与项目 prompt 叠加注入**（不是覆盖），每个文件独立启用；
		*   - 列表只包含**已存在**的文件（宿主已过滤），不出现「未创建 / 未识别」占位；
		*   - 渲染 / trim 去重 / 预算截断 / framing 全部由宿主完成，客户端不算；
		*   - **行内开关位置与 Skills / MCP 一致**：
		*       · 全局视图：行内**没有**单开关；全局 prompt 的「可见范围 / 每工作区默认」
		*         在行尾「可见：…」chip 打开的弹层里配；
		*       · 工作区视图：全局 prompt 行尾开关 = **本工作区默认**（写
		*         `prompt.setVisibility`，保留 mode 与其它工作区，只改
		*         `workspaces[list.projectRoot].defaultEnabled`）；项目 prompt 行尾开关 =
		*         **本项目默认**（写 `prompt.setProjectDefault`，key 口径由宿主按 cwd 向上找 `.git`）；
		*   - **冻结会话**（`list.frozen !== undefined`）：详情只读、隐藏编辑与开关，提示
		*     「本会话已冻结」。
		*
		* 详情页沿用 v22 外壳（`detail-shell.tsx`）：标题行 / 状态条 / 内容工具条 / 内容区；
		* 预览用 `MarkdownPreview`，编辑用 `.skp-prompt-editor` textarea，保存后仅新会话生效。
		*
		* @module dsh-capability-settings/client/prompt-panel
		*/
		/** 状态 pill 文案（宿主 `state` 字典）。 */
		const STATE_LABEL = {
			injected: "注入",
			truncated: "预算截断",
			omitted: "预算省略",
			disabled: "关闭",
			invisible: "不可见",
			duplicate: "重复折叠",
			"too-large": "超 1 MB",
			unreadable: "不可读"
		};
		/** 状态 pill 色调：注入 = success；关闭 = 灰；其余（被预算 / 去重 / 不可读）= warn。 */
		function stateToneClass(state) {
			if (state === "injected") return "skp-prompt-status skp-prompt-status-injected";
			if (state === "disabled" || state === "invisible") return "skp-prompt-status skp-prompt-status-disabled";
			return "skp-prompt-status skp-prompt-status-warn";
		}
		/** 可见范围模式文案。 */
		const MODE_LABEL = {
			all: "全部工作区",
			selected: "指定工作区",
			none: "全部不可见"
		};
		/** 作用域标签（标题行 / 行内）。 */
		function scopeTagOf(file) {
			if (file.scope === "user-global") return {
				label: "全局",
				className: "skp-tag skp-tag-global",
				title: "全局 prompt（$DSH_HOME/AGENTS.md）"
			};
			if (file.scope === "agents-global") return {
				label: "全局",
				className: "skp-tag skp-tag-global",
				title: "全局 prompt（$DSH_AGENTS_HOME/AGENTS.md）"
			};
			return {
				label: "项目",
				className: "skp-tag skp-tag-project",
				title: "项目链 prompt（git 根 → 工作区目录，逐级叠加注入）"
			};
		}
		/** 字节数（< 1 MiB 用千分位精确值，便于与宿主预算对齐）。 */
		function formatSize$1(bytes) {
			if (!Number.isFinite(bytes) || bytes < 0) return "—";
			if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
			return `${Math.round(bytes).toLocaleString("en-US")} B`;
		}
		/** 路径最后一段（工作区 / 项目展示名）。 */
		function baseName(path) {
			const trimmed = path.replace(/[\\/]+$/, "");
			const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
			return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
		}
		/** 行数（用于「仅预览 N 行」提示）。 */
		function lineCount(text) {
			if (text.length === 0) return 0;
			return text.split("\n").length;
		}
		/** 错误对象转可读文案。 */
		function errorText(failure) {
			return String(failure instanceof Error ? failure.message : failure);
		}
		/** 全局 prompt 的可见范围摘要（详情状态条 / 行内 chip 共用）。 */
		function visibilitySummaryText(file, scope) {
			const visibility = file.visibility;
			if (visibility === void 0) return "可见：全部工作区";
			const base = visibility.mode === "none" ? "不可见" : visibility.mode === "selected" ? "指定工作区" : "全部工作区";
			if (scope === "global") return `可见：${base}`;
			return `可见：${base} · 本工作区默认${visibility.defaultEnabled ? "开" : "关"}`;
		}
		/** 当前工作区的可见性 key（宿主语义项目根：从 cwd 向上找 `.git`）。 */
		function currentRootOf(data, workspace) {
			if (data !== void 0 && data.projectRoot.length > 0) return data.projectRoot;
			if (workspace !== void 0 && workspace.length > 0) return workspace;
			return data?.cwd ?? "";
		}
		/**
		* 收集某个全局 prompt 在**所有已知工作区**上的可见/默认状态。
		*
		* 为什么需要逐工作区拉一次 `prompt.list({cwd})`：客户端 API 只把「当前作用域」
		* 的解析结果挂在 `file.visibility` 里（`mode/visible/defaultEnabled` 三元组），
		* 没有整份 `workspaces` 映射；而 `prompt.setVisibility` 是**整份替换**。要满足
		* 「只改当前工作区、保留其它工作区」，只能先按工作区读回各自的有效值，再整份写回。
		* 失败的工作区按宿主默认（可见 + 默认启用）降级，不阻塞弹层。
		*/
		async function loadVisibilitySnapshot(api, file, projects, current) {
			const rows = [];
			const seen = /* @__PURE__ */ new Set();
			const add = (row) => {
				if (row.root.length === 0 || seen.has(row.root)) return;
				seen.add(row.root);
				rows.push(row);
			};
			try {
				const entry = (await api.prompt.list()).visibility[file.scope];
				if (entry !== void 0) {
					if (current !== void 0) add({
						...current,
						current: true
					});
					const roots = /* @__PURE__ */ new Set([
						...Object.keys(entry.workspaces),
						...projects.map((project) => project.path),
						...current !== void 0 ? [current.root] : []
					]);
					for (const root of roots) {
						if (root.length === 0 || seen.has(root)) continue;
						const project = projects.find((item) => item.path === root);
						add({
							root,
							title: project?.title?.trim() ?? baseName(root),
							path: project?.path ?? root,
							visible: entry.workspaces[root]?.visible ?? (entry.mode === "selected" ? false : true),
							defaultEnabled: entry.workspaces[root]?.defaultEnabled ?? true,
							current: current !== void 0 && current.root === root
						});
					}
					return {
						mode: entry.mode,
						rows
					};
				}
			} catch {}
			if (current !== void 0) add({
				...current,
				current: true
			});
			const resolved = await Promise.all(projects.map(async (project) => {
				try {
					const list = await api.prompt.list({ cwd: project.path });
					const found = list.files.find((item) => item.id === file.id);
					return {
						root: list.projectRoot.length > 0 ? list.projectRoot : project.path,
						title: project.title?.trim() ?? baseName(project.path),
						path: project.path,
						visible: found?.visibility?.visible ?? true,
						defaultEnabled: found?.visibility?.defaultEnabled ?? true,
						current: false
					};
				} catch {
					return {
						root: project.path,
						title: project.title?.trim() ?? baseName(project.path),
						path: project.path,
						visible: true,
						defaultEnabled: true,
						current: false
					};
				}
			}));
			for (const row of resolved) add(row);
			return {
				mode: file.visibility?.mode ?? "all",
				rows
			};
		}
		/**
		* Prompt 详情（v22 外壳）：
		* 标题行（名称 / 作用域 / 状态）+ 状态条（第 N 位 / 字节 / 预算 / sha1 / 可见范围）
		* + 工具条（预览 / 编辑 / 复制路径）+ 内容区（Markdown 预览 / 文本编辑器）。
		*/
		function PromptDetail({ api, file, list, frozen, scope, projectName, readVersion, onSaved, onOpenVisibility }) {
			const [read, setRead] = (0, react.useState)({ status: "loading" });
			const [editing, setEditing] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)(void 0);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(void 0);
			/** 保存成功后的瞬时提示（4s 自动消失；不再常驻）。 */
			const [saveNotice, setSaveNotice] = (0, react.useState)(false);
			const saveNoticeTimer = (0, react.useRef)(void 0);
			const [copied, setCopied] = (0, react.useState)(false);
			const [localVersion, setLocalVersion] = (0, react.useState)(0);
			const isFrozen = frozen !== void 0;
			const isProject = file.scope === "project";
			(0, react.useEffect)(() => {
				let alive = true;
				setRead({ status: "loading" });
				api.prompt.read({ path: file.path }).then((value) => {
					if (!alive) return;
					setRead({
						status: "ready",
						content: value.content,
						truncated: value.truncated,
						size: value.size
					});
				}).catch((failure) => {
					if (!alive) return;
					setRead({
						status: "error",
						message: errorText(failure)
					});
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				file.path,
				readVersion,
				localVersion
			]);
			(0, react.useEffect)(() => {
				setEditing(false);
				setDraft(void 0);
				setSaveError(void 0);
			}, [file.path]);
			const content = read.status === "ready" ? read.content : void 0;
			const dirty = editing && draft !== void 0 && content !== void 0 && draft !== content;
			const canEdit = !isFrozen && read.status === "ready" && !saving;
			const frozenFile = frozen?.files.find((item) => item.id === file.id);
			const enabledFiles = (0, react.useMemo)(() => list.files.filter((item) => item.enabled), [list.files]);
			const enabledIndex = enabledFiles.findIndex((item) => item.id === file.id);
			const order = frozenFile?.order ?? file.order ?? (enabledIndex >= 0 ? enabledIndex + 1 : void 0);
			const orderTotal = frozen !== void 0 ? frozen.files.length : enabledFiles.length;
			const orderText = order !== void 0 && file.enabled ? `第 ${order} / ${orderTotal} 位` : file.enabled ? "已启用" : "未注入";
			const size = frozenFile?.bytes ?? (read.status === "ready" ? read.size : file.size);
			const digest = frozenFile?.digest;
			const visibilityText = isProject ? "仅本项目" : visibilitySummaryText(file, scope === "workspace" ? "workspace" : "global");
			const stateNote = (() => {
				if (file.state === "duplicate") return `内容与保留的那一份重复，宿主按候选组去重折叠（不单独注入）${file.duplicateOf !== void 0 ? `：${file.duplicateOf}` : ""}`;
				if (file.state === "truncated") {
					const item = frozen?.truncated.find((entry) => entry.displayPath === file.displayPath);
					return item !== void 0 ? `被预算截断：原文 ${formatSize$1(item.originalBytes)}，实际注入 ${formatSize$1(item.includedBytes)}` : "被预算截断（预算不足时先省略更宽泛的文件，再截断最具体的）";
				}
				if (file.state === "omitted") return "被预算整份省略：预算不足时按「宽泛 → 具体」省略更宽泛的文件";
				if (file.state === "too-large") return `单文件超过 1 MiB（${formatSize$1(size)}），宿主静默跳过：不注入，也不计入预算省略名单`;
				if (file.state === "unreadable") return "读取失败：宿主跳过该文件（检查权限 / 编码后重试）";
				if (file.state === "invisible") return "全局可见性对本工作区关闭：不注入；如需打开，请在全局视图的「可见范围」里配置";
				if (file.state === "disabled") return "默认关闭：本工作区 / 本项目的新会话不注入该文件；开关在列表行尾";
			})();
			const enterEdit = () => {
				if (!canEdit) return;
				setDraft((current) => current ?? content ?? "");
				setSaveError(void 0);
				setEditing(true);
			};
			const cancelEdit = () => {
				if (saving) return;
				setDraft(void 0);
				setEditing(false);
				setSaveError(void 0);
			};
			const save = async () => {
				if (draft === void 0 || saving) return;
				if (content === draft) {
					cancelEdit();
					return;
				}
				setSaving(true);
				setSaveError(void 0);
				try {
					await api.prompt.save({
						path: file.path,
						content: draft
					});
					setDraft(void 0);
					setEditing(false);
					setLocalVersion((value) => value + 1);
					onSaved();
					setSaveNotice(true);
					if (saveNoticeTimer.current !== void 0) clearTimeout(saveNoticeTimer.current);
					saveNoticeTimer.current = setTimeout(() => setSaveNotice(false), 4e3);
				} catch (failure) {
					setSaveError(errorText(failure));
				} finally {
					setSaving(false);
				}
			};
			(0, react.useEffect)(() => () => {
				if (saveNoticeTimer.current !== void 0) clearTimeout(saveNoticeTimer.current);
			}, []);
			const copyPath = async () => {
				try {
					await navigator.clipboard?.writeText(file.path);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				} catch {}
			};
			const draftBytes = (0, react.useMemo)(() => {
				if (draft === void 0) return 0;
				try {
					return new TextEncoder().encode(draft).length;
				} catch {
					return draft.length;
				}
			}, [draft]);
			const titleTags = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: scopeTagOf(file).className,
					title: scopeTagOf(file).title,
					children: scopeTagOf(file).label
				}),
				file.kind === "local" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-tag skp-tag-flat",
					title: "本地覆盖文件（与基础文件叠加注入）",
					children: "local"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: stateToneClass(file.state),
					title: `宿主状态：${STATE_LABEL[file.state]}`,
					children: STATE_LABEL[file.state]
				}),
				isFrozen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-tag skp-tag-flat",
					children: "本会话已冻结"
				})
			] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailPage, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-head-wrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTitleBar, {
						title: file.name,
						tags: titleTags
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailStrip, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-strip-item skp-strip-ellipsis",
							title: file.path,
							children: file.displayPath
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-strip-item",
							children: file.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								"第 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-strip-strong",
									children: order ?? "—"
								}),
								" / ",
								orderTotal,
								" 位"
							] }) : orderText
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item",
							title: `文件字节数 / 渲染预算`,
							children: [
								formatSize$1(size),
								" / ",
								formatSize$1(list.budget.maxBytes)
							]
						}),
						digest !== void 0 && digest.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item",
							title: "本会话冻结清单里的全文 SHA-1",
							children: ["sha1 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-strip-strong",
								children: digest.slice(0, 8)
							})]
						})] }),
						!isProject && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-strip-item",
							title: file.path,
							children: visibilityText
						})] }),
						frozen !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-strip-item",
							children: ["冻结于 ", new Date(frozen.at).toLocaleTimeString()]
						})] }),
						!isProject && !isFrozen && scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-strip-right",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-strip-meta-btn",
								title: "按工作区配置可见范围与默认启用",
								onClick: onOpenVisibility,
								children: "编辑可见范围"
							})
						})
					] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-toolbar",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: editing ? "skp-btn" : "skp-btn skp-btn-primary",
							disabled: saving,
							onClick: () => {
								if (saving) return;
								setEditing(false);
								setSaveError(void 0);
							},
							children: "预览"
						}),
						!isFrozen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: editing ? "skp-btn skp-btn-primary" : "skp-btn",
							disabled: !canEdit,
							title: "编辑 prompt 正文",
							onClick: enterEdit,
							children: "编辑"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-toolbar-stat",
							children: isFrozen ? "只读 · 本会话已冻结" : editing ? dirty ? "草稿未保存" : "无改动" : read.status === "ready" ? `${lineCount(read.content)} 行` : read.status === "loading" ? "读取中…" : "正文不可用"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-toolbar-right",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								onClick: () => void copyPath(),
								children: copied ? "已复制路径" : "复制路径"
							}), editing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: saving,
								onClick: cancelEdit,
								children: "取消"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn skp-btn-primary",
								disabled: saving || !dirty,
								title: dirty ? "保存到原文件（原子写）；只影响新会话" : "没有改动",
								onClick: () => void save(),
								children: saving ? "保存中…" : "保存"
							})] })]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-body",
					children: [
						isFrozen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-detail-readonly",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-detail-readonly-icon",
								"aria-hidden": "true",
								children: "i"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "本会话已冻结：首轮注入的内容在会话开始时固定，详情只读（编辑与开关已隐藏）。改动只影响新会话。" })]
						}),
						saveError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-error",
							children: ["保存失败：", saveError]
						}),
						saveNotice && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-prompt-save-note",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								children: "✓"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "已保存：仅对新会话生效（当前会话保持冻结，已注入的 prompt 不变）" })]
						}),
						read.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-error",
							children: [
								"读取失败：",
								read.message,
								(file.state === "too-large" || size > 1048576) && "（文件超过 1 MiB，宿主会跳过注入，不支持预览 / 编辑）"
							]
						}),
						stateNote !== void 0 && file.state !== "injected" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-note skp-note-warn",
							style: { marginBottom: 8 },
							children: stateNote
						}),
						read.status === "loading" && !editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail-loading",
							children: "读取中…"
						}) : editing ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-prompt-editor-wrap",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "skp-prompt-editor",
								"aria-label": `编辑 ${file.name}`,
								spellCheck: false,
								value: draft ?? "",
								onChange: (event) => setDraft(event.target.value)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-prompt-editor-meta",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										formatSize$1(draftBytes),
										" · ",
										lineCount(draft ?? ""),
										" 行"
									] }),
									dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-prompt-warn",
										children: "未保存"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { marginLeft: "auto" },
										children: "保存后仅对新会话生效"
									})
								]
							})]
						}) : read.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 auto",
								minHeight: 0,
								overflowY: "auto",
								paddingRight: 4
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownPreview, { source: read.content }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-prompt-editor-meta",
								style: { marginTop: 10 },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									"仅预览 ",
									read.content.length > 261120 ? "前 256 KB" : "全文",
									" · ",
									lineCount(read.content),
									" 行"
								] }), read.truncated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-prompt-warn",
									children: "正文超出预览上限，已截断显示"
								})]
							})]
						}) : null
					]
				})
			] });
		}
		/** 整份写回时用的状态 key（顺序无关的 dirty 判定）。 */
		function snapshotKey(mode, rows) {
			return `${mode}|${rows.map((row) => `${row.root}:${row.visible ? 1 : 0}:${row.defaultEnabled ? 1 : 0}`).join(",")}`;
		}
		/**
		* 全局 prompt 的「可见范围」弹层（v23 帧 04）：
		* mode 三选（全部工作区 / 指定工作区 / 全部不可见）+ 每工作区的「可见 / 默认启用」两列；
		* 保存写 `prompt.setVisibility`（**整份替换**那个 scope 的配置）。
		*/
		function PromptVisibilityModal({ api, file, scope, projects, current, onClose, onSaved }) {
			const [loading, setLoading] = (0, react.useState)(true);
			const [loadError, setLoadError] = (0, react.useState)(void 0);
			const [initial, setInitial] = (0, react.useState)(void 0);
			const [mode, setMode] = (0, react.useState)("all");
			const [rows, setRows] = (0, react.useState)([]);
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				let alive = true;
				setLoading(true);
				setLoadError(void 0);
				loadVisibilitySnapshot(api, file, projects, current).then((snapshot) => {
					if (!alive) return;
					setInitial(snapshot);
					setMode(snapshot.mode);
					setRows(snapshot.rows);
					setLoading(false);
				}).catch((failure) => {
					if (!alive) return;
					setLoadError(errorText(failure));
					setLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				file.id,
				projects,
				current?.root
			]);
			const dirty = initial !== void 0 && (mode !== initial.mode || snapshotKey(mode, rows) !== snapshotKey(initial.mode, initial.rows));
			const setRow = (root, patch) => {
				setRows((prev) => prev.map((row) => row.root === root ? {
					...row,
					...patch
				} : row));
			};
			const save = async () => {
				if (saving || !dirty || file.scope === "project") return;
				setSaving(true);
				setError(void 0);
				try {
					const workspaces = {};
					for (const row of rows) workspaces[row.root] = row.visible ? {
						visible: true,
						defaultEnabled: row.defaultEnabled
					} : { visible: false };
					await api.prompt.setVisibility({
						scope: file.scope,
						mode,
						workspaces
					});
					onSaved();
				} catch (failure) {
					setError(errorText(failure));
				} finally {
					setSaving(false);
				}
			};
			const note = mode === "none" ? "不可见：该工作区的任何会话都不能注入这个 prompt；会话首屏不能反向打开。" : mode === "selected" ? "仅勾选的工作区可见；新工作区默认不可见，需回来手动勾选。" : "全部工作区可见；可用「可见」列单独隐藏某个工作区。新工作区默认可见。";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Modal, {
				title: `${file.name} · 全局可见范围`,
				wide: true,
				onClose,
				header: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-vis-tip",
						title: file.path,
						children: file.displayPath
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-vis-modal-note",
						children: "可见 = 该工作区的会话可以注入这个 prompt；默认 = 可见时是否默认启用（会话首屏可再单独改）。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-scope-seg",
						role: "group",
						"aria-label": "可见范围模式",
						children: Object.keys(MODE_LABEL).map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: mode === value ? "skp-scope-seg-btn skp-scope-seg-btn-active" : "skp-scope-seg-btn",
							"aria-pressed": mode === value,
							disabled: saving || loading,
							onClick: () => setMode(value),
							children: MODE_LABEL[value]
						}, value))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-vis-modal-note",
						children: note
					}),
					loadError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-error",
						children: ["可见性读取失败：", loadError]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: error
					})
				] }),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "skp-btn",
					disabled: saving,
					onClick: onClose,
					children: "取消"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: dirty && !saving ? "skp-btn skp-btn-primary" : "skp-btn",
					disabled: saving || loading || !dirty,
					title: dirty ? "保存可见范围与每工作区默认" : "没有改动",
					onClick: () => void save(),
					children: saving ? "保存中…" : "保存"
				})] }),
				children: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-status",
					children: "读取各工作区可见性…"
				}) : rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-note",
					children: "还没有已知工作区；新建工作区后再来配置。"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-prompt-vis-row",
						style: {
							background: "transparent",
							boxShadow: "none",
							padding: "0 12px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-prompt-vis-name",
								style: { fontWeight: 600 },
								children: "工作区"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-prompt-vis-path",
								style: { fontWeight: 600 },
								children: "项目根（可见性 key）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-prompt-vis-name",
								style: {
									flex: "none",
									width: 70,
									textAlign: "center"
								},
								children: "可见"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-prompt-vis-name",
								style: {
									flex: "none",
									width: 90,
									textAlign: "right"
								},
								children: "默认启用"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "table",
						"aria-label": "各工作区可见性与默认启用",
						children: rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-prompt-vis-row",
							role: "row",
							title: row.root,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-prompt-vis-name",
									role: "cell",
									title: row.title,
									children: [row.title, row.current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-tag skp-tag-flat",
										style: { marginLeft: 6 },
										children: "当前"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-prompt-vis-path",
									role: "cell",
									title: row.path,
									children: row.root
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									role: "cell",
									style: {
										flex: "none",
										width: 70,
										display: "flex",
										justifyContent: "center"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "skp-vis-check",
										title: "该工作区可见（可见性高优先级控制）",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: row.visible,
											disabled: saving || mode === "none",
											"aria-label": `${row.title} 可见`,
											onChange: (event) => setRow(row.root, { visible: event.target.checked })
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-sr-only",
											children: "可见"
										})]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									role: "cell",
									style: {
										flex: "none",
										width: 90,
										display: "flex",
										justifyContent: "flex-end"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "skp-row-toggle",
										title: row.visible ? "该工作区的默认开 / 关（工作区视图仍可覆盖）" : "不可见时默认开关不生效",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-switch",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												role: "switch",
												"aria-label": `${row.title} 默认启用`,
												checked: row.visible && row.defaultEnabled,
												disabled: saving || mode === "none" || !row.visible,
												onChange: (event) => setRow(row.root, { defaultEnabled: event.target.checked })
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
										})
									})
								})
							]
						}, row.root))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: "不可见 ⇒ 该工作区的任何会话都不能注入；会话首屏不能反向打开。默认启用只在可见时生效。"
					})
				] })
			});
		}
		/**
		* Prompt 域视图：两栏（文件名列表 + 详情 / 编辑器）。
		*
		* - 全局视图：只列**全局** prompt（`file.scope !== "project"`）；行尾是「可见：…」chip；
		* - 工作区视图：全局 prompt（叠加注入）+ 项目链 prompt；行尾开关写默认层；
		* - 搜索来自根组件头部输入框（`query` prop），只过滤当前列表。
		*
		* @param query 根组件头部搜索框的当前值。
		* @param workspace 当前工作区路径（undefined = 全局视图）。
		* @param projects 全部已知工作区（可见范围弹层用）。
		*/
		function PromptView({ api, workspace, projects = [], query, onCount }) {
			const promptSupported = typeof api.prompt?.list === "function";
			const scope = workspace === void 0 ? "global" : "workspace";
			const projectName = workspace === void 0 ? void 0 : projects.find((project) => project.path === workspace)?.title?.trim() ?? baseName(workspace);
			const [selectedId, setSelectedId] = (0, react.useState)(void 0);
			const [busyId, setBusyId] = (0, react.useState)(void 0);
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [visibilityFile, setVisibilityFile] = (0, react.useState)(void 0);
			const [readVersion, setReadVersion] = (0, react.useState)(0);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			/** 可见性快照缓存（按文件 id；写操作后失效）。 */
			const visibilityCache = (0, react.useRef)(/* @__PURE__ */ new Map());
			const { data, loading, error, reload } = useAsyncList(async () => typeof api.prompt?.list === "function" ? api.prompt.list() : {
				files: [],
				cwd: "",
				projectRoot: "",
				budget: {
					maxBytes: 65536,
					maxSourceBytes: 1048576
				},
				engineAvailable: false,
				visibility: {},
				frozen: void 0,
				errors: ["Prompt 域不可用（宿主未提供 prompt API）"]
			}, [
				api,
				workspace,
				scope
			], { cacheKey: `prompt:${workspace ?? "global"}` });
			(0, react.useEffect)(() => {
				visibilityCache.current.clear();
			}, [workspace]);
			const files = (0, react.useMemo)(() => data?.files ?? [], [data]);
			const isFrozen = data?.frozen !== void 0;
			/** 当前作用域展示的文件：全局视图只看全局 prompt；工作区视图两者叠加。 */
			const scopedFiles = (0, react.useMemo)(() => scope === "global" ? files.filter((file) => file.scope !== "project") : files, [files, scope]);
			const globalFiles = (0, react.useMemo)(() => scopedFiles.filter((file) => file.scope !== "project"), [scopedFiles]);
			const projectFiles = (0, react.useMemo)(() => scopedFiles.filter((file) => file.scope === "project"), [scopedFiles]);
			const enabledCount = (0, react.useMemo)(() => scopedFiles.filter((file) => file.enabled).length, [scopedFiles]);
			(0, react.useEffect)(() => {
				if (!loading && error === void 0) onCount?.(enabledCount);
			}, [
				enabledCount,
				loading,
				error,
				onCount
			]);
			(0, react.useEffect)(() => {
				if (scopedFiles.length === 0) {
					if (selectedId !== void 0) setSelectedId(void 0);
					return;
				}
				if (selectedId !== void 0 && scopedFiles.some((file) => file.id === selectedId)) return;
				setSelectedId(scopedFiles[0]?.id);
			}, [scopedFiles, selectedId]);
			const q = query.trim().toLowerCase();
			const matches = (file) => {
				if (q.length === 0) return true;
				return file.name.toLowerCase().includes(q) || file.displayPath.toLowerCase().includes(q) || file.path.toLowerCase().includes(q);
			};
			const matchedFiles = (0, react.useMemo)(() => scopedFiles.filter(matches), [scopedFiles, q]);
			const matchedGlobal = matchedFiles.filter((file) => file.scope !== "project");
			const matchedProject = matchedFiles.filter((file) => file.scope === "project");
			const selected = scopedFiles.find((file) => file.id === selectedId);
			/** 行尾开关的勾选态：全局 prompt = 本工作区默认；项目 prompt = 本项目默认。 */
			const checkedOf = (file) => {
				if (file.scope === "project") return file.defaultEnabled;
				return file.visibility?.defaultEnabled ?? file.defaultEnabled;
			};
			const toggleDisabledOf = (file) => {
				if (busyId === file.id) return true;
				if (file.scope !== "project" && file.state === "invisible") return true;
				return false;
			};
			const switchTitleOf = (file) => {
				if (file.scope === "project") return checkedOf(file) ? "关闭：本项目的新会话默认不注入该文件（写项目级默认；其它项目不受影响）" : "打开：本项目的新会话默认注入该文件（写项目级默认）";
				if (file.state === "invisible") return "该全局 prompt 对本工作区不可见：先到全局视图的「可见范围」里打开可见性";
				return checkedOf(file) ? "关闭：本工作区的新会话默认不注入该文件（只改本工作区的默认，保留可见范围与其它工作区）" : "打开：本工作区的新会话默认注入该文件（只改本工作区的默认，保留可见范围与其它工作区）";
			};
			/** 当前工作区可见性快照（弹层与「本工作区默认」开关共用）。 */
			const currentVisibilityRow = (file) => {
				if (scope !== "workspace" || data === void 0) return void 0;
				const root = currentRootOf(data, workspace);
				if (root.length === 0) return void 0;
				return {
					root,
					title: projectName ?? baseName(root),
					path: workspace ?? data.cwd,
					visible: file.visibility?.visible ?? true,
					defaultEnabled: file.visibility?.defaultEnabled ?? true
				};
			};
			const snapshotFor = async (file) => {
				const cached = visibilityCache.current.get(file.id);
				if (cached !== void 0) return cached;
				const snapshot = await loadVisibilitySnapshot(api, file, projects, currentVisibilityRow(file));
				visibilityCache.current.set(file.id, snapshot);
				return snapshot;
			};
			/**
			* 写行尾开关：
			*   - 项目 prompt → `prompt.setProjectDefault`（宿主按 cwd 向上找 `.git` 算项目根）；
			*   - 全局 prompt（工作区视图）→ `prompt.setVisibility`：保留 mode 与其它工作区，
			*     只改 `workspaces[list.projectRoot].defaultEnabled`。
			*/
			const toggleFile = async (file, next) => {
				if (isFrozen || busyId !== void 0) return;
				if (file.scope !== "project" && file.state === "invisible") return;
				setBusyId(file.id);
				setOpError(void 0);
				try {
					if (file.scope === "project") {
						const cwd = workspace ?? data?.cwd;
						await api.prompt.setProjectDefault({
							...cwd !== void 0 && cwd.length > 0 ? { cwd } : {},
							path: file.path,
							enabled: next
						});
					} else {
						if (data === void 0) return;
						const snapshot = await snapshotFor(file);
						const root = currentRootOf(data, workspace);
						if (root.length === 0) {
							setOpError("无法确定当前工作区对应的项目根，暂不能写默认开关");
							return;
						}
						const rows = snapshot.rows.some((row) => row.root === root) ? snapshot.rows : [...snapshot.rows, {
							root,
							title: projectName ?? baseName(root),
							path: workspace ?? data.cwd,
							visible: file.visibility?.visible ?? true,
							defaultEnabled: file.visibility?.defaultEnabled ?? true,
							current: true
						}];
						const workspaces = {};
						for (const row of rows) workspaces[row.root] = row.visible ? {
							visible: true,
							defaultEnabled: row.root === root ? next : row.defaultEnabled
						} : { visible: false };
						await api.prompt.setVisibility({
							scope: file.scope,
							mode: snapshot.mode,
							workspaces
						});
					}
					visibilityCache.current.delete(file.id);
					reload({ silent: true });
				} catch (failure) {
					setOpError(errorText(failure));
				} finally {
					setBusyId(void 0);
				}
			};
			const focusRow = (id) => {
				const element = rowRefs.current.get(id);
				element?.focus();
				element?.scrollIntoView({ block: "nearest" });
			};
			const onRowKeyDown = (event, id) => {
				if (matchedFiles.length === 0) return;
				const index = matchedFiles.findIndex((file) => file.id === id);
				if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
					event.preventDefault();
					const next = event.key === "Home" ? 0 : event.key === "End" ? matchedFiles.length - 1 : event.key === "ArrowDown" ? Math.min(matchedFiles.length - 1, index + 1) : Math.max(0, index - 1);
					const nextId = matchedFiles[next]?.id;
					if (nextId !== void 0) {
						setSelectedId(nextId);
						requestAnimationFrame(() => focusRow(nextId));
					}
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					setSelectedId(id);
				}
			};
			/** 单行：dot + 名称 + 作用域 + displayPath + 状态 pill；行尾按作用域给开关 / 可见性 chip。 */
			const renderRow = (file) => {
				const active = file.id === selectedId;
				const isProject = file.scope === "project";
				const scopeTag = scopeTagOf(file);
				const checked = checkedOf(file);
				const disabled = toggleDisabledOf(file);
				const chipMode = file.visibility?.mode ?? "all";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: active ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": active,
							tabIndex: active ? 0 : -1,
							className: active ? "skp-row skp-row-active" : "skp-row",
							ref: (element) => {
								if (element === null) rowRefs.current.delete(file.id);
								else rowRefs.current.set(file.id, element);
							},
							onClick: () => setSelectedId(file.id),
							onKeyDown: (event) => onRowKeyDown(event, file.id),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-row-name",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: file.enabled ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow",
											"aria-hidden": "true"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-row-title",
											title: file.name,
											children: file.name
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: scopeTag.className,
											title: scopeTag.title,
											children: scopeTag.label
										}),
										file.kind === "local" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-tag skp-tag-flat",
											title: "本地覆盖文件（与基础文件叠加注入）",
											children: "local"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-row-desc",
									title: file.displayPath,
									style: {
										fontFamily: "var(--ds-font-family-code,ui-monospace,monospace)",
										fontSize: 11,
										lineHeight: "16px"
									},
									children: file.displayPath
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-row-meta",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: stateToneClass(file.state),
											title: `宿主状态：${STATE_LABEL[file.state]}`,
											children: STATE_LABEL[file.state]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatSize$1(file.size) }),
										isFrozen && file.order !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											"第 ",
											file.order,
											" 位"
										] }),
										file.duplicateOf !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											title: file.duplicateOf,
											children: ["折叠自 ", baseName(file.duplicateOf)]
										})
									]
								})
							]
						}),
						scope === "global" && !isFrozen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "skp-tag skp-tag-flat",
							title: `可见范围：${visibilitySummaryText(file, "global")}（点击按工作区配置可见与默认）`,
							onClick: () => setVisibilityFile(file),
							children: [
								"可见：",
								MODE_LABEL[chipMode],
								" ▾"
							]
						}),
						scope === "workspace" && !isFrozen && (file.state === "duplicate" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-row-default-label",
							title: "同候选组内容重复，宿主自动折叠；不单独注入，因此没有独立开关",
							children: "自动合并"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "skp-row-toggle",
							title: switchTitleOf(file),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-switch",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									role: "switch",
									"aria-label": `${file.name} ${isProject ? "本项目默认启用" : "本工作区默认启用"}`,
									checked,
									disabled,
									onChange: (event) => void toggleFile(file, event.target.checked)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-switch-track" })]
							})
						}))
					]
				}, file.id);
			};
			const renderGroupHead = (title, count, note) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-prompt-group-head",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-group-count",
						children: count
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-prompt-group-note",
						children: note
					})
				]
			});
			const listTitle = scope === "global" ? "全局 Prompt" : `${projectName ?? "工作区"} · Prompt`;
			const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
			const projectRootName = data !== void 0 && data.projectRoot.length > 0 ? baseName(data.projectRoot) : projectName ?? "项目";
			const renderListBody = () => {
				if (loading && data === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-status",
					children: "加载中…"
				});
				if (error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-error",
					children: ["读取失败：", error]
				});
				if (scopedFiles.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-empty",
					children: [scope === "global" ? "还没有已存在的全局 prompt 文件（$DSH_HOME/AGENTS.md、$DSH_AGENTS_HOME/AGENTS.md）。" : "此工作区还没有已存在的 prompt 文件（项目根到工作区目录的 AGENTS.md / CLAUDE.md / *.local.md）。", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-pane-note",
						children: "列表只显示已存在且被宿主识别的文件；未创建的文件不会出现。"
					})]
				});
				if (matchedFiles.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-empty",
					children: [
						"没有匹配「",
						query.trim(),
						"」的 prompt 文件。"
					]
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-group-scroll skp-group-scroll-plain",
					children: [matchedGlobal.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead("全局（叠加注入）", globalFiles.length, scope === "global" ? "可见范围按工作区配置" : "叠加注入 · 行尾开关 = 本工作区默认"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "skp-list",
						role: "listbox",
						"aria-label": "全局 Prompt",
						children: matchedGlobal.map(renderRow)
					})] }), scope === "workspace" && matchedProject.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead(`项目链 · ${projectRootName}`, projectFiles.length, "git 根 → 工作区目录 · 行尾开关 = 本项目默认"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "skp-list",
						role: "listbox",
						"aria-label": "项目链 Prompt",
						children: matchedProject.map(renderRow)
					})] })]
				});
			};
			if (!promptSupported) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "skp-status",
				role: "status",
				children: "Prompt 域不可用（宿主版本较旧或服务未就绪）"
			});
			const engineAvailable = data?.engineAvailable !== false;
			const visibilityCurrent = visibilityFile === void 0 ? void 0 : currentVisibilityRow(visibilityFile);
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
					error === void 0 && data !== void 0 && data.errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-error",
						children: data.errors.join("\n")
					}),
					error === void 0 && data !== void 0 && !engineAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-prompt-note",
						style: { margin: "8px 0" },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-prompt-note-title",
							children: "宿主渲染器不可用"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "本机宿主渲染器不可用：prompt 开关暂不生效，注入仍由宿主默认行为提供。" })]
					}),
					loading && data === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-status",
						children: "加载中…"
					}),
					data !== void 0 && error === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-list-pane",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-list-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-list-title",
											title: listTitle,
											children: listTitle
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-group-count",
											title: "当前作用域已存在的文件数",
											children: q.length > 0 ? `${matchedFiles.length} / ${scopedFiles.length}` : scopedFiles.length
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-list-note",
											children: listNote
										}),
										loading && data !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-refresh-note",
											children: "刷新中…"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-pane-title-note",
											children: [enabledCount, " 已启用"]
										})
									]
								}),
								scope === "global" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									title: "全局视图行内不设单开关（与 Skills / MCP 一致）：默认与可见范围在行尾「可见范围」弹层里按工作区配置",
									children: "行内不设单开关 · 默认与可见范围在弹层里按工作区配"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									title: "全局 + 项目 prompt 叠加注入（不互相覆盖）；行尾开关只写默认层，不改文件内容",
									children: "叠加注入（不覆盖）· 行尾开关只写默认层，不改文件内容"
								}),
								isFrozen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									children: "本会话已冻结 · 详情只读"
								}),
								renderListBody()
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail skp-detail-fixed skp-detail-flush",
							children: selected === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-detail-empty",
								children: scopedFiles.length === 0 ? "此作用域还没有可注入的 prompt 文件。" : "选择一个 prompt 文件查看内容。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptDetail, {
								api,
								file: selected,
								list: data,
								...data.frozen !== void 0 ? { frozen: data.frozen } : {},
								scope,
								...projectName !== void 0 ? { projectName } : {},
								readVersion,
								onSaved: () => {
									setReadVersion((value) => value + 1);
									reload({ silent: true });
								},
								onOpenVisibility: () => setVisibilityFile(selected)
							}, selected.id)
						})]
					}),
					visibilityFile !== void 0 && visibilityFile.scope !== "project" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptVisibilityModal, {
						api,
						file: visibilityFile,
						scope,
						projects,
						...visibilityCurrent !== void 0 ? { current: visibilityCurrent } : {},
						onClose: () => setVisibilityFile(void 0),
						onSaved: () => {
							visibilityCache.current.delete(visibilityFile.id);
							setVisibilityFile(void 0);
							reload({ silent: true });
						}
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
			autoNoKey: "当前没有可用的 API Key：自动评分不会触发。请先填写并保存密钥，或配置环境变量。",
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
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-jev-label skp-jev-label-strong",
													children: COPY.autoEnable
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-jev-hint",
													children: COPY.autoEnableHint
												}),
												form.autoEnabled && saved !== null && !saved.hasApiKey && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "skp-jev-err",
													role: "status",
													children: COPY.autoNoKey
												})
											]
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
			const treeCollapsed = contentWidth < TREE_COLLAPSE_WIDTH;
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
					!treeCollapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-file-tree",
						role: "tree",
						"aria-label": "Skills 目录",
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
								children: "目录"
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
					treeCollapsed && state.status === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
		* **v20.1 信息架构（能力中心）**：只保留两条轴 + 一个解释层。
		*   1. 类型 = Tab（Skills / MCP / Tools / Prompt，Jev 用分隔线单独成组）；
		*   2. 作用域 = 头部常驻分段控件（全局 / 工作区 ▾，工作区下拉列出全部
		*      工作区）——**面板与当前对话所在工作区完全解耦，默认进入全局**；
		*      `src/client.ts` 的面板 api `currentWorkspaceCwd = () => selection.cwd`
		*      （undefined = 全局，禁止 session fallback）；
		*   3. 详情 = 两段作用域链（全局 → 工作区，逐段标 继承 / 覆盖 / 来源）；
		*      **面板不涉及会话层级**，会话级开关在对话上方的「能力」Tab。
		*
		* 左栏 ScopeNav / 工作区列表已删除；列表标题栏固定写「类型 + 作用域」
		* （`全局 Skills` / `HtDot · Skills` / `HtDot · MCP`）+ 计数 + 作用域提示 +
		* 内联「＋ 添加 Skill / ＋ 添加 MCP」入口，弹窗落点由当前 Tab × 当前作用域
		* 直接确定（不再二次选择）。
		*
		* **两份 api，切勿合并（防回归）**：面板这份 api 的 cwd 只取用户在面板里
		* 显式选择的作用域；composer（输入框工具行 / 首屏入口）在 client.ts 中用
		* 单独的每会话 api，`currentWorkspaceCwd` 只取该会话自己的工作区。两者共用
		* 同一份 `subscribeWorkspace` 回调集合。若把面板这份 api 交给 composer，
		* 就会出现跨工作区串味 bug。
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
			prompt: "Prompt",
			jev: "Jev 模型"
		};
		const DOMAIN_ORDER = [
			"skills",
			"mcp",
			"tools",
			"prompt",
			"jev"
		];
		/**
		* 各域的搜索占位符（搜索框在根组件头部，切换域时切换文案）。
		* `jev` 域没有搜索框，故不在此表内（渲染处按 `domain !== "jev"` 隐藏）。
		*/
		const DOMAIN_SEARCH_PLACEHOLDER = {
			skills: "搜索 Skills…",
			mcp: "搜索 MCP…",
			tools: "搜索插件或工具…",
			prompt: "搜索 prompt 文件…"
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
			const [projects, setProjects] = (0, react.useState)(() => api.projects());
			/** 面板作用域：undefined = 全局（默认），路径 = 用户选中的工作区。 */
			const [pinned, setPinned] = (0, react.useState)(() => api.selectedProject());
			const [skillsCount, setSkillsCount] = (0, react.useState)(void 0);
			const [mcpCount, setMcpCount] = (0, react.useState)(void 0);
			const [toolsCount, setToolsCount] = (0, react.useState)(void 0);
			const [promptCount, setPromptCount] = (0, react.useState)(void 0);
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
					if (detail !== "skills" && detail !== "mcp" && detail !== "tools" && detail !== "prompt" && detail !== "jev") return;
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
				prompt: promptCount,
				jev: void 0
			};
			const jevActive = domain === "jev";
			/** 作用域：未选择工作区 = 全局（面板默认，与当前对话无关）。 */
			const workspaceSelected = pinned !== void 0;
			const activeProject = pinned === void 0 ? void 0 : projects.find((project) => project.path === pinned);
			/** 工作区展示名：优先工作区 title，其次目录 basename（统一 HtDot 口径）。 */
			const projectName = pinned === void 0 ? void 0 : activeProject?.title ?? basenameOf(pinned);
			/** 切换作用域：undefined = 全局；路径 = 该工作区。 */
			const selectWorkspace = (path) => api.selectProject(path);
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
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "能力中心" }), !jevActive && (workspaceSelected ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-scope-badge",
									children: "工作区视图"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-workspace",
									title: pinned,
									children: projectName
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-scope-badge",
									children: "全局视图"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-workspace",
									children: "所有工作区生效"
								})] }))]
							}), !jevActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-title-tools",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-scope-seg",
									role: "group",
									"aria-label": "作用域",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: workspaceSelected ? "skp-scope-seg-btn" : "skp-scope-seg-btn skp-scope-seg-btn-active",
										"aria-pressed": !workspaceSelected,
										title: "管理全局能力（所有工作区生效）",
										onClick: () => selectWorkspace(void 0),
										children: "全局"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkpSelect, {
										className: "skp-dd-scope skp-scope-seg-select",
										value: pinned ?? "",
										title: workspaceSelected ? pinned : "从全部工作区中选择",
										ariaLabel: "工作区作用域",
										options: [
											...pinned === void 0 ? [{
												value: "",
												label: "工作区 ▾"
											}] : [],
											...projects.map((project) => ({
												value: project.path,
												label: `工作区 · ${project.title ?? basenameOf(project.path)}`,
												...pinned === project.path ? { hint: "当前" } : {}
											})),
											...pinned !== void 0 && !projects.some((project) => project.path === pinned) ? [{
												value: pinned,
												label: `工作区 · ${basenameOf(pinned)}`
											}] : []
										],
										onChange: (value) => selectWorkspace(value === "" ? void 0 : value)
									})]
								})
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-header-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "skp-tabs",
								role: "tablist",
								children: DOMAIN_ORDER.map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [d === "jev" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tab-sep",
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
								})] }, d))
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
						workspace: pinned,
						projects,
						query,
						onCount: setToolsCount
					}) : domain === "prompt" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptView, {
						api,
						workspace: pinned,
						projects,
						query,
						onCount: setPromptCount
					}) : domain === "skills" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillsView, {
						api,
						workspace: pinned,
						projects,
						query,
						onSelectWorkspace: selectWorkspace,
						onCount: setSkillsCount
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpView, {
						api,
						workspace: pinned,
						projects,
						query,
						onSelectWorkspace: selectWorkspace,
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
			if (item.origin === "preset") return `Agent 预设 · 仅在「${item.channel ?? "未知预设"}」的对话可见`;
			return item.channel !== void 0 && item.channel.length > 0 ? `${item.channel} 运行时注入（不落盘）` : "插件运行时注入（不落盘）";
		}
		/** 注入行的只读原因条文案（详情页顶部）。 */
		function injectedReadonlyNote(item) {
			const channel = item.channel !== void 0 && item.channel.length > 0 ? item.channel : "插件";
			if (item.origin === "bundled") return "内容只读 · DSH 内置 Skills（无磁盘副本）；可在列表 / 本页启用或禁用，不可编辑或删除。";
			if (item.origin === "preset") return `内容只读 · 由 Agent 预设「${channel}」提供（无磁盘副本，仅绑定该预设的对话可见）；可在本页启用或禁用，不可编辑或删除。`;
			return `内容只读 · 由插件 ${channel} 运行时注册（无磁盘副本）；可在列表 / 本页启用或禁用，不可编辑或删除。`;
		}
		/** 行左标签的排序与文案：scope → 格式 → 关系（最多 3 个）。 */
		function skillTags(item, hasGlobal) {
			const tags = [];
			if (item.injected === true) {
				tags.push({
					key: "origin",
					label: originLabel(item),
					className: originTagClass(item),
					title: item.origin === "bundled" ? "DSH 随包提供的 Skills（只读）" : item.origin === "preset" ? "由当前 Agent 预设渠道提供，只在绑定该预设的对话里可见" : "由插件在运行时注册的 Skills（只读）"
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
				label: isProject ? "本项" : "全局",
				className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
				title: isProject ? "仅存在于所选工作区的 Skills" : "全局 Skills，对所有工作区生效"
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
				title: "已生成屏蔽占位，使同名全局 Skills 在本工作区不可用；删除占位即恢复"
			});
			else if (isProject && hasGlobal) tags.push({
				key: "override",
				label: "覆盖全局",
				className: "skp-tag skp-tag-relation",
				title: "本工作区生效的是这份副本；同名全局 Skills 被遮蔽"
			});
			else if (!isProject && item.projectShadow === "stub") tags.push({
				key: "disabled-in-project",
				label: "工作区默认关闭",
				className: "skp-tag skp-tag-warn",
				title: "该工作区已禁用同名全局 Skills；可在工作区作用域重新打开（不影响其它工作区）"
			});
			else if (!isProject && item.projectShadow === "skill") tags.push({
				key: "project-copy",
				label: "工作区副本生效中",
				className: "skp-tag skp-tag-readonly",
				title: "工作区已有同名 Skills，按优先级该工作区生效的是工作区副本"
			});
			return tags;
		}
		/**
		* 全局视图的开关勾选态 = **全局默认是否启用**（v20.1 B2：独立
		* `capability-global-overrides.json`，不修改技能文件）。
		* 旧宿主没有 `globalDefaultDisabled` 时回退到旧的项目遮蔽口径。
		*/
		function globalDefaultEnabledOf(item) {
			if (item.globalDefaultDisabled !== void 0) return !item.globalDefaultDisabled;
			if (item.projectShadow === "stub") return false;
			return item.disabledInProject !== true;
		}
		/**
		* 工作区视图的开关勾选态 = **有效默认值**（契约 §1.3：全局默认 < 工作区显式）。
		* 优先用宿主投影的 `effectiveDefaultEnabled`；旧宿主按可见字段回退。
		*/
		/** frontmatter YAML 的 key 是否需要引号（只处理保守集合）。 */
		function yamlKey(key) {
			return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
		}
		/**
		* frontmatter YAML 值序列化：标量按 YAML 安全形式输出（数字/布尔/null 原样，
		* 其余字符串按需加双引号）；对象 / 数组用 JSON flow 形式（JSON 是合法 YAML），
		* **不做字段推断**——只输出 spec 里真实存在的值。
		*/
		function yamlScalar(value) {
			if (typeof value === "string") {
				const plain = value.length > 0 && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value);
				const reserved = /^(?:true|false|null|yes|no|on|off|~|\d+(?:\.\d+)?)$/i.test(value);
				return plain && !reserved ? value : JSON.stringify(value);
			}
			if (typeof value === "number" || typeof value === "boolean") return String(value);
			if (value === null || value === void 0) return "null";
			try {
				return JSON.stringify(value);
			} catch {
				return JSON.stringify(String(value));
			}
		}
		/**
		* 由 `SkillSpec` 还原 frontmatter YAML（字段与磁盘 frontmatter 一一对应：
		* name / description / whenToUse / 扁平 invocation 键 / metadata）。不臆造未知字段。
		*/
		function frontmatterYamlOf(spec) {
			const lines = [`name: ${yamlScalar(spec.name)}`, `description: ${yamlScalar(spec.description)}`];
			if (spec.whenToUse !== void 0 && spec.whenToUse.trim().length > 0) lines.push(`whenToUse: ${yamlScalar(spec.whenToUse)}`);
			const invocation = spec.invocation ?? {};
			for (const key of ["disable-model-invocation", "user-invocable"]) if (invocation[key] !== void 0) lines.push(`${yamlKey(key)}: ${yamlScalar(invocation[key])}`);
			const metadata = spec.metadata ?? {};
			const metadataEntries = Object.entries(metadata);
			if (metadataEntries.length > 0) {
				lines.push("metadata:");
				for (const [key, value] of metadataEntries) lines.push(`  ${yamlKey(key)}: ${yamlScalar(value)}`);
			}
			return lines.join("\n");
		}
		/** metadata 值展示：标量原样；对象 / 数组用紧凑 JSON（嵌套对象可读预览）。 */
		function metadataValueText(value) {
			if (value === null) return "null";
			if (typeof value === "string") return value;
			if (typeof value === "number" || typeof value === "boolean") return String(value);
			try {
				return JSON.stringify(value);
			} catch {
				return String(value);
			}
		}
		/**
		* 「Frontmatter / 触发规则」区块（Skills 详情）：
		* 展示 read 拿到的 spec（名称 / 描述 / 使用时机 / 调用策略 / metadata），
		* 并提供由 spec 生成的原始 frontmatter YAML 折叠块。样式沿用 `.skp-detail-*`。
		*/
		function SkillFrontmatterSection({ spec }) {
			const metadataEntries = Object.entries(spec.metadata ?? {});
			const modelInvocable = spec.invocation?.["disable-model-invocation"] !== true;
			const userInvocable = spec.invocation?.["user-invocable"] !== false;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "skp-frontmatter",
				"aria-label": "Frontmatter / 触发规则",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-detail-inspect-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-field-label",
							children: "Frontmatter / 触发规则"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-test-stat",
							children: "来自 SKILL.md frontmatter · 只读"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: "skp-frontmatter-fields",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "名称" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: spec.name }) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "描述" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: spec.description.length > 0 ? spec.description : "—" }),
							spec.whenToUse !== void 0 && spec.whenToUse.trim().length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "使用时机 / 触发规则" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: spec.whenToUse })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "调用策略" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
								"模型 ",
								modelInvocable ? "✓" : "✗",
								" · 用户 ",
								userInvocable ? "✓" : "✗"
							] }),
							metadataEntries.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "metadata" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "skp-frontmatter-meta",
								children: metadataEntries.map(([key, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
									className: "skp-frontmatter-meta-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-frontmatter-key",
										children: key
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-frontmatter-value",
										title: metadataValueText(value),
										children: metadataValueText(value)
									})]
								}, key))
							}) })] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "skp-frontmatter-raw",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "原始 frontmatter（YAML）" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							className: "skp-frontmatter-yaml",
							children: frontmatterYamlOf(spec)
						})]
					})
				]
			});
		}
		function effectiveDefaultEnabledOf(item) {
			if (item.effectiveDefaultEnabled !== void 0) return item.effectiveDefaultEnabled;
			if (item.projectDefaultEnabled === true) return true;
			if (item.projectDefaultDisabled === true) return false;
			if (item.projectShadow === "stub") return false;
			return item.globalDefaultDisabled !== true && item.disabledInProject !== true;
		}
		/**
		* 行开关是否置灰 + tooltip。
		*
		* - 全局视图：写全局默认（独立文件）；注入行也可启停（readOnly 只限制内容编辑）；
		* - 工作区视图：项目磁盘条目的开关写 frontmatter（只读/无工作区时置灰）；
		*   全局 / 注入条目写「工作区显式启用/禁用」（B2）。
		*
		* 注意判序：`canToggleGlobal` 必须先于 `readOnly` 判——宿主 `skills.list` 里
		* **所有注入行**都带 `readOnly:true`（内容只读），把 readOnly 当开关禁用条件
		* 会把「插件注入 · 只读 · 可启停」整组错误置灰（verifier V20-05j）。
		*/
		function skillSwitchDisabled(item, scope) {
			/** true = 内容只读但开关可写（注入行）：readOnly 不拦启停。 */
			const contentOnlyReadOnly = item.readOnly && item.injected !== true;
			if (scope === "global") {
				if (item.canToggleGlobal === false) return {
					disabled: true,
					title: item.globalToggleBlockedReason ?? "该条目由同层注入提供，无法设置全局默认"
				};
				if (contentOnlyReadOnly) return {
					disabled: true,
					title: "只读来源，无法修改"
				};
				return {
					disabled: false,
					title: globalDefaultEnabledOf(item) ? "关闭：所有工作区默认不启用（写全局默认名单，不修改 Skills 文件；工作区可重新打开）" : "打开：恢复此 Skill 的全局默认启用"
				};
			}
			if (contentOnlyReadOnly) return {
				disabled: true,
				title: "只读来源（.claude 兼容目录），无法修改"
			};
			if (isProjectSource(item.source)) {
				if (item.shadowStub === true) return {
					disabled: false,
					title: "打开：删除屏蔽占位，恢复同名全局 Skill 在本工作区可用"
				};
				return {
					disabled: false,
					title: item.modelInvocable && item.userInvocable ? "关闭：本工作区内的这份 Skill 模型与用户都不可调用（写 frontmatter）" : "打开：恢复模型与用户调用（写 frontmatter）"
				};
			}
			return {
				disabled: false,
				title: effectiveDefaultEnabledOf(item) ? "关闭：仅此工作区默认不启用（写项目覆盖）" : "打开：仅此工作区默认启用（可覆盖全局默认关闭）"
			};
		}
		/** 取路径最后一段作为工作区显示名（兼容 POSIX / Windows 分隔符）。 */
		function basenameOf(path) {
			const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
			return segments[segments.length - 1] ?? path;
		}
		/**
		* Skills 视图（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav 与工作区列表。
		*
		*  - **全局作用域**（`workspace === undefined`）：列表 = 磁盘全局 Skills +
		*    宿主注入 Skills（按来源分组）；行尾开关写**全局默认**
		*    （`overrides.globalToggle` → `capability-global-overrides.json`）。
		*  - **工作区作用域**（`workspace` = 用户选中的工作区）：列表 = 本项目独有条目
		*    + 引用的全局能力（按来源分组）；行尾开关写**该工作区的有效默认**
		*    （B2：项目磁盘条目走 frontmatter，全局 / 注入条目走 overrides 显式启用/禁用）。
		*
		* 作用域入口只在根部 header（全局 / 工作区 ▾），本视图不提供第二套导航；
		* 列表标题栏固定「类型 + 作用域」与内联「＋ 添加 Skill」入口，类型与落点由
		* 当前 Tab × 当前作用域直接决定（弹窗不再二次选择）。
		*
		* 搜索词由根组件头部的同一输入框提供（query），只过滤当前列表；计数口径 =
		* Tab 与列表标题共享「当前作用域总数」，搜索时标题显示「匹配 / 总数」。
		*/
		function SkillsView({ api, workspace, projects, query, onSelectWorkspace, onCount }) {
			const skillsApi = api.skills;
			const [selected, setSelected] = (0, react.useState)(void 0);
			/** 关系标签互跳的目标行：切作用域后待列表出现再选中。 */
			const [pendingSelect, setPendingSelect] = (0, react.useState)(void 0);
			const [installOpen, setInstallOpen] = (0, react.useState)(false);
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [busyRow, setBusyRow] = (0, react.useState)(void 0);
			/** 写操作计数：传给 SkillContent，变化时清空文件缓存并重拉。 */
			const [contentVersion, setContentVersion] = (0, react.useState)(0);
			/** 全局默认层（独立文件）：文件路径 + 损坏警告；开关后重读。 */
			const [globalOverrides, setGlobalOverrides] = (0, react.useState)(void 0);
			const [globalVersion, setGlobalVersion] = (0, react.useState)(0);
			/** v21：工作区视图的项目 overrides（判断「跟随全局默认 / 已覆盖」）。 */
			const [projectOverrides, setProjectOverrides] = (0, react.useState)(void 0);
			/** 写操作计数：工作区 overrides 变化后重读（「跟随 / 已覆盖」标签）。 */
			const [writeVersion, setWriteVersion] = (0, react.useState)(0);
			const rowRefs = (0, react.useRef)(/* @__PURE__ */ new Map());
			const scope = workspace === void 0 ? "global" : "workspace";
			const workspaceSelected = scope === "workspace";
			const projectName = workspace === void 0 ? void 0 : projects.find((project) => project.path === workspace)?.title ?? basenameOf(workspace);
			/** 当前全局可见性集合（旧宿主 / v1 文件 ⇒ 全空 = 全部可见）。 */
			const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
			/** 某 skill 的可见性配置（global 视图的行标签 / 详情用）。 */
			const visibilityOf = (name) => visibilityEntryOf(visibilitySets, "skills", name);
			/** 兜底默认：名字在全局默认关闭名单里。 */
			const globalOffOf = (item) => item.globalDefaultDisabled === true || globalOverrides?.skills.includes(item.name) === true;
			const { data, loading, error, reload } = useAsyncList(async () => {
				const view = skillsApi.listView !== void 0 ? await skillsApi.listView() : {
					skills: await skillsApi.list(),
					hiddenCount: 0
				};
				return {
					items: view.skills,
					hiddenCount: view.hiddenCount ?? 0
				};
			}, [skillsApi, workspace], { cacheKey: `skills:${workspace ?? "global"}` });
			const items = data?.items ?? [];
			const hiddenCount = data?.hiddenCount ?? 0;
			const projectItems = (0, react.useMemo)(() => items.filter((item) => isProjectSource(item.source)), [items]);
			const globalItems = (0, react.useMemo)(() => items.filter((item) => !isProjectSource(item.source)), [items]);
			const injectedItems = (0, react.useMemo)(() => globalItems.filter((item) => item.injected === true), [globalItems]);
			const diskGlobalItems = (0, react.useMemo)(() => globalItems.filter((item) => item.injected !== true), [globalItems]);
			/** v21：工作区视图里因可见性被隐藏的**全局**条目（宿主已过滤，这里防御旧宿主）。 */
			const workspaceGlobalItems = (0, react.useMemo)(() => scope === "workspace" ? globalItems.filter((item) => item.visibleInWorkspace !== false) : globalItems, [globalItems, scope]);
			(0, react.useEffect)(() => {
				let alive = true;
				safeGlobalGet(api).then((value) => {
					if (alive) setGlobalOverrides(value);
				});
				return () => {
					alive = false;
				};
			}, [api, globalVersion]);
			(0, react.useEffect)(() => {
				if (scope !== "workspace") {
					setProjectOverrides(void 0);
					return;
				}
				let alive = true;
				safeOverridesGet(api).then((value) => {
					if (alive) setProjectOverrides(value);
				});
				return () => {
					alive = false;
				};
			}, [
				api,
				scope,
				workspace,
				writeVersion
			]);
			/**
			* 当前作用域总数（Tab 与列表标题共用同一口径）：
			* 全局视图 = 全部条目；工作区视图 = 可见条目（v21 计数可见口径）。
			*/
			const scopeTotal = scope === "global" ? globalItems.length : projectItems.length + workspaceGlobalItems.length;
			(0, react.useEffect)(() => {
				if (!loading && error === void 0) onCount?.(scopeTotal);
			}, [
				scopeTotal,
				loading,
				error,
				onCount
			]);
			const q = query.trim().toLowerCase();
			const matchesSkill = (item) => q.length === 0 || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.channel !== void 0 && item.channel.toLowerCase().includes(q);
			/** 当前作用域参与渲染的全局条目（工作区视图已按可见性过滤）。 */
			const globalItemsForScope = scope === "global" ? globalItems : workspaceGlobalItems;
			const visibleProject = (0, react.useMemo)(() => projectItems.filter(matchesSkill), [projectItems, q]);
			const visibleGlobal = (0, react.useMemo)(() => globalItemsForScope.filter(matchesSkill), [globalItemsForScope, q]);
			const visibleDiskGlobal = (0, react.useMemo)(() => diskGlobalItems.filter((item) => scope === "global" || item.visibleInWorkspace !== false).filter(matchesSkill), [
				diskGlobalItems,
				scope,
				q
			]);
			const visibleInjected = (0, react.useMemo)(() => injectedItems.filter((item) => scope === "global" || item.visibleInWorkspace !== false).filter(matchesSkill), [
				injectedItems,
				scope,
				q
			]);
			/** 当前作用域可见行（决定键盘导航与选中查找）。 */
			const visibleItems = (0, react.useMemo)(() => scope === "global" ? visibleGlobal : [...visibleProject, ...visibleGlobal], [
				scope,
				visibleGlobal,
				visibleProject
			]);
			const visibleKeys = (0, react.useMemo)(() => visibleItems.map(skillRowKey), [visibleItems]);
			const selectedItem = items.find((item) => skillRowKey(item) === selected);
			(0, react.useEffect)(() => {
				setSelected(void 0);
			}, [workspace]);
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
			/** 行内统一开关：按「当前作用域 × 行类型」分派（全部真实调用后端）。 */
			const toggleRow = async (item, next) => {
				const key = skillRowKey(item);
				if (busyRow !== void 0) return;
				setBusyRow(key);
				setOpError(void 0);
				try {
					const isProject = isProjectSource(item.source);
					if (scope === "global") {
						const result = await api.overrides.globalToggle({
							domain: "skills",
							key: item.name,
							disabled: !next
						});
						if (!result.ok) {
							setOpError(result.errors.join("; "));
							return;
						}
						setGlobalVersion((value) => value + 1);
					} else if (isProject) {
						const result = item.shadowStub === true ? next ? await skillsApi.enableInProject({ name: item.name }) : { ok: true } : await skillsApi.setEnabled({
							...skillRefOf(item),
							enabled: next
						});
						if (!result.ok) {
							setOpError(result.errors.join("; "));
							return;
						}
					} else {
						const result = await api.overrides.setSkillDefault({
							key: item.name,
							enabled: next
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
					setWriteVersion((value) => value + 1);
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
			/** 列表标题栏的内联添加（类型 + 落点已由当前 Tab × 作用域决定）。 */
			const addLabel = "＋ 添加 Skill";
			const addTitle = scope === "global" ? "添加 Skill 到全局" : `添加 Skill 到工作区 ${projectName ?? "工作区"}`;
			/** 列表标题：全局 = 「全局 Skills」；工作区 = 「HtDot · Skills」。 */
			const listTitle = scope === "global" ? "全局 Skills" : `${projectName ?? "工作区"} · Skills`;
			const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
			/** v21.3：稳定回调（配合 `SkillListRow` 的 React.memo，避免切换作用域时全量重渲）。 */
			const rowActionsRef = (0, react.useRef)({
				selectRow,
				toggleRow,
				onRowKeyDown
			});
			rowActionsRef.current = {
				selectRow,
				toggleRow,
				onRowKeyDown
			};
			const stableSelectRow = (0, react.useCallback)((key) => rowActionsRef.current.selectRow(key), []);
			const stableToggleRow = (0, react.useCallback)((item, next) => {
				rowActionsRef.current.toggleRow(item, next);
			}, []);
			const stableRowKeyDown = (0, react.useCallback)((event, key) => rowActionsRef.current.onRowKeyDown(event, key), []);
			/** 一组技能行（列表容器 + 可访问性标签）。行组件 memo 化，只重渲状态变化的行。 */
			const renderRows = (list, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: "skp-list",
				role: "listbox",
				"aria-label": label,
				children: list.map((item) => {
					const key = skillRowKey(item);
					const isProject = isProjectSource(item.source);
					const visibilityEditable = scope === "global" && !isProject;
					const entry = visibilityOf(item.name);
					const invisible = visibilityEditable && isRowInvisible(item, entry, projects);
					const overrideState = workspaceSelected && !isProject ? workspaceOverrideOf(projectOverrides, "skills", item.name) : "inherit";
					const switcher = skillSwitchDisabled(item, scope);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
						role: "presentation",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillListRow, {
							item,
							selected: selected === key,
							busy: busyRow === key,
							scope,
							projectName,
							projects,
							visibilityEntry: entry,
							globalOff: globalOffOf(item),
							invisible,
							overrideState,
							hasDiskGlobal: diskGlobalItems.some((global) => global.name === item.name),
							switchDisabled: switcher.disabled,
							switchTitle: switcher.title,
							rowRefs,
							onSelect: stableSelectRow,
							onToggle: stableToggleRow,
							onKeyDown: stableRowKeyDown
						})
					}, key);
				})
			});
			/** 一个分组头（标题 + 计数 + 说明）。 */
			const renderGroupHead = (title, count, note) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-list-group-head",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-list-group-title",
						children: title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-group-count",
						children: count
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-list-group-note",
						children: note
					})
				]
			});
			/** 空态：按「一个都没有」与「搜索无匹配」区分，并给原地添加入口。 */
			const renderEmpty = () => {
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
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: scope === "global" ? "全局还没有 Skills。" : `工作区 ${projectName ?? ""} 还没有 Skills。` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-btn",
						style: { marginTop: 10 },
						onClick: () => setInstallOpen(true),
						children: scope === "global" ? "添加到全局" : "添加到此工作区"
					})]
				});
			};
			/** 列表主体：全局 = 用户安装 + 插件注入；工作区 = 本项目 + 引用的全局能力。 */
			const renderListBody = () => {
				if (loading && data === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-status",
					children: "加载中…"
				});
				if (error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-error",
					children: ["读取失败：", error]
				});
				if (scope === "global") {
					if (visibleDiskGlobal.length === 0 && visibleInjected.length === 0) return renderEmpty();
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-group-scroll skp-group-scroll-plain",
						children: [visibleDiskGlobal.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead("用户安装", diskGlobalItems.length, "~/.agents/skills"), renderRows(visibleDiskGlobal, "用户安装的全局 Skills")] }), visibleInjected.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead("插件注入", injectedItems.length, "只读 · 可启停"), renderRows(visibleInjected, "插件注入的 Skills")] })]
					});
				}
				if (visibleProject.length === 0 && visibleGlobal.length === 0) {
					if (hiddenCount > 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-group-scroll skp-group-scroll-plain",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-empty",
							children: "本工作区没有可见的 Skills。"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-pane-note",
							children: [
								"另有 ",
								hiddenCount,
								" 个能力未对此外工作区开放"
							]
						})]
					});
					return renderEmpty();
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-group-scroll skp-group-scroll-plain",
					children: [
						visibleProject.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead(`本项目 · ${projectName ?? "工作区"}`, projectItems.length, "工作区独有"), renderRows(visibleProject, "本项目 Skills")] }),
						visibleGlobal.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroupHead("引用的全局能力", globalItemsForScope.length, `开关作用于 ${projectName ?? "此工作区"}`), renderRows(visibleGlobal, "引用的全局 Skills")] }),
						hiddenCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-pane-note",
							title: "这些能力在全局视图里未被开放给本工作区；请在全局视图的「可见范围」里开启",
							children: [
								"另有 ",
								hiddenCount,
								" 个能力未对此外工作区开放"
							]
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
					scope === "global" && globalOverrides?.errors !== void 0 && globalOverrides.errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-error",
						children: ["全局默认名单读取失败（按空名单处理）：", globalOverrides.errors.join("; ")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-list-pane",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-list-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "skp-list-title",
											title: listTitle,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-list-title-scope",
												children: scope === "global" ? "全局" : projectName ?? "工作区"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-list-title-type",
												children: scope === "global" ? " Skills" : " · Skills"
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-group-count",
											title: "当前作用域总数",
											children: q.length > 0 ? `${visibleItems.length} / ${scopeTotal}` : scopeTotal
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-list-note",
											children: listNote
										}),
										loading && data !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-refresh-note",
											children: "刷新中…"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "skp-btn skp-btn-primary skp-list-add",
											title: addTitle,
											"aria-label": addTitle,
											onClick: () => setInstallOpen(true),
											children: addLabel
										})
									]
								}),
								scope === "global" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "skp-pane-note",
									title: globalOverrides?.filePath,
									children: globalOverrides?.filePath !== void 0 ? `全局默认写入 ${globalOverrides.filePath}` : "全局默认对所有工作区生效；工作区可单独覆盖"
								}),
								scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "skp-pane-note",
									children: [
										"开关作用于 ",
										projectName ?? "此工作区",
										" 的默认值 · 其它工作区不受影响"
									]
								}),
								renderListBody()
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail skp-detail-fixed skp-detail-flush",
							children: selectedItem !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillDetail, {
								summary: selectedItem,
								api: skillsApi,
								scope,
								workspace,
								projectName,
								workspaces: projects,
								onSelectWorkspace,
								visibility: scope === "global" && !isProjectSource(selectedItem.source) ? {
									api,
									entry: visibilityOf(selectedItem.name),
									globalOff: globalOffOf(selectedItem),
									onSaved: () => {
										setGlobalVersion((value) => value + 1);
										setWriteVersion((value) => value + 1);
										reload({ silent: true });
									}
								} : void 0,
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
								children: scopeTotal === 0 ? "此作用域还没有 Skills。用列表标题栏的「＋ 添加 Skill」添加一个。" : "选择一个条目查看说明与全部文件内容。"
							})
						})]
					}),
					installOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallDialog, {
						api: skillsApi,
						scope: scope === "global" ? "global" : "project",
						workspace,
						projectName,
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
		* 详情卡片（v20.1）：标题 / 两段作用域链（全局 → 工作区）/ 动作区 / 元信息 +
		* **文件树与阅读器**（见 skill-content.tsx）。
		*
		* 作用域链只到工作区：全局视图第二段是「在「工作区」作用域查看 ↗」入口；
		* 工作区视图第二段显示该工作区的真实有效状态。会话级开关不进入本面板。
		*/
		function SkillDetail({ summary, api, scope, workspace, projectName, workspaces, onSelectWorkspace, visibility, contentVersion, onChanged, onRemoved }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [opError, setOpError] = (0, react.useState)(void 0);
			const [confirmImport, setConfirmImport] = (0, react.useState)(false);
			const [exportPathOpen, setExportPathOpen] = (0, react.useState)(false);
			const [deleteOpen, setDeleteOpen] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			/** v22：长元数据（frontmatter / 可见范围 / 路径 / 调用方式）默认收起。 */
			const [metaOpen, setMetaOpen] = (0, react.useState)(false);
			/**
			* v21.2：详情 frontmatter（`skills.read` 的 spec：name/description/whenToUse/
			* invocation/metadata）。读取失败或注入行 fallback 失败时静默降级（不渲染区块，
			* 不阻塞详情）；写操作后随 contentVersion 重读。
			*/
			const [frontmatter, setFrontmatter] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				let alive = true;
				setFrontmatter(void 0);
				api.read(summary.name, skillRefOf(summary)).then((detail) => {
					if (alive && detail !== void 0) setFrontmatter(detail.spec);
				}).catch(() => {});
				return () => {
					alive = false;
				};
			}, [
				api,
				summary.name,
				summary.root,
				summary.source,
				contentVersion
			]);
			const isGlobal = isGlobalSkillSource(summary.source);
			const isProject = isProjectSource(summary.source);
			const hasWorkspace = workspace !== void 0;
			const injected = summary.injected === true;
			const state = invocationState(summary);
			/** 两段作用域链（全局 → 工作区）的文案：回答「为什么是现在这个状态」。 */
			const globalSegment = (() => {
				if (isProject) return {
					on: false,
					title: "未配置",
					note: "本项只存在于所选工作区"
				};
				const on = globalDefaultEnabledOf(summary);
				return {
					on,
					title: on ? "已安装 · 默认启用" : "已安装 · 默认关闭",
					note: on ? "对所有工作区生效" : "全局默认关闭；工作区可重新打开"
				};
			})();
			const workspaceSegment = (() => {
				if (isProject) return {
					on: summary.shadowStub !== true,
					title: summary.shadowStub === true ? "屏蔽占位" : "本项独有 · 默认启用",
					note: "来源：本项目 .agents/skills"
				};
				if (summary.projectDefaultEnabled === true) return {
					on: true,
					title: "默认启用（重新打开）",
					note: "来源：工作区覆盖 · 覆盖全局默认关闭"
				};
				if (summary.projectDefaultDisabled === true || summary.projectShadow === "stub") return {
					on: false,
					title: "已关闭（覆盖）",
					note: "来源：工作区覆盖 · 仅此工作区默认关闭"
				};
				if (summary.projectDefaultEnabled === false || summary.projectDefaultDisabled === false) return {
					on: effectiveDefaultEnabledOf(summary),
					title: effectiveDefaultEnabledOf(summary) ? "默认启用" : "已关闭",
					note: "来源：工作区覆盖（capability-overrides.json）"
				};
				return {
					on: effectiveDefaultEnabledOf(summary),
					title: effectiveDefaultEnabledOf(summary) ? "默认启用" : "已关闭",
					note: "未配置工作区覆盖 · 跟随全局默认"
				};
			})();
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
			const copyPath = async () => {
				if (summary.path === void 0) return;
				try {
					await navigator.clipboard?.writeText(summary.path);
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				} catch {}
			};
			const deleteBody = summary.shadowStub === true ? "将删除工作区内的屏蔽占位，同名全局 Skills 在本工作区恢复可用。" : isGlobal ? "将删除全局 Skills，所有工作区都将不再可用。此操作不可撤销。" : "将删除本工作区中的这份 Skills（含目录下的所有文件）。此操作不可撤销。";
			const sourceText = injected ? summary.channel !== void 0 && summary.channel.length > 0 ? summary.channel : originLabel(summary) : summary.source;
			const formatText = injected ? injectedOriginText(summary) : summary.format === "directory" ? "目录格式" : "单文件";
			const invocationNode = injected || summary.readOnly || summary.shadowStub === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
				"模型 ",
				summary.modelInvocable ? "✓" : "✗",
				" · 用户 ",
				summary.userInvocable ? "✓" : "✗"
			] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
			});
			/** v22：低频与破坏性动作收进 ⋯ 菜单（启停开关常驻标题行）。 */
			const menuItems = [];
			if (summary.path !== void 0) menuItems.push({
				key: "copy-path",
				label: copied ? "已复制路径" : "复制路径",
				onSelect: () => void copyPath()
			});
			if (!summary.readOnly && !injected) {
				if (hasWorkspace && isGlobal) menuItems.push({
					key: "import",
					label: confirmImport ? "确认覆盖工作区内的同名 Skills？" : "复制到本工作区",
					danger: confirmImport,
					title: confirmImport ? "工作区内已有同名 Skills，再次点击将覆盖为全局副本" : "复制到本工作区（.agents/skills），此后可在本工作区独立启停",
					onSelect: () => void doImport(confirmImport)
				});
				menuItems.push({
					key: "export",
					label: "导出",
					onSelect: () => void doExportDownload()
				});
				menuItems.push({
					key: "export-path",
					label: "导出到路径…",
					onSelect: () => setExportPathOpen(true)
				});
				menuItems.push({
					key: "delete",
					label: "删除",
					danger: true,
					title: deleteBody,
					onSelect: () => setDeleteOpen(true)
				});
			}
			const toggleTitle = injected || summary.readOnly ? "只读条目不可启停" : state === "partial" ? "部分禁用（模型 / 用户其一已关）：点击启用全部调用方向" : state === "full" ? isGlobal ? "全局默认在列表行尾设置；此处切换会同时影响所有工作区" : "点击禁用（用户与模型都不可调用）" : "点击启用（恢复用户与模型调用）";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailPage, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-detail-head-wrap",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTitleBar, {
							title: summary.name,
							tags: injected ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
									title: isGlobal ? "全局 Skills（对所有工作区生效）" : "仅存在于所选工作区的 Skills",
									children: isGlobal ? "全局" : "本项"
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
							right: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [!injected && !summary.readOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleSwitch, {
								checked: state !== "none",
								partial: state === "partial",
								disabled: busy || isGlobal && state === "full",
								label: state === "full" ? "已启用" : state === "none" ? "已禁用" : "部分禁用",
								title: toggleTitle,
								onChange: (next) => void doSetEnabled(next)
							}), menuItems.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MoreMenu, { items: menuItems })] })
						}),
						summary.shadowStub === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-badge skp-badge-inline",
							children: "屏蔽占位"
						}),
						isGlobal && summary.projectShadow === "stub" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-badge skp-badge-inline",
							children: "工作区默认关闭"
						}),
						isGlobal && summary.projectShadow === "skill" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-badge skp-badge-inline",
							children: "工作区副本生效中"
						}),
						summary.description.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-detail-desc",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "skp-detail-desc-text",
								title: summary.description,
								children: summary.description
							})
						}),
						injected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-detail-readonly",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-detail-readonly-icon",
								"aria-hidden": "true",
								children: "i"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: injectedReadonlyNote(summary) })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(DetailStrip, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeChain, {
								compact: true,
								scope,
								projectName,
								globalSeg: globalSegment,
								workspaceSeg: workspaceSegment,
								workspaces,
								onSelectWorkspace
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-strip-item",
								children: ["来源 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-strip-strong",
									children: sourceText
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-strip-item",
								children: formatText
							}),
							summary.path !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StripSeparator, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-link-btn skp-strip-item",
								title: summary.path,
								onClick: () => void copyPath(),
								children: copied ? "已复制路径" : "复制路径"
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-strip-right",
								children: [visibility !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityEditControl, {
									api: visibility.api,
									domain: "skills",
									capabilityKey: summary.name,
									name: summary.name,
									entry: visibility.entry,
									workspaces,
									globalOff: visibility.globalOff,
									onSaved: visibility.onSaved
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-strip-meta-btn",
									onClick: () => setMetaOpen((value) => !value),
									children: "元数据"
								})]
							})
						] })
					]
				}),
				metaOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
					wide: true,
					title: `元数据 · ${summary.name}`,
					onClose: () => setMetaOpen(false),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(MetaGrid, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "来源",
								children: sourceText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "格式",
								children: summary.format === "directory" ? "目录（多文件）" : "单文件"
							}),
							summary.path !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "路径",
								mono: true,
								title: summary.path,
								children: summary.path
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "调用方式",
								children: invocationNode
							}),
							summary.whenToUse !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetaCell, {
								label: "使用时机",
								title: summary.whenToUse,
								children: summary.whenToUse
							})
						] }),
						visibility !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
							className: "skp-detail-fields",
							style: { marginTop: 12 },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityDetailFields, {
								summaryOnly: true,
								api: visibility.api,
								domain: "skills",
								capabilityKey: summary.name,
								name: summary.name,
								entry: visibility.entry,
								workspaces,
								globalOff: visibility.globalOff,
								onSaved: visibility.onSaved
							})
						}),
						frontmatter !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillFrontmatterSection, { spec: frontmatter }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-modal-actions",
							children: [summary.path !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								onClick: () => void copyPath(),
								children: copied ? "已复制路径" : "复制路径"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								onClick: () => setMetaOpen(false),
								children: "关闭"
							})]
						})
					]
				}),
				opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-error",
					style: { margin: "8px 24px 0" },
					children: opError
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-detail-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillContent, {
						summary,
						api,
						refreshKey: contentVersion
					})
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
			] });
		}
		/**
		* Skills 列表单行（v21.3，`React.memo`）：列表 160+ 行时避免切作用域/选中/搜索
		* 引发全量重渲。props 全部为原始值或稳定引用（回调由父级 ref 包装成稳定函数）。
		*/
		const SkillListRow = (0, react.memo)(function SkillListRow({ item, selected, busy, scope, projectName, projects, visibilityEntry, globalOff, invisible, overrideState, hasDiskGlobal, switchDisabled, switchTitle, rowRefs, onSelect, onToggle, onKeyDown }) {
			const key = skillRowKey(item);
			const isProject = isProjectSource(item.source);
			const isInjected = item.injected === true;
			const state = invocationState(item);
			/** 只有「全局视图里的全局条目」编辑可见性；项目自己的条目不参与。 */
			const visibilityEditable = scope === "global" && !isProject;
			const mode = item.visibilityMode ?? visibilityModeOf(visibilityEntry);
			const visibleCount = item.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects);
			const checked = scope === "global" ? globalDefaultEnabledOf(item) : isProject ? item.shadowStub === true ? false : item.modelInvocable && item.userInvocable : effectiveDefaultEnabledOf(item);
			const tags = skillTags(item, hasDiskGlobal);
			const dotClass = isInjected ? checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow" : item.shadowStub === true || item.readOnly ? "skp-dot skp-dot-hollow" : state === "full" ? "skp-dot skp-dot-enabled" : state === "partial" ? "skp-dot skp-dot-partial" : "skp-dot";
			const dotText = isInjected ? checked ? "已启用" : "默认关闭" : item.shadowStub === true ? "屏蔽占位" : item.readOnly ? "只读" : state === "full" ? "已启用" : state === "partial" ? "部分禁用" : "已禁用";
			/** 项目自己的技能没有「全局默认」可言：不显示「跟随全局/已覆盖」文案。 */
			const switchLabel = isProject ? "" : `默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "option",
				"aria-selected": selected,
				tabIndex: selected ? 0 : -1,
				className: selected ? "skp-row skp-row-active" : "skp-row",
				ref: (element) => {
					if (element === null) rowRefs.current.delete(key);
					else rowRefs.current.set(key, element);
				},
				onClick: () => onSelect(key),
				onKeyDown: (event) => onKeyDown(event, key),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-row-name",
						children: [(isProject || isInjected || scope === "workspace") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-row-tags",
							children: [
								tags.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: tag.className,
									title: tag.title,
									children: tag.label
								}, tag.key)),
								visibilityEditable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisibilityRowMeta, {
									entry: visibilityEntry,
									workspaces: projects,
									globalOff,
									mode,
									count: visibleCount,
									invisible
								}),
								overrideState !== "inherit" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-warn",
									title: overrideState === "on" ? "本工作区显式打开该能力（覆盖全局的每工作区默认）；点行尾开关可关闭" : "本工作区显式关闭该能力（覆盖全局的每工作区默认）；点行尾开关可打开",
									children: "已覆盖"
								})
							]
						}), scope === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "skp-row-toggle",
							title: switchTitle,
							onClick: (event) => event.stopPropagation(),
							onKeyDown: (event) => event.stopPropagation(),
							children: [switchLabel.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-row-default-label",
								children: switchLabel
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-switch",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									role: "switch",
									"aria-label": `启用 ${item.name}`,
									checked,
									disabled: switchDisabled || busy,
									onChange: (event) => onToggle(item, event.target.checked)
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
		});
		/** 安装对话框的来源模式与 Tab 文案。 */
		const INSTALL_MODE = {
			upload: "上传",
			path: "宿主路径",
			url: "URL"
		};
		/**
		* 安装对话框（v20.1）：**固定落点**，不再二次选择类型 / 作用域。
		*
		* 类型与落点由「当前 Tab × 当前作用域」决定（Skills + 全局 / Skills + 某工作区），
		* 因此顶部固定一张「落点」卡：作用域徽章 + 写入路径 + 「仅此作用域生效 ·
		* 与当前对话无关」，并提示换落点要先切换顶部作用域。弹窗内只填内容：
		* 上传（.md / 文件夹 / .zip）、宿主路径、URL 三种来源，校验 `SKILL.md`。
		*/
		function InstallDialog({ api, scope, workspace, projectName, onClose, onInstalled }) {
			const [mode, setMode] = (0, react.useState)("upload");
			const [overwrite, setOverwrite] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [errors, setErrors] = (0, react.useState)([]);
			const [sourcePath, setSourcePath] = (0, react.useState)("");
			const [url, setUrl] = (0, react.useState)("");
			const [picked, setPicked] = (0, react.useState)(void 0);
			const fileInputRef = (0, react.useRef)(null);
			const dirInputRef = (0, react.useRef)(null);
			const zipInputRef = (0, react.useRef)(null);
			const isGlobal = scope === "global";
			const title = isGlobal ? "添加 Skill 到全局" : `添加 Skill 到工作区 ${projectName ?? "工作区"}`;
			const targetPath = isGlobal ? "~/.agents/skills/" : `${workspace ?? "<工作区>"}/.agents/skills/`;
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
				const writableScope = isGlobal ? "global" : "project";
				const target = isGlobal ? void 0 : ".agents";
				try {
					const result = mode === "upload" ? await api.installUpload({
						scope: writableScope,
						target,
						files: picked?.files ?? [],
						overwrite
					}) : mode === "path" ? await api.installFromPath({
						scope: writableScope,
						target,
						sourcePath: sourcePath.trim(),
						overwrite
					}) : await api.installFromUrl({
						scope: writableScope,
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
				title,
				onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-form",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-landing",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "skp-landing-head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-landing-icon",
										"aria-hidden": "true",
										children: "⌖"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-field-label",
										children: "落点"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project",
										children: isGlobal ? "全局" : `工作区 ${projectName ?? "工作区"}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-landing-note",
										children: "仅此作用域生效 · 与当前对话无关"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-detail-head-spacer" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "skp-landing-hint",
										children: "要换落点？先切换顶部作用域"
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: "skp-landing-path",
								title: targetPath,
								children: targetPath
							})]
						}),
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
.skp-row-default-label{font-size:11px;color:var(--skp-text-3);white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;}
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
.skp-note-warn{color:var(--skp-warn);}
.skp-modal-overlay{position:fixed;z-index:95;inset:0;background:var(--skp-mask);display:grid;place-items:center;}
.skp-modal{width:520px;max-width:92vw;max-height:84vh;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:22px;border:1px solid var(--skp-border);border-radius:14px;background:var(--skp-surface);box-shadow:0 24px 64px rgba(15,20,30,.22),0 4px 16px rgba(15,20,30,.1);scrollbar-width:thin;}
.skp-modal h3{margin:0;font-size:16px;font-weight:600;color:var(--skp-text);}
.skp-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px;}
/* v21：固定头 / 内容滚动 / 固定底栏（底部按钮不随内容滚动；可见性弹层用）。 */
.skp-modal-wide{width:760px;max-width:94vw;}
.skp-modal .skp-meta-grid{gap:14px 24px;}
.skp-modal .skp-frontmatter{margin:0;}
.skp-modal .skp-detail-fields{margin:0;}
.skp-modal-fixed{overflow:hidden;gap:12px;}
.skp-modal-fixed>h3{flex:none;}
.skp-modal-header{flex:none;display:flex;flex-direction:column;gap:10px;min-width:0;}
.skp-modal-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px;padding-bottom:4px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
/* 滚动区里的表格/说明不得被 flex 压缩（否则长列表会被压扁而不是出现滚动条）。 */
.skp-modal-scroll>.skp-vis-table,.skp-modal-scroll>.skp-note,.skp-modal-scroll>.skp-error{flex:none;}
.skp-modal-footer{flex:none;display:flex;justify-content:flex-end;gap:10px;padding-top:12px;border-top:1px solid var(--skp-border);background:var(--skp-surface);}
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
.skp-dock-title-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-state-business-primary,#4176e6);}
/* 首屏入口：挂在首屏行（conversation.hero.options）右端，与 workspace chip /「标准模式」同族。
   v18 起改为行内 ghost 组：无外底 / 无边框 / 无分隔线，24px 高（首屏行维持 26px）。
   与邻居共用 token：hover = --dsw-alias-interactive-bg-hover；数字 label-secondary；
   图标 label-tertiary；焦点环 state-business-primary。 */
/* 派生继承（spawn-time snapshot）：首屏与能力页共用的下拉 */
.skp-derive{position:relative;display:inline-flex;align-items:center;flex:none;min-width:0;}
.skp-derive-trigger{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,color .12s ease;}
.skp-derive-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-derive-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4176e6);}
.skp-derive-trigger:disabled{opacity:.55;cursor:default;}
.skp-derive-value{overflow:hidden;text-overflow:ellipsis;}
.skp-derive-chevron{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary,#8b95a1);transition:transform .12s ease;}
.skp-derive-trigger[aria-expanded="true"] .skp-derive-chevron{transform:rotate(180deg);}
.skp-derive-pop{position:fixed;z-index:320;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 16px 40px rgba(15,20,30,.18);}
.skp-derive-opt{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;text-align:left;cursor:pointer;}
.skp-derive-opt:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-derive-opt-active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 8%,transparent);}
.skp-derive-opt-main{display:flex;flex-direction:column;gap:2px;min-width:0;}
.skp-derive-opt-title{font-size:12.5px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-derive-opt-desc{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-derive-check{margin-left:auto;flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-state-business-primary,#4176e6);}
.skp-derive-rail{margin-left:auto;}
.skp-derive-rail .skp-derive-trigger{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));border-radius:6px;font-size:11px;}
.skp-derive-static{display:inline-flex;align-items:center;height:24px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);white-space:nowrap;}
.skp-derive-static-hero{padding:0 4px;}
.skp-derive-rail-static{margin-left:auto;font-size:11px;}
.skp-derive-banner{flex:none;display:flex;align-items:center;gap:8px;margin:8px 10px 0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 22%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 7%,transparent);}
.skp-derive-banner-title{flex:none;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-derive-banner-desc{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-entry-host{display:inline-flex;flex:none;align-items:center;height:24px;min-width:0;max-width:100%;}
.skp-dock-entry{display:inline-flex;flex:none;align-items:center;gap:2px;height:24px;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:12px/18px var(--dsw-font-family,system-ui,sans-serif);}
.skp-dock-entry-item{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 6px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;transition:background-color .12s ease,color .12s ease;}
.skp-dock-entry-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-dock-entry-item:focus-visible,.skp-dock-entry-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-entry-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-entry-item:hover .skp-dock-entry-icon{color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-dock-entry-count{flex:none;font-size:12px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-dock-entry-item:hover .skp-dock-entry-count{color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-dock-entry-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);cursor:pointer;transition:background-color .12s ease,color .12s ease,opacity .12s ease;}
.skp-dock-entry-btn:hover:not([aria-disabled="true"]){background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.06));color:var(--dsw-alias-label-primary,#1b1f26);}
.skp-dock-entry-btn[aria-disabled="true"]{opacity:.4;cursor:default;}
.skp-dock-entry-decision{position:relative;color:var(--dsw-alias-label-secondary,#5b6472);}
.skp-dock-entry-decision svg{display:block;}
.skp-dock-entry-guide-dot{position:absolute;top:3px;right:3px;width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4176e6);}
/* 配置弹窗：背景模糊 + 居中大弹层（替代旧的下拉展开） */
.skp-dock-modal-backdrop{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.55));-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}
.skp-dock-modal{display:flex;flex-direction:column;width:min(1120px,100%);max-height:min(84vh,760px);min-height:0;}
.skp-dock-panel.skp-dock-panel-modal{width:100%;max-height:min(84vh,760px);min-height:0;padding:20px 24px;gap:10px;border-radius:18px;box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(15,20,30,.16));}
.skp-dock-panel-modal .skp-dock-head{min-height:32px;}
.skp-dock-panel-modal .skp-dock-title{font-size:17px;}
.skp-dock-panel-modal .skp-dock-subtitle{font-size:11.5px;}
.skp-dock-panel-modal .skp-dock-tabs{padding:3px;border-radius:9px;}
.skp-dock-panel-modal .skp-dock-tab{height:24px;padding:0 10px;border-radius:7px;font-size:12px;}
.skp-dock-panel-modal .skp-dock-grid{max-height:min(58vh,540px);grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.skp-dock-panel-modal .skp-dock-foot{margin-top:2px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(20,28,40,.08));}
.skp-dock-modal-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:15px;cursor:pointer;}
.skp-dock-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-dock-modal-close:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#4176e6);}
.skp-dock-spacer{flex:1 1 auto;min-width:0;}
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
/* v24：开启 / 未开启的对比要能一眼分辨——开启=蓝边 + 浅蓝底 + 左侧竖条；
   未开启=整卡压暗、标题降级为 secondary、底部状态标签「未启用」。 */
.skp-dock-card-on{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 58%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 13%,transparent);box-shadow:inset 2px 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 78%,transparent);}
.skp-dock-card-on:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);}
.skp-dock-card-off{opacity:.55;}
.skp-dock-card-off:hover{opacity:.85;}
.skp-dock-card-off .skp-dock-card-name{color:var(--dsw-alias-label-tertiary,#8b95a1);font-weight:500;}
.skp-dock-card-off .skp-dock-card-desc{color:var(--dsw-alias-label-tertiary,#8b95a1);}
.skp-dock-card-state{flex:none;font-size:9px;font-weight:600;letter-spacing:.02em;padding:1px 6px;border-radius:999px;}
.skp-dock-card-on .skp-dock-card-state{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);}
.skp-dock-card-off .skp-dock-card-state{color:var(--dsw-alias-label-tertiary,#8b95a1);background:var(--dsw-alias-bg-module-platform,rgba(20,28,40,.05));}
.skp-dock-card-disabled{cursor:default;}
.skp-dock-card-disabled.skp-dock-card-off{opacity:.5;}
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
/* task-32：Tools 归属仍在解析时的轻量提示（首屏 Tools Tab；transient，不阻塞开关）。 */
.skp-dock-grid-note{grid-column:1/-1;display:flex;align-items:center;min-height:18px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
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
.skp-row-default-label{font-size:11px;color:var(--skp-text-3);white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;}
.skp-row-desc{font-size:12.5px;line-height:18px;color:var(--skp-text-3);}
button.skp-tag{border:0;appearance:none;cursor:pointer;font-family:inherit;line-height:19px;}
button.skp-tag:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-accent-soft);}
.skp-tag-relation{color:var(--skp-accent);background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--skp-accent) 45%,transparent);}
.skp-tag-relation:hover{background:var(--skp-accent-soft);}
.skp-dot-hollow{background:transparent;box-shadow:inset 0 0 0 1.5px var(--skp-text-3);}
.skp-dot{margin-right:6px;}
/* v21 滚动修复：详情栏自身纵向滚动（长详情不再被裁掉）；横向不滚、保留 padding。
   Skills 内容区仍保留文件树/阅读器的内部滚动，这里只兜底「详情整体超出」的情况。 */
.skp-detail-fixed{display:flex;padding:20px 24px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
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
.skp-md-table-wrap{margin:0 0 12px;overflow-x:auto;scrollbar-width:thin;}
.skp-md-table{width:100%;border-collapse:collapse;font-size:11.5px;line-height:1.55;}
.skp-md-table th,.skp-md-table td{border:1px solid var(--skp-border);padding:5px 8px;vertical-align:top;text-align:left;}
.skp-md-table th{background:var(--skp-fill);font-weight:600;color:var(--skp-text);white-space:nowrap;}
.skp-md-table td{color:var(--skp-text-2);}
.skp-md-table tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--skp-fill) 55%,transparent);}
.skp-md-table .skp-md-inline-code{white-space:nowrap;}
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
/* v13 修复：Skills「全局」作用域的启停范围说明（避免误读成全局关闭）。 */
.skp-pane-note{flex:none;padding:0 6px 6px;font-size:11px;line-height:15px;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* v21.3：已有列表数据时的轻量刷新提示（不遮挡列表，替代整屏「加载中…」）。 */
.skp-refresh-note{flex:none;font-size:11px;line-height:15px;color:var(--skp-text-3);white-space:nowrap;}
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
@container (max-width:720px){.skp-decision-row{grid-template-columns:18px 34px minmax(0,1fr) 72px 44px;grid-template-areas:"check kind name name score" "check kind desc desc bar";row-gap:2px;min-height:56px;}.skp-decision-check{grid-area:check;}.skp-decision-kind{grid-area:kind;}.skp-decision-name{grid-area:name;}.skp-decision-desc-cell{grid-area:desc;}.skp-decision-bar{grid-area:bar;align-self:center;}.skp-decision-score{grid-area:score;align-self:start;}.skp-decision-threshold{flex-wrap:wrap;row-gap:4px;}.skp-decision-count{flex:1 1 100%;margin-left:0;text-align:right;}}
@container (max-width:720px){.skp-decision-name-cell{grid-area:name;}.skp-decision-src{max-width:64px;}}
@container (max-width:560px){.skp-decision-desc{display:none;}.skp-decision-foot{flex-wrap:wrap;}.skp-decision-btn{flex:1 1 auto;}.skp-decision-btn-primary{flex:1 1 100%;order:3;min-width:0;}.skp-decision-badge-auto{display:none;}}

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
/* v13 修复：首屏 Tools 卡片「本会话覆盖」小标签（蓝底，区别于插件紫 / 未识别琥珀）。 */
.skp-dock-tag-override{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);}
.skp-dock-tag-count{flex:none;padding:0 5px;border-radius:4px;font-size:9.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b95a1);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 8%,transparent);}
/* 决策结果行：Tools 行（插件）标签 / N 个工具 / 底部说明。 */
.skp-decision-kind-tool{color:#a78bfa;background:color-mix(in srgb,#8b5cf6 18%,transparent);}
.skp-decision-toolcount{flex:none;padding:0 5px;border-radius:4px;font-size:9.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8b95a1);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b1f26) 8%,transparent);white-space:nowrap;}
.skp-decision-note{flex:none;margin:0;font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b95a1);}
/* v13 R3：能力面板 · Tools 页（两栏；无左导航）。 */
.skp-tools-body{overflow:hidden;}
.skp-tools-pane{width:420px;}
.skp-pane-title-note{min-width:0;margin-left:auto;font-size:11px;font-weight:400;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* v13 修复：Tools 详情（插件详情 + 20+ 工具手风琴）要能独立纵向滚动到底。
   只作用在 .skp-tools-body 里，Skills 详情仍靠内部文件树/阅读器自滚，不受影响。 */
.skp-tools-body .skp-detail-fixed{display:block;overflow-y:auto;overflow-x:hidden;}
.skp-tools-body .skp-detail-fixed .skp-detail-card{min-height:0;}
/* 手风琴交给详情外层滚动（避免详情内部再出现第二根滚动条）。 */
.skp-tools-body .skp-tool-accordion{max-height:none;overflow:visible;}
/* 工具展开后的原始 JSON（默认收起；pre 自身横向滚动）。 */
.skp-tools-raw{display:flex;flex-direction:column;gap:6px;min-width:0;margin-top:4px;}
.skp-tools-raw-json{margin:0;padding:8px 10px;border-radius:6px;background:var(--skp-fill);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;line-height:1.55;color:var(--skp-text-2);white-space:pre;overflow-x:auto;max-height:240px;overflow-y:auto;scrollbar-width:thin;}
/* v13 R5：Jev 配置页副标题第二行 + API Key ⓘ（安全承诺收进 tooltip）。 */
.skp-jev-subtitle-sub{font-size:11.5px;color:var(--skp-text-3);}
.skp-jev-label-row{display:flex;align-items:center;gap:6px;min-width:0;}
.skp-jev-info{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--skp-text-3);font:inherit;font-size:12px;line-height:1;cursor:help;}
.skp-jev-info:hover{color:var(--skp-text-2);}
.skp-jev-info:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-jev-key-safety{font-size:11.5px;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
@container (max-width:1100px){.skp-tools-pane{width:340px;}}
@container (max-width:900px){.skp-tools-pane{width:280px;}}

/* v20.1 能力中心：头部作用域分段（全局 / 工作区 ▾）——面板唯一的作用域入口。 */
.skp-scope-badge{flex:none;padding:0 8px;border-radius:6px;background:var(--skp-accent-soft);color:var(--skp-accent);font-size:11px;font-weight:600;line-height:20px;}
.skp-scope-seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:var(--skp-radius-sm);background:var(--skp-fill);}
.skp-scope-seg-btn{height:28px;padding:0 14px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:12.5px;font-weight:500;color:var(--skp-text-3);cursor:pointer;white-space:nowrap;transition:color .15s var(--skp-ease),background-color .15s var(--skp-ease);}
.skp-scope-seg-btn:hover:not(:disabled){color:var(--skp-text);}
.skp-scope-seg-btn-active,.skp-scope-seg-btn-active:hover{background:var(--skp-surface);color:var(--skp-text);box-shadow:0 1px 2px rgba(20,28,40,.08),0 0 0 1px var(--skp-border);}
.skp-scope-seg-btn:disabled{opacity:.45;cursor:default;}
.skp-scope-seg-select .skp-dd-btn{height:28px;padding:0 26px 0 12px;border-color:transparent;background-color:transparent;background-position:right 8px center;font-size:12.5px;font-weight:500;color:var(--skp-text);box-shadow:none;}
.skp-scope-seg-select .skp-dd-btn:hover:not(:disabled){border-color:transparent;background-color:var(--skp-hover);}
.skp-scope-seg-select .skp-dd-btn:disabled{background-color:transparent;}
.skp-tab-sep{flex:none;width:1px;height:18px;margin:0 6px;background:var(--skp-border-strong);}
/* 列表标题栏：类型 + 作用域 + 计数 + 作用域提示 + 内联添加入口。 */
.skp-list-pane{flex:none;width:380px;display:flex;flex-direction:column;min-height:0;min-width:0;padding:8px;overflow:hidden;border-right:1px solid var(--skp-border);}
.skp-list-head{flex:none;display:flex;align-items:center;gap:8px;min-height:40px;padding:0 2px;min-width:0;overflow:hidden;}
.skp-list-title{flex:1 1 auto;display:flex;align-items:center;min-width:0;font-size:14px;font-weight:600;color:var(--skp-text);white-space:nowrap;overflow:hidden;}
.skp-list-title-scope{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-list-title-type{flex:none;white-space:nowrap;}
.skp-list-head .skp-detail-head-spacer{display:none;}
.skp-list-note{flex:0 1 auto;min-width:0;font-size:11px;color:var(--skp-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.skp-list-add{flex:none;height:28px;padding:0 12px;font-size:12px;white-space:nowrap;}
.skp-group-scroll-plain{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 2px 4px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent;}
/* 两段作用域链（全局 → 工作区）：详情首屏回答「为什么是现在这个状态」。 */
.skp-scope-chain{flex:none;display:flex;align-items:stretch;gap:8px;margin:0 0 12px;min-width:0;}
.skp-scope-chain-seg{flex:1 1 0;display:flex;flex-direction:column;gap:3px;min-width:0;padding:10px 12px;border:1px solid var(--skp-border);border-radius:var(--skp-radius);background:var(--skp-fill);text-align:left;}
.skp-scope-chain-head{display:flex;align-items:center;gap:6px;min-width:0;}
.skp-scope-chain-head .skp-dot{margin-right:0;}
.skp-scope-chain-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:600;letter-spacing:.04em;color:var(--skp-text-3);}
.skp-scope-chain-title{font-size:13px;font-weight:600;color:var(--skp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-scope-chain-note{font-size:11px;line-height:15px;color:var(--skp-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-scope-chain-arrow{flex:none;align-self:center;font-size:13px;color:var(--skp-text-3);}
.skp-scope-chain-action{border-style:dashed;background:transparent;cursor:pointer;font:inherit;color:inherit;}
.skp-scope-chain-action:hover{border-color:var(--skp-accent);background:var(--skp-accent-soft);}
.skp-scope-chain-action:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-accent-soft);}
/* 全局视图第二段：先选工作区，再切换（fixed 弹出层复用 .skp-dd-pop） */
.skp-scope-chain-pop{padding:6px;overscroll-behavior:contain;}
.skp-scope-chain-pop-head{padding:6px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--skp-text-3);}
.skp-scope-chain-pop-empty{padding:14px 10px;font-size:12px;color:var(--skp-text-3);text-align:left;}
.skp-scope-chain-pop .skp-dd-opt{width:100%;}
/* 固定落点卡（添加 Skill / 添加 MCP 弹窗顶部）：作用域 + 写入路径 + 与当前对话无关。 */
.skp-landing{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--skp-border);border-radius:var(--skp-radius);background:var(--skp-fill);min-width:0;}
.skp-landing-head{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;}
.skp-landing-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--skp-accent-soft);color:var(--skp-accent);font-size:10px;}
.skp-landing-note{flex:none;font-size:11.5px;color:var(--skp-text-3);white-space:nowrap;}
.skp-landing-hint{flex:none;font-size:11px;color:var(--skp-text-3);white-space:nowrap;}
.skp-landing-path{display:block;padding:6px 8px;border-radius:6px;background:var(--skp-surface);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;color:var(--skp-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@container (max-width:1050px){.skp-list-pane{width:340px;}}
@container (max-width:900px){.skp-list-pane{width:300px;}}

/* v21 可见性（全局行标签 / 详情分段 / 可见范围弹层；优先复用既有 token） */
.skp-vis-summary{flex:none;font-size:11px;color:var(--skp-text-3);white-space:nowrap;}
/* v21 UX 修订：详情只保留一行「可见范围」摘要 + 编辑按钮（不再内联分段/长表格）。 */
.skp-vis-detail-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 4px;}
.skp-vis-detail-summary{min-width:0;flex:1 1 auto;font-size:12.5px;line-height:1.6;color:var(--skp-text-2);word-break:break-word;}
.skp-vis-detail-head .skp-btn{flex:none;}
.skp-vis-modal-note{font-size:12.5px;line-height:1.6;color:var(--skp-text-3);}
.skp-vis-table{display:flex;flex-direction:column;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);overflow:hidden;}
.skp-vis-table-head,.skp-vis-table-row{display:grid;grid-template-columns:minmax(0,1fr) 120px 150px;align-items:center;gap:8px;padding:8px 10px;}
.skp-vis-table-head{position:sticky;top:0;z-index:1;background:var(--skp-fill);font-size:11.5px;color:var(--skp-text-3);}
.skp-vis-table-row+.skp-vis-table-row{border-top:1px solid var(--skp-border);}
.skp-vis-check{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--skp-text-2);cursor:pointer;}
/* v21.1：表头批量切换（可见列全选/全不选、默认列全部默认开/关） */
.skp-vis-col-head{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;}
.skp-vis-batch{border:0;background:none;padding:0;font:inherit;font-size:11px;color:var(--skp-accent);cursor:pointer;white-space:nowrap;}
.skp-vis-batch:hover:not(:disabled){text-decoration:underline;}
.skp-vis-batch:disabled{opacity:.45;cursor:default;text-decoration:none;}
/* v21.1：冲突二级确认框的工作区列表（列表可滚，交给 modal 滚动区） */
.skp-vis-conflict-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;}
.skp-vis-conflict-row{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 8px;border:1px solid var(--skp-border);border-radius:var(--skp-radius-sm);background:var(--skp-fill);font-size:12.5px;color:var(--skp-text-2);}
.skp-vis-conflict-root{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--skp-text-3);}
.skp-vis-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4176e6);cursor:pointer;}
.skp-vis-default-toggle{margin-left:0;}
/* v21.2：可见性 / 每工作区默认的生效范围说明（新建对话生效；已有对话保持原状）。 */
.skp-vis-tip{flex:none;font-size:11.5px;line-height:1.6;color:var(--skp-text-3);word-break:break-word;}
/* v21.2 Skills 详情：Frontmatter / 触发规则区块（只读，来自 skills.read 的 spec）。 */
.skp-frontmatter{flex:none;display:flex;flex-direction:column;gap:8px;margin:2px 0 10px;padding:10px 12px;border:1px solid var(--skp-border);border-radius:var(--skp-radius);background:var(--skp-fill);min-width:0;}
.skp-frontmatter .skp-detail-inspect-head{margin:0;}
.skp-frontmatter-fields{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 12px;align-items:start;font-size:12.5px;}
.skp-frontmatter-fields dt{color:var(--skp-text-3);font-weight:600;white-space:nowrap;}
.skp-frontmatter-fields dd{margin:0;min-width:0;color:var(--skp-text-2);word-break:break-word;}
.skp-frontmatter-fields dd code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;}
.skp-frontmatter-meta{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;min-width:0;}
.skp-frontmatter-meta-row{display:flex;gap:8px;min-width:0;}
.skp-frontmatter-key{flex:none;color:var(--skp-text-3);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;line-height:1.6;}
.skp-frontmatter-value{min-width:0;overflow-wrap:anywhere;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;line-height:1.6;color:var(--skp-text-2);}
.skp-frontmatter-raw{min-width:0;}
.skp-frontmatter-raw>summary{cursor:pointer;font-size:12px;color:var(--skp-accent);white-space:nowrap;}
.skp-frontmatter-yaml{margin:6px 0 0;padding:8px 10px;border:1px solid var(--skp-border);border-radius:6px;background:var(--skp-surface);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;line-height:1.55;color:var(--skp-text-2);white-space:pre;overflow:auto;max-height:220px;scrollbar-width:thin;}
.skp-test-tools{display:flex;flex-direction:column;gap:2px;min-width:0;}
.skp-test-tool-row{display:flex;align-items:center;gap:8px;min-height:32px;padding:0 8px;border-radius:6px;min-width:0;}
.skp-test-tool-row:hover{background:var(--skp-hover);}
.skp-test-tool-row .skp-tool-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;}
/* v22 详情页（Skills / MCP 共用，见 detail-shell.tsx）：固定头部三段 + 内容区独立滚动。
   设计源：docs/figma/preview/v22-*（page Capability Panel · 详情页内容优先 v22 草案）。 */
.skp-detail-page{flex:1 1 auto;display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;overflow:hidden;font-size:14px;color:var(--skp-text-2);}
.skp-detail-flush{padding:0;overflow:hidden;}
.skp-badge-inline{align-self:flex-start;font-size:11px;padding:2px 10px;}
.skp-detail-head-wrap{flex:none;display:flex;flex-direction:column;gap:6px;padding:16px 24px 8px;border-bottom:1px solid var(--skp-border);min-width:0;}
.skp-detail-title-row{display:flex;align-items:center;gap:8px;min-width:0;min-height:30px;}
.skp-detail-title-row h3{flex:0 1 auto;min-width:0;margin:0;font-size:18px;font-weight:600;color:var(--skp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-detail-title-tags{display:inline-flex;align-items:center;gap:6px;flex:none;}
.skp-detail-title-row>.skp-badge{font-size:11px;padding:2px 10px;}
.skp-detail-strip{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;min-width:0;overflow:hidden;font-size:11.5px;color:var(--skp-text-3);}
.skp-detail-strip>*{flex:0 1 auto;min-width:0;}
.skp-detail-strip>.skp-strip-right{flex:none;margin-left:auto;}
.skp-detail-strip>.skp-scope-chain-compact{overflow:hidden;}
.skp-strip-strong{color:var(--skp-text-2);}
.skp-strip-sep{width:1px;height:12px;background:var(--skp-border);margin:0 2px;}
.skp-strip-right{margin-left:auto;display:inline-flex;align-items:center;gap:10px;flex:none;}
.skp-strip-item{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-strip-ellipsis{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-strip-meta-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 10px;border:1px solid var(--skp-border);border-radius:999px;background:transparent;color:var(--skp-text-2);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap;}
.skp-strip-meta-btn:hover{background:var(--skp-hover);color:var(--skp-text);}
.skp-strip-meta-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-switch-wrap{display:inline-flex;align-items:center;gap:8px;flex:none;cursor:pointer;}
.skp-switch-label{font-size:11.5px;color:var(--skp-text-3);white-space:nowrap;}
.skp-switch{position:relative;display:inline-flex;align-items:center;width:36px;height:20px;border-radius:999px;background:var(--skp-fill);transition:background-color .18s var(--skp-ease);}
.skp-switch-on{background:var(--skp-accent);}
.skp-switch-partial{background:color-mix(in srgb,var(--skp-accent) 55%,var(--skp-fill));}
.skp-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;}
.skp-switch input:disabled{cursor:default;}
.skp-switch:has(input:disabled){opacity:.5;}
.skp-switch-knob{position:absolute;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .18s var(--skp-ease);}
.skp-switch-on .skp-switch-knob,.skp-switch-partial .skp-switch-knob{transform:translateX(16px);}
.skp-more{position:relative;flex:none;}
.skp-more-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid var(--skp-border);border-radius:8px;background:transparent;color:var(--skp-text-2);font:inherit;font-size:14px;line-height:1;cursor:pointer;}
.skp-more-btn:hover{background:var(--skp-hover);color:var(--skp-text);}
.skp-more-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--skp-border-strong);}
.skp-more-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:130;min-width:200px;padding:5px;border:1px solid var(--skp-border);border-radius:10px;background:var(--skp-surface);box-shadow:0 12px 32px rgba(15,20,30,.18),0 2px 8px rgba(15,20,30,.08);}
.skp-more-item{display:block;width:100%;padding:8px 10px;border:0;border-radius:7px;background:none;color:var(--skp-text-2);font:inherit;font-size:13px;text-align:left;cursor:pointer;white-space:nowrap;}
.skp-more-item:hover:not(:disabled){background:var(--skp-hover);color:var(--skp-text);}
.skp-more-item:disabled{opacity:.45;cursor:default;}
.skp-more-item-danger{color:var(--skp-error);}
.skp-more-item-danger:hover:not(:disabled){background:color-mix(in srgb,var(--skp-error) 10%,transparent);color:var(--skp-error);}
.skp-meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 20px;min-width:0;}
.skp-meta-cell{display:flex;flex-direction:column;gap:3px;min-width:0;}
.skp-meta-label{font-size:10.5px;font-weight:600;letter-spacing:.04em;color:var(--skp-text-3);}
.skp-meta-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--skp-text-2);}
.skp-meta-mono{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px;}
.skp-meta-wide{grid-column:1 / -1;min-width:0;}
@media (max-width:1100px){.skp-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
/* 内容工具条 + 工具主从分栏（MCP v22 方案 B） */
.skp-detail-toolbar{flex:none;display:flex;align-items:center;gap:10px;min-width:0;padding:10px 24px;border-bottom:1px solid var(--skp-border);}
.skp-toolbar-title{flex:none;font-size:13px;font-weight:600;color:var(--skp-text);}
.skp-toolbar-stat{flex:none;min-width:0;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--skp-text-3);}
.skp-toolbar-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none;}
.skp-tools-search{width:180px;height:28px;padding:0 10px;border:1px solid var(--skp-border);border-radius:8px;background:var(--skp-surface);font:inherit;font-size:12px;color:var(--skp-text);outline:none;transition:border-color .15s var(--skp-ease),box-shadow .15s var(--skp-ease);}
.skp-tools-search::placeholder{color:var(--skp-text-3);}
.skp-tools-search:focus-visible{border-color:var(--skp-border-strong);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));}
.skp-tools-split{flex:1 1 auto;min-height:0;display:flex;gap:16px;padding:12px 24px 16px;min-width:0;}
.skp-tools-list{flex:none;width:262px;min-height:0;display:flex;flex-direction:column;gap:8px;min-width:0;}
.skp-tools-list-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;}
.skp-tool-row{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:0 10px;border:0;border-radius:8px;background:none;color:var(--skp-text-2);font:inherit;cursor:pointer;text-align:left;min-width:0;}
.skp-tool-row:hover{background:var(--skp-hover);color:var(--skp-text);}
.skp-tool-row:focus-visible{outline:none;box-shadow:inset 0 0 0 1px var(--skp-accent);}
.skp-tool-row-active,.skp-tool-row-active:hover{position:relative;background:var(--dsw-alias-interactive-bg-active,rgba(20,28,40,.08));color:var(--skp-text);}
.skp-tool-row-active::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--skp-accent);}
.skp-tool-row-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12.5px;}
.skp-tool-row-count{flex:none;font-size:10.5px;color:var(--skp-text-3);white-space:nowrap;}
.skp-tool-detail{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--skp-border);padding-left:16px;}
.skp-tool-detail-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:4px;scrollbar-width:thin;}
.skp-tool-detail-head{flex:none;display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}
.skp-tool-detail-name{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:14px;color:var(--skp-text);word-break:break-all;}
.skp-tool-detail-desc{font-size:12px;line-height:19px;color:var(--skp-text-3);}
.skp-tool-detail-note{font-size:11px;line-height:18px;color:var(--skp-text-3);margin-top:10px;}
/* Skills 内容区（文件树 + 阅读器）放在新详情页里：由外层给左右留白，内容区自身撑满高度。 */
.skp-detail-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:0 24px 16px;min-width:0;}
.skp-detail-body>.skp-skill-content{min-height:0;}
.skp-detail-loading{padding:24px;font-size:12.5px;color:var(--skp-text-3);}
/* 作用域链紧凑态（详情状态条内联）：单行摘要，工作区下拉交互保留。 */
.skp-scope-chain-compact{flex:none;display:inline-flex;flex-wrap:nowrap;align-items:center;gap:6px;margin:0;min-width:0;font-size:11.5px;color:var(--skp-text-3);}
.skp-scope-chain-compact .skp-scope-chain-seg{flex:0 0 auto;display:inline-flex;flex-direction:row;align-items:center;gap:5px;min-width:0;padding:0;border:0;background:none;font:inherit;color:inherit;text-align:left;}
.skp-scope-chain-compact .skp-scope-chain-head{display:inline-flex;align-items:center;gap:5px;min-width:0;}
.skp-scope-chain-compact .skp-scope-chain-label{min-width:auto;font-size:11.5px;font-weight:500;letter-spacing:0;color:var(--skp-text-3);white-space:nowrap;}
.skp-scope-chain-compact .skp-scope-chain-title{font-size:11.5px;font-weight:500;color:var(--skp-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}
.skp-scope-chain-compact .skp-scope-chain-note{display:none;}
.skp-scope-chain-compact .skp-scope-chain-arrow{font-size:11.5px;color:var(--skp-text-3);}
.skp-scope-chain-compact .skp-scope-chain-action{padding:0;border:0;background:none;cursor:pointer;}
.skp-scope-chain-compact .skp-scope-chain-action:hover .skp-scope-chain-title{color:var(--skp-text);}
.skp-scope-chain-compact .skp-dot{margin-right:0;}
.skp-link-btn:disabled{opacity:.45;cursor:default;text-decoration:none;}

/* ---------------------------------------------------------------------------
 * Prompt 域（v23）：首轮注入的指令文件
 * 复用列表/详情/开关的原语，只补「说明、编辑器、可见性行」三类。
 * ------------------------------------------------------------------------- */
.skp-prompt-note{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:8px;background:var(--skp-card,#1F242E);box-shadow:inset 0 0 0 1px var(--skp-line,#2A3140);font-size:11px;line-height:17px;color:var(--skp-text-3);}
.skp-prompt-note-title{font-size:11.5px;font-weight:600;color:var(--skp-text-2);}
.skp-prompt-editor-wrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px;}
.skp-prompt-editor{flex:1 1 auto;min-height:240px;width:100%;resize:none;box-sizing:border-box;padding:12px 14px;border-radius:10px;box-shadow:inset 0 0 0 1px var(--skp-line,#2E3645);background:var(--skp-card,#1F242E);color:var(--skp-text);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px;line-height:20px;outline:none;scrollbar-width:thin;}
.skp-prompt-editor:focus{box-shadow:inset 0 0 0 1px var(--skp-accent,#5B8CFF);}
.skp-prompt-editor-meta{display:flex;align-items:center;gap:10px;font-size:10.5px;color:var(--skp-text-3);}
.skp-prompt-editor-meta .skp-prompt-warn{color:var(--skp-warn,#FBBF24);}
.skp-prompt-vis-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:var(--skp-card,#1F242E);box-shadow:inset 0 0 0 1px var(--skp-line,#262D3A);}
.skp-prompt-vis-name{flex:1 1 auto;min-width:0;font-size:12px;color:var(--skp-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-prompt-vis-path{flex:1 1 auto;min-width:0;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:9.5px;color:var(--skp-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.skp-prompt-group-head{display:flex;align-items:center;gap:8px;margin:10px 0 6px;font-size:11px;font-weight:600;color:var(--skp-text-3);}
.skp-prompt-group-note{margin-left:auto;font-size:9.5px;font-weight:400;color:var(--skp-text-3);}
.skp-prompt-status{flex:none;margin-left:auto;font-size:9.5px;font-weight:600;padding:1px 6px;border-radius:999px;}
.skp-prompt-status-injected{color:var(--skp-success,#4ADE80);background:rgba(74,222,128,.14);}
.skp-prompt-status-disabled{color:var(--skp-text-3);background:rgba(148,163,184,.14);}
.skp-prompt-status-warn{color:var(--skp-warn,#FBBF24);background:rgba(251,191,36,.14);}
.skp-prompt-save-note{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:8px 12px;border-radius:8px;background:rgba(74,222,128,.12);box-shadow:inset 0 0 0 1px rgba(74,222,128,.28);font-size:11.5px;color:var(--skp-success,#4ADE80);}

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
		//#region src/client/prompt-tab.tsx
		/**
		* 会话能力弹层 / 会话「能力」Tab 的第 4 个域：Prompt（首轮注入的指令文件，v23）。
		*
		* 语义（与宿主 `src/prompt/*` 对齐）：
		*   - 候选 = 全局 `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md` + 项目根→cwd 每层的
		*     `AGENTS.md` / `CLAUDE.md`（含 `*.local.md`）；全局与项目**叠加注入**，不是覆盖；
		*   - 首屏（hero / modal）可编辑：卡片开关写**本会话首屏显式选择**
		*     `api.prompt.setSessionSelection({ selected })`；默认全选 = 未设置选择时
		*     `list().files[].enabled` 全为 true（与 DSH 原生一致）；
		*   - 会话内（view）只读：数据以 `list().frozen`（manifest）为唯一权威，
		*     只展示状态、不发任何开关请求；
		*   - Prompt **不参与** Jev 能力决策、不参与三域批量动作（`BULK_DOMAINS` 仍三域）。
		*
		* 为什么单独一个文件：`composer-capability.tsx` 已经 3k 行，Prompt 是独立域；
		* 这里只复用主文件已有的 `skp-dock-*` 样式原语（样式表 `styles.ts` 归他人维护，
		* 本批不改），因此开关/标签/图标在这里各自内联一份小实现（不跨文件循环依赖）。
		*
		* @module dsh-capability-settings/client/prompt-tab
		*/
		/** 指令文件：文档图标。 */
		function DocIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M4 2.5h5l3 3v8H4v-11z",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M9 2.5v3h3",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6 8.5h4M6 10.5h3",
						stroke: "currentColor",
						strokeWidth: "1.2",
						strokeLinecap: "round"
					})
				]
			});
		}
		/** 冻结：锁。 */
		function LockIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3.5",
					y: "7",
					width: "9",
					height: "6.5",
					rx: "1.4",
					stroke: "currentColor",
					strokeWidth: "1.2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinecap: "round"
				})]
			});
		}
		function errMessage(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** 两个 id 集合是否完全一致（顺序无关）。 */
		function sameStringSet(a, b) {
			if (a.length !== b.length) return false;
			const set = new Set(b);
			return a.every((item) => set.has(item));
		}
		/**
		* Prompt Tab 数据控制器：`list()` 每会话 API（adapter 自动注入 sessionId）。
		*
		* 写口径（二选一，见 `toggle` 注释）：**与默认启用集合一致时写 `null`**（清除
		* 显式选择、跟随默认层），否则写整份 `selected` 数组。
		*
		* @param api 面板 / 每会话 api（旧宿主可能缺 `prompt`，运行时降级提示）。
		* @param readOnly 只读页（mode="view"）；`true` 时额外读 `manifest` 兜底。
		*/
		function usePromptTabData(api, readOnly) {
			const [list, setList] = (0, react.useState)(void 0);
			const [frozen, setFrozen] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(void 0);
			const [pendingId, setPendingId] = (0, react.useState)(void 0);
			const [tick, setTick] = (0, react.useState)(0);
			const refresh = (0, react.useCallback)(() => setTick((value) => value + 1), []);
			(0, react.useEffect)(() => {
				if (api === void 0 || typeof api.prompt?.list !== "function") {
					setLoading(false);
					setError("Prompt 域不可用（宿主未提供 prompt API）");
					return;
				}
				let alive = true;
				setLoading(true);
				setError(void 0);
				(async () => {
					try {
						const next = await api.prompt.list();
						if (!alive) return;
						setList(next);
						let nextFrozen = next.frozen;
						if (nextFrozen === void 0 && readOnly && next.sessionId !== void 0) {
							nextFrozen = await api.prompt.manifest({ sessionId: next.sessionId });
							if (!alive) return;
						}
						setFrozen(nextFrozen);
						if (next.errors.length > 0) setError(next.errors.join("; "));
					} catch (err) {
						if (alive) setError(errMessage(err));
					} finally {
						if (alive) setLoading(false);
					}
				})();
				return () => {
					alive = false;
				};
			}, [
				api,
				readOnly,
				tick
			]);
			const toggle = (0, react.useCallback)((file) => {
				if (api === void 0 || list === void 0 || pendingId !== void 0) return;
				const files = list.files;
				const current = files.filter((candidate) => candidate.enabled).map((candidate) => candidate.id);
				const next = file.enabled ? current.filter((id) => id !== file.id) : [...current, file.id];
				const selected = sameStringSet(next, files.filter((candidate) => (candidate.visibility?.visible ?? true) && candidate.defaultEnabled).map((candidate) => candidate.id)) ? null : next;
				setPendingId(file.id);
				setError(void 0);
				(async () => {
					try {
						await api.prompt.setSessionSelection({ selected });
					} catch (err) {
						setError(errMessage(err));
					} finally {
						setPendingId(void 0);
						refresh();
					}
				})();
			}, [
				api,
				list,
				pendingId,
				refresh
			]);
			const files = list?.files ?? [];
			return {
				...list !== void 0 ? { list } : {},
				...frozen !== void 0 ? { frozen } : {},
				files,
				loading,
				...error !== void 0 ? { error } : {},
				...pendingId !== void 0 ? { pendingId } : {},
				enabledCount: files.filter((file) => file.enabled).length,
				injectedCount: frozen?.files.length ?? 0,
				fileCount: files.length,
				refresh,
				toggle
			};
		}
		function PromptTag({ label, tone, title }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `skp-dock-tag skp-dock-tag-${tone}`,
				title,
				children: label
			});
		}
		/** 与 composer-capability 的 DockSwitch 同款（行为：拦截冒泡，卡片不再重复触发）。 */
		function PromptSwitch({ checked, disabled, title, onChange }) {
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
		/** 事件目标是否落在开关上（键盘触发兜底，避免卡片重复写一次）。 */
		function isSwitchEventTarget$1(target) {
			const element = target;
			return typeof element?.closest === "function" && element.closest(".skp-dock-switch") !== null;
		}
		function scopeLabel(scope) {
			return scope === "project" ? "项目" : "全局";
		}
		function scopeTitle(scope) {
			return scope === "user-global" ? "用户全局（~/.dsh）" : scope === "agents-global" ? "Agent 全局（~/.agents）" : "项目（项目根 → 当前工作区目录）";
		}
		/** 首屏可编辑卡片的作用域 / 策略标签（与面板 `PromptState` 字典同口径）。 */
		function editableStatusTag(file) {
			if (file.state === "duplicate") return {
				label: "折叠",
				tone: "bundled",
				title: file.duplicateOf !== void 0 ? `与 ${file.duplicateOf} 内容重复，只注入一次` : "与同组文件内容重复，只注入一次"
			};
			if (file.state === "invisible") return {
				label: "不可见",
				tone: "external",
				title: "全局可见范围对本工作区关闭（会话页无法反开关）"
			};
			if (file.state === "too-large") return {
				label: "超 1 MiB",
				tone: "external",
				title: "单文件超过预算源上限，宿主会静默跳过"
			};
			if (file.state === "unreadable") return {
				label: "不可读",
				tone: "external",
				title: "文件读取失败"
			};
			if (file.sessionExplicit === false) return {
				label: "本会话关闭",
				tone: "preset",
				title: "本会话首屏显式关闭（不影响默认层）"
			};
			if (file.sessionExplicit === true) return {
				label: "本会话开启",
				tone: "global",
				title: "本会话首屏显式开启（不影响默认层）"
			};
			if (file.projectDefault === false) return {
				label: "项目关闭",
				tone: "preset",
				title: "项目级默认关闭：本项目的新会话默认不注入"
			};
			if (file.projectDefault === true) return {
				label: "项目默认开启",
				tone: "global",
				title: "项目级默认开启，覆盖全局默认"
			};
			if (file.enabled) return {
				label: "默认启用",
				tone: "global",
				title: "未做会话选择时跟随默认层启用"
			};
			return {
				label: "默认关闭",
				tone: "preset",
				title: "默认关闭"
			};
		}
		/** 只读页状态 pill：✓ 已注入 / 未注入 / 不注入（以冻结清单为权威）。 */
		function readonlyStatusPill(file, frozen) {
			const manifestFile = frozen === void 0 ? void 0 : frozen.files.find((candidate) => candidate.id === file.id) ?? frozen.files.find((candidate) => candidate.displayPath === file.displayPath);
			if (manifestFile !== void 0) return frozen?.truncated.some((item) => item.displayPath === file.displayPath) === true ? {
				label: "✓ 已注入",
				tone: "warn",
				title: `已注入（超出预算被截断）· 第 ${manifestFile.order} 位 · ${manifestFile.bytes} B`
			} : {
				label: "✓ 已注入",
				tone: "injected",
				title: `已进入本会话首轮上下文 · 第 ${manifestFile.order} 位 · ${manifestFile.bytes} B`
			};
			if (frozen?.omitted.some((item) => item.displayPath === file.displayPath) === true) return {
				label: "未注入",
				tone: "warn",
				title: "超出预算上限，本会话被整份省略"
			};
			if (file.enabled === false) return {
				label: "不注入",
				tone: "disabled",
				title: "默认关闭或全局可见性关闭，本会话不注入"
			};
			if (file.state === "duplicate") return {
				label: "未注入",
				tone: "disabled",
				title: "与同组文件内容重复，宿主自动合并、只注入一份"
			};
			if (file.state === "too-large") return {
				label: "未注入",
				tone: "disabled",
				title: "单文件超过预算源上限，宿主跳过"
			};
			if (file.state === "invisible") return {
				label: "不注入",
				tone: "disabled",
				title: "全局可见范围对本工作区关闭"
			};
			if (file.state === "unreadable") return {
				label: "未注入",
				tone: "disabled",
				title: "文件读取失败，宿主跳过"
			};
			return {
				label: "未注入",
				tone: "disabled",
				title: frozen === void 0 ? "本会话首轮尚未冻结（冻结后按实际注入结果显示）" : "未进入本会话注入清单"
			};
		}
		/** 只读冻结 banner：本会话首轮注入已固化，改文件 / 开关都不会影响本会话。 */
		function FreezeBanner({ frozen, onRefresh }) {
			const at = frozen === void 0 ? void 0 : new Date(frozen.at).toLocaleString("zh-CN", {
				hour12: false,
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-dock-rail",
				role: "note",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-dock-rail-count",
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LockIcon, {}), frozen !== void 0 ? "本会话首轮已注入并冻结" : "本会话首轮注入尚未冻结"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dock-foot-note",
						title: frozen !== void 0 ? "文件修改、面板编辑与开关都不会改变本会话的模型上下文；如需调整请新开会话（面板中的改动只对新会话生效）。" : "首轮开始后固化；本页只展示首轮注入结果，不能修改、不能开关。",
						children: frozen !== void 0 ? "文件修改、面板编辑与开关都不会改变本会话的模型上下文；如需调整请新开会话。" : "首轮开始后固化，本页只读。"
					}),
					at !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-dock-rail-note",
						children: at
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-dock-link",
						onClick: onRefresh,
						children: "刷新"
					})
				]
			});
		}
		/** 宿主渲染管线不可用时的轻量降级提示（开关不生效，注入仍走宿主默认）。 */
		function EngineDegraded() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-dock-rail",
				role: "note",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-dock-rail-count",
					style: { color: "var(--dsw-alias-state-warn-primary,#f59e0b)" },
					children: "宿主渲染管线不可用"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "skp-dock-foot-note",
					children: "开关键类暂不生效，首轮仍按宿主默认注入；如需完整控制请到能力面板查看。"
				})]
			});
		}
		/** 首屏可编辑卡片：标题行右端开关；开关后整份写本会话选择。 */
		function EditablePromptCard({ file, busy, onToggle }) {
			const duplicate = file.state === "duplicate";
			const toggleable = !duplicate && file.state !== "invisible" && file.state !== "too-large" && file.state !== "unreadable";
			const status = editableStatusTag(file);
			const switchTitle = file.enabled ? `关闭：本会话首轮不注入 ${file.name}（不落盘、不改默认）` : `开启：本会话首轮注入 ${file.name}（不改默认）`;
			const cardState = duplicate ? "" : file.enabled ? " skp-dock-card-on" : " skp-dock-card-off";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `skp-dock-card${cardState}${toggleable ? "" : " skp-dock-card-disabled"}`,
				role: toggleable ? "button" : void 0,
				tabIndex: toggleable ? 0 : void 0,
				"aria-pressed": toggleable && !duplicate ? file.enabled : void 0,
				title: toggleable ? switchTitle : file.path,
				onClick: (event) => {
					if (isSwitchEventTarget$1(event.target)) return;
					if (toggleable && !busy) onToggle();
				},
				onKeyDown: (event) => {
					if (isSwitchEventTarget$1(event.target)) return;
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						if (toggleable && !busy) onToggle();
					}
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-icon",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-name",
								title: file.path,
								children: file.name
							}),
							duplicate ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-tag skp-dock-tag-bundled",
								title: "与同组文件内容重复，由宿主自动合并、只注入一份",
								children: "自动合并"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptSwitch, {
								checked: file.enabled,
								disabled: !toggleable || busy,
								title: switchTitle,
								onChange: onToggle
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "skp-dock-card-desc",
						title: file.path,
						children: file.displayPath
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptTag, {
								label: scopeLabel(file.scope),
								tone: file.scope === "project" ? "project" : "global",
								title: scopeTitle(file.scope)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptTag, {
								label: status.label,
								tone: status.tone,
								title: status.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-meta",
								children: formatSize(file.size)
							})
						]
					})
				]
			});
		}
		/** 会话内只读卡片：标题行右端换成状态 pill，无开关、无点击写操作。 */
		function ReadonlyPromptCard({ file, frozen }) {
			const pill = readonlyStatusPill(file, frozen);
			const manifestFile = frozen === void 0 ? void 0 : frozen.files.find((candidate) => candidate.id === file.id) ?? frozen.files.find((candidate) => candidate.displayPath === file.displayPath);
			const status = editableStatusTag(file);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `skp-dock-card${manifestFile !== void 0 ? " skp-dock-card-on" : " skp-dock-card-off"} skp-dock-card-disabled`,
				title: file.path,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-icon",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocIcon, {})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-name",
								title: file.path,
								children: file.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `skp-prompt-status skp-prompt-status-${pill.tone}`,
								title: pill.title,
								children: pill.label
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "skp-dock-card-desc",
						title: file.path,
						children: file.displayPath
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptTag, {
								label: scopeLabel(file.scope),
								tone: file.scope === "project" ? "project" : "global",
								title: scopeTitle(file.scope)
							}),
							manifestFile !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptTag, {
								label: `第 ${manifestFile.order} 位`,
								tone: "preset",
								title: "宿主首轮注入顺序"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptTag, {
								label: status.label,
								tone: status.tone,
								title: status.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-meta",
								children: formatSize(file.size)
							})
						]
					})
				]
			});
		}
		/** 只读正文预览（`frozen.text` 截断展示，不落会话日志、不可编辑）。 */
		function FrozenPreview({ text, fileCount }) {
			const LIMIT = 4e3;
			const shown = text.length > LIMIT ? text.slice(0, LIMIT) : text;
			const lines = text.split("\n").length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "skp-dock-rail",
				style: {
					flexDirection: "column",
					alignItems: "stretch",
					gap: 6,
					maxHeight: 250,
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-dock-rail-count",
						children: [
							"已注入内容预览 · 共 ",
							fileCount,
							" 个文件"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("pre", {
						style: {
							margin: 0,
							overflow: "auto",
							maxHeight: 170,
							padding: "8px 10px",
							borderRadius: 8,
							background: "var(--dsw-alias-bg-layer-1,#fff)",
							fontFamily: "var(--ds-font-family-code,ui-monospace,monospace)",
							fontSize: 10.5,
							lineHeight: "16px",
							color: "var(--dsw-alias-label-secondary,#5b6472)",
							whiteSpace: "pre-wrap",
							wordBreak: "break-word"
						},
						children: [shown, text.length > LIMIT ? "\n…" : ""]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "skp-dock-rail-note",
						children: [
							"只读预览 · 全文 ",
							lines,
							" 行",
							text.length > LIMIT ? `（已截断，仅显示前 ${LIMIT} 字）` : "",
							" · 不可修改 / 不可开关"
						]
					})
				]
			});
		}
		/**
		* Prompt Tab 内容：banner / 汇总行 / 卡片网格 / （只读）正文预览。
		*
		* @param data `usePromptTabData` 的返回值。
		* @param readOnly 会话内只读（mode="view"）。
		* @param query 页头搜索词（复用面板既有搜索框）。
		* @param onClearQuery 清空搜索（空态里的「清空搜索」）。
		*/
		function PromptTab({ data, readOnly, query, onClearQuery }) {
			const filtered = (0, react.useMemo)(() => {
				const q = query.trim().toLowerCase();
				if (q === "") return data.files;
				return data.files.filter((file) => `${file.name} ${file.displayPath} ${scopeLabel(file.scope)}`.toLowerCase().includes(q));
			}, [data.files, query]);
			const busy = data.pendingId !== void 0;
			const injectable = data.files.filter((file) => file.enabled && file.state !== "duplicate");
			const merged = data.files.filter((file) => file.enabled && file.state === "duplicate");
			const injectBytes = injectable.reduce((sum, file) => sum + file.size, 0);
			const budget = data.list?.budget.maxBytes ?? 65536;
			const degraded = data.list?.engineAvailable === false;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				readOnly ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FreezeBanner, {
					frozen: data.frozen,
					onRefresh: data.refresh
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-dock-rail",
					role: "note",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-dock-rail-count",
							children: [
								"将注入 ",
								injectable.length,
								" 个文件"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-dock-rail-note",
							children: [
								"预计 ",
								formatSize(injectBytes),
								" / ",
								formatSize(budget)
							]
						}),
						merged.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-dock-rail-note",
							title: merged.map((file) => file.displayPath).join(" · "),
							children: [
								"（",
								merged.map((file) => file.name).join("、"),
								" 内容重复，自动合并）"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-spacer" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-dock-rail-note",
							children: "开始时冻结 · 之后本会话不可改"
						})
					]
				}),
				degraded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EngineDegraded, {}),
				data.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "skp-dock-banner",
					role: "alert",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: data.error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "skp-dock-link",
						onClick: data.refresh,
						children: "重试"
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-dock-grid",
					role: "tabpanel",
					children: data.loading && data.files.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-dock-empty",
						children: "加载中…"
					}) : filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-empty",
						children: [query.trim() !== "" ? `没有匹配「${query.trim()}」的 Prompt` : data.files.length === 0 ? "未发现可注入的 Prompt 文件" : "没有可展示的 Prompt", query.trim() !== "" && onClearQuery !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-dock-link",
							onClick: onClearQuery,
							children: "清空搜索"
						})]
					}) : readOnly ? filtered.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReadonlyPromptCard, {
						file,
						frozen: data.frozen
					}, file.id)) : filtered.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditablePromptCard, {
						file,
						busy,
						onToggle: () => data.toggle(file)
					}, file.id))
				}),
				readOnly && data.frozen?.text !== void 0 && data.frozen.text.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FrozenPreview, {
					text: data.frozen.text,
					fileCount: data.frozen.files.length
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "skp-dock-grid-note",
					children: readOnly ? "只展示首轮已注入 / 未注入结果；未创建 / 未识别项不在此列出（在能力面板里管理）。" : "默认全选（与 DSH 一致）· 只列已存在且被 DSH 读取的 prompt：未创建 / 未识别项在能力面板里管理。"
				})
			] });
		}
		//#endregion
		//#region src/client/composer-capability.tsx
		/**
		* 会话「本会话能力」配置区（首屏入口 + 配置弹窗 + 会话内整页）。
		*
		* 两个入口（在 src/client.ts 注册）：
		*   - 首屏（hero）：`conversation.hero.options` 首屏行（workspace chip /「标准模式」那一行）
		*     右端的行内控件组（书 / MCP 官方标 / 扳手 + ✦ + 滑杆），点击打开居中弹窗
		*     （55% 遮罩 + 10px 背景模糊）；✦ 仍触发能力决策，结果面板 fixed 落在输入卡下方。
		*     与邻居控件同款：12px、无外底、hover 才出浅底。active 相位整行消失、入口卸载。
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
		/** Skills：Lucide book-open。 */
		function EntrySkillIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
					stroke: "currentColor",
					strokeWidth: "2.2",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** MCP：Simple Icons 的 MCP 官方标（原图满 24 网格，视口内缩 2 对齐其它两枚的视觉体量）。 */
		function EntryMcpIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "-2 -2 28 28",
				fill: "currentColor",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M13.85 0a4.16 4.16 0 0 0-2.95 1.217L1.456 10.66a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l9.442-9.442a2.49 2.49 0 0 1 3.541 0 2.49 2.49 0 0 1 0 3.541L8.59 12.97l-.1.1a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l.1-.098 7.03-7.034a2.49 2.49 0 0 1 3.542 0l.049.05a2.49 2.49 0 0 1 0 3.54l-8.54 8.54a1.96 1.96 0 0 0 0 2.755l1.753 1.753a.835.835 0 0 0 1.18 0 .835.835 0 0 0 0-1.18l-1.753-1.753a.266.266 0 0 1 0-.394l8.54-8.54a4.185 4.185 0 0 0 0-5.9l-.05-.05a4.16 4.16 0 0 0-2.95-1.218c-.2 0-.401.02-.6.048a4.17 4.17 0 0 0-1.17-3.552A4.16 4.16 0 0 0 13.85 0m0 3.333a.84.84 0 0 0-.59.245L6.275 10.56a4.186 4.186 0 0 0 0 5.902 4.186 4.186 0 0 0 5.902 0L19.16 9.48a.835.835 0 0 0 0-1.18.835.835 0 0 0-1.18 0l-6.985 6.984a2.49 2.49 0 0 1-3.54 0 2.49 2.49 0 0 1 0-3.54l6.983-6.985a.835.835 0 0 0 0-1.18.84.84 0 0 0-.59-.245" })
			});
		}
		/** Tools：Lucide wrench。 */
		function EntryToolIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
					stroke: "currentColor",
					strokeWidth: "2.2",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** 入口右侧「配置」：滑杆图标。 */
		function SlidersIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M1 2.6h10M1 6h10M1 9.4h10",
						stroke: "currentColor",
						strokeWidth: "1.3",
						strokeLinecap: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "3.6",
						cy: "2.6",
						r: "1.5",
						fill: "var(--dsw-alias-bg-layer-1,#fff)",
						stroke: "currentColor",
						strokeWidth: "1.1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "8.2",
						cy: "6",
						r: "1.5",
						fill: "var(--dsw-alias-bg-layer-1,#fff)",
						stroke: "currentColor",
						strokeWidth: "1.1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "5.4",
						cy: "9.4",
						r: "1.5",
						fill: "var(--dsw-alias-bg-layer-1,#fff)",
						stroke: "currentColor",
						strokeWidth: "1.1"
					})
				]
			});
		}
		/** 能力决策（填充四角星）。 */
		function DecisionStarIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8Z",
					fill: "currentColor"
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
			attributionSettling: false,
			mounts: {},
			settling: false,
			hiddenCounts: {
				skills: 0,
				mcp: 0,
				tools: 0
			}
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
			const skillsPromise = (async () => {
				try {
					if (api.skills.sessionListView !== void 0) {
						const view = await api.skills.sessionListView();
						return {
							rows: view.skills,
							hidden: view.hiddenCount ?? 0
						};
					}
					return {
						rows: await api.skills.sessionList(),
						hidden: 0
					};
				} catch {
					return {
						rows: (await api.skills.list()).map((row) => ({
							...row,
							enabledInSession: true,
							canToggleInSession: false
						})),
						hidden: 0
					};
				}
			})();
			const [skillsView, mcp, statuses, runtime, toolsView] = await Promise.all([
				skillsPromise,
				api.mcp.list(),
				api.mcp.status().catch(() => []),
				api.mcp.runtime({ cwd: workspace }).catch(() => ({
					servers: [],
					hiddenCount: 0
				})),
				api.tools.list().catch(() => ({
					units: [],
					totalGlobalTools: 0,
					excludedBuiltinCount: 0,
					errors: [],
					attributionSettling: false,
					hiddenCount: 0
				}))
			]);
			const visibleOnly = (row) => row.visibleInWorkspace !== false;
			return {
				skills: skillsView.rows.filter((skill) => skill.shadowStub !== true).filter(visibleOnly),
				servers: mcp.servers.filter(visibleOnly),
				externals: runtime.servers.filter(visibleOnly),
				tools: toolsView.units.filter(visibleOnly),
				attributionSettling: toolsView.attributionSettling === true,
				mounts: aggregateMounts(statuses),
				settling: statuses.some((status) => status.settling === true),
				hiddenCounts: {
					skills: skillsView.hidden,
					mcp: (mcp.hiddenCount ?? 0) + (runtime.hiddenCount ?? 0),
					tools: toolsView.hiddenCount ?? 0
				}
			};
		}
		/** 派生模式变更事件：首屏与能力页是两个独立挂载点，需要互相同步。 */
		const DERIVE_CHANGED_EVENT = "skp-derive-changed";
		const DERIVE_LABEL = {
			session: "派生继承会话",
			workspace: "派生继承工作区"
		};
		const DERIVE_DESC = {
			session: "派生 agent 继承当前会话的能力（默认）",
			workspace: "派生 agent 使用工作区默认能力"
		};
		/** 会话级派生模式：读取 + 写入；写入后本地回显，失败留给 UI 提示。 */
		function useDeriveMode(api, enabled = true) {
			const [info, setInfo] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(enabled);
			const [pending, setPending] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [reloadToken, setReloadToken] = (0, react.useState)(0);
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
				if (api?.derive === void 0 || typeof api.derive.get !== "function") {
					setInfo({ mode: "session" });
					setLoading(false);
					return;
				}
				let cancelled = false;
				setLoading(true);
				api.derive.get().then((next) => {
					if (cancelled || !mountedRef.current) return;
					setInfo(next);
					setError(void 0);
				}).catch((err) => {
					if (cancelled || !mountedRef.current) return;
					setInfo({ mode: "session" });
					setError(String(err instanceof Error ? err.message : err));
				}).finally(() => {
					if (!cancelled && mountedRef.current) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, [
				api,
				enabled,
				reloadToken
			]);
			(0, react.useEffect)(() => {
				if (!enabled || typeof window === "undefined") return;
				const onChanged = () => setReloadToken((value) => value + 1);
				window.addEventListener(DERIVE_CHANGED_EVENT, onChanged);
				return () => window.removeEventListener(DERIVE_CHANGED_EVENT, onChanged);
			}, [enabled]);
			return {
				info,
				loading,
				pending,
				error,
				setMode: (0, react.useCallback)(async (mode) => {
					if (api?.derive === void 0 || typeof api.derive.set !== "function") return;
					setPending(true);
					setError(void 0);
					try {
						const result = await api.derive.set(mode);
						if (!result.ok) throw new Error(result.errors.join("; "));
						setInfo((prev) => ({
							mode,
							...prev?.derived !== void 0 ? { derived: prev.derived } : {}
						}));
						if (typeof window !== "undefined") window.dispatchEvent(new Event(DERIVE_CHANGED_EVENT));
					} catch (err) {
						setError(String(err instanceof Error ? err.message : err));
					} finally {
						setPending(false);
					}
				}, [api])
			};
		}
		/**
		* 「派生继承会话 / 派生继承工作区」下拉。
		*
		* 与「标准模式」同族的文字触发器；弹出层用 fixed 定位，避免被首屏行 /
		* 面板容器裁剪。两个选项都带一句说明，选中项打勾。
		*/
		function DeriveModeSelect({ value, loading, pending, onChange, variant = "hero", disabled = false, title }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [anchor, setAnchor] = (0, react.useState)(void 0);
			const rootRef = (0, react.useRef)(null);
			const btnRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			const busy = pending === true || loading === true;
			(0, react.useEffect)(() => {
				if (!open) return;
				const close = () => {
					setOpen(false);
					setAnchor(void 0);
				};
				const onPointerDown = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				const onScroll = (event) => {
					if (popRef.current !== null && event.target instanceof Node && popRef.current.contains(event.target)) return;
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
			const toggle = () => {
				if (busy) return;
				if (open) {
					setOpen(false);
					setAnchor(void 0);
					return;
				}
				const rect = btnRef.current?.getBoundingClientRect();
				if (rect === void 0) return;
				const width = 300;
				const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
				const vh = typeof window === "undefined" ? 900 : window.innerHeight;
				const left = Math.max(8, Math.min(rect.left, vw - 8 - width));
				const below = rect.bottom + 6;
				const menuHeight = 152;
				const top = below + menuHeight <= vh - 8 ? below : Math.max(8, rect.top - 6 - menuHeight);
				setAnchor({
					left,
					top,
					width
				});
				setOpen(true);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: `skp-derive skp-derive-${variant}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					ref: btnRef,
					type: "button",
					className: "skp-derive-trigger",
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					"aria-label": `派生继承方式：${DERIVE_LABEL[value]}`,
					title: title ?? "只影响之后创建的 subagent / teammate；已存在的不受影响",
					disabled: disabled || busy,
					onClick: toggle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-derive-value",
						children: DERIVE_LABEL[value]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-derive-chevron",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, {})
					})]
				}), open && anchor !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: popRef,
					className: "skp-derive-pop",
					role: "listbox",
					"aria-label": "派生继承方式",
					style: {
						left: `${anchor.left}px`,
						top: `${anchor.top}px`,
						width: `${anchor.width}px`
					},
					children: Object.keys(DERIVE_LABEL).map((mode) => {
						const active = mode === value;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": active,
							className: `skp-derive-opt${active ? " skp-derive-opt-active" : ""}`,
							onClick: () => {
								if (!active) onChange(mode);
								setOpen(false);
								setAnchor(void 0);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-derive-opt-main",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-derive-opt-title",
									children: DERIVE_LABEL[mode]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-derive-opt-desc",
									children: DERIVE_DESC[mode]
								})]
							}), active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-derive-check",
								"aria-hidden": "true",
								children: "✓"
							})]
						}, mode);
					})
				})]
			});
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
				const pendingActivation = skill.activationPending === true;
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
					...pendingActivation ? { meta: "改动待激活生效" } : canToggle ? {} : { meta: "会话未激活" }
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
				const defaultEnabled = unit.defaultEnabled ?? unit.enabledInSession ?? true;
				return {
					id,
					kind: "tool",
					name: unit.name,
					tag: unattributed ? "未识别" : "插件",
					tone: unattributed ? "unattributed" : "plugin",
					description: `${toolCount} 个工具 · ${unattributed ? "来源未识别" : "插件注入"}`,
					meta: `${toolCount} 个工具`,
					enabled: pending[id] ?? unit.enabled ?? unit.enabledInSession ?? unit.defaultEnabled ?? true,
					disabled: locked,
					unit: unit.unit,
					explicit: unit.explicit === true,
					defaultEnabled,
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
			const title = row.kind === "tool" ? row.disabled ? row.lockedReason ?? "该插件无法在当前会话切换" : row.enabled ? "关闭：本会话关闭此插件全部工具（全局默认不变）" : "开启：本会话启用（覆盖全局默认）" : row.disabled ? "该能力无法在当前会话切换，请到能力面板管理" : row.name;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `skp-dock-card${row.enabled ? " skp-dock-card-on" : " skp-dock-card-off"}${row.disabled ? " skp-dock-card-disabled" : ""}`,
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-card-state",
								children: row.enabled ? "已启用" : "未启用"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, {
								label: row.tag,
								tone: row.tone
							}),
							row.kind === "tool" && row.explicit && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-tag skp-dock-tag-override",
								title: `全局默认${row.defaultEnabled ? "开启" : "关闭"}；本会话单独设置`,
								children: "本会话覆盖"
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
			const { mode, api, loading, error, skillRows, mcpRows, toolRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, onBulk, onRetryBulk, bulkState, initialTab, onTabChange } = props;
			/** 旧宿主 / 测试桩没有 `api.prompt`：不渲染 Prompt Tab，保持三域行为不变。 */
			const promptSupported = typeof api?.prompt?.list === "function";
			const [tab, setTabState] = (0, react.useState)(initialTab ?? "skills");
			/** v21：三域因可见性被隐藏的条目总数（弹窗提示；全局视图的可见范围控制）。 */
			const hiddenTotal = (props.snapshot?.hiddenCounts?.skills ?? 0) + (props.snapshot?.hiddenCounts?.mcp ?? 0) + (props.snapshot?.hiddenCounts?.tools ?? 0);
			const setTab = (next) => {
				setTabState(next);
				onTabChange?.(next);
			};
			(0, react.useEffect)(() => {
				if (!promptSupported && tab === "prompt") setTabState("skills");
			}, [promptSupported, tab]);
			const [query, setQuery] = (0, react.useState)("");
			const [resetBusy, setResetBusy] = (0, react.useState)(false);
			const derive = useDeriveMode(api, mode === "view" || mode === "modal");
			const prompt = usePromptTabData(api, mode === "view");
			const readOnlyPrompt = mode === "view";
			const skillsOn = skillRows.filter((row) => row.enabled).length;
			const mcpOn = mcpRows.filter((row) => row.enabled).length;
			const toolsOn = toolRows.filter((row) => row.enabled).length;
			const injectedOn = skillRows.filter((row) => row.injected === true && row.enabled).length;
			const rows = tab === "skills" ? skillRows : tab === "mcp" ? mcpRows : tab === "tools" ? toolRows : [];
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
							mode === "modal" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-scope",
								children: "仅当前会话"
							}),
							(mode === "view" || mode === "modal") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-subtitle",
								children: mode === "modal" ? "开关只作用于当前对话 · 不改项目默认" : "开关只作用于当前会话，不修改项目默认"
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
								}), mode === "modal" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "skp-dock-modal-close",
									title: "关闭",
									"aria-label": "关闭",
									onClick: onCollapse,
									children: "✕"
								}) : mode !== "view" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
					derive.info?.derived !== void 0 && (mode === "view" || mode === "modal") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-derive-banner",
						role: "note",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-derive-banner-title",
							children: DERIVE_LABEL[derive.info.derived.mode]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-derive-banner-desc",
							children: "创建时快照 · 本页修改只影响本会话，不影响主对话"
						})]
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
									}),
									promptSupported && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										role: "tab",
										"aria-selected": tab === "prompt",
										className: `skp-dock-tab${tab === "prompt" ? " skp-dock-tab-active" : ""}`,
										title: "首轮注入的指令文件（AGENTS.md / CLAUDE.md 等）· 首屏可开关，会话开始后只读冻结",
										onClick: () => setTab("prompt"),
										children: ["Prompt", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "skp-dock-tab-count",
											children: readOnlyPrompt ? `${prompt.injectedCount} / ${prompt.fileCount}` : `${prompt.enabledCount} / ${prompt.fileCount}`
										})]
									}) })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-spacer" }),
							promptSupported && tab === "prompt" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-tag skp-dock-tag-preset",
								title: "Prompt 只决定把哪些指令文件交给 DSH；Jev 能力决策与三域批量开关只处理 Skills / MCP / Tools",
								children: "不参与 Jev 能力决策"
							}),
							onManage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-link",
								onClick: onManage,
								children: "管理全部 ↗"
							})
						]
					}),
					tab !== "prompt" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
							}),
							derive.info?.derived !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-derive-static skp-derive-rail-static",
								title: "派生会话：创建时的继承方式已固定；本页修改只影响本会话",
								children: [DERIVE_LABEL[derive.info.derived.mode], " · 创建时快照"]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeriveModeSelect, {
								variant: "rail",
								value: derive.info?.mode ?? "session",
								loading: derive.loading,
								pending: derive.pending,
								title: derive.error ?? void 0,
								onChange: (next) => void derive.setMode(next)
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
					tab === "prompt" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptTab, {
						data: prompt,
						readOnly: readOnlyPrompt,
						query,
						onClearQuery: () => setQuery("")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-grid",
						role: "tabpanel",
						children: [tab === "tools" && props.snapshot.attributionSettling && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "skp-dock-grid-note",
							children: "来源解析中…"
						}), loading && filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
						}, row.id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-dock-foot-note",
								children: tab === "prompt" ? readOnlyPrompt ? "只展示本会话首轮注入结果 · 不参与 Jev 能力决策 · 不参与三域批量开关" : `默认全选（与 DSH 一致）· 将注入 ${prompt.enabledCount} / ${prompt.fileCount} 个文件 · 不参与 Jev 能力决策` : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									totalOn,
									" / ",
									total,
									" 项已启用",
									injectedOn > 0 ? ` · 其中 ${injectedOn} 项来自插件 / DSH 内置 / Agent 预设` : "",
									" · 开关只作用于当前对话",
									hiddenTotal > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-vis-summary",
										title: "能力可见性由全局「可见范围」按工作区控制；不可见能力不出现在本会话，也不能在这里打开",
										children: [
											" ",
											"· 能力可见性由全局控制 · 不可见 ",
											hiddenTotal,
											" 项已隐藏"
										]
									})
								] })
							}),
							tab !== "prompt" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-btn",
								disabled: resetBusy || bulkRunning,
								title: "清除本会话的显式开关，恢复默认（Skills / MCP / Tools 三域；Tools 回落到全局默认）",
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
		function ComposerCapabilityEntry(props) {
			const { api, onManage } = props;
			const slot = props.slotProps;
			if (slot !== void 0 && typeof slot.useInput === "function") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryWithSubscribedDraft, {
				api,
				onManage,
				slotProps: slot,
				useInput: slot.useInput
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryBody, {
				api,
				onManage,
				slotProps: slot,
				slotDraft: void 0
			});
		}
		/**
		* 槽 standardProps 可用分支：`useInput` 是订阅式 hook，草稿变化即重渲染。
		* 单独成组件是为了避免在 props 形态切换时改变 EntryBody 的 hooks 顺序。
		*/
		function EntryWithSubscribedDraft({ api, onManage, slotProps, useInput }) {
			const draft = useInput((state) => typeof state?.draft === "string" ? state.draft : "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryBody, {
				api,
				onManage,
				slotProps,
				slotDraft: draft
			});
		}
		function EntryBody({ api, onManage, slotProps, slotDraft }) {
			const { ref, phase } = useConversationPhase();
			const isHero = phase === "hero";
			const controller = useCapabilityController(api, useWorkspaceLabel(api), isHero);
			const derive = useDeriveMode(api, isHero);
			const rect = useComposerCardRect(isHero, ref);
			const [modalOpen, setModalOpen] = (0, react.useState)(false);
			const [modalTab, setModalTab] = (0, react.useState)("skills");
			const contentRef = (0, react.useRef)(null);
			const entryRef = (0, react.useRef)(null);
			const modalRef = (0, react.useRef)(null);
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
					entryRef.current?.querySelector(".skp-dock-entry-decision")?.focus();
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
			let entryTooltip = configured ? autoOff ? "自动触发默认关闭 · 可在 Jev 模型 Tab 开启" : "根据输入框草稿，为 Skills、MCP 与 Tools 打分并勾选相关能力（仅当前会话）" : "尚未配置 Jev 模型，点击去配置";
			if (decision.state?.phase === "applying") {
				entryDisabled = true;
				entryGuide = false;
				entryTooltip = "正在应用所选能力";
			} else if (decision.state?.phase === "loading") {
				entryDisabled = true;
				entryGuide = false;
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
			const closeModal = (0, react.useCallback)(() => {
				setModalOpen(false);
				requestAnimationFrame(() => entryRef.current?.querySelector(".skp-dock-entry-config")?.focus());
			}, []);
			(0, react.useEffect)(() => {
				if (!isHero) setModalOpen(false);
			}, [isHero]);
			(0, react.useEffect)(() => {
				if (!modalOpen) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						closeModal();
						return;
					}
					if (event.key !== "Tab") return;
					const root = modalRef.current;
					if (root === null) return;
					const focusables = Array.from(root.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])")).filter((node) => node.offsetParent !== null);
					if (focusables.length === 0) return;
					const first = focusables[0];
					const last = focusables[focusables.length - 1];
					const active = document.activeElement;
					if (!event.shiftKey && active === last) {
						event.preventDefault();
						first.focus();
					} else if (event.shiftKey && active === first) {
						event.preventDefault();
						last.focus();
					}
				};
				document.addEventListener("keydown", onKeyDown, true);
				const frame = requestAnimationFrame(() => {
					modalRef.current?.querySelector(".skp-dock-modal-close")?.focus();
				});
				return () => {
					cancelAnimationFrame(frame);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [modalOpen, closeModal]);
			const skillsOn = controller.skillRows.filter((row) => row.enabled).length;
			const mcpOn = controller.mcpRows.filter((row) => row.enabled).length;
			const toolsOn = controller.toolRows.filter((row) => row.enabled).length;
			const countsLoading = controller.loading && totalCapabilities === 0;
			const countText = (value) => countsLoading ? "—" : String(value);
			const countTitle = (label, on, total) => `${label}：已启用 ${on} / ${total} · 点击配置本会话能力`;
			const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
			const decisionStyle = rect === void 0 ? void 0 : (() => {
				const maxHeight = Math.max(180, Math.min(decision.state !== void 0 ? 560 : 360, viewportHeight - rect.top - 24));
				return {
					left: `${rect.left}px`,
					top: `${rect.top}px`,
					width: `${rect.width}px`,
					maxHeight: `${maxHeight}px`
				};
			})();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref,
				className: "skp-dock-entry-host",
				children: [
					isHero && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: entryRef,
						className: "skp-dock-entry",
						role: "group",
						"aria-label": "本会话能力",
						children: [
							derive.info?.derived !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-derive-static skp-derive-static-hero",
								title: "派生会话：创建时的继承方式已固定，本页修改只影响本会话",
								children: DERIVE_LABEL[derive.info.derived.mode]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeriveModeSelect, {
								variant: "hero",
								value: derive.info?.mode ?? "session",
								loading: derive.loading,
								pending: derive.pending,
								title: derive.error ?? void 0,
								onChange: (mode) => void derive.setMode(mode)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "skp-dock-entry-item",
								title: countTitle("Skills", skillsOn, controller.skillRows.length),
								"aria-label": `配置 Skills：已启用 ${skillsOn} / ${controller.skillRows.length}`,
								onClick: () => {
									setModalTab("skills");
									setModalOpen(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dock-entry-icon",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntrySkillIcon, {})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dock-entry-count",
									children: countText(skillsOn)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "skp-dock-entry-item",
								title: countTitle("MCP", mcpOn, controller.mcpRows.length),
								"aria-label": `配置 MCP：已启用 ${mcpOn} / ${controller.mcpRows.length}`,
								onClick: () => {
									setModalTab("mcp");
									setModalOpen(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dock-entry-icon",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryMcpIcon, {})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dock-entry-count",
									children: countText(mcpOn)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "skp-dock-entry-item",
								title: countTitle("Tools", toolsOn, controller.toolRows.length),
								"aria-label": `配置 Tools：已启用 ${toolsOn} / ${controller.toolRows.length}`,
								onClick: () => {
									setModalTab("tools");
									setModalOpen(true);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dock-entry-icon",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EntryToolIcon, {})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-dock-entry-count",
									children: countText(toolsOn)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "skp-dock-entry-btn skp-dock-entry-decision",
								title: entryTooltip,
								"aria-label": "能力决策",
								"aria-disabled": entryDisabled ? true : void 0,
								onClick: onEntryClick,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DecisionStarIcon, {}), entryGuide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
									className: "skp-dock-entry-guide-dot",
									"aria-hidden": "true"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-entry-btn skp-dock-entry-config",
								title: "配置本会话能力",
								"aria-label": "配置本会话能力",
								onClick: () => setModalOpen(true),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SlidersIcon, {})
							})
						]
					}),
					isHero && decision.state !== void 0 && decisionStyle !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: contentRef,
						className: "skp-dock-fixed",
						style: decisionStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DecisionPanel, {
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
						}), decision.toast !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `skp-decision-toast skp-decision-toast-${decision.toast.tone}`,
							role: "status",
							children: decision.toast.text
						})]
					}),
					isHero && modalOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-dock-modal-backdrop",
						onMouseDown: (event) => {
							if (event.target === event.currentTarget) closeModal();
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							ref: modalRef,
							className: "skp-dock-modal",
							role: "dialog",
							"aria-modal": "true",
							"aria-label": "本会话能力",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityPanel, {
								mode: "modal",
								api,
								initialTab: modalTab,
								onTabChange: setModalTab,
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
								onCollapse: closeModal,
								...onManage !== void 0 ? { onManage } : {},
								onRetry: controller.refresh
							})
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "skp-sr-only",
						role: "status",
						"aria-live": "polite",
						children: decision.liveMessage
					})
				]
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
						api,
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
				currentWorkspaceCwd: () => selection.cwd,
				subscribeWorkspace,
				listProjects: () => listWorkspaceOptions(ctx),
				selectedProject: () => selection.cwd,
				selectProject: (path) => {
					if (selection.cwd === path) return;
					selection.cwd = path;
					notifyWorkspaceListeners();
				},
				sessionTitle: (sessionId) => sessionTitleOf(ctx, sessionId)
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
			let lastPanelCwd = selection.cwd;
			let lastSessionCwd = currentWorkspaceCwd(ctx);
			let lastItemsKey = workspaceItemsKey(ctx);
			const onGraphChange = () => {
				const sessionCwd = currentWorkspaceCwd(ctx);
				const panelCwd = selection.cwd;
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
				const disposeCapabilityEntry = ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({
					name: "conversation.hero.options",
					id: "capability-panel-entry",
					order: 60,
					label: "本会话能力（首屏）"
				}, (props) => ComposerCapabilityEntry({
					api: composerApiFor(props?.sessionId),
					onManage: openCapabilityPanel,
					slotProps: props
				})));
				if (typeof disposeCapabilityEntry === "function") disposers.push(disposeCapabilityEntry);
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