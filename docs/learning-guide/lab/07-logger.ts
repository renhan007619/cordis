import { Context, Logger } from 'cordis'

const ctx = new Context()

const exporter = {
  colors: 0,           // 关闭颜色，便于观察
  export(message: any) {
    // Logger.format 应用 printf 格式化（%s/%d/%o/...）
    console.log(`[${message.name}:${message.type}] ${Logger.format(exporter, message)}`)
  },
}
ctx.logger.exporter(exporter)

ctx.logger('demo').info('hello %s, count=%d', 'world', 42)
ctx.logger('demo').warn('a warning')
ctx.logger.error(new Error('boom'))
