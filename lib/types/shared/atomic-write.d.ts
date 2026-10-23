/**
 * 原子写文件：临时文件 + rename（父目录按需创建）。
 *
 * mcp / overrides / skills 三个域原本各复制了一份
 * "mkdir + 带时间戳/随机后缀的临时文件 + writeFile + rename"（skills 域的
 * 临时名还缺随机后缀，同进程同毫秒并发写同一文件会撞上同一个临时文件名）。
 * 这里收敛成一份，临时名统一带随机后缀。
 *
 * @module @chengdb/capability-panel/shared/atomic-write
 */
/**
 * 原子写可选参数（additive；不传时行为与旧版完全一致）。
 *
 * 目前只有 Jev 配置使用：`mode: 0o600` 让临时文件从创建起就是 0600，rename
 * 保留该模式，密钥文件不会经历"先按 umask 可读、再 chmod"的中间态。
 * mcp / skills / overrides 三域的三参调用**不要改**，产物 mode 仍由 umask 决定。
 */
export interface AtomicWriteOptions {
    /** 写临时文件时使用的 POSIX 权限（如 `0o600`）。缺省不传 = 沿用 umask。 */
    mode?: number;
}
/**
 * 原子写入一个文本文件（自动创建父目录）。
 *
 * 用带时间戳与随机后缀的临时文件 + rename 覆盖，避免写一半留下损坏的文件，
 * 也避免同一进程同一毫秒的两个写者撞上同一个临时文件名。
 *
 * @param filePath 目标文件绝对路径
 * @param body 完整文本内容
 * @param tmpPrefix 临时文件名的语义前缀（如 "mcp" / "overrides" / "skill"）
 * @param options 可选写参数（见 {@link AtomicWriteOptions}）；缺省行为不变
 */
export declare function atomicWriteText(filePath: string, body: string, tmpPrefix: string, options?: AtomicWriteOptions): Promise<void>;
