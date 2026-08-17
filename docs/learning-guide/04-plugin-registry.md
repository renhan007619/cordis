# 第 4 课：插件系统与配置校验

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `04-config.ts` —— 配置校验（ValidationError）
> - `04-multi.ts` —— 同一插件挂载多次
> - `04-await-error.ts` —— await 插件失败传播

## 本课目标

- 深入插件三种形态的解析细节与 `name` 规则
- 理解 `RegistryService`：runtime 缓存、fibers 列表、删除语义
- 掌握 `inject` 的两种写法及其原型链解析（`Inject.resolve`）
- 掌握配置校验：Standard Schema、`resolveConfig`、`ValidationError`
- 理解插件对象（`ctx.plugin()` 返回值）为何可 await

## 核心概念

### 1. 插件形态回顾与解析

`src/registry.ts:7-9`：

```ts
function isApplicable(object: Plugin) {
  return object && typeof object === 'object' && typeof object.apply === 'function'
}
```

`resolve()`（`src/registry.ts:144-150`）把插件统一解析成回调函数：

- 函数 → 直接返回；
- 对象（含类实例，因为实例是对象且有 `apply`？不——类插件走构造函数路径）→ 返回 `.apply`；
- 无法解析 → `ctx.plugin()` 抛 `Error: invalid plugin, expect function or object with an "apply" method`（`src/registry.ts:196`）。

### 2. name 规则

`src/registry.ts:201-203`：

```ts
let name = plugin.name
if (name === 'apply') name = undefined
runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config }
```

- `name` 用于诊断与日志（`ctx.fiber.name` 沿父链找第一个非空 `runtime.name`，`src/fiber.ts:215-222`）；
- 若对象插件没写 `name`，`plugin.name` 取到的是 `'apply'`（对象字面量方法名的默认推断），会被置为 `undefined`，此时 `fiber.name` 回退为 `'root'`；
- 函数插件的 `name` 默认就是函数名（如 `hello`）。

### 3. RegistryService：以回调为键

`src/registry.ts:125-213`：

- `_internal: Map<Function, Plugin.Runtime>`：**以解析后的回调函数为键**缓存运行时；
- `Runtime` = `{ name, callback, fibers: DisposableList<Fiber>, Config }`；
- 同一插件挂载多次（如不同配置）→ 同一个 runtime，`runtime.fibers` 里多个 Fiber；
- `counter`：全局递增的 `uid` 来源（`src/fiber.ts:134`：`this.uid = parent.registry.counter`）；
- `delete(plugin)`：删 runtime 并**逐个 dispose 其所有 fiber**（`src/registry.ts:162-171`）——卸载一个插件对象 = 卸载它的所有实例。

> 思考题：`registry.delete` 与 fiber 自身的 dispose 有何关系？看 `src/fiber.ts:182-187`：fiber 卸载时会检查 `this.ctx.registry.has(runtime.callback)`，若还有别的 fiber 实例则仅从 `runtime.fibers` 移除自己；若最后一个实例被移除则 `registry.delete` runtime。这是「引用计数式」的自动回收。

### 4. inject：依赖声明

`Inject` 类型（`src/registry.ts:11-15`）两种写法：

```ts
// 数组写法：声明依赖，不传配置
ctx.plugin({ inject: ['db'], apply(ctx) { /* ctx.db 可用 */ } })

// 对象写法：声明依赖 + 默认配置
ctx.plugin({ inject: { db: { url: 'default' } }, apply(ctx) { /* ... */ } })
```

`Inject.resolve`（`src/registry.ts:43-61`）负责解析，注意 `symbols.checkProto` 分支：用 `@Inject` 装饰器在类上声明时，会把 `inject` 放在**类的原型链**上（`src/registry.ts:20-24` 的 `Object.create(Object.getPrototypeOf(value).inject ?? null)`），这样子类继承父类的依赖声明，`resolve` 时递归合并原型链。

`inject` 的两种用途（`src/fiber.ts:137-144` 与 166-168）：

1. 为 ctx 的 `intercept` 链写入依赖配置（可被服务读取）；
2. `_checkImpl(name)` 校验依赖是否可用（第 5 课详解）。

### 5. 配置校验：Standard Schema

插件可声明 `Config`（一个实现了 Standard Schema 接口的 schema 对象）。挂载时 `resolveConfig`（`src/fiber.ts:34-46`）校验：

```ts
export function resolveConfig(runtime: Plugin.Runtime, config: any) {
  if (!runtime.Config) return config
  const result = runtime.Config['~standard'].validate(config)
  if ('then' in result) throw new TypeError('Async config validation is not supported')
  if (result.issues) throw new ValidationError(result.issues)
  return result.value
}
```

