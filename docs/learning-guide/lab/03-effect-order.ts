import { Context } from 'cordis'

const ctx = new Context()
const log: string[] = []

const fiber = ctx.plugin((ctx) => {
  ctx.effect(() => {
    log.push('A register')
    return () => log.push('A dispose')
  })

  ctx.effect(() => {
    log.push('B register')
    return () => log.push('B dispose')
  })

  // 插件自身返回的 dispose
  return () => log.push('-- plugin dispose --')
})

// 手动卸载插件，触发逆序清理
await fiber
await fiber.dispose()
console.log(log.join('\n'))
