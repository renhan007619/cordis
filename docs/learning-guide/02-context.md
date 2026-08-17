# 第 2 课：Context——一切的核心

> 🧪 **本课配套实验**（`docs/learning-guide/lab/`，运行：`yarn tsx docs/learning-guide/lab/文件名.ts`）
> - `02-extend.ts` —— extend 原型链行为
> - `02-isolate.ts` —— isolate 服务隔离

## 本课目标

- 理解 `Context` 是「对象 + Proxy」的双层结构
- 掌握 `extend()`：基于原型链的上下文派生机制
- 掌握 `isolate()`：服务的符号级隔离
- 掌握 `intercept()`：配置的逐层覆盖
- 了解 `mixin` 与内部 `symbols`

## 核心概念

`Context` 是整个框架的「共享内存」。所有插件都在某个 Context 上注册能力，所有能力都从 Context 上被读取。理解 Context 的关键是理解它的四个机制：**Proxy、extend、isolate、intercept**。

### 1. Proxy：属性访问的守门员

`new Context()` 返回的是一个 Proxy（`src/context.ts:39`）。`ReflectService.handler`（`src/reflect.ts:62-133`）拦截了 `get` / `set` / `has`：

- **特殊属性**（symbol、`prototype`、`then`、数字字符串、`_` 开头）直接放行（`isSpecialProperty`，`src/reflect.ts:33-38`）；
- **已有属性**：返回 `getTraceable(ctx, value)`——把对象包装成可追踪代理（第 7 课讲）；
- **未定义属性**：走 `internal/get` waterfall 事件，去服务仓库（`store`）里按隔离符号查找——这就是 `ctx.someService` 能拿到服务的原因；
- **`set` 同理**：未声明属性在插件中赋值会抛错（`cannot set property "x" without provide`）。

> 一个常见的困惑：为什么 `ctx.foo` 未声明却不会直接 `undefined`？因为 Proxy 的 `get` 拦截里 `Reflect.has(target, prop)` 为 false 时会抛 `Error: cannot get property "foo" without inject`（`src/reflect.ts:71`）。这保证拼写错误在运行时立刻暴露。

### 2. extend()：原型链派生

`src/context.ts:55-63`：

```ts
extend(meta = {}): this {
  const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value
  const self = Object.create(getTraceable(this, this))   // ★ 以「代理自身」为原型
  for (const prop of Reflect.ownKeys(meta)) {
    Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop)!)
  }
  if (!shadow) return self
  return Object.assign(Object.create(self), { [symbols.shadow]: shadow })
}
```

- 子 Context 是**父 Context 的原型链后代**：读父级属性走原型链，写自有属性互不干扰；
- `meta` 中的属性通过 `Object.defineProperty` 直接定义在子对象上（可带 getter/setter）；
- `symbols.shadow` 用于「影子上下文」机制（追踪调用者），先知道存在即可。

每个插件的 Fiber 都会 `parent.extend({ fiber: this })`（`src/fiber.ts:135`），所以**插件拿到的 ctx 是一个新的派生 Context**，它的 `ctx.fiber` 指向插件自己的 Fiber。

### 3. isolate()：服务的隔离域

`src/context.ts:65-69`：

```ts
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}
```

- `isolate` 是一张「名字 → 唯一 symbol」的映射表，同样基于原型链；
- 为某个服务名建立隔离后，子上下文中对 `name` 的读写**不再与父级共享**——`provide` 时 `store` 的键是 `ctx[symbols.isolate][name]`（`src/reflect.ts:184-186`），名字相同但 symbol 不同，就是两个互不相干的仓库条目；
- 典型用途：`ctx.isolate('database')` 让不同插件各持有一个数据库实例，互不覆盖。

### 4. intercept()：配置覆盖链

`src/context.ts:71-77`：

```ts
intercept(name: string, config: any) {
  const intercept = Object.create(this[symbols.intercept])
  intercept[name] = config
  return this.extend({ [symbols.intercept]: intercept })
}
```

