import { createServer } from 'http';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { consoleLogger as logger } from './logger';
import { convertWavToMp3 } from './mp3';
import { createMailer } from './mailer';
import { downloadRecording } from './recordingDownload';

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  if (config.problems.length > 0) {
    logger.warn(`not configured, webhooks will answer 503: ${config.problems.join('; ')}`);
  }

  const app = createApp({
    config,
    logger,
    mailer: createMailer(config),
    downloadRecording: (url) => downloadRecording(url),
    convertToMp3: (wav) => convertWavToMp3(wav),
  });

  const server = createServer(app);
  server.listen(config.port, config.bindAddr, () => {
    logger.info(
      `listening on ${config.bindAddr}:${config.port} language=${config.language} timezone=${config.timezone} recipients=${config.to.length}`,
    );
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
