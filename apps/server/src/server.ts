import { buildApp } from './app.js';
import { createContainer, env, loggerConfig } from './core/index.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const container = createContainer();
const app = await buildApp({ container, logger: loggerConfig });

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  app.log.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  const forceExit = setTimeout(() => {
    app.log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await app.close();
    app.log.info('Server closed gracefully');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during graceful shutdown');
    clearTimeout(forceExit);
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => shutdown(signal));
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
