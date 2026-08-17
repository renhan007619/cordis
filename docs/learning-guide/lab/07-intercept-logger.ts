import { Context } from 'cordis'

const ctx = new Context()
const seen: string[] = []

ctx.logger.exporter({
  colors: 0,
  export(message) {
    if (message.level === 2 || message.level === 3) seen.push(`${message.type}:${message.name}`)
  },
})

ctx.logger('a').info('visible')
ctx.logger('a').debug('hidden by default')

// 子树中把 a 的级别调到 DEBUG(3)
const scoped = ctx.intercept('logger', { name: 'a', level: 3 })
scoped.logger('a').debug('now visible in scoped context')

console.log(seen)   // ['info:a', 'debug:a']
