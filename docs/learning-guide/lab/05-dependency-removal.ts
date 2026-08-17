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
