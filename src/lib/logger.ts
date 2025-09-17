import { get, writable } from 'svelte/store';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  details: unknown[];
  timestamp: number;
}

const LOG_CAPACITY = 200;

const store = writable<LogEntry[]>([]);
let counter = 0;

const consoleMethods: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: (console.debug?.bind(console) ?? console.log.bind(console)) as (...args: unknown[]) => void,
  info: console.info?.bind(console) ?? console.log.bind(console),
  warn: console.warn?.bind(console) ?? console.log.bind(console),
  error: console.error?.bind(console) ?? console.log.bind(console)
};

const enqueue = (entry: LogEntry) => {
  store.update((entries) => {
    const next = entries.length >= LOG_CAPACITY ? entries.slice(entries.length - LOG_CAPACITY + 1) : entries.slice();
    next.push(entry);
    return next;
  });
};

const record = (level: LogLevel, message: string, ...details: unknown[]) => {
  const timestamp = Date.now();
  const entry: LogEntry = {
    id: ++counter,
    level,
    message,
    details,
    timestamp
  };

  const method = consoleMethods[level] ?? console.log.bind(console);
  method(`[AnalogSignals][${level.toUpperCase()}] ${message}`, ...details);
  enqueue(entry);
};

export const logs = {
  subscribe: store.subscribe
};

export const logger = {
  debug: (message: string, ...details: unknown[]) => record('debug', message, ...details),
  info: (message: string, ...details: unknown[]) => record('info', message, ...details),
  warn: (message: string, ...details: unknown[]) => record('warn', message, ...details),
  error: (message: string, ...details: unknown[]) => record('error', message, ...details),
  clear: () => store.set([]),
  snapshot: () => get(store),
  capacity: LOG_CAPACITY
};

