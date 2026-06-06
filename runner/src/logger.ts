/* ──────────────────────────── Structured Logger ──────────────────────────────── */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

let currentLevel: LogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) {
    return;
  }

  const parts: string[] = [
    `[${formatTimestamp()}]`,
    `[${level.padEnd(5)}]`,
    message,
  ];

  if (context && Object.keys(context).length > 0) {
    parts.push(JSON.stringify(context));
  }

  const output = parts.join(' ');

  if (level === LogLevel.ERROR) {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>): void => log(LogLevel.DEBUG, msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>): void => log(LogLevel.INFO, msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>): void => log(LogLevel.WARN, msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>): void => log(LogLevel.ERROR, msg, ctx),

  /** Horizontal rule for visual separation in pipeline output */
  separator: (): void => {
    process.stdout.write('─'.repeat(72) + '\n');
  },

  /** Banner for phase headers */
  banner: (title: string): void => {
    process.stdout.write('\n' + '═'.repeat(72) + '\n');
    process.stdout.write(`  ${title}\n`);
    process.stdout.write('═'.repeat(72) + '\n\n');
  },
};
