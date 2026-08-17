import { Context } from 'cordis'

function worker(ctx: Context) {
  console.log(`worker ${ctx.fiber.uid} started`)
}

const ctx = new Context()
ctx.plugin(worker)
ctx.plugin(worker)
console.log('runtime fibers:', ctx.registry.get(worker)!.fibers.length) // 2