- 与 isolate 相同的原型链模式，但存的是**配置对象**；
- 服务实例化时从 `intercept` 链上收集同名配置合并（`Service[symbols.resolveConfig]`，`src/service.ts:51-67`）：**父级先、子级后，逐层覆盖**；
- 典型用途：`ctx.intercept('logger', { level: 2 })` 给某个子树统一调日志级别（第 7 课）。

### 5. symbols：内部协议

`src/utils.ts:47-71` 定义了一组 `Symbol.for(...)` 全局注册表符号。它们出现在源码各处，是 Cordis 内部协议（如 `symbols.isolate`、`symbols.intercept`、`symbols.tracker`、`symbols.effect`），调试时遇到不认识的对象属性，先去这里查表。

## 源码阅读清单（本课）

| 文件 | 行号 | 读什么 |
|------|------|--------|
| `src/context.ts` | 全部 | Context 类：构造、extend、isolate、intercept |
| `src/reflect.ts` | 62-133 | Proxy handler：get/set/has 的完整逻辑 |
| `src/utils.ts` | 47-71 | 全部内部 symbol 及其用途 |
| `src/fiber.ts` | 133-144 | 插件 Fiber 如何派生 ctx 并设置 intercept |

## 动手实验

### 实验 2-1：extend 的原型链行为

```ts
import { Context } from 'cordis'

const ctx = new Context()
const child = ctx.extend()

console.log(child !== ctx)          // true：是新的对象
console.log(child.fiber === ctx.fiber)  // true：没传 meta，fiber 走原型链
console.log(child.root === ctx.root)    // true

// 写入只影响自身
;(child as any).foo = 1
console.log((ctx as any).foo)       // undefined

// 带 meta 的 extend：defineProperty 直接定义
const metaChild = ctx.extend({ marker: 'x' })
console.log((metaChild as any).marker)  // x
```

### 实验 2-2：isolate 隔离服务

```ts
import { Context } from 'cordis'

const ctx = new Context()

// 根上下文提供 db 服务
ctx.provide('db', { url: 'root-db' })

// 隔离的子树
const child = ctx.isolate('db')
child.provide('db', { url: 'child-db' })

console.log(ctx.get('db'))        // { url: 'root-db' }
console.log(child.get('db'))      // { url: 'child-db' } —— 名字相同但不共享
```

> `provide` / `get` 是服务机制（第 5 课详讲），这里只需观察 isolate 的效果。

### 实验 2-3：intercept 配置覆盖

```ts
import { Context } from 'cordis'

const ctx = new Context()
// 在 intercept 上放配置（服务自己会通过 resolveConfig 读取）
const child = ctx.intercept('logger', { level: 1 })

console.log('intercept 是原型链继承的：', 'logger' in child[symbolsCheck()])
function symbolsCheck() { return Symbol.for('cordis.intercept') as any }
```

## 自测题

1. 为什么 `ctx.foo`（未声明属性）在插件里访问会**抛错**而不是返回 `undefined`？是 Proxy 的哪个 trap 实现的？
2. `extend({ fiber })` 中的 `fiber` 为什么要用 `defineProperty` 而不是直接赋值？（提示：子对象上直接定义属性 vs 原型链查找的区别）
3. `isolate` 与 `intercept` 的数据结构有什么相同点？它们各自影响服务的什么环节？
4. 插件里的 `ctx` 和根 `ctx` 是什么关系？`ctx.fiber` 分别指向什么？

## 延伸阅读

- 下一篇：[第 3 课：Effect 与生命周期——可逆性的心脏](03-effect-lifecycle.md)
- 官方教程第 2 章（生命周期视角的 Context）：[DeepSeek-Harness cordis-tutorial](https://github.com/deepseek-ai/DeepSeek-Harness/tree/master/docs/cordis-tutorial)
