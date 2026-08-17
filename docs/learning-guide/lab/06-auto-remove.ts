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
