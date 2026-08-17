import { Context } from 'cordis'

const ctx = new Context()
let count = 0
ctx.once('ping', () => count++)
ctx.emit('ping')
ctx.emit('ping')
console.log('count:', count)   // 1
