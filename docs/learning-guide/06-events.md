# 第 6 课：事件系统

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `06-modes.ts` —— ⭐ 五种事件分发模式
> - `06-auto-remove.ts` —— 卸载自动移除监听器
> - `06-once.ts` —— once 只触发一次

## 本课目标

- 掌握五种分发模式：`emit` / `parallel` / `serial` / `bail` / `waterfall`
- 理解 `on` / `once` 与 `EventOptions`（prepend / global）
- 理解内部事件（`internal/*`）如何驱动框架自身
- 理解监听器的 ctx 过滤机制（`internal/dispatch` 与 filter）

## 核心概念

### 1. 事件注册

`ctx.on(name, listener, options)`（`src/events.ts:144-158`）：

```ts
on(name, listener, options?) {
  if (typeof options !== 'object') options = { prepend: options }
  this.ctx.fiber.assertActive()
  listener = this.ctx.reflect.bind(listener)          // ★ 包装为可追踪监听器
  const result = this.bail(this.ctx, 'internal/listener', name, listener, options)
  if (result) return result                            // ★ 内部事件可接管注册
  const hooks = this._hooks[name] ||= []
  const label = `ctx.on(${JSON.stringify(name)})`
  return this.register(label, hooks, listener, options)
}
```

- `reflect.bind` 给监听器套上 Proxy，把 this 与参数都 `trace` 到当前 ctx（`src/reflect.ts:271-280`）——调用方上下文由此传递；
- **`internal/listener` 是个 hook 点**：任何一方可以通过拦截它来接管事件注册。框架自身用它处理 `internal/update` 的 Fiber 局部 hook（`src/events.ts:54-60`）；
- `register` 把监听器放进 hooks 数组并**注册为 effect**（`src/events.ts:128-134`）——插件卸载时监听器自动移除，返回值可手动 `dispose()`。

### 2. 五种分发模式

`_resolve`（`src/events.ts:72-81`）解析 `thisArg` 与监听器列表（按注册顺序，`prepend` 控制插队），并先发 `internal/dispatch` 内部事件（非 internal 事件都会触发）。

| 模式 | 行为 | 返回值 |
|------|------|--------|
| `emit` | 同步逐个调用 | `void` |
| `parallel` | `Promise.allSettled` 并发，全部结束后若存在 rejection 抛 `AggregateError` | `Promise<void>` |
| `serial` | 逐个 **await**，**一旦有返回值立即短路**（`isBailed`） | 首个非空结果 / undefined |
| `bail` | 同步逐个调用，**一旦有返回值立即短路** | 首个非空结果 / undefined |
| `waterfall` | 共享参数的可拦截调用链：监听器 `(...args, next)`，`next` 是继续链的句柄；不调 `next` 即短路 | 最终结果 |

关键细节：

- `isBailed(value)`（`src/events.ts:6-8`）：`value !== null && value !== false && value !== undefined`——监听器返回 `null`/`false`/`undefined` 视为"继续"，返回其他值视为"拦截"；
- `waterfall`（`src/events.ts:117-126`）：监听器签名是 `(thisArg, ...args, next)`，`args` 末尾被推入 `next` 函数。**所有监听器共享同一份 `args` 引用**——要向下游传值，监听器修改参数对象（或提前拦截不调 `next`，直接返回替代值）。注意：**waterfall 的返回值来自第一个监听器的返回值**，监听器应 `return next()` 把链值逐层传回（否则得 `undefined`）。框架用它实现"可被中间件拦截的内部操作"（如 `internal/update`、`internal/get`、`internal/set`）；
- `parallel` 用 `allSettled` 保证所有监听器都执行完（不因一个失败中断），最后统一抛 `AggregateError`。

### 3. once

`once`（`src/events.ts:160-167`）包一层自注销函数：第一次触发时先 `dispose()` 再执行原监听器。

### 4. 内部事件（框架自身的事件总线）

`src/events.ts:169-177` 声明了全部内部事件。它们贯穿整个生命周期：

| 事件 | 触发时机 | 用途 |
|------|---------|------|
| `internal/plugin` | Fiber 创建/销毁 | 插件状态追踪（loader、hmr 监听） |
| `internal/status` | Fiber 状态变化 | 状态通知（`_updateState` 发出） |
| `internal/service` | 服务提供/移除 | 服务变化通知（`notify` 发出） |
| `internal/update` | 插件配置更新 | 可被 Fiber 局部 hook 拦截（`update()`） |
| `internal/get` / `internal/set` | 属性访问/赋值 | 服务查找与赋值的可拦截点 |
| `internal/listener` | 事件注册 | 可接管事件注册（如 Fiber 局部 update hook） |
| `internal/dispatch` | 事件分发前 | 全局拦截/观察所有事件 |

