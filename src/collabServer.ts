import { spawn, ChildProcess } from 'child_process';

const toBool = (value?: string) => String(value).toLowerCase() === 'true';

export const startCollabServer = (): ChildProcess | null => {
  const enabled = process.env.COLLAB_SERVER_ENABLED
    ? toBool(process.env.COLLAB_SERVER_ENABLED)
    : true;

  if (!enabled) {
    console.log('Collab server disabled via COLLAB_SERVER_ENABLED=false');
    return null;
  }

  const host = process.env.COLLAB_SERVER_HOST || '0.0.0.0';
  const port = process.env.COLLAB_SERVER_PORT || '1234';
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['y-websocket'];

  console.log(`Starting Yjs collab server on ws://${host}:${port}`);
  const child = spawn(command, args, {
    env: {
      ...process.env,
      HOST: host,
      PORT: port,
    },
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('Failed to start Yjs collab server process:', error.message);
    console.error('Install package: npm i @y/websocket-server');
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Yjs collab server exited with code ${code}.`);
      console.error('Ensure @y/websocket-server is installed and retry.');
    }
  });

  return child;
};
