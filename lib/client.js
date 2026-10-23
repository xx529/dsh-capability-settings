window.__ModuleLoader__.load({
	id: "@chengdb/capability-panel",
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
		* @module @chengdb/capability-panel/channel
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
		* @module @chengdb/capability-panel/client/api-adapter
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
					/** 详情：宿主可能返回 undefined（不存在）。 */
					async read(name) {
						const result = await rpc("skills.read", {
							name,
							cwd: deps.currentWorkspaceCwd()
						});
						if (!result.ok) throw new Error(result.errors.join("; "));
						const detail = result.value;
						if (detail === void 0) return void 0;
						return detail;
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
							files: self.files
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
					* 投影成客户端类型；脏数据丢弃。
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
								origin: server.origin === "entry" ? "entry" : "fiber",
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
				overrides: {
					/** 读取当前项目的禁用声明全量（宿主侧无工作区时返回空清单）。 */
					async get() {
						const result = await rpc("overrides.get", { cwd: deps.currentWorkspaceCwd() });
						if (!result.ok) throw new Error(result.errors.join("; "));
						return result.value;
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
		* 把宿主返回的行对象投影成客户端摘要：
		* 调用策略是嵌套的 `invocation` 对象 → 拍平成两个布尔；
		* 其它字段做了宽松的字符串归一，防御宿主侧数据漂移。
		*/
		function toSummary(value) {
			const inv = value.invocation ?? {};
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
				...typeof value.canToggleInSession === "boolean" ? { canToggleInSession: value.canToggleInSession } : {}
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
		* @module @chengdb/capability-panel/client/styles
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
.skp-dock-card-foot{display:flex;align-items:center;gap:6px;margin-top:auto;min-width:0;}
.skp-dock-tag{flex:none;padding:0 5px;border-radius:4px;font-size:9.5px;font-weight:600;line-height:16px;letter-spacing:.02em;}
.skp-dock-tag-project{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);}
.skp-dock-tag-global{color:var(--dsw-alias-label-tertiary,#8b95a1);background:var(--dsw-alias-interactive-bg-hover,rgba(20,28,40,.05));}
.skp-dock-tag-external{color:var(--dsw-alias-state-warn-primary,#f59e0b);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 14%,transparent);}
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
.skp-dock-panel-view .skp-dock-grid{max-height:none;overflow:visible;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:0;}
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

`;
		/**
		* 注入样式表（幂等：已存在同 id 的 style 标签则不重复注入）。
		* 返回清理函数，用于插件 stop / 卸载时移除标签。
		*/
		function installStyles() {
			const id = "dsh-capability-panel-css";
			if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${id}"]`) === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "@chengdb/capability-panel";
				tag.dataset.pluginCss = id;
				tag.textContent = SKP_CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}
			return () => void 0;
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
		* @module @chengdb/capability-panel/client/select
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
		*   - `bundled` 两侧都不归（只读内置条目，不进面板的磁盘视图）。
		*
		* @module @chengdb/capability-panel/shared/skill-sources
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
		* @module @chengdb/capability-panel/client/panel-common
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
		* @module @chengdb/capability-panel/client/mcp-panel
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
		const HEAD_TAGS_STYLE = {
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
		/** 「工具与参数」两栏容器：左列表 + 右参数表，共用一条外框。 */
		const INSPECTOR_STYLE = {
			display: "flex",
			minWidth: 0,
			border: "1px solid var(--skp-border)",
			borderRadius: "var(--skp-radius-sm)",
			overflow: "hidden"
		};
		/** 左栏工具列表：宽 300（窄容器可收缩），自身滚动，行高 34。 */
		const INSPECTOR_LIST_STYLE = {
			flex: "0 1 300px",
			width: 300,
			minWidth: 0,
			maxHeight: "min(46vh, 420px)",
			overflow: "auto",
			display: "flex",
			flexDirection: "column",
			gap: 2,
			padding: 4,
			background: "var(--skp-fill)",
			scrollbarWidth: "thin"
		};
		/** 右栏参数表容器：自身滚动，不把详情页顶长。 */
		const INSPECTOR_PANE_STYLE = {
			flex: "1 1 auto",
			minWidth: 0,
			maxHeight: "min(46vh, 420px)",
			overflow: "auto",
			padding: "10px 12px",
			display: "flex",
			flexDirection: "column",
			gap: 8
		};
		/** 工具行公共样式（行高 34；选中态 = 底 + 左蓝条）。 */
		const TOOL_ROW_BASE_STYLE = {
			display: "flex",
			flexDirection: "column",
			justifyContent: "center",
			gap: 1,
			flex: "none",
			height: 34,
			boxSizing: "border-box",
			padding: "2px 8px",
			border: "none",
			borderLeft: "2px solid transparent",
			borderRadius: 4,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer",
			overflow: "hidden"
		};
		const TOOL_ROW_IDLE_STYLE = TOOL_ROW_BASE_STYLE;
		const TOOL_ROW_ACTIVE_STYLE = {
			...TOOL_ROW_BASE_STYLE,
			borderLeftColor: "var(--skp-accent)",
			background: "var(--skp-accent-soft)"
		};
		const TOOL_NAME_STYLE = {
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 12,
			fontWeight: 600,
			color: "var(--skp-text)",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const TOOL_DESC_STYLE = {
			fontSize: 11.5,
			lineHeight: 1.3,
			color: "var(--skp-text-3)",
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		/** 右栏工具标题行：等宽工具名 + 参数个数。 */
		const TOOL_HEAD_STYLE = {
			display: "flex",
			alignItems: "baseline",
			gap: 8,
			flexWrap: "wrap",
			minWidth: 0
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
			const summary = server.summary ?? "运行时注入，不由能力面板管理（只读）";
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
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tag skp-tag-readonly",
									children: "外部"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "skp-row-meta",
							children: [
								server.source !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
			const matchesExternal = (server) => q.length === 0 || server.serverName.toLowerCase().includes(q) || (server.source ?? "").toLowerCase().includes(q) || (server.summary ?? "").toLowerCase().includes(q);
			const globalServers = servers.filter((server) => server.scope === "global");
			const projectServers = servers.filter((server) => server.scope === "project");
			const visibleGlobal = globalServers.filter(matchesServer);
			const visibleProject = projectServers.filter(matchesServer);
			const visibleExternal = runtimeServers.filter(matchesExternal);
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
				const title = disabled ? "先选择工作区" : target === "global" ? "添加全局 MCP 服务器" : `添加项目 MCP 服务器（${projectName ?? projectPath}）`;
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
							"」的 MCP 服务器。"
						]
					});
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: group === "global" ? "还没有全局 MCP 服务器。" : "本项目还没有 MCP 服务器。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "skp-btn",
							style: { marginTop: 10 },
							onClick: () => openAdd(group),
							children: group === "global" ? "添加全局 MCP" : "添加到本项目"
						})]
					});
				}
				return renderServerScroll(list, group === "global" ? "全局 MCP 服务器" : "本项目 MCP 服务器");
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
					loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-status",
						children: "加载中…"
					}),
					!loading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										"」的 MCP 服务器。"
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [searching ? visibleGlobal.length > 0 && renderServerScroll(visibleGlobal, "全局 MCP 服务器") : renderServerList(visibleGlobal, "global"), renderExternalGroup()] }) : projectPath === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
									children: scope === "project" && projectPath === void 0 ? "先选择一个工作区，再查看或添加本项目 MCP 服务器。" : "选择一个服务器查看详情，或新增一个。"
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
							style: HEAD_TAGS_STYLE,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-readonly",
								children: "外部注入"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								children: "只读"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-note",
						children: [
							"只读原因：该 MCP 由 ",
							server.source ?? "其它插件",
							" 在运行时注入，能力面板只能查看与记录调用，不能编辑或删除。"
						]
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: server.source ?? "运行时注入（来源不可识别）" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "注入方式" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）" }),
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: "由注入方管理；能力面板只读展示，不提供编辑/删除/卸载。" })
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
							style: HEAD_TAGS_STYLE,
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
					!embedded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: isNew ? "添加 MCP 服务器" : `编辑 ${server?.key}` }),
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
		/** 工具描述（去首尾空白；缺省空串）。 */
		function toolDescription(tool) {
			return typeof tool.description === "string" ? tool.description.trim() : "";
		}
		/**
		* 「工具与参数」两栏检视器（配置条目与外部注入共用）：
		*  - 左栏：工具列表（宽 300、行高 34、可点选，选中态 = 底色 + 左蓝条），
		*    显示工具名 + 描述单行省略；
		*  - 右栏：所选工具的参数表（参数 / 类型 / 必填 / 说明），从
		*    `tool.parameters` 的 `properties` + `required` 展开；无参数显示「无参数」。
		*
		* 成功拿到工具清单后默认选中第一个工具；切换工具只换右栏，**不重新探测**
		* （探测由调用方控制）。工具清单变化（重新测试 / 换服务器）时校正选中：
		* 仍在清单里就保留，否则回到第一个。
		*/
		function ToolsInspector({ tools }) {
			const [activeName, setActiveName] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				setActiveName((current) => current !== void 0 && tools.some((tool) => tool.name === current) ? current : tools[0]?.name);
			}, [tools]);
			const active = tools.find((tool) => tool.name === activeName) ?? tools[0];
			const parameters = active === void 0 ? [] : toolParameters(active);
			const activeDescription = active === void 0 ? "" : toolDescription(active);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: INSPECTOR_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "listbox",
					"aria-label": "工具列表",
					style: INSPECTOR_LIST_STYLE,
					children: tools.map((tool) => {
						const selected = active !== void 0 && tool.name === active.name;
						const description = toolDescription(tool);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							"aria-selected": selected,
							title: description.length > 0 ? `${tool.name}\n${description}` : tool.name,
							style: selected ? TOOL_ROW_ACTIVE_STYLE : TOOL_ROW_IDLE_STYLE,
							onClick: () => setActiveName(tool.name),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: TOOL_NAME_STYLE,
								children: tool.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: TOOL_DESC_STYLE,
								children: description.length > 0 ? description : "无说明"
							})]
						}, tool.name);
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: INSPECTOR_PANE_STYLE,
					children: active === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-note",
						children: "没有可查看的工具。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: TOOL_HEAD_STYLE,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: "skp-tool-name",
								children: active.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-test-stat",
								children: parameters.length > 0 ? `${parameters.length} 个参数` : "无参数"
							})]
						}),
						activeDescription.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "skp-tool-desc skp-clamp-3",
							title: activeDescription,
							children: activeDescription
						}),
						parameters.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
					] })
				})]
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
				title: "添加 MCP 服务器",
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
		* @module @chengdb/capability-panel/client/skill-content
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
		/** 以文件清单构建树（目录由路径前缀推导）；同层 SKILL.md → 目录 → 文件 → 名称。 */
		function buildTree(files, rootName) {
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
						"aria-label": "技能文件",
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
								children: "技能文件"
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
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "skp-tree-count",
												children: node.count ?? 0
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
													children: formatSize(node.file?.size ?? 0)
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
							ariaLabel: "选择技能文件",
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
								selectedFile !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "skp-reader-meta",
									children: [
										formatSize(selectedFile.size),
										" · ",
										fileTypeLabel(selectedFile.path)
									]
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
								selectedFile !== void 0 && !selectedFile.binary && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
									children: "此技能没有可预览的文件"
								}),
								state.status === "ready" && selectedFile !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReaderContent, {
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
		* @module @chengdb/capability-panel/client/panel
		*/
		/** 域 Tab 的展示文案（当前硬编码中文，见 client.ts 的 locale 说明）。 */
		const DOMAIN_LABEL = {
			skills: "技能",
			mcp: "MCP"
		};
		const DOMAIN_ORDER = ["skills", "mcp"];
		/** 各域的搜索占位符（搜索框在根组件头部，切换域时切换文案）。 */
		const DOMAIN_SEARCH_PLACEHOLDER = {
			skills: "搜索技能…",
			mcp: "搜索 MCP 服务器…"
		};
		/**
		* 面板根组件：头部（标题 + 项目下拉框 + 域 Tab）+ 当前域视图。
		*
		* 它是主区域页面的本体（见 panel-entry.tsx 的 CapabilityPanelPage），自带
		* `.skp-panel`（height:100% / flex column），因此不再需要浮层外壳与关闭
		* 按钮——关闭 = 侧栏切换到别的主面板。
		*/
		function CapabilityPanel$1({ api }) {
			const [domain, setDomain] = (0, react.useState)("skills");
			/** 当前域的搜索词（搜索框在头部，按域切换 placeholder；切域清空）。 */
			const [query, setQuery] = (0, react.useState)("");
			const [workspace, setWorkspace] = (0, react.useState)(() => api.workspaceLabel());
			const [projects, setProjects] = (0, react.useState)(() => api.projects());
			const [pinned, setPinned] = (0, react.useState)(() => api.selectedProject());
			const [skillsCount, setSkillsCount] = (0, react.useState)(void 0);
			const [mcpCount, setMcpCount] = (0, react.useState)(void 0);
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
				mcp: mcpCount
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "skp-panel",
				"aria-label": "能力面板",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "skp-header",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-title-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "skp-title-main",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "能力面板" }), workspace !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-workspace",
								title: workspace,
								children: workspace
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
						})]
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
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: DOMAIN_LABEL[d] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-tab-count",
									children: counts[d] ?? "—"
								})]
							}, d))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
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
				}), domain === "skills" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillsView, {
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
				})]
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
		/** 行左标签的排序与文案：scope → 格式 → 关系（最多 3 个）。 */
		function skillTags(item, hasGlobal) {
			const isProject = isProjectSource(item.source);
			const tags = [{
				key: "scope",
				label: isProject ? "项目" : "全局",
				className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
				title: isProject ? "本项目内的技能，只在本项目生效" : "全局技能，对所有项目生效"
			}, {
				key: "format",
				label: item.format === "directory" ? "目录" : ".md",
				className: "skp-tag skp-tag-flat",
				title: item.format === "directory" ? "目录型技能（SKILL.md + 其他文件）" : "单文件技能"
			}];
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
				title: "已生成屏蔽占位，使同名全局技能在本项目不可用；删除占位即恢复"
			});
			else if (isProject && hasGlobal) tags.push({
				key: "override",
				label: "覆盖全局",
				className: "skp-tag skp-tag-relation",
				title: "本项目生效的是这份项目副本；同名全局技能被遮蔽"
			});
			else if (!isProject && item.projectShadow === "stub") tags.push({
				key: "disabled-in-project",
				label: "本项目已禁用",
				className: "skp-tag skp-tag-warn",
				title: "本项目内已放置屏蔽占位，此技能在本项目不可用（不影响其它项目）"
			});
			else if (!isProject && item.projectShadow === "skill") tags.push({
				key: "project-copy",
				label: "项目副本生效中",
				className: "skp-tag skp-tag-readonly",
				title: "本项目内已有同名技能，按优先级本项目中生效的是项目副本"
			});
			return tags;
		}
		/** 行开关的勾选态（语义见任务规格 / docs/ux/panel-upgrade.md §3.5、§5.3）。 */
		function skillSwitchChecked(item) {
			if (isProjectSource(item.source)) {
				if (item.shadowStub === true) return false;
				return item.modelInvocable && item.userInvocable;
			}
			return item.projectShadow !== "stub";
		}
		/** 行开关是否置灰 + tooltip（只读 / 项目副本生效中 / 无工作区）。 */
		function skillSwitchDisabled(item, hasWorkspace) {
			const isProject = isProjectSource(item.source);
			if (item.readOnly) return {
				disabled: true,
				title: "只读来源（.claude 兼容目录），无法修改或删除"
			};
			if (!hasWorkspace) return {
				disabled: true,
				title: "需要可写的工作区才能修改技能"
			};
			if (isProject) {
				if (item.shadowStub === true) return {
					disabled: false,
					title: "打开：删除屏蔽占位，恢复同名全局技能在本项目可用"
				};
				return {
					disabled: false,
					title: skillSwitchChecked(item) ? "关闭：模型与用户都不可调用" : "打开：恢复模型与用户调用（写入项目副本 frontmatter）"
				};
			}
			if (item.projectShadow === "skill") return {
				disabled: true,
				title: "本项目已有同名技能（项目副本生效中），请在项目副本上操作"
			};
			if (item.projectShadow === "stub") return {
				disabled: false,
				title: "打开：删除本项目内的屏蔽占位，恢复此全局技能在本项目可用"
			};
			return {
				disabled: false,
				title: skillSwitchChecked(item) ? "关闭：在本项目内禁用此全局技能（生成屏蔽占位，不影响其它项目）" : "打开：恢复此全局技能在本项目可用"
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
			const globalItems = (0, react.useMemo)(() => items.filter((item) => !isProjectSource(item.source)), [items]);
			(0, react.useEffect)(() => {
				if (!loading && error === void 0) onCount?.(items.length);
			}, [
				items.length,
				loading,
				error,
				onCount
			]);
			const q = query.trim().toLowerCase();
			const matchesSkill = (item) => q.length === 0 || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
			const globalVisible = (0, react.useMemo)(() => globalItems.filter(matchesSkill), [globalItems, q]);
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
			/** 行内统一开关：按行类型分派到 setEnabled / enableInProject / disableInProject。 */
			const toggleRow = async (item, next) => {
				const key = skillRowKey(item);
				if (busyRow !== void 0) return;
				setBusyRow(key);
				setOpError(void 0);
				try {
					const result = isProjectSource(item.source) ? item.shadowStub === true ? next ? await skillsApi.enableInProject({ name: item.name }) : { ok: true } : await skillsApi.setEnabled({
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
				const addTitle = addDisabled ? "先选择工作区" : target === "global" ? "安装技能到全局" : "安装技能到本项目";
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
							"」的技能。"
						]
					});
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-empty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: group === "global" ? "还没有全局技能。" : "本项目还没有技能。" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
						"aria-label": group === "global" ? "全局技能" : "本项目技能",
						children: list.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							role: "presentation",
							children: renderRow(item)
						}, skillRowKey(item)))
					})
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
				const state = invocationState(item);
				const tags = skillTags(item, globalItems.some((global) => global.name === item.name));
				const switcher = skillSwitchDisabled(item, pinned !== void 0);
				const dotClass = item.shadowStub === true || item.readOnly ? "skp-dot skp-dot-hollow" : state === "full" ? "skp-dot skp-dot-enabled" : state === "partial" ? "skp-dot skp-dot-partial" : "skp-dot";
				const dotText = item.shadowStub === true ? "屏蔽占位" : item.readOnly ? "只读" : state === "full" ? "已启用" : state === "partial" ? "部分禁用" : "已禁用";
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
							children: [isProject && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
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
					loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "skp-status",
						children: "加载中…"
					}),
					!loading && error === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
								className: "skp-scope-nav",
								"aria-label": "技能作用域",
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
										children: "全局技能"
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
								}), scope === "global" ? renderSkillList(globalVisible, "global") : pinned === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
									children: items.length === 0 ? "还没有任何技能。技能让 agent 在特定任务上按固定做法工作。" : scope === "project" && showWorkspacePicker ? "请选择左侧工作区，再查看或安装本项目技能。" : "选择一个技能查看说明与全部文件内容。"
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
			const deleteBody = summary.shadowStub === true ? "将删除本项目内的屏蔽占位，同名全局技能在本项目恢复可用。" : isGlobal ? "将删除全局技能，所有项目都将不再可用。此操作不可撤销。" : "将删除本项目中的这份技能（含目录下的所有文件）。此操作不可撤销。";
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project",
								title: isGlobal ? "全局技能（对所有项目生效）" : "本项目内的技能",
								children: isGlobal ? "全局" : "项目"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-tag skp-tag-flat",
								children: summary.format === "directory" ? "目录" : ".md"
							}),
							summary.readOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								children: "只读"
							}),
							summary.shadowStub === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								title: "屏蔽占位：使同名全局技能在本项目不可用；删除本条目即可恢复",
								children: "屏蔽占位"
							}),
							isGlobal && summary.projectShadow === "stub" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								title: "本项目内已放置屏蔽占位，此技能在本项目不可用（不影响其它项目）",
								children: "本项目已禁用"
							}),
							isGlobal && summary.projectShadow === "skill" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-badge",
								title: "项目区有同名技能，按宿主优先级在本项目生效的是项目副本",
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
					!summary.readOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								title: "此全局技能当前为禁用状态；点击恢复启用（对所有项目生效）",
								onClick: () => void doSetEnabled(true),
								children: "已禁用"
							}),
							hasWorkspace && isGlobal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: confirmImport ? "skp-btn skp-btn-danger" : "skp-btn",
								disabled: busy,
								title: confirmImport ? "项目内已有同名技能，再次点击将覆盖为全局副本" : "复制到本项目（.agents/skills），此后可在本项目内独立启停",
								onClick: () => void doImport(confirmImport),
								children: confirmImport ? "确认覆盖项目内的同名技能？" : "导入到本项目"
							}),
							hasWorkspace && isGlobal && summary.projectShadow === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: busy,
								title: "在本项目内禁用此全局技能（生成屏蔽占位，模型与用户调用都被宿主原生拒绝；不影响其它项目，可随时恢复）",
								onClick: () => void doDisableInProject(),
								children: "在本项目禁用"
							}),
							hasWorkspace && isGlobal && summary.projectShadow === "stub" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-btn",
								disabled: busy,
								title: "删除本项目内的屏蔽占位，恢复此全局技能在本项目可用",
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
								children: ["来源 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "skp-detail-meta-strong",
									children: summary.source
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "skp-detail-meta-item",
								children: summary.format === "directory" ? "目录格式" : "单文件"
							}),
							(summary.readOnly || !isGlobal) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "skp-detail-meta-item",
								children: ["调用方式", summary.readOnly || summary.shadowStub === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
										title: summary.userInvocable ? "点击关闭用户调用（输入框 /name 不再注入此技能；模型仍可自动触发）" : "点击开启用户调用（输入框 /name 可注入此技能）",
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
						title: `删除技能「${summary.name}」？`,
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
				title: "安装技能",
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
							}), "同名技能已存在时覆盖"]
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
		* @module @chengdb/capability-panel/client/composer-common
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
		* @module @chengdb/capability-panel/client/composer-capability
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
			mounts: {},
			settling: false
		};
		/** 项目来源判定（与 shared/skill-sources 的语义一致，客户端侧保持轻量）。 */
		function sourceIsProject(source) {
			return source.startsWith("project-");
		}
		function skillTag(skill) {
			return sourceIsProject(skill.source) ? "项目" : skill.readOnly ? "全局 · 只读" : "全局";
		}
		function skillEnabled(skill) {
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
			const [skills, mcp, statuses, runtime] = await Promise.all([
				skillsPromise,
				api.mcp.list(),
				api.mcp.status().catch(() => []),
				api.mcp.runtime({ cwd: workspace }).catch(() => ({ servers: [] }))
			]);
			return {
				skills: skills.filter((skill) => skill.shadowStub !== true),
				servers: mcp.servers,
				externals: runtime.servers,
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
				rows.push({
					id,
					kind: "mcp",
					name: server.serverName,
					tag: "外部",
					meta: server.restrictable !== true ? "不可在当前对话关闭" : server.tools.length > 0 ? `${server.tools.length} 个工具` : typeof server.source === "string" && server.source.length > 0 ? server.source : "外部实例",
					enabled: pending[id] ?? externalEnabled(server),
					disabled: server.restrictable !== true,
					dot: server.restrictable ? "mounted" : "none",
					target: server.serverName,
					writeKind: "server",
					locked: server.restrictable !== true
				});
			}
			return rows;
		}
		function DockSwitch({ checked, disabled, title, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "skp-dock-switch",
				title,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked,
					disabled,
					"aria-label": title,
					onChange
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-switch-track" })]
			});
		}
		function Tag({ label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `skp-dock-tag skp-dock-tag-${label === "项目" ? "project" : label === "外部" ? "external" : "global"}`,
				children: label
			});
		}
		function CapabilityCard({ row, busy, onToggle }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `skp-dock-card${row.enabled ? " skp-dock-card-on" : ""}${row.disabled ? " skp-dock-card-disabled" : ""}`,
				role: "button",
				tabIndex: 0,
				"aria-pressed": row.enabled,
				title: row.disabled ? "该能力无法在当前会话切换，请到能力面板管理" : row.name,
				onClick: () => {
					if (!row.disabled && !busy) onToggle();
				},
				onKeyDown: (event) => {
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
								children: row.kind === "skill" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SparkleIcon, { size: 13 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpIcon, {})
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
						children: row.kind === "skill" ? row.description : row.meta
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "skp-dock-card-foot",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, { label: row.tag }), row.kind === "skill" ? row.meta !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "skp-dock-card-meta",
							children: row.meta
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `skp-dock-dot skp-dock-dot-${row.dot}`,
							title: row.meta
						})]
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
		function CapabilityPanel(props) {
			const { mode, loading, error, skillRows, mcpRows, pending, busy, onToggle, onReset, onCollapse, onManage, onRefresh, onRetry, initialTab } = props;
			const [tab, setTab] = (0, react.useState)(initialTab ?? "skills");
			const [query, setQuery] = (0, react.useState)("");
			const [resetBusy, setResetBusy] = (0, react.useState)(false);
			const skillsOn = skillRows.filter((row) => row.enabled).length;
			const mcpOn = mcpRows.filter((row) => row.enabled).length;
			const rows = tab === "skills" ? skillRows : mcpRows;
			const filtered = (0, react.useMemo)(() => {
				const q = query.trim().toLowerCase();
				if (q === "") return rows;
				return rows.filter((row) => `${row.name} ${row.kind === "skill" ? row.description : row.meta}`.toLowerCase().includes(q));
			}, [rows, query]);
			const totalOn = skillsOn + mcpOn;
			const total = skillRows.length + mcpRows.length;
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
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "tab",
									"aria-selected": tab === "mcp",
									className: `skp-dock-tab${tab === "mcp" ? " skp-dock-tab-active" : ""}`,
									onClick: () => setTab("mcp"),
									children: ["MCP 服务器", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "skp-dock-tab-count",
										children: [
											mcpOn,
											" / ",
											mcpRows.length
										]
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "skp-dock-spacer" }),
							onManage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-link",
								onClick: onManage,
								children: "管理全部 ↗"
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
							children: [query.trim() !== "" ? `没有匹配「${query.trim()}」的能力` : tab === "skills" ? "本会话暂无可配置的 Skills" : "本会话暂无可配置的 MCP 服务器", query.trim() !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-link",
								onClick: () => setQuery(""),
								children: "清空搜索"
							})]
						}) : filtered.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityCard, {
							row,
							busy: busy[row.id] === true,
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
									" 项已启用 · 开关只作用于当前对话"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "skp-dock-btn",
								disabled: resetBusy,
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
		function CapabilityBar({ skillRows, mcpRows, loading, onExpand }) {
			const mcpEnabled = mcpRows.filter((row) => row.enabled).map((row) => ({
				id: row.id,
				name: row.name,
				kind: "mcp"
			}));
			const enabled = [
				...mcpEnabled.slice(0, 2),
				...skillRows.filter((row) => row.enabled).map((row) => ({
					id: row.id,
					name: row.name,
					kind: "skill"
				})),
				...mcpEnabled.slice(2)
			];
			const visible = enabled.slice(0, 5);
			const overflow = enabled.length - visible.length;
			const total = skillRows.length + mcpRows.length;
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
			const skillRows = (0, react.useMemo)(() => buildSkillRows(snapshot, pending), [snapshot, pending]);
			const mcpRows = (0, react.useMemo)(() => buildMcpRows(snapshot, pending), [snapshot, pending]);
			(0, react.useEffect)(() => {
				setPending({});
			}, [snapshot]);
			return {
				snapshot,
				loading,
				error,
				refresh,
				skillRows,
				mcpRows,
				pending,
				busy,
				toggle: (0, react.useCallback)(async (row) => {
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
						} else await api.mcp.setSessionEnabled({
							target: row.target,
							kind: row.writeKind,
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
				]),
				reset: (0, react.useCallback)(async () => {
					setError(void 0);
					try {
						const hidden = snapshot.skills.filter((skill) => skill.enabledInSession === false);
						await Promise.all(hidden.map((skill) => api.skills.setSessionEnabled({
							name: skill.name,
							enabled: true
						})));
						const overrides = [...snapshot.servers.filter((server) => server.enabledInSession !== void 0).map((server) => ({
							target: server.scope === "project" ? server.key : server.serverName,
							kind: server.scope === "project" ? "project" : "server"
						})), ...snapshot.externals.filter((server) => server.enabledInSession !== void 0 && server.restrictable === true).map((server) => ({
							target: server.serverName,
							kind: "server"
						}))];
						await Promise.all(overrides.map((item) => api.mcp.setSessionEnabled({
							target: item.target,
							kind: item.kind,
							enabled: void 0
						})));
					} catch (err) {
						setError(String(err instanceof Error ? err.message : err));
					} finally {
						refresh();
					}
				}, [
					api,
					refresh,
					setError,
					snapshot
				])
			};
		}
		function ComposerCapabilityHero({ api, onManage }) {
			const { ref, phase } = useConversationPhase();
			const isHero = phase === "hero";
			const controller = useCapabilityController(api, useWorkspaceLabel(api), isHero);
			const rect = useComposerCardRect(isHero, ref);
			const [open, setOpen] = (0, react.useState)(true);
			const placeholder = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref,
				className: "skp-dock-hero-anchor",
				"aria-hidden": "true"
			});
			if (!isHero || rect === void 0) return placeholder;
			const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
			const maxHeight = Math.max(180, Math.min(360, viewportHeight - rect.top - 24));
			const style = {
				left: `${rect.left}px`,
				top: `${rect.top}px`,
				width: `${rect.width}px`,
				maxHeight: `${maxHeight}px`
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref,
				className: "skp-dock-hero-anchor",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "skp-dock-fixed",
					style,
					children: open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityPanel, {
						mode: "hero",
						loading: controller.loading,
						error: controller.error,
						snapshot: controller.snapshot,
						skillRows: controller.skillRows,
						mcpRows: controller.mcpRows,
						pending: controller.pending,
						busy: controller.busy,
						onToggle: (row) => void controller.toggle(row),
						onReset: controller.reset,
						onRefresh: controller.refresh,
						onCollapse: () => setOpen(false),
						...onManage !== void 0 ? { onManage } : {},
						onRetry: controller.refresh
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityBar, {
						skillRows: controller.skillRows,
						mcpRows: controller.mcpRows,
						loading: controller.loading,
						onExpand: () => setOpen(true)
					})
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
						pending: controller.pending,
						busy: controller.busy,
						onToggle: (row) => void controller.toggle(row),
						onReset: controller.reset,
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
			"panel.domain.skills": "技能",
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
				const openCapabilityPanel = () => {
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
					onManage: openCapabilityPanel
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