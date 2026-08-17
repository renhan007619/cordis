# 第 7 课：Logger 与工具函数

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `07-logger.ts` —— 自定义 exporter + 格式化
> - `07-intercept-logger.ts` —— intercept 调整日志级别

## 本课目标

- 掌握 Logger 的格式化、级别与 exporter 机制
- 理解 `createCallable`：可调用服务对象
- 理解 `traceable`：上下文追踪代理（getTraceable / withProps / withProp）
- 理解 `composeError`：长堆栈（long stack trace）
- 理解 `symbols.tracker` 如何串联这一切

## 核心概念

### 1. Logger：格式化与级别

`Logger`（`src/logger.ts:69-148`）：

- 构造时生成四个方法 `error/info/warn/debug`，对应级别 `0/1/2/3`（`LoggerLevel`，`src/logger.ts:18-23`）；
- `format`（`src/logger.ts:85-117`）实现 printf 风格格式化：`%s`、`%d`/`%i`、`%f`、`%o`/`%O`（JSON）、`%c`（清屏符）、`%C`（按名称哈希染色）；首个参数是 Error 时自动输出 `stack`，非字符串自动补 `%o`；
- 单行长度受 `maxLength`（默认 10240）截断；
- 颜色：`Logger.color` 按 exporter 的 `colors` 等级输出 ANSI 码，`Logger.code` 用名称哈希选色（`src/logger.ts:70-83`）。

### 2. LoggerService：可调用的服务

`LoggerService`（`src/logger.ts:170-246`）是一个**可调用对象**：`ctx.logger('foo')` 返回一个命名 Logger，`ctx.logger.info(...)` 直接使用推导名称。

实现（`src/logger.ts:179-204`）：

```ts
constructor(ctx: Context) {
  const tracker: Tracker = { property: 'ctx', noShadow: true }
  const self = createCallable('logger', joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker)
  Object.assign(self, this)      // 把实例方法拷到可调用对象上
  self.ctx = ctx
  defineProperty(self, symbols.tracker, tracker)
  ...
  return self
}
```

- 默认 exporter：写入 `buffer`（容量 `bufferSize`，默认 1000，超出丢最旧的）；
- `exporter(exporter)` 注册导出器（本身是 effect，卸载时移除）——**日志系统的可插拔点**：console 导出器、Web 面板导出器（`packages/logger-console`）都是 exporter；
- `[symbols.invoke](name?)`（`src/logger.ts:226-237`）：调用时解析 `intercept` 链上的 `logger` 配置（`_resolveConfig`），`name` 默认取调用者 Fiber 名（hyphenate）——**这正是 `ctx.intercept('logger', { level })` 能调级别的原因**；
- 四个方法也挂在服务本身上（`src/logger.ts:239-245`）：`ctx.logger.info(...)` 等价于 `ctx.logger().info(...)`。

### 3. createCallable 与 joinPrototype

`createCallable(name, proto, tracker)`（`src/utils.ts:219-226`）：

```ts
export function createCallable(name: string, proto: {}, tracker: Tracker) {
  const self = function (...args: any[]) {
    const proxy = createTraceable(self['ctx'], self, tracker)
    return Reflect.apply(proxy, this, args)
  }
  defineProperty(self, 'name', name)
  return Object.setPrototypeOf(self, proto)
}
```

- 返回一个**函数对象**，其原型被换成 `proto`（`joinPrototype`，`src/utils.ts:88-95`，把类原型与 Function.prototype 的链合并），因此它同时「可调用」又「instanceof Service」；
- 调用时把自身 trace 到 ctx，然后分派给 `[symbols.invoke]`（若存在，`applyTraceable`，`src/utils.ts:214-217`）。

### 4. traceable：上下文追踪代理

`getTraceable(ctx, value)`（`src/utils.ts:110-118`）与 `createTraceable`（`src/utils.ts:157-212`）：

- 任何**带有 `symbols.tracker` 的对象**（服务实例、Logger 等）被从 ctx 上取到时，都会被包成追踪代理；
- 代理的关键行为：
  - `get` 拦截：`prop === tracker.property` 时返回**当前 ctx**（如 `ctx.logger` 的 `property: 'ctx'`，取到 logger 再访问 `.ctx` 得到的是当前 ctx）；`associate` 命中的关联属性（`${associate}.${prop}`，如 `logger.error`）从 `ctx.reflect.props` 查、转发到 `ctx`（`src/utils.ts:170-172, 198-200`）——这是 `ctx.on()` 能被 mixin 又保持 this 指向的细节；
  - 方法访问返回**shadow 包装**（`createShadowMethod`，`src/utils.ts:148-155`）：调用时若 `thisArg === outer` 则替换为 shadow ctx——保证方法里的 `this.ctx` 是调用方 ctx；
  - `symbols.caller` / `symbols.original` 两个保留属性用于逃逸；
- `withProps(target, props)`（`src/utils.ts:120-132`）：把附加属性优先于原对象注入（读/写都先查 props）——`@Inject` 方法包装和 `ctx.extend` 的 shadow 都用它。

> 一句话总结：**traceable 让"从哪个 ctx 拿到的对象，方法调用时就携带哪个 ctx"**。这是 Cordis 能把同一服务实例安全地共享给多个隔离上下文的关键。

