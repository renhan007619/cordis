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
