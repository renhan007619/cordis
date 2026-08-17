import { Context } from 'cordis'

const ctx = new Context()
const child = ctx.extend()

console.log('child !== ctx:', child !== ctx)
console.log('child.fiber === ctx.fiber:', child.fiber === ctx.fiber)
console.log('child.root === ctx.root:', child.root === ctx.root)

;(child as any).foo = 1
console.log('ctx.foo:', (ctx as any).foo, '(undefined)')

const metaChild = ctx.extend({ marker: 'x' })
console.log('metaChild.marker:', (metaChild as any).marker)
