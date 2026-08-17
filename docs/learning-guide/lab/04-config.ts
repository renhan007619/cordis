import { Context } from 'cordis'

// 一个极简 Standard Schema（也可以用 schemastery 等库生成）
const Config = {
  '~standard': {
    version: 1,
    vendor: 'lab',
    validate(value: any) {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { issues: [{ message: 'config must be an integer' }] }
      }
      return { value }
    },
  },
}

function counter(ctx: Context, config: number) {
  console.log('counter started with', config)
}

const ctx = new Context()

// 合法配置
await ctx.plugin({ name: 'counter', Config, apply: counter }, 42)

// 非法配置：抛 ValidationError
try {
  await ctx.plugin({ name: 'counter', Config, apply: counter }, 'oops')
} catch (e) {
  console.log('validation failed:', (e as Error).message)
}
