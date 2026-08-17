# 第 8 课：综合实战——插件组合与扩展包巡礼

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `08-task-queue.ts` —— ⭐ 综合实战：服务 + 事件 + 配置 + 清理

## 本课目标

- 综合运用前 7 课知识，编写一个「服务 + 事件 + 配置 + 清理」的完整插件
- 理解官方启动器 `bin.js`：Loader + Include 如何用 YAML 驱动插件树
- 巡礼核心之外的扩展包（loader / include / group / hmr / timer / logger-console / utils）
- 通过全部核心测试完成闭环，画出完整生命周期图

## 综合实战：任务队列服务

我们构建一个「任务队列」服务：提供方是 `TaskQueue` 服务（配置容量），消费方是「worker」插件（inject 依赖 + 监听事件），并且要验证卸载时一切被清理。

创建 `docs/learning-guide/lab/08-task-queue.ts`：

```ts
import { Context, Service } from 'cordis'

// 1. 服务提供方：可配置容量的任务队列
class TaskQueue extends Service {
  private tasks: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'taskQueue')
    const config = this[Service.resolveConfig]() as any
    this.capacity = config?.capacity ?? 10
    ctx.logger('queue').info('created with capacity %d', this.capacity)
  }

  capacity: number

  push(task: string) {
    if (this.tasks.length >= this.capacity) {
      this.ctx.logger('queue').warn('queue full, dropping %s', task)
      return false
    }
    this.tasks.push(task)
    this.ctx.emit('task/pushed', task)          // 事件通知
    return true
  }

  get size() {
    return this.tasks.length
  }
}

// 2. 消费方：依赖注入 + 事件监听 + 自动清理
//    注意：apply 用方法简写（无 prototype），否则会被当作类插件 new 调用
const worker = {
  inject: ['taskQueue'] as const,
  apply(ctx: Context) {
    const log: string[] = []
    ctx.on('task/pushed', (task: string) => log.push(`handled: ${task}`))
    ctx.effect(() => {
      log.push('worker watching')
      return () => log.push('worker stopped')
    })
    return () => console.log('worker log:', log.join(' | '))
  },
}

async function main() {
  const ctx = new Context()

  // 让日志可见（默认 exporter 只进 buffer 不打印）
  ctx.logger.exporter({
    colors: 0,
    export(message: any) {
      console.log(`[${message.name}:${message.type}]`)
    },
  })

  // 3. 用 intercept 给服务传配置
  const scoped = ctx.intercept('taskQueue', { capacity: 2 })
  scoped.plugin(TaskQueue)
  const workerFiber = scoped.plugin(worker)

  await workerFiber
  await new Promise(r => setTimeout(r, 0))

  // 4. 使用服务
  scoped.taskQueue.push('a')   // ok
  scoped.taskQueue.push('b')   // ok
  scoped.taskQueue.push('c')   // full → warn
  console.log('queue size:', scoped.taskQueue.size)

  // 5. 卸载 worker：监听器与 effect 应自动清理
  await workerFiber.dispose()
}

main()
```

预期输出（节选）：

```
[queue:info]
worker watching    ← 依赖就绪后 worker 自动加载
[queue:warn]
queue size: 2
worker log: worker watching | handled: a | handled: b
```

> 观察点：`push('c')` 时队列已满——配置 `capacity: 2` 来自 `intercept`；worker 卸载时事件监听器随 effect 消失，`worker log` 打印在 dispose 阶段。

## ⚠️ 陷阱提示：命名函数 apply 会被 `new` 调用

调试本实验时我们踩到一个隐蔽的坑，值得单独记录：

`ctx.plugin(plugin)` 解析出回调后，`_execute` 用 `isConstructor(runtime.callback)`（`src/utils.ts:76-86`）判断是「类插件」还是「函数插件」：

```ts
export function isConstructor(func: any) {
  if (!func.prototype) return false   // 箭头函数 / 方法简写 → 函数插件
  ...
  return true                          // 有 prototype → 当作类插件 new
}
```

而**普通命名函数是有 `prototype` 的**：

```ts
({ apply() {} }).apply.prototype      // undefined → 函数插件，正常调用
(function worker() {}).prototype      // {…}       → 被当作类插件，new 调用
(() => {}).prototype                  // undefined → 函数插件
```

因此：

- `ctx.plugin({ apply: worker })`（`worker` 是命名函数）→ **`new worker(ctx, config)`**：函数体照常执行，但返回值被当作"构造实例"而非 dispose——**函数返回的清理函数永远不会被收集**，卸载时静默丢失；
- `ctx.plugin(function hello(ctx) { return () => cleanup })` 同理（函数插件直接传命名函数也会被 new）；
- 直接 `ctx.plugin(hello)` 且 `hello` 只做同步工作（如打印）时看不出问题——**函数体执行正常**，坑只影响返回值。

**规避三原则**（也是官方教程的做法）：

1. **清理逻辑统一用 `ctx.effect()`**，不要依赖插件函数返回值；
2. 对象插件的 `apply` 用**方法简写**（`apply(ctx) {}`）或箭头函数；
3. 若确实要用返回值清理，插件必须写成箭头函数。

> 想亲手验证：把本实验 worker 的 `apply` 改成 `apply: function worker(ctx) {...}`，重跑——`worker log` 会消失（dispose 丢失）。这正是本课最初的版本遇到的现象。

