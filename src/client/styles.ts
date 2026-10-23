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

// 设计令牌：颜色 / 圆角 / 缓动，全部可在 .skp-panel 一层覆盖。
// 交互控件（按钮、输入框、下拉框）统一的过渡曲线。
// 下拉按钮与弹出列表共享同一套描边 / 圆角 / 层级约定（z-index 120 高于
// 模态框 95）。面板本体不再是浮层（占据主区域，见 panel-entry.tsx），
// popover/footer 相关规则已随入口迁移删除；.skp-backdrop 保留备用。
//
// .skp-main 是主区域页面包装（panel-entry.tsx 的 CapabilityPanelPage）：
// 撑满 layout 主区域的 flex 列，并把内部滚动限制在页面内。
//
// .skp-nav-glyph 是侧栏 `sidebar.panellist` 入口的**图标本体**（同样见
// panel-entry.tsx）：该子树在 .skp-panel 之外，拿不到 --skp-* 令牌，只能
// 用宿主 --dsw-alias-*，颜色默认继承侧栏按钮的 currentColor。
//
// skp-composer-* 是输入框工具行的 MCP 快捷开关与 Skills 快捷输入
// （见 composer-mcp.tsx / composer-skills.tsx）：按钮与弹层都注册在输入区
// 槽位（conversation.input.left / .overlay），
// 不在 .skp-panel 子树内，因此这组规则不复用 --skp-* 令牌，一律直接用
// 宿主的 --dsw-alias-* 主题变量（加中性色兜底），跟随宿主主题/明暗切换。
// 弹层层级 119 低于下拉弹出列表 120。
// 注意：.skp-composer-pop 的 left:0 只是无锚点时的退化位；JSX 内联改用
// right 定位时必须同时写 left:"auto" 解除它——fixed + 定宽元素同时带
// left/right 属于过度约束，LTR 下浏览器会忽略 right 采用 left:0，
// 弹层会被钉到视口左缘（盖住侧边栏）。
export const SKP_CSS = `
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
export function installStyles(): () => void {
  const id = "dsh-capability-panel-css";
  if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${id}"]`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@chengdb/capability-panel";
    tag.dataset.pluginCss = id;
    tag.textContent = SKP_CSS;
    document.head.appendChild(tag);
    return () => tag.remove();
  }
  return () => undefined;
}