> 观察：`internal/status` 在 `_updateState` 中发出（`src/fiber.ts:360`），`internal/service` 在 `notify` 中发出（`src/reflect.ts:224`）——框架的「可观测性」正是通过内部事件实现的。

### 5. 监听器过滤：ctx 的作用域

`_resolve` 里的过滤逻辑（`src/events.ts:79-80`）：

```ts
.filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
```

- 每个 hook 记住注册它的 `ctx`；
- 触发时若 `thisArg` 带有 `Context.filter` 符号（`self[symbols.filter]`），则用它过滤监听器——`notify` 就利用这一点，只为「同一隔离键」的 ctx 触发 `internal/service`（`src/reflect.ts:222-225`：`self[symbols.filter] = (target) => filter(target, name)`）；
- `global: true` 的监听器跳过过滤（框架级监听）。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `src/events.ts` | 6-8 | isBailed |
| `src/events.ts` | 45-70 | 构造器中的 internal/listener 与 internal/update 接线 |
| `src/events.ts` | 72-127 | _resolve 与五种分发 |
| `src/events.ts` | 128-167 | register / unregister / on / once |
| `src/fiber.ts` | 355-369 | internal/status 触发点 |
| `src/reflect.ts` | 205-227 | internal/service 触发点与 filter |

## 动手实验

### 实验 6-1：五种模式对比

创建 `docs/learning-guide/lab/06-modes.ts`：

```ts
import { Context } from 'cordis'

const ctx = new Context()

// emit：同步全部执行
ctx.on('a', () => console.log('a1'))
ctx.on('a', () => console.log('a2'))
ctx.emit('a')

// bail：第一个有返回值的短路
ctx.on('b', () => undefined)
ctx.on('b', () => 'short-circuited')
ctx.on('b', () => console.log('never printed'))
console.log('bail result:', ctx.bail('b'))

// serial：异步版 bail（逐个 await）
ctx.on('c', async () => { await new Promise(r => setTimeout(r, 10)); return undefined })
ctx.on('c', async () => 'serial stopped')
ctx.on('c', () => console.log('never printed'))
console.log('serial result:', await ctx.serial('c'))

// waterfall：共享参数的可拦截调用链（监听器 return next() 传递链值）
ctx.on('d', (n: { v: number }, next: () => void) => { n.v *= 2; return next() })
ctx.on('d', (n: { v: number }, next: () => void) => { n.v += 1; return next() })
const state = { v: 3 }
console.log('waterfall result:', ctx.waterfall('d', state, (s: { v: number }) => s.v))   // ((3*2)+1) = 7
```

预期输出：

```
a1
a2
bail result: short-circuited
serial result: serial stopped
waterfall result: 7
```

### 实验 6-2：插件卸载自动移除监听器

```ts
import { Context } from 'cordis'

const ctx = new Context()
const events: string[] = []

const fiber = ctx.plugin((ctx) => {
  ctx.on('tick', () => events.push('listener alive'))
  ctx.effect(() => () => events.push('plugin cleaned'))
})

await fiber              // 等插件加载完成（监听器已注册）
ctx.emit('tick')
await fiber.dispose()    // 卸载插件
ctx.emit('tick')         // 监听器已随 effect 移除
console.log(events)      // ['listener alive', 'plugin cleaned']
```

### 实验 6-3：once 只触发一次

```ts
import { Context } from 'cordis'

const ctx = new Context()
let count = 0
ctx.once('ping', () => count++)
ctx.emit('ping')
ctx.emit('ping')
console.log('count:', count)   // 1
```

## 自测题

1. `bail` 与 `serial` 的区别是什么？各自的适用场景？
2. `waterfall` 监听器的签名是什么？为什么 `internal/get` 用 waterfall 而非 bail？
3. `ctx.on` 注册的监听器为什么在插件卸载后自动消失？（提示：`register` 与 effect 的关系）
4. `internal/listener` 事件的作用是什么？`internal/update` 的 Fiber 局部 hook 如何实现？
5. `notify` 发 `internal/service` 时如何保证只通知同一隔离域的 ctx？（提示：`symbols.filter`）

## 延伸阅读

- 对应测试：`packages/core/tests/events.spec.ts`
- 官方第 4 章：[事件](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial/04-events.md)
- 下一篇：[第 7 课：Logger 与工具函数](07-logger-utils.md)
