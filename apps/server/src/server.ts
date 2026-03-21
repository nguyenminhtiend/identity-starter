import { buildApp } from './app.js';
import { createContainer, env, loggerConfig } from './core/index.js';

const container = createContainer();

const app = await buildApp({ container, logger: loggerConfig });

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
