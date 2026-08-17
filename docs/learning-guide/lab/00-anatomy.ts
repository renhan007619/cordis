/**
 * 实验 00：解剖三行代码 —— `new Context()` + `ctx.plugin(hello)` 背后发生了什么
 *
 * ─────────────────────────────────────────────────────────────
 * 【本实验探究什么】三个问题，正好对应三个阶段：
 *   A. import：'cordis' 包从哪来？Context 是什么？
 *   B. new Context()：为什么说 ctx 是「Proxy 化的」？→ 三个证据
 *   C. ctx.plugin(hello)：回调何时被调用？Fiber 实例长什么样？状态机怎么流转？
 *
 * 运行：yarn tsx docs/learning-guide/lab/00-anatomy.ts
 * ─────────────────────────────────────────────────────────────
 */
import { Context, FiberState } from 'cordis'

// ═════════════════════════════════════════════════════════════
// 阶段 A：import { Context } from 'cordis'
// 【探究】'cordis' 是包名，指向仓库里的 packages/core；
//        Context 是个 class —— class 既是「值」（能 new）也是「类型」（能做注解）。
// ═════════════════════════════════════════════════════════════
console.log('== 阶段 A：import ==')
console.log('typeof Context =', typeof Context, '  ← class 在运行时就是 function')
console.log('Context.effect 是 symbol：', typeof Context.effect === 'symbol', '  ← class 的静态属性')
console.log('')

// ═════════════════════════════════════════════════════════════
// 阶段 B：new Context()  ——  Proxy 化的 Context
// 【探究】为什么说 ctx 是「门卫包着的对象」（Proxy）？下面三个证据。
// ═════════════════════════════════════════════════════════════
console.log('== 阶段 B：new Context() —— Proxy 化的 Context ==')
const ctx = new Context()

// —— ★ 关键行：context.ts 第 39 行 `new Proxy(this, handler)` ——
//    构造器把「自己」包进 Proxy 并 return，所以 new Context() 得到的是门卫，
//    而不是普通对象。下面用三个证据验证这一点。

// 证据 1：root 指向代理自身（普通对象不会有这种"自指"结构）
console.log('【证据 1】ctx.root === ctx →', ctx.root === ctx,
  '  ← root 指向门卫本身，普通对象不会有此特性')

// 证据 2：访问「不存在」的属性——根 ctx 上走「宽松模式」（返回 undefined）
//        （因为根 Fiber 没有 runtime，reflect.ts 第 79 行走 ctx.reflect.get(prop, false)）
console.log('【证据 2】根 ctx 上访问 ctx.foo →', (ctx as any).foo,
  '  ← 宽松模式返回 undefined（不抛错）')
// 注意：在【插件上下文】里访问不存在属性会抛错！见阶段 C 的 hello() 内部。

// 证据 3：访问「存在」的属性（服务）会被放行，且从仓库动态取出
console.log('【证据 3】访问 ctx.events（服务）→ 放行：', typeof ctx.events === 'object',
  '  ← 每次访问都动态查服务仓库')

// 附带观察：构造器里就绪的四个内置服务（reflect/registry/events/logger）
console.log('【附带】四个内置服务就绪：',
  ['reflect', 'registry', 'events', 'logger'].every(k => !!(ctx as any)[k]) ? '✓' : '✗',
  '  ← 所以插件一上来就能用 ctx.on()/ctx.logger()')
console.log('')

// ═════════════════════════════════════════════════════════════
// 阶段 C：ctx.plugin(hello)
// 【探究】① 回调是什么、何时被调用 ② Fiber 实例（uid、独立 ctx）③ 状态机流转
// ═════════════════════════════════════════════════════════════
console.log('== 阶段 C：ctx.plugin(hello) ==')
const root = ctx

// hello 是「回调」：你不自己调用它，而是交给 Cordis，由它在合适的时机执行。
// 用箭头函数（无 prototype）→ 走「函数插件」分支 → 返回值（清理函数）正常收集。
const hello = (ctx: Context) => {
  console.log('  └─ [hello() 被调用] —— 注意：这发生在 plugin() 返回【之后】')
  console.log('     · 插件拿到的 ctx 是【新派生】的：ctx !== root →', ctx !== root,
    '  ← 每个插件有自己的作用域')
  console.log('     · ctx.fiber.uid =', ctx.fiber.uid,
    '  ← 全局计数器分配的实例编号（第一个插件=1）')
  console.log('     · ctx.fiber.runtime.name =', JSON.stringify(ctx.fiber.runtime?.name),
    '  ← 插件名，用于诊断/日志')
  console.log('     · fiber 状态 =', FiberState[ctx.fiber.state],
    '  ← 此刻还在「加载中」！')
  // —— 补证：插件 ctx 有 runtime，访问不存在属性会【抛错】（门卫严格模式）——
  //    reflect.ts 第 80 行：有 runtime 时走 internal/get waterfall → 查不到即抛错
  try {
    ;(ctx as any).nonexistentProp
    console.log('     · 访问 ctx.nonexistentProp → 没抛错（意外）')
  } catch (e) {
    console.log('     · 访问 ctx.nonexistentProp → 被门卫拦截：',
      (e as Error).message.replace(/^Error: /, ''))
  }
  // 返回清理函数：插件卸载时会执行它（可逆性）
  return () => console.log('     · [hello 的清理函数被收集并执行]')
}

// —— ★ 关键行：ctx.plugin(hello) ——
//    plugin 不是 class 方法，是 mixin 自 registry 服务的方法；
//    返回值是可 await 的 Fiber（wrapper）：既能 await，也能 .dispose()。
const fiber = ctx.plugin(hello)
console.log('plugin() 返回可 await 的 Fiber：', typeof fiber.then === 'function',
  '  ← wrapper 上挂了 then，指向"等它加载完"')
console.log('')

// 等待加载完成：hello() 在异步微任务中执行，所以这里必须 await
await fiber
console.log('== await 之后：状态 =', FiberState[fiber.state], '==')
console.log('')

// 卸载：触发清理清单（逆序执行）→ 状态回到 DISPOSED
await fiber.dispose()
console.log('== dispose 之后：状态 =', FiberState[fiber.state], '==')
