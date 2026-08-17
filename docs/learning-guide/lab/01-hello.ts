/**
 * ═══════════════════════════════════════════════════════════════
 * 实验 01：第一个插件 —— 最小模型与插件的「完整一生」
 * ═══════════════════════════════════════════════════════════════
 *
 * 【这个实验探究什么】
 *   Cordis 的最小运行模型只有两个动作：
 *   `new Context()` 创建共享空间，`ctx.plugin(hello)` 挂载插件。
 *   本实验验证四件事：
 *     ① 挂载即运行 —— 插件挂上去，回调立刻被调用
 *     ② 工作空间 —— 回调收到的 ctx 与根 ctx 不是同一个（每个插件有自己的空间）
 *     ③ 实例身份证 —— 每个插件实例有唯一编号 uid 和名字（ctx.fiber.name）
 *     ④ 可逆性 —— dispose() 卸载时，插件返回的清理函数自动执行
 *
 * 【这个实验怎么进行】
 *   步骤 1：定义插件 hello —— 一个回调，Cordis 会调用它并传入一个 ctx
 *   步骤 2：new Context() 创建应用
 *   步骤 3：ctx.plugin(hello) 挂载插件，观察返回的 Fiber
 *   步骤 4：await fiber 等待加载完成，看状态变为 ACTIVE
 *   步骤 5：fiber.dispose() 卸载插件，看清理函数执行、状态变为 DISPOSED
 *
 * 运行：yarn tsx docs/learning-guide/lab/01-hello.ts
 * ═══════════════════════════════════════════════════════════════
 */

import { Context, FiberState } from 'cordis'

// 步骤 1：定义插件（回调）。
// 注意：我们只"交出"函数本身（不加括号），由 Cordis 在合适的时机调用。
const hello = (ctx: Context) => {
  console.log('hello() 被调用了')
  console.log('· 插件 ctx 是新的：ctx !== root →', ctx !== root)
  console.log('· 我的实例编号 uid =', ctx.fiber.uid)
  console.log('· 我的插件名 =', ctx.fiber.name)
  // 返回清理函数：插件卸载时自动执行（可逆性的体现）
  return () => console.log('· [清理函数执行：插件已卸载，一切已撤销]')
}

// 步骤 2：创建应用（共享空间）
const root = new Context()

// 步骤 3：挂载插件。返回一个「可 await 的 Fiber」。
const fiber = root.plugin(hello)
console.log('plugin() 已返回（hello 还没执行——加载是异步的）')
console.log('')

// 步骤 4：等加载完成，状态变为 ACTIVE
await fiber
console.log('await 之后：fiber 状态 =', FiberState[fiber.state])
console.log('')

// 步骤 5：卸载。触发清理函数，状态回到 DISPOSED。
await fiber.dispose()
console.log('dispose 之后：fiber 状态 =', FiberState[fiber.state])
