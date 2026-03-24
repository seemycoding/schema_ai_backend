"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const dotenv_1 = __importDefault(require("dotenv"));
const collabServer_1 = require("./collabServer");
dotenv_1.default.config();
const PORT = Number(process.env.PORT || 8000);
app_1.default.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
const collabProcess = (0, collabServer_1.startCollabServer)();
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
