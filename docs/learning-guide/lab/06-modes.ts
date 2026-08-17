import { Context } from 'cordis'

const ctx = new Context()

// emit：同步全部执行
ctx.on('a', () => console.log('a1'))
ctx.on('a', () => console.log('a2'))
ctx.emit('a')

// bail：第一个有返回值的短路
ctx.on('b', () => undefined)
ctx.on('b', () => 'short-circuited')
ctx.on('b', () => console.log('never printed'))
console.log('bail result:', ctx.bail('b'))

// serial：异步版 bail（逐个 await）
ctx.on('c', async () => { await new Promise(r => setTimeout(r, 10)); return undefined })
ctx.on('c', async () => 'serial stopped')
ctx.on('c', () => console.log('never printed'))
console.log('serial result:', await ctx.serial('c'))

// waterfall：共享参数的可拦截调用链（监听器 return next() 传递链值）
ctx.on('d', (n: { v: number }, next: () => void) => { n.v *= 2; return next() })
ctx.on('d', (n: { v: number }, next: () => void) => { n.v += 1; return next() })
const state = { v: 3 }
console.log('waterfall result:', ctx.waterfall('d', state, (s: { v: number }) => s.v))   // ((3*2)+1) = 7
