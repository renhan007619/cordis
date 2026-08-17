# 第 3 课：Effect 与生命周期——可逆性的心脏

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `03-effect-order.ts` —— ⭐ effect 注册与**逆序清理**
> - `03-inactive.ts` —— 在已卸载 ctx 上注册报错
> - `03-async-gen.ts` —— 异步/生成器 effect

> 这是 Cordis 最核心的一课。整个框架的「可逆性」承诺都由本课机制保证。请放慢节奏精读。

## 本课目标

- 理解 `ctx.effect()`：注册一个可自动撤销的副作用
- 掌握 Fiber 的六态状态机与 `inertia` 迁移机制
- 理解 dispose 的**逆序**执行与错误吞没策略
- 理解 `epoch` 如何驱动加载/卸载切换
- 能画出插件从加载到卸载的完整生命周期图

## 核心概念

### 1. Effect：可逆性的最小单元

Cordis 中**一切注册**（事件监听、服务提供、定时器……）最终都通过 `ctx.effect(execute)` 挂到当前 Fiber 上（`src/fiber.ts:275-340`）。

`execute` 的返回值（Effect）可以是：

| 返回类型 | 含义 |
|---------|------|
| `() => void` | dispose 函数：卸载时调用 |
| `null / undefined` | 无清理逻辑 |
| `Promise<dispose>` | 异步产生 dispose |
| `Iterable<dispose>` | 同步生成多个 dispose |
| `AsyncIterable<dispose>` | 异步生成多个 dispose（每次迭代间检查 epoch） |

`_execute`（`src/fiber.ts:229-273`）按类型分派处理。**所有返回的 dispose 都会压入 `this._disposables`**（一个 `DisposableList`）。

### 2. DisposableList：序号管理的清理队列

`src/utils.ts:4-39`：

```ts
export class DisposableList<T extends WeakKey> {
  private sn = 0
  private map = new Map<number, T>()
  private weak = new WeakMap<T, number>()

  push(value: T) { ... }        // 返回「按序号删除」的注销函数
  delete(value: T) { ... }      // 按值找序号再删除
  clear() {                      // ★ 返回逆序数组
    const values = [...this.map.values()]
    this.map.clear()
    return values.reverse()
  }
}
```

- `push` 返回一个注销函数（O(1) 删除），这是 `ctx.on()` 的返回值能直接当 dispose 用的原因；
- `clear()` **逆序**返回全部条目——后注册的先清理，这是「依赖倒置清理」的关键：子 effect 先于父 effect 撤销。

### 3. Fiber 状态机

`src/fiber.ts:78-85`：

```ts
export const enum FiberState {
  PENDING,    // 待激活
  LOADING,    // 正在加载（异步回调执行中）
  ACTIVE,     // 活跃：回调执行完毕且未出错
  FAILED,     // 加载失败（回调抛错）
  DISPOSED,   // 已被卸载（uid 置 null）
  UNLOADING,  // 正在卸载
}
```

一个插件 Fiber 的生命周期：

```
plugin() ──> PENDING ──(epoch 从 INACTIVE 变为有效)──> LOADING ──(回调完成)──> ACTIVE
                                                          │
                                                          └──(回调抛错)──> FAILED
dispose()/卸载 ──> UNLOADING ──(disposables 清空)──> DISPOSED (uid = null)
```

状态迁移通过 `_updateState`（`src/fiber.ts:355-369`）驱动：状态变化时发出 `internal/status` 内部事件，并在 ACTIVE ⇄ 非 ACTIVE 切换时通知依赖它的服务消费者（第 5 课的 `notify`）。

### 4. epoch 与 inertia：异步加载的「惯性」

这是 Fiber 设计中最精妙的部分。一个插件可能**在加载途中就被要求卸载**（依赖的服务被替换），也可能**在卸载途中又被要求加载**。Cordis 用两个变量解决竞态：

- **`epoch`**（`_runner.epoch`）：当前生命周期意图的编码。对插件 Fiber 而言，`epoch` 是 `INACTIVE` 或由所依赖服务的 uid 拼接而成的字符串（`_refresh`，`src/fiber.ts:385-397`）；依赖变化 → epoch 变化 → 需要重载。
- **`inertia`**（惯性）：当前正在进行的异步迁移的 Promise。`_setEpoch`（`src/fiber.ts:399-413`）在已有 `inertia` 时**不新开迁移**，只更新 epoch；等当前 `_reload`/`_unload` 完成后再看 epoch 是否还是旧值，决定继续加载还是反向卸载（`src/fiber.ts:415-458` 的相互调用）。

```
_reload() ──(epoch 变了)──> _unload()
_unload() ──(epoch 又变了)──> _reload()
```

两者像两个齿轮咬合，直到 epoch 稳定。`await fiber.await()`（`src/fiber.ts:460-466`）循环等待 `inertia` 收敛。

### 5. dispose：逆序清理 + 错误吞没

`effect()` 内层的 `dispose()`（`src/fiber.ts:281-294`）：

