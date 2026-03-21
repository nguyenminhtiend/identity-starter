import { buildApp } from './app.js';
import { createContainer, env, loggerConfig } from './core/index.js';

const container = createContainer();

const app = await buildApp({ container, logger: loggerConfig });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Received shutdown signal');
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
