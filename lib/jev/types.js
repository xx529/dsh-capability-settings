/**
 * Jev 能力决策：宿主与客户端共用的类型、默认值与错误码。
 *
 * 契约来源：`docs/architecture/jev-capability-decision.md` §3.4 / §5.2。
 *
 * 本文件**不**引用任何宿主服务，保证可以被客户端类型镜像与单元测试直接
 * import。宿主内部使用的 `JevCapability` 等类型也放在这里，避免
 * `rank.ts` / `apply.ts` 之间循环依赖。
 *
 * @module @chengdb/capability-panel/jev/types
 */
/** 一次默认配置（每次返回新对象，避免调用方改到共享引用）。 */
export function defaultJevConfig() {
    return {
        baseURL: "https://api.typesafe.ai",
        model: "jev-latest",
        apiKeyEnv: "TYPESAFE_API_KEY",
        autoTrigger: { enabled: false, pauseMs: 1000, minChars: 10, minEditChars: 4 },
        timeoutMs: 30000,
    };
}
