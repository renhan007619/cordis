# 🎓 Cordis 核心学习指南

> 以本仓库源码（`packages/core`，Cordis **4.0.0-rc.8**）为主线，采用「读概念 + 跑实验 + 读源码」三合一的分课学习模式。
>
> **本指南的全部内容都在 `docs/learning-guide/` 这一个目录里**：9 篇课程文档 + 19 个可直接运行的实验脚本。

Cordis 是一个**元框架（Meta-Framework）**：它自身不提供业务能力，而是提供一套「插件系统运行时」——任何能力（服务、事件、配置、生命周期）都可以作为插件挂载到共享的 `Context` 上，并且在卸载时**完整撤销（可逆）**。本指南的目标是让你从**机制层面**理解这套运行时——不追求读完全部源码，而是抓住核心。

---

## 📂 目录结构（全部内容一览）

```
docs/learning-guide/                      ← 学习指南根目录（就是这里）
├── README.md                             ← 本文件：指南入口、索引、目录树
│
├── 01-hello-cordis.md                    ← 第 1 课：框架与第一个插件
├── 02-context.md                         ← 第 2 课：Context
├── 03-effect-lifecycle.md                ← 第 3 课：Effect 与生命周期（可逆性核心）
├── 04-plugin-registry.md                 ← 第 4 课：插件系统与配置校验
├── 05-services-di.md                     ← 第 5 课：服务与依赖注入
├── 06-events.md                          ← 第 6 课：事件系统
├── 07-logger-utils.md                    ← 第 7 课：Logger 与工具函数
├── 08-composition-lab.md                 ← 第 8 课：综合实战与扩展包
│
└── lab/                                  ← 实验代码目录（19 个脚本，均可直接运行）
    ├── 00-anatomy.ts                     ← ⭐ 解剖演示：new Context + plugin 的幕后
    ├── 01-hello.ts                       ← 第 1 课：第一个插件
    ├── 02-extend.ts                      ← 第 2 课：extend 原型链行为
    ├── 02-isolate.ts                     ← 第 2 课：isolate 服务隔离
    ├── 03-effect-order.ts                ← 第 3 课：effect 注册与逆序清理
    ├── 03-inactive.ts                    ← 第 3 课：在已卸载 ctx 上注册报错
    ├── 03-async-gen.ts                   ← 第 3 课：异步/生成器 effect
    ├── 04-config.ts                      ← 第 4 课：配置校验（ValidationError）
    ├── 04-multi.ts                       ← 第 4 课：同一插件挂载多次
    ├── 04-await-error.ts                 ← 第 4 课：await 失败传播
    ├── 05-service.ts                     ← 第 5 课：自定义服务 + 依赖注入
    ├── 05-dependency-removal.ts          ← 第 5 课：依赖消失 → 自动卸载
    ├── 05-intercept-config.ts            ← 第 5 课：intercept 配置注入
    ├── 06-modes.ts                       ← 第 6 课：五种事件分发模式
    ├── 06-auto-remove.ts                 ← 第 6 课：卸载自动移除监听器
    ├── 06-once.ts                        ← 第 6 课：once 只触发一次
    ├── 07-logger.ts                      ← 第 7 课：自定义 exporter
    ├── 07-intercept-logger.ts            ← 第 7 课：intercept 调整日志级别
    └── 08-task-queue.ts                  ← 第 8 课：综合实战（任务队列服务）
```

> 💡 实验文件的编号前缀与课程对应：`0N-xxx.ts` 属于第 N 课。`00-anatomy.ts` 是贯穿全文的总览演示。

---

## 📖 课程表（共 8 课）

| # | 课程 | 核心机制（30 秒版） | 配套实验 |
|---|------|-------------------|---------|
| 1 | [认识 Cordis：框架与第一个插件](01-hello-cordis.md) | 元框架；插件 = 回调；挂载 = 创建可逆实例 | `00-anatomy` `01-hello` |
| 2 | [Context：一切的核心](02-context.md) | 共享空间；extend 派生、isolate 隔离、intercept 配置 | `02-extend` `02-isolate` |
| 3 | [Effect 与生命周期：可逆性的心脏](03-effect-lifecycle.md) | **注册即登记、卸载即逆序清理**；Fiber 状态机 | `03-effect-order` `03-inactive` `03-async-gen` |
| 4 | [插件系统与配置校验](04-plugin-registry.md) | 三种形态收敛为回调；Registry；配置校验 | `04-config` `04-multi` `04-await-error` |
| 5 | [服务与依赖注入](05-services-di.md) | 服务 = 挂载的具名能力；inject 依赖；依赖变化自动重载 | `05-service` `05-dependency-removal` `05-intercept-config` |
| 6 | [事件系统](06-events.md) | emit/bail/serial/parallel/waterfall 五种分发 | `06-modes` `06-auto-remove` `06-once` |
| 7 | [Logger 与工具函数](07-logger-utils.md) | 日志格式与 exporter；可追踪代理 | `07-logger` `07-intercept-logger` |
| 8 | [综合实战：插件组合与扩展包巡礼](08-composition-lab.md) | 服务+事件+配置+清理 完整插件；扩展包一览 | `08-task-queue` |

---

## 🧪 实验索引（19 个，全部验证通过）

**统一运行方式**（在仓库根目录）：

```sh
yarn tsx docs/learning-guide/lab/文件名.ts
```

