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
