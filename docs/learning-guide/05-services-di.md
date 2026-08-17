# 第 5 课：服务与依赖注入

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `05-service.ts` —— 自定义服务 + 依赖注入
> - `05-dependency-removal.ts` —— ⭐ 依赖消失 → 消费者自动卸载
> - `05-intercept-config.ts` —— intercept 配置注入

## 本课目标

- 理解 `Service` 基类与「服务即类插件」的统一模型
- 掌握 `provide` / `get` / `set` / `accessor` / `mixin` 五个反射 API
- 理解服务的**隔离键**（isolate symbol）与 `store` 仓库
- 掌握 `@Inject` 装饰器与 `intercept` 配置注入
- 理解依赖热替换：`notify → _checkImpl → _refresh → epoch` 链路

## 核心概念

### 1. 服务是什么？

服务（Service）是挂在 `ctx` 上的**具名能力**，例如 `ctx.logger`、`ctx.events`。从插件角度看：

- **提供方**：`ctx.provide(name, value)` 注册；更常见的是 `class X extends Service` 后 `ctx.plugin(X)`——类插件构造时自动 `provide`（`src/service.ts:33`：`self.ctx.reflect.provide(name, self, this[symbols.check])`）。
- **消费方**：声明 `inject: ['name']` 后直接 `ctx.name` 访问；未声明就访问会抛 `cannot get property "name" without inject`（`src/reflect.ts:71`）。

### 2. Service 基类（`src/service.ts`）

```ts
export abstract class Service<out T = never> {
  constructor(protected ctx: Context, name: string) {
    name ??= this.constructor['provide'] as string
    let self = this
    const tracker: Tracker = { associate: name, property: 'ctx' }
    if (self[symbols.invoke]) {
      self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker)
    }
    self.ctx = ctx
    self.name = name
    defineProperty(self, symbols.tracker, tracker)
    self.ctx.reflect.provide(name, self, this[symbols.check])   // ★ 自动提供
    return self
  }
}
```

要点：

- 服务名默认取构造参数，缺省时从静态 `provide` 属性取；
- 若服务实现了 `[symbols.invoke]`，会被包装成**可调用对象**（`createCallable`，第 7 课）——例如 `ctx.logger('name')` 这种「服务兼函数」的形态（`src/logger.ts:170-204`）；
- 构造时即 `provide`——所以类插件一加载，服务就可用；
- 静态 `[Symbol.hasInstance]`（`src/service.ts:69-79`）让 `instanceof` 能穿透代理/包装。

`Service` 还有三个受保护符号方法：

| 符号 | 作用 |
|------|------|
| `[symbols.filter]` | 服务对哪些 ctx 可见（默认按 isolate 键匹配，`src/service.ts:37-39`） |
| `[symbols.extend]` | 派生服务实例（`Object.create` 或重新 createCallable） |
| `[symbols.resolveConfig]` | 沿 `intercept` 链收集配置并合并（`src/service.ts:51-67`） |

### 3. 反射服务：provide / get / set

`ReflectService`（`src/reflect.ts`）持有两个仓库：

- `store: Dict<Impl, symbol>`：**键是隔离 symbol**，值是 `{ name, value, fiber, check }`；
- `props: Dict<Property>`：属性声明（`service` 或 `accessor` 类型）。

`provide(name, value, check?)`（`src/reflect.ts:175-203`）是一个 **effect**：

1. 声明 `props[name] = { type: 'service' }`；
2. 在 `root` 的 isolate 表里为 name 分配 symbol（`src/reflect.ts:184`），取**当前 ctx 的 isolate 键**；
3. `store[key] = impl` 登记，同时写入当前 fiber 的 `store[name]`；
4. 若 fiber 已 ACTIVE，`notify([name])` 通知依赖方；
5. 返回异步 dispose：删除 store 条目 → `notify` → 等所有依赖 fiber 收敛 → 删除自身 store（**先通知后自清**，保证依赖先拿到"服务消失"信号，`src/reflect.ts:195-201`）。

`get(name)` / `set(name, value)`：围绕 `_getImpl`（`src/reflect.ts:154-160`）——按当前 ctx 的 isolate 键查 store，且**严格模式下要求 impl.fiber 处于 ACTIVE**（服务在加载/卸载中视为不可用）。

### 4. @Inject：声明式依赖

类插件上用装饰器声明依赖（`src/registry.ts:17-40`）：

```ts
class MyPlugin {
  @Inject('db')
  private db!: Database
  constructor(ctx: Context) { ... }
}
```

- **类上**：写入 `value.inject[name]`（并置 `checkProto`，让子类继承）；
- **方法上**：写入 `metadata.inject`，并通过 `addInitializer` 在构造后自动 `ctx.inject(inject, callback)`（`src/registry.ts:28-35`）——构造器拿到的是包装后的 ctx（`withProps(this, { [property]: ctx })`），依赖作为属性可用。

### 5. 依赖热替换：核心链路

当服务提供者 A 发生变化（加载/卸载/重载），消费者 B 必须跟着重启。链路如下：

```
A provide/卸载
  └─> ReflectService.notify([name])            (src/reflect.ts:205-227)
        ├─ 遍历所有 runtime 的所有 fiber
        ├─ 对 inject 含 name 且隔离键匹配的 fiber：
        │     fiber._checkImpl(name)            (src/fiber.ts:371-383) 重新解析实现
        │     fiber._refresh()                  (src/fiber.ts:385-397) 重算 epoch
        │        epoch = ':'.join(依赖服务的 uid)
        └─ 发内部事件 internal/service
```

