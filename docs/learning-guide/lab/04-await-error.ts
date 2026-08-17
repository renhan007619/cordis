import { Context } from 'cordis'

function boom(ctx: Context) {
  throw new Error('apply exploded')
}

const ctx = new Context()
try {
  await ctx.plugin(boom)
} catch (e) {
  console.log('await caught:', (e as Error).message)
}
