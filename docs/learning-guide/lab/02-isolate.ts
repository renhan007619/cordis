import { Context } from 'cordis'

const ctx = new Context()

ctx.provide('db', { url: 'root-db' })

// 隔离的子树：db 不再与根共享
const child = ctx.isolate('db')
child.provide('db', { url: 'child-db' })

console.log('ctx.db:', ctx.get('db'))
console.log('child.db:', child.get('db'))