- 校验发生在 fiber 首次激活时（`src/fiber.ts:173` 的 `this.config = resolveConfig(runtime, config)`），校验失败 → `_error` 被设置 → 状态 FAILED（`src/fiber.ts:350`）；
- `ValidationError`（`src/fiber.ts:16-28`）把 issue 列表格式化成可读的多行错误；
- **不支持异步校验**（显式抛错，`src/fiber.ts:38-40`）。

### 6. 可 await 的插件返回值

`src/registry.ts:208-212`：

```ts
const wrapped = Object.create(fiber) as Fiber & PromiseLike<Fiber>
wrapped.then = (onFulfilled, onRejected) => fiber.await().then(onFulfilled, onRejected)
return wrapped
```

- 返回的 wrapper 是 Fiber 的原型副本，附加了 `then`；
- `await ctx.plugin(...)` = `await fiber.await()`：等待 `inertia` 收敛、若有 `_error` 则抛出（`src/fiber.ts:460-466`）；
- 所以异步插件可以用 `await` 等待其真正加载完成，失败则拿到异常。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `src/registry.ts` | 7-9, 63-100 | 插件类型定义与 `isApplicable` |
| `src/registry.ts` | 144-171 | resolve / get / has / delete |
| `src/registry.ts` | 189-213 | inject / plugin 入口 |
| `src/registry.ts` | 43-61 | `Inject.resolve` 原型链合并 |
| `src/fiber.ts` | 34-46, 16-28 | 配置校验与 ValidationError |
| `src/fiber.ts` | 122-212 | Fiber 构造：inject、intercept、dispose 注册 |
| `src/fiber.ts` | 182-187 | 卸载时的引用计数回收 |

## 动手实验

### 实验 4-1：带配置校验的插件

创建 `docs/learning-guide/lab/04-config.ts`：

```ts
import { Context } from 'cordis'

// 一个极简 Standard Schema（也可以用 schemastery 等库生成）
const Config = {
  '~standard': {
    version: 1,
    vendor: 'lab',
    validate(value: any) {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { issues: [{ message: 'config must be an integer', path: [] }] }
      }
      return { value }
    },
  },
}

function counter(ctx: Context, config: number) {
  console.log('counter started with', config)
}

const ctx = new Context()

// 合法配置
await ctx.plugin({ name: 'counter', Config, apply: counter }, 42)

// 非法配置：抛 ValidationError
try {
  await ctx.plugin({ name: 'counter', Config, apply: counter }, 'oops')
} catch (e) {
  console.log('validation failed:', (e as Error).message)
}
```

预期输出：

```
counter started with 42
validation failed: invalid config:
  - config must be an integer
```

### 实验 4-2：同一插件挂载多次（多 Fiber 共享 runtime）

```ts
import { Context } from 'cordis'

function worker(ctx: Context) {
  console.log(`worker ${ctx.fiber.uid} started`)
}

const ctx = new Context()
ctx.plugin(worker)
ctx.plugin(worker)
console.log('runtime fibers:', ctx.registry.get(worker)!.fibers.length) // 2
```

### 实验 4-3：await 失败传播

```ts
import { Context } from 'cordis'

function boom(ctx: Context) {
  throw new Error('apply exploded')
}

const ctx = new Context()
try {
  await ctx.plugin(boom)
} catch (e) {
  console.log('await caught:', (e as Error).message)
}
```

## 自测题

1. `ctx.plugin(worker)` 两次会创建几个 runtime、几个 Fiber？`registry.get(worker)?.fibers.length` 是多少？
2. 对象插件 `{ apply(ctx) {} }` 的 `fiber.name` 是什么？为什么？
3. `registry.delete(plugin)` 与单个 fiber 的 dispose 如何协同？（提示：`src/fiber.ts:182-187` 的引用计数）
4. 一个插件的 `Config` 校验失败后，`await ctx.plugin(...)` 会发生什么？Fiber 停在哪个状态？
5. `Inject.resolve` 中 `symbols.checkProto` 分支为什么存在？（提示：类继承场景）

## 延伸阅读

- 对应测试：`packages/core/tests/plugin.spec.ts`、`packages/core/tests/decorator.spec.ts`（@Inject 装饰器）
- Standard Schema 规范：[standard-schema/spec](https://github.com/standard-schema/standard-schema)
- 下一篇：[第 5 课：服务与依赖注入](05-services-di.md)
