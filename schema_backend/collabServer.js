"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCollabServer = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const toBool = (value) => String(value).toLowerCase() === 'true';
const startCollabServer = () => {
    const enabled = process.env.COLLAB_SERVER_ENABLED
        ? toBool(process.env.COLLAB_SERVER_ENABLED)
        : process.env.NODE_ENV !== 'production';
    if (!enabled) {
        console.log('Collab server disabled via COLLAB_SERVER_ENABLED=false');
        return null;
    }
    const host = process.env.COLLAB_SERVER_HOST || '0.0.0.0';
    const port = process.env.COLLAB_SERVER_PORT || '1234';
    const command = process.execPath;
    const serverScript = path_1.default.resolve(__dirname, '../node_modules/@y/websocket-server/src/server.js');
    const args = [serverScript];
    console.log(`Starting Yjs collab server on ws://${host}:${port}`);
    const child = (0, child_process_1.spawn)(command, args, {
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
exports.startCollabServer = startCollabServer;