| 实验 | 所属课 | 演示的核心机制 | 关键输出 |
|------|-------|---------------|---------|
| `00-anatomy.ts` | 全程 | `new Context()` 与 `ctx.plugin()` 的幕后全貌 | 插件 ctx ≠ 根 ctx；uid=1；LOADING→ACTIVE→DISPOSED |
| `01-hello.ts` | 1 | 最小模型 + 插件完整一生（挂载→运行→卸载） | `hello() 被调用了`、`ctx !== root: true`、`ACTIVE→DISPOSED` |
| `02-extend.ts` | 2 | extend 基于原型链派生；写操作不共享 | `child.fiber === ctx.fiber: true` |
| `02-isolate.ts` | 2 | isolate 让同名服务互不干扰 | `root-db` vs `child-db` |
| `03-effect-order.ts` | 3 | 卸载时清理项**逆序**执行 | `A register → B register → -- plugin dispose -- → B dispose → A dispose` |
| `03-inactive.ts` | 3 | 已卸载 ctx 上注册抛 `INACTIVE_EFFECT` | `caught: cannot create effect...` |
| `03-async-gen.ts` | 3 | 异步/生成器 effect 的注册 | `async effect registered` |
| `04-config.ts` | 4 | Standard Schema 配置校验 | `counter started with 42` + `validation failed` |
| `04-multi.ts` | 4 | 同一插件多次挂载 = 多 Fiber 共享 runtime | `runtime fibers: 2` |
| `04-await-error.ts` | 4 | await 插件失败会抛出 | `await caught: apply exploded` |
| `05-service.ts` | 5 | Service 子类 + inject 注入 | `counter starts at 0 / after add: 5` |
| `05-dependency-removal.ts` | 5 | 依赖服务卸载 → 消费者自动卸载 | `reporter loaded \| reporter unloaded` |
| `05-intercept-config.ts` | 5 | intercept 沿派生链注入配置 | `a greeter: hi / b greeter: hello` |
| `06-modes.ts` | 6 | emit/bail/serial/waterfall 四种模式 | `bail result: short-circuited`、`waterfall result: 7` |
| `06-auto-remove.ts` | 6 | 插件卸载 → 监听器自动移除 | `['listener alive', 'plugin cleaned']` |
| `06-once.ts` | 6 | once 只触发一次 | `count: 1` |
| `07-logger.ts` | 7 | 自定义 exporter + printf 格式化 | `[demo:info] hello world, count=42` |
| `07-intercept-logger.ts` | 7 | intercept 调整日志级别 | `['info:a', 'debug:a']` |
| `08-task-queue.ts` | 8 | 服务+事件+配置+清理 综合 | `queue size: 2`、`worker log: ...` |

**一次跑完所有实验：**

```sh
# PowerShell
Get-ChildItem docs\learning-guide\lab\*.ts | ForEach-Object { yarn tsx $_.FullName }

# 或逐个运行（推荐，便于对照输出）
yarn tsx docs/learning-guide/lab/03-effect-order.ts
```

---

## 🚀 环境准备

前置要求：Node.js ≥ 20（本机为 26）、Yarn 4。

```sh
# 1. 安装依赖（在仓库根目录）
yarn install

# 2.（可选）构建所有包 —— 让从包名导入的测试（如 decorator.spec.ts）也能运行
yarn build

# 3. 运行核心包全部测试（当前 12 个文件 / 71 个用例全部通过）
yarn vitest packages/core/tests

# 4. 运行单个测试文件（例如 fiber）
yarn vitest packages/core/tests/fiber.spec.ts

# 5. 直接运行一个 TS 实验脚本（tsx 免构建）
yarn tsx docs/learning-guide/lab/xxx.ts
```

> 若 `yarn` 命令不可用：先执行 `npm install -g @yarnpkg/cli-dist` 安装 Yarn 4 CLI。

---

## 🧭 学习方法（三档强度）

**如果你只想了解核心机制（推荐）：**

1. 跑 `00-anatomy.ts` —— 看「挂载插件」的幕后全貌；
2. 读第 1 课 → 跑 `01-hello.ts`；
3. 读第 3 课的概念部分（**可逆性**）→ 跑 `03-effect-order.ts`、`03-inactive.ts`；
4. 跑 `08-task-queue.ts` 综合实战，能照着写就毕业了。
5. 其余课程当**参考手册**，用到再翻。

**中等强度：** 每课先读「核心概念」→ 跑该课配套实验 → 做自测题。

**源码强度：** 按每课「源码阅读清单」逐行精读 `packages/core/src/`，并把 `tests/` 对应 spec 对照看。

---

## 📚 参考资源

- 官方文档：[cordis.js.org](https://cordis.js.org) ｜ [Cordis Primer（官方入门，含概念图）](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)
- 官方动手教程：[DeepSeek-Harness docs/cordis-tutorial](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial)（7 章，含中文，与 Cordis v4 同源）
- 论文：[A Programming Paradigm for Spatiotemporal Composability](https://github.com/cordiverse/paper)（Cordis 背后的设计思想）
- 中文解析：[Cordis 框架代码核心解析：一个可逆插件系统的实现](https://jishuzhan.net/article/2088431344681369601)
- 关键外部依赖：[cosmokit](https://github.com/cordiverse/cosmokit)（工具库）、[@standard-schema/spec](https://github.com/standard-schema/standard-schema)（配置校验标准）
