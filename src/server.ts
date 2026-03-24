import app from './app';
import dotenv from 'dotenv';
import { startCollabServer } from './collabServer';

dotenv.config();

const PORT = Number(process.env.PORT || 8000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const collabProcess = startCollabServer();

const stopCollabServer = () => {
  if (collabProcess && !collabProcess.killed) {
    collabProcess.kill('SIGTERM');
  }
};

process.on('SIGINT', () => {
  stopCollabServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopCollabServer();
  process.exit(0);
});
