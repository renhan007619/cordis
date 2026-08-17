import { Context } from 'cordis'

const ctx = new Context()
ctx.plugin((ctx) => {
  ctx.effect(async () => {
    console.log('async effect registered')
    return () => console.log('async effect disposed')
  })

  ctx.effect(function* () {
    console.log('gen effect: step 1')
    yield () => console.log('gen effect: step 1 disposed')
    console.log('gen effect: step 2')
    yield () => console.log('gen effect: step 2 disposed')
  })
})