- `_checkImpl`：重新查 store 并执行 `check` 回调，失败则从 `_store` 删除；
- `_refresh`：把 epoch 重算为依赖服务 uid 的拼接——**任一依赖变化，epoch 必变**；
- `_setEpoch`（`src/fiber.ts:399-413`）对比新旧 epoch：依赖从无到有 → `_reload()`（LOADING）；依赖消失 → `_unload()`（UNLOADING）。

这就是「服务替换 → 依赖自动重启」的完整机制：**B 的加载顺序由依赖关系决定，与插件声明顺序无关**。

### 6. accessor 与 mixin

- `ctx.accessor(name, { get, set })`：声明一个**计算属性**（`src/reflect.ts:229-237`），比服务更轻量；
- `ctx.mixin(source, names)`（`src/reflect.ts:239-265`）：把某个服务的若干方法**混入 ctx**，例如 `Context` 上的 `ctx.on()` 就是通过 `mixin('events', [...])` 来的（`src/reflect.ts:144-148`：`this.mixin('events', ['on','once','parallel','emit','serial','bail','waterfall'])`）——所以 `ctx.on` 实际是 `ctx.events.on` 的代理。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `src/service.ts` | 全部 | Service 基类与三个符号方法 |
| `src/reflect.ts` | 135-203 | store/props、get/set/provide |
| `src/reflect.ts` | 205-227 | notify：依赖通知 |
| `src/reflect.ts` | 229-265 | accessor / mixin |
| `src/fiber.ts` | 371-413 | _checkImpl / _refresh / _setEpoch |
| `src/registry.ts` | 17-40 | @Inject 装饰器 |
| `tests/service.spec.ts` | 全部 | 服务机制测试 |

## 动手实验

### 实验 5-1：自定义服务 + 依赖注入

创建 `docs/learning-guide/lab/05-service.ts`：

```ts
import { Context, Service } from 'cordis'

// 服务提供方：计数器服务
class Counter extends Service {
  value = 0
  constructor(ctx: Context) {
    super(ctx, 'counter')
  }
  add(n = 1) {
    this.value += n
    return this.value
  }
}

// 消费方：声明依赖 counter
function reporter(ctx: Context) {
  console.log('counter starts at', ctx.counter.value)
  return () => console.log('reporter unloaded')
}

const ctx = new Context()
ctx.plugin(Counter)          // 先加载服务
await ctx.plugin({ inject: ['counter'], apply: reporter })
console.log('after add:', ctx.counter.add(5))
```

预期输出：

```
counter starts at 0
after add: 5
```

> 试试把 `ctx.plugin(Counter)` 移到 `reporter` 之后，结果不变——顺序由依赖决定。

### 实验 5-2：依赖消失 → 自动卸载

```ts
import { Context, Service } from 'cordis'

class Counter extends Service {
  constructor(ctx: Context) {
    super(ctx, 'counter')
  }
}

const ctx = new Context()
const state: string[] = []

const counterFiber = ctx.plugin(Counter)

await ctx.plugin({
  inject: ['counter'],
  apply(ctx) {
    state.push('reporter loaded')
    return () => state.push('reporter unloaded')
  },
})

// 卸载服务提供者 → reporter 依赖消失，应自动卸载
await counterFiber.dispose()
console.log(state.join(' | '))   // reporter loaded | reporter unloaded
```

### 实验 5-3：intercept 配置注入

```ts
import { Context, Service } from 'cordis'

class Greeter extends Service {
  greeting: string
  constructor(ctx: Context) {
    super(ctx, 'greeter')
    const config = this[Service.resolveConfig]() as any  // 沿 intercept 链收集配置
    this.greeting = config.greeting ?? 'hi'
  }
}

const ctx = new Context()
// 两个子树：隔离出独立的服务键；b 额外带 intercept 配置
const a = ctx.isolate('greeter')
const b = ctx.isolate('greeter').intercept('greeter', { greeting: 'hello' })

a.plugin(Greeter)
b.plugin(Greeter)
await new Promise(r => setTimeout(r, 0))
console.log('a greeter:', a.get('greeter')?.greeting)   // hi
console.log('b greeter:', b.get('greeter')?.greeting)   // hello
```

预期输出：

```
a greeter: hi
b greeter: hello
```

> 说明：`intercept` 通过原型链作用于其派生子树；`Service[symbols.resolveConfig]`（`src/service.ts:51-67`）沿 `intercept` 链收集同名配置并合并（父级在前、子级在后覆盖）。⚠️ 若两个子树**不隔离**，同名服务会写同一个 `store` 键而冲突（`service "greeter" has been registered`）——`isolate` 正是为避免这种冲突而设计。

## 自测题

1. `provide` 的返回值是一个异步函数，它的执行顺序为什么是「先 notify 后删自身 store」？
2. `_getImpl` 的 `strict` 参数控制什么？为什么服务加载中视为不可用？
3. 依赖热替换的完整链路是什么？`epoch` 在其中起什么作用？
4. `ctx.on()` 为什么存在？它与 `ctx.events.on` 是什么关系？（提示：`mixin`）
5. 类插件 `class X extends Service` 构造时做了什么，使它加载即提供服务？

## 延伸阅读

- 对应测试：`packages/core/tests/service.spec.ts`、`tests/reflect.spec.ts`、`tests/associate.spec.ts`
- 官方第 3 章：[服务](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial/03-services.md)
- 下一篇：[第 6 课：事件系统](06-events.md)
