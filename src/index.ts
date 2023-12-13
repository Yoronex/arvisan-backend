import './env';
import createHttp from './http';

async function createApp(): Promise<void> {
  const app = await createHttp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Listening at http://localhost:${port}`));
}

if (require.main === module) {
  process.on('SIGINT', () => {
    // this is only called on ctrl+c, not restart
    process.kill(process.pid, 'SIGINT');
  });

  // Only execute the application directly if this is the main execution file.
  createApp().catch((e) => {
    console.error(e);
  });
}
