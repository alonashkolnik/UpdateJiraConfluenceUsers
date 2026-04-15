import fs from 'fs';
import path from 'path';
import { app } from 'electron';

let logFilePath: string | null = null;
let logStream: fs.WriteStream | null = null;

function getLogPath(): string {
  if (logFilePath) return logFilePath;
  // Use app's user data path, or fallback to CWD for dev
  const dir = app?.isReady()
    ? path.join(app.getPath('userData'), 'logs')
    : path.join(process.cwd(), 'logs');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  logFilePath = path.join(dir, `app-${dateStr}.log`);
  return logFilePath;
}

function getStream(): fs.WriteStream {
  if (logStream) return logStream;
  logStream = fs.createWriteStream(getLogPath(), { flags: 'a' });
  return logStream;
}

function formatMsg(level: string, context: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] [${context}] ${message}`;
  if (data !== undefined) {
    try {
      const serialized = data instanceof Error
        ? `${data.message}\n${data.stack}`
        : JSON.stringify(data, null, 2);
      line += ` | ${serialized}`;
    } catch {
      line += ` | [unserializable data]`;
    }
  }
  return line;
}

export const logger = {
  info(context: string, message: string, data?: unknown) {
    const line = formatMsg('INFO', context, message, data);
    console.log(line);
    getStream().write(line + '\n');
  },

  warn(context: string, message: string, data?: unknown) {
    const line = formatMsg('WARN', context, message, data);
    console.warn(line);
    getStream().write(line + '\n');
  },

  error(context: string, message: string, data?: unknown) {
    const line = formatMsg('ERROR', context, message, data);
    console.error(line);
    getStream().write(line + '\n');
  },

  debug(context: string, message: string, data?: unknown) {
    const line = formatMsg('DEBUG', context, message, data);
    console.log(line);
    getStream().write(line + '\n');
  },

  getLogFilePath(): string {
    return getLogPath();
  },
};
