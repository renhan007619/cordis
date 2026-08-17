# 第 1 课：认识 Cordis——框架与第一个插件

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `00-anatomy.ts` —— ⭐ 解剖演示：`new Context()` + `ctx.plugin()` 的幕后全貌
> - `01-hello.ts` —— 第一个插件

## 本课目标

- 理解 Cordis 的定位：一个**元框架（Meta-Framework）**，一切能力都是插件
- 看懂本仓库的 monorepo 结构，知道核心代码在哪里
- 掌握插件系统的三种形态，能写出第一个插件
- 跑通「测试」与「直跑脚本」两条实验路径

## Cordis 是什么？

Cordis 不提供任何业务能力，它提供的是**承载能力的运行时**：

- 一个全局共享的 `Context` 对象；
- 把「能力」以插件形式挂载到 `Context` 上的机制；
- 一套保证**可逆性（reversibility）**的生命周期系统——插件卸载时，它注册的一切（服务、事件监听、副作用）都会被完整撤销，不留痕迹。

官方论文称之为 *Spatiotemporal Composability*（时空组合性）：
- **空间（Spatial）**：多个插件共存于同一个应用，通过依赖关系（`inject`）组合；
- **时间（Temporal）**：插件可以随时加载/卸载/重载，系统状态随之正确迁移。

Cordis 是 Koishi 生态的核心依赖，也是 DeepSeek Harness 的底层框架。本仓库即其 v4 源码（`cordis@4.0.0-rc.8`）。

## 仓库结构

```
packages/
├── core/        ← ★ Cordis 核心（包名 cordis），本指南的主战场
├── loader/      ← 配置驱动的插件加载器（第 8 课）
├── include/     ← 从 YAML 文件加载插件配置
├── group/       ← 插件分组（namespace）
├── hmr/         ← 热模块替换
├── timer/       ← 定时器服务
├── logger-console/ ← 控制台日志导出器
├── create/      ← 脚手架（create-cordis）
└── utils/       ← 通用工具（List 等）
```

核心包 `packages/core/src/` 只有 9 个文件，全部精读是可行的：

| 文件 | 行数 | 职责 |
|------|-----|------|
| `index.ts` | 7 | 入口，纯 re-export |
| `context.ts` | 78 | `Context` 类：核心对象 |
| `fiber.ts` | 486 | `Fiber`：生命周期与 effect（最核心） |
| `events.ts` | 178 | 事件系统 |
| `registry.ts` | 214 | 插件注册表 |
| `reflect.ts` | 281 | 反射服务：属性代理与依赖注入 |
| `service.ts` | 80 | `Service` 基类 |
| `logger.ts` | 246 | 日志服务 |
| `utils.ts` | 278 | 工具：DisposableList、symbols、长堆栈等 |

## 最小运行模型

Cordis 的最小模型只有两件事：

```ts
import { Context } from 'cordis'

const ctx = new Context()          // 1. 创建根上下文
ctx.plugin(hello)                  // 2. 挂载插件 —— 函数立即被调用
```

`Context` 构造器做了什么（`src/context.ts:36-49`）：

```ts
constructor() {
  this[symbols.isolate] = Object.create(null)
  this[symbols.intercept] = Object.create(null)
  const self = new Proxy<this>(this, ReflectService.handler)  // ★ 自身被代理
  this.root = self
  this.baseUrl = undefined
  this.fiber = new Fiber(self, {}, Object.create(null), null, () => [])  // 根 Fiber
  this.reflect = new ReflectService(self)   // 反射服务
  this.registry = new RegistryService(self) // 插件注册表
  this.events = new EventsService(self)     // 事件服务
  this.logger = new LoggerService(self)     // 日志服务
  this.fiber._disposables.clear()
  return self                              // ★ 返回的是 Proxy 而非 this
}
```

三个要点：

1. **`Context` 是自身的一个 Proxy**（`ReflectService.handler`）——所有属性访问都要经过代理，这是服务注入/隔离/拦截的根基（第 2、5 课深入）；
2. **根 Fiber 在构造时就创建**，且 `runtime = null`——根 Fiber 没有插件回调，只负责持有生命周期；
3. 四个内置服务（reflect / registry / events / logger）都在构造器中创建，所以任何插件开箱即用 `ctx.on(...)`、`ctx.logger(...)`。

## 插件：三种形态

任何插件最终都被解析成一个**回调函数**（见 `src/registry.ts:144-150`）：

```ts
resolve(plugin: Plugin): Function | undefined {
  try {
    if (typeof plugin === 'function') return plugin        // 函数插件
    if (isApplicable(plugin)) return plugin.apply           // 对象插件：取 apply 方法
  } catch {}
}
```

因此有三种写法（`tests/plugin.spec.ts` 里有全部用例）：

