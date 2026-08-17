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