## 官方启动器：Loader + Include

`packages/core/bin.js` 只有 16 行，却是整个配置驱动体系的入口：

```js
import { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@cordisjs/plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: './cordis.yml' },
})
```

- `Loader`（`packages/loader`）：一个**服务**，提供 `loader.create()` 等 API，管理插件树；
- `Include`（`packages/include`）：解析 `cordis.yml`（YAML 配置列表），把其中每项 `name`（模块路径或包名）挂载为插件；
- 配置项可带 `config`（经校验后传入）、`inject` 等字段——**整个应用就是一份 YAML**，这也是官方教程（DeepSeek-Harness cordis-tutorial）的运行方式。

> 实验：在 `docs/learning-guide/lab/` 下建 `cordis.yml`，内容为 `- name: './08-task-queue.ts'` 之类，然后用 `yarn tsx ../../packages/core/bin.js`（或参考 bin.js 自建启动器）运行，观察配置驱动加载。

## 扩展包巡礼

| 包 | 一句话作用 | 与核心的关系 |
|----|-----------|-------------|
| `@cordisjs/plugin-loader` | 插件树管理器：`ctx.loader.create()` | 消费 registry + reflect |
| `@cordisjs/plugin-include` | 从 YAML/JS 文件加载插件配置 | 消费 loader |
| `@cordisjs/plugin-group` | 插件分组（namespace），批量启用/停用 | 消费 loader |
| `@cordisjs/plugin-hmr` | 热模块替换：文件变化自动重载插件 | 消费 loader + timer |
| `@cordisjs/plugin-timer` | `setTimeout/setInterval` 服务化（可注入、自动清理） | 典型 Service 实现范例 |
| `@cordisjs/plugin-logger-console` | 控制台日志导出器 | 消费 logger 的 exporter |
| `@cordisjs/utils` | 通用工具（`List` 等，绑定 ctx 生命周期） | 消费 fiber 的 effect |
| `create-cordis` | 脚手架：初始化一个 Cordis 应用 | 独立 CLI |

> 推荐精读 `packages/timer`（短，Service + effect 的教科书实现）与 `packages/loader`（理解配置驱动的插件树如何用核心 API 构建）。

## 收官：跑全部核心测试

```sh
yarn vitest packages/core/tests
```

预期全部通过。然后**自己动手写一个测试**：把本课的 TaskQueue 场景写成 `packages/core/tests/lab-task-queue.spec.ts`（或放到独立目录用 vitest 跑），验证「服务替换后 worker 自动重载」。

## 完整生命周期图（总结）

```
┌─ ctx.plugin(plugin) ─────────────────────────────────────────────┐
│  Registry.resolve → callback                                      │
│  runtime = _internal.get(callback) ?? 新建                        │
│  fiber = new Fiber(ctx, config, Inject.resolve(inject), runtime)  │
│    uid = registry.counter++                                       │
│    ctx = parent.extend({ fiber })                                 │
│    intercept ← inject 配置                                        │
│    emit internal/plugin                                           │
│    _checkImpl(每个依赖)                                           │
│    dispose = parent.fiber.effect(加载逻辑)                        │
│  PENDING ──_setEpoch(有效)──► LOADING ──_execute──► ACTIVE        │
│      │       依赖变化/卸载                │ 抛错                  │
│      │        └─► UNLOADING ◄────────────┴─► FAILED              │
│      │             │                                             │
│      │             └─ disposables 逆序清理 ──► DISPOSED (uid=null)│
│  提供服务时: provide → store[isolateKey] → notify → 依赖 fiber    │
│      _checkImpl → _refresh(epoch=uid 拼接) → _reload/_unload      │
└───────────────────────────────────────────────────────────────────┘
```

## 自测题（综合）

1. 描述一次完整流程：插件 A `provide('db')` 之后，插件 B（`inject: ['db']`）是如何被"唤醒"的？涉及哪些文件、哪些方法？
2. `ctx.intercept('taskQueue', { capacity: 2 })` 的配置是怎么到达 `TaskQueue` 构造器的？画出原型链。
3. 如果把 `ctx.plugin(TaskQueue)` 改成在**根 ctx** 上加载，而 worker 在 scoped ctx 上——隔离键相同吗？worker 还能拿到服务吗？（提示：`isolate` 表继承自 root）
4. 热重载（HMR）本质上复用了哪个核心机制？（提示：epoch 变化 → _unload → _reload）
5. 用自己的话向别人解释：为什么 Cordis 被称为「可逆插件系统」？举 3 个"注册即自动撤销"的例子。

## 下一步

- 读 `packages/loader` 与 `packages/hmr` 源码，理解生产级插件系统；
- 阅读[官方 7 章教程](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial)，把 loader 驱动的写法与核心 API 对应起来；
- 阅读论文 [A Programming Paradigm for Spatiotemporal Composability](https://github.com/cordiverse/paper) 理解设计哲学；
- 参考 [cordis-rs](https://github.com/dshbox/cordis-rs)（Rust 移植）从另一视角巩固概念。

🎉 恭喜完成 Cordis 核心学习！你已具备直接阅读任何 Cordis 插件源码、并为 Koishi / DeepSeek Harness 编写插件的能力。