```ts
import { Service, type Context } from 'cordis'

// 1. 函数插件：最常见
export function hello(ctx: Context) {
  ctx.logger('hello').info('hi')
}

// 2. 对象插件：带 apply 方法的对象
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) { /* ... */ },
}

// 3. 类插件：Service 子类（第 5 课详解）
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

挂载时（`src/registry.ts:193-213` `plugin()`）：
1. 解析出回调 `callback`；
2. 以回调为键缓存 `runtime`（含 `fibers` 列表、`Config`）；
3. 创建新的 `Fiber`（带递增 `uid`）并**立即进入加载流程**；
4. 返回一个「可 await 的 Fiber」——`await ctx.plugin(...)` 可等待其加载完成。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `packages/core/src/index.ts` | 全部 | 核心导出面 |
| `packages/core/src/context.ts` | 36-49 | Context 构造器与内置服务 |
| `packages/core/src/registry.ts` | 144-150, 193-213 | 插件解析与挂载 |
| `packages/core/bin.js` | 全部 | 官方启动器：`new Context()` + `ctx.plugin(Loader)` |
| `packages/core/tests/plugin.spec.ts` | 全部 | 插件机制的测试用例（推荐对照读） |

## 动手实验

### 实验 1-1：第一个插件 —— 最小模型与「完整一生」

**探究什么**：最小模型 `new Context()` + `ctx.plugin(hello)`；挂载即运行；插件拿到的 ctx 是新的（有自己的工作空间）；实例有 uid 和名字；`dispose()` 卸载时清理函数自动执行（可逆性）。

文件 `docs/learning-guide/lab/01-hello.ts` 里完整写明了「探究什么 + 怎么进行 + 代码」三段正文，核心代码如下：

```ts
import { Context, FiberState } from 'cordis'

const hello = (ctx: Context) => {
  console.log(`hello from ${ctx.fiber.name}`)   // 插件名 = 实例的身份证
  return () => console.log('清理函数执行')        // 卸载时自动调用
}

const root = new Context()
const fiber = root.plugin(hello)   // 挂载，返回可 await 的 Fiber
await fiber                        // 等加载完成
await fiber.dispose()              // 卸载（触发清理）
```

运行：

```sh
yarn tsx docs/learning-guide/lab/01-hello.ts
```

预期输出：

```
plugin() 已返回（hello 还没执行——加载是异步的）

hello() 被调用了
· 插件 ctx 是新的：ctx !== root → true
· 我的实例编号 uid = 1
· 我的插件名 = hello
await 之后：fiber 状态 = ACTIVE

· [清理函数执行：插件已卸载，一切已撤销]
dispose 之后：fiber 状态 = DISPOSED
```

> 观察点：`plugin()` 返回时 hello **还没执行**（加载是异步的，需要 `await`）；`ctx.fiber.name` 取自插件名字；卸载时返回的清理函数被自动调用。

### 实验 1-2：解剖三行代码（核心原理验证）

创建 `docs/learning-guide/lab/00-anatomy.ts`：

```ts
import { Context, FiberState } from 'cordis'

const ctx = new Context()          // ① 创建根上下文（返回的是 Proxy）
const root = ctx

const hello = (ctx: Context) => {
  console.log('hello() 被调用')
  console.log('· 插件 ctx ≠ 根 ctx：', ctx !== root)
  console.log('· ctx.fiber.uid =', ctx.fiber.uid)
  console.log('· fiber 状态 =', FiberState[ctx.fiber.state])
}

const fiber = ctx.plugin(hello)
await fiber                        // 等加载完成（异步）
await fiber.dispose()              // 卸载（可逆）
```

运行：

```sh
yarn tsx docs/learning-guide/lab/00-anatomy.ts
```

预期输出（节选）：

```
hello() 被调用
· 插件 ctx ≠ 根 ctx： true
· ctx.fiber.uid = 1
· fiber 状态 = LOADING
```

> 完整版见 `lab/00-anatomy.ts`：它把三行代码拆成三个阶段（import / new Context / plugin），每个阶段打印证据——`ctx.root === ctx`（Proxy 痕迹）、访问不存在属性被门卫拦截、LOADING→ACTIVE→DISPOSED 状态机流转。

### 实验 1-3：跑核心测试

```sh
yarn vitest packages/core/tests/plugin.spec.ts
```

预期输出（节选）：

```
 ✓ packages/core/tests/plugin.spec.ts (N tests)
```

全部通过即代表你的环境与源码状态一致。

## 自测题

1. `new Context()` 返回的 `self` 是什么？为什么返回的是它而不是 `this`？
2. 插件在 Cordis 中被解析成什么？`ctx.plugin(object)` 最终调用的是哪个属性？
3. `await ctx.plugin(...)` 为什么能 await？返回值的 `then` 是谁提供的？（提示：`src/registry.ts:208-212`）
4. 根 Fiber 与插件 Fiber 的关键区别是什么？（提示：`runtime` 是否为 null）

## 延伸阅读

- 官方入门：[Cordis Primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)
- 官方第一课：[DeepSeek-Harness cordis-tutorial 第 1 章](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial)（loader 驱动的写法，第 8 课会复现）
- 下一篇：[第 2 课：Context——一切的核心](02-context.md)
