import { Context, Service } from 'cordis'

// 1. 服务提供方：可配置容量的任务队列
class TaskQueue extends Service {
  private tasks: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'taskQueue')
    const config = this[Service.resolveConfig]() as any
    this.capacity = config?.capacity ?? 10
    ctx.logger('queue').info('created with capacity %d', this.capacity)
  }

  capacity: number

  push(task: string) {
    if (this.tasks.length >= this.capacity) {
      this.ctx.logger('queue').warn('queue full, dropping %s', task)
      return false
    }
    this.tasks.push(task)
    this.ctx.emit('task/pushed', task)          // 事件通知
    return true
  }

  get size() {
    return this.tasks.length
  }
}

// 2. 消费方：依赖注入 + 事件监听 + 自动清理
//    注意：apply 用方法简写（无 prototype），否则会被当作类插件 new 调用
const worker = {
  inject: ['taskQueue'] as const,
  apply(ctx: Context) {
    const log: string[] = []
    ctx.on('task/pushed', (task: string) => log.push(`handled: ${task}`))
    ctx.effect(() => {
      log.push('worker watching')
      return () => log.push('worker stopped')
    })
    return () => console.log('worker log:', log.join(' | '))
  },
}

async function main() {
  const ctx = new Context()

  // 让日志可见（默认 exporter 只进 buffer 不打印）
  ctx.logger.exporter({
    colors: 0,
    export(message: any) {
      console.log(`[${message.name}:${message.type}]`)
    },
  })

  // 3. 用 intercept 给服务传配置
  const scoped = ctx.intercept('taskQueue', { capacity: 2 })
  scoped.plugin(TaskQueue)
  const workerFiber = scoped.plugin(worker)

  await workerFiber
  await new Promise(r => setTimeout(r, 0))

  // 4. 使用服务
  scoped.taskQueue.push('a')   // ok
  scoped.taskQueue.push('b')   // ok
  scoped.taskQueue.push('c')   // full → warn
  console.log('queue size:', scoped.taskQueue.size)

  // 5. 卸载 worker：监听器与 effect 应自动清理
  await workerFiber.dispose()
}

main()