```ts
const dispose = () => {
  let task!: void | Promise<void>
  for (const dispose of disposables.splice(0).reverse()) {   // 逆序
    if (task) task = task.then(dispose)                       // 异步链式
    else { const result = dispose(); if (isObject(result) && 'then' in result) task = result }
  }
  return task
}
```

- 逆序执行，保证「后注册的先清理」；
- 异步 dispose 用 Promise 链串行化；
- Fiber 卸载时（`_unload`，`src/fiber.ts:437-458`）对每个 dispose 包 `composeError` 并 `ctx.logger.error(reason)` **吞掉错误**——单个插件清理失败不影响其他插件的卸载（但会记录日志）。

### 6. 两个典型错误场景

- **在非活跃 ctx 上注册**：`ctx.effect()` 首先 `assertActive()`（`src/fiber.ts:224-227, 278`），若 Fiber 已被 dispose（`uid === null`）则抛 `CordisError('INACTIVE_EFFECT')`；
- **无效 effect 返回值**：`_execute` 对既不是函数也不是可迭代/可 await 的值抛 `TypeError('Invalid effect')`（`src/fiber.ts:234-271`）。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `src/utils.ts` | 4-39 | DisposableList：清理队列 |
| `src/fiber.ts` | 78-101 | 状态枚举与 CordisError |
| `src/fiber.ts` | 229-273 | `_execute`：Effect 类型分派 |
| `src/fiber.ts` | 275-340 | `effect()`：注册与包装 |
| `src/fiber.ts` | 348-413 | 状态计算、`_setEpoch`、`_refresh` |
| `src/fiber.ts` | 415-466 | `_reload` / `_unload` / `await` |
| `src/fiber.ts` | 468-486 | `restart` / `update` |

## 动手实验

### 实验 3-1：effect 的注册与逆序清理

```ts
import { Context } from 'cordis'

const ctx = new Context()

const fiber = ctx.plugin((ctx) => {
  const log: string[] = []

  ctx.effect(() => {
    log.push('A register')
    return () => log.push('A dispose')
  })

  ctx.effect(() => {
    log.push('B register')
    return () => log.push('B dispose')
  })

  // 插件自身返回的 dispose
  return () => {
    log.push('-- plugin dispose --')
    console.log(log.join('\n'))
  }
})

// 手动卸载插件，触发逆序清理
await fiber
await fiber.dispose()
```

运行预期输出：

```
A register
B register
-- plugin dispose --
B dispose
A dispose
```

> 要点：插件**自身返回的 dispose** 是最后一个被 `_execute` 收集进 `_disposables` 的，因此卸载时最先执行；两个 effect 的 dispose 按注册逆序（B 先于 A）。若不加 `fiber.dispose()`，插件永远不会卸载——程序退出即结束，清理不会发生。

### 实验 3-2：异步 effect 与生成器 effect

```ts
import { Context } from 'cordis'

const ctx = new Context()
ctx.plugin((ctx) => {
  ctx.effect(async () => {
    console.log('async effect registered')
    return () => console.log('async effect disposed')
  })

  ctx.effect(function* () {
    console.log('gen effect: step 1')
    yield () => console.log('gen effect: step 1 disposed')
    console.log('gen effect: step 2')
    yield () => console.log('gen effect: step 2 disposed')
  })
})
```

### 实验 3-3：在已卸载的 ctx 上注册会抛错

```ts
import { Context } from 'cordis'

const ctx = new Context()
let fiber: any
let pluginCtx: Context

fiber = ctx.plugin((ctx) => {
  pluginCtx = ctx
  console.log('plugin loaded')
})

await fiber            // 等待加载完成
await fiber.dispose()  // 卸载插件

try {
  pluginCtx.effect(() => {})  // 在已卸载插件的 ctx 上注册
} catch (e) {
  console.log('caught:', (e as Error).message)
}
```

预期输出：

```
plugin loaded
caught: cannot create effect on inactive context
```

> 关键：插件的 `ctx.fiber.uid` 在卸载时被置为 `null`（`src/fiber.ts:180`），而 `effect()` 开头调用 `assertActive()`（`src/fiber.ts:278`）检测 `uid === null` 即抛 `CordisError`。根 Context 的根 Fiber 永不 dispose，所以在根 ctx 上注册不会抛错——这也解释了为什么应用关闭后还能安全地创建新 Context。

## 自测题

1. `DisposableList.clear()` 为什么要逆序返回？给出一个「先注册的依赖后注册的」的例子说明逆序清理的正确性。
2. Fiber 的 `epoch` 在插件 Fiber 中由什么组成？为什么依赖服务变化会导致 epoch 变化？
3. 插件在加载途中被卸载会发生什么？`inertia` 的作用是什么？
4. `ctx.effect(() => 'not a function')` 会怎样？（提示：`_execute` 的 `Invalid effect`）
5. 画出插件从 `plugin()` 到 `dispose()` 的完整状态迁移图，标注每个转移的触发条件。

## 延伸阅读

- 对应测试：`packages/core/tests/fiber.spec.ts`（8 个用例，强烈推荐逐条对照）
- 下一篇：[第 4 课：插件系统与配置校验](04-plugin-registry.md)
- 官方第 2 章：[生命周期与 effect](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial/02-lifecycle-and-effects.md)