### 5. composeError：长堆栈

`composeError(callback, getOuterStack)`（`src/utils.ts:260-273`）与 `handleError`（`src/utils.ts:233-258`）：

- 执行回调时先记录当前栈帧（`info.error`）作为内层锚点；
- 若回调抛出异步错误，把错误栈中内层部分替换为「外层注册点的栈」（`getOuterStack`，`src/utils.ts:275-277` 预先构建）——于是你能看到**错误来自哪个 effect 注册点**，而不仅是执行点；
- Fiber 的 `_execute`（`src/fiber.ts:229-273`）与卸载逻辑（`src/fiber.ts:440-444`）都用它包裹，效果：插件回调里抛错，堆栈会包含 `ctx.plugin()` 调用处。

### 6. symbols.tracker 协议

`Tracker`（`src/utils.ts:41-45`）：`{ associate?, property?, noShadow? }`。所有「挂到 ctx 上的对象」都应通过 `defineProperty(obj, symbols.tracker, tracker)` 声明自己是可追踪的（服务实例 `src/service.ts:31`、LoggerService `src/logger.ts:187`、RegistryService `src/registry.ts:130-133`、EventsService `src/events.ts:49-52` 等）。没有 tracker 的对象从 ctx 取出时不会被包装。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `src/logger.ts` | 18-23, 69-148 | 级别、格式化、颜色 |
| `src/logger.ts` | 159-246 | LoggerService：createCallable、exporter、invoke |
| `src/utils.ts` | 88-95, 110-118 | joinPrototype、getTraceable |
| `src/utils.ts` | 120-212 | withProps、shadow、createTraceable |
| `src/utils.ts` | 214-226 | applyTraceable、createCallable |
| `src/utils.ts` | 233-277 | handleError、composeError、buildOuterStack |

## 动手实验

### 实验 7-1：自定义 exporter

创建 `docs/learning-guide/lab/07-logger.ts`：

```ts
import { Context, Logger } from 'cordis'

const ctx = new Context()

const exporter = {
  colors: 0,           // 关闭颜色，便于观察
  export(message: any) {
    // Logger.format 应用 printf 格式化（%s/%d/%o/...）
    console.log(`[${message.name}:${message.type}] ${Logger.format(exporter, message)}`)
  },
}
ctx.logger.exporter(exporter)

ctx.logger('demo').info('hello %s, count=%d', 'world', 42)
ctx.logger('demo').warn('a warning')
ctx.logger.error(new Error('boom'))
```

预期输出（节选）：

```
[demo:info] hello world, count=42
[demo:warn] a warning
[demo:error] Error: boom
    at ...
```

> 说明：`message.args` 是**原始参数引用**（含 Error 对象），要得到格式化后的文本需调用 `Logger.format(exporter, message)`（`src/logger.ts:85-117`）。`ctx.logger.error(...)` 未传名称时名字回退为 `root`。

### 实验 7-2：intercept 调整日志级别

```ts
import { Context } from 'cordis'

const ctx = new Context()
const seen: string[] = []

ctx.logger.exporter({
  colors: 0,
  export(message) {
    if (message.level <= 2) seen.push(`${message.type}:${message.name}`)
  },
})

ctx.logger('a').info('visible')
ctx.logger('a').debug('hidden by default')

// 子树中把 a 的级别调到 DEBUG(3)
const scoped = ctx.intercept('logger', { name: 'a', level: 3 })
scoped.logger('a').debug('now visible in scoped context')

console.log(seen)   // ['info:a', 'debug:a']
```

### 实验 7-3：traceable 的 ctx 传递

```ts
import { Context } from 'cordis'

const ctx = new Context()

// 一个带 tracker 的服务：方法里读 this.ctx.fiber.name
const svc = {
  [Symbol.for('cordis.tracker')]: { property: 'ctx' },
  ctx: ctx,
  name: 'svc',
  whoami() {
    return (this as any).ctx.fiber.name
  },
}
ctx.provide('svc', svc)

ctx.plugin((ctx) => {
  console.log('from plugin ctx:', ctx.svc.whoami())   // 应为插件名
})

ctx.plugin(function named(ctx) {
  console.log('with thisArg:', ctx.svc.whoami.call(ctx)) // 显式传 this
})
```

## 自测题

1. `ctx.logger('a')` 与 `ctx.logger.info(...)` 两条路径分别如何工作？`[symbols.invoke]` 的作用？
2. `createCallable` 返回的对象为什么能 `instanceof Service`？
3. traceable 代理的 `property` 字段（如 `'ctx'`）控制什么行为？`noShadow: true` 有何不同？
4. `composeError` 如何让异步错误的堆栈包含注册点？`buildOuterStack` 为什么预先构建？
5. 为什么没有 `symbols.tracker` 的对象从 ctx 取出后不会被包装？（提示：`getTraceable` 的判断）

## 延伸阅读

- 对应测试：`packages/core/tests/logger.spec.ts`、`tests/reflect.spec.ts`、`tests/associate.spec.ts`
- 控制台导出器实现：`packages/logger-console/src/`
- 下一篇：[第 8 课：综合实战——插件组合与扩展包巡礼](08-composition-lab.md)
