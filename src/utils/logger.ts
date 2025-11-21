export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  info(message: string, ...args: any[]) {
    console.log(`[${new Date().toISOString()}] [${this.prefix}] INFO:`, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    console.warn(`[${new Date().toISOString()}] [${this.prefix}] WARN:`, message, ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(`[${new Date().toISOString()}] [${this.prefix}] ERROR:`, message, ...args);
  }

  debug(message: string, ...args: any[]) {
    console.debug(`[${new Date().toISOString()}] [${this.prefix}] DEBUG:`, message, ...args);
  }

  success(message: string, ...args: any[]) {
    console.log(`[${new Date().toISOString()}] [${this.prefix}] SUCCESS:`, message, ...args);
  }
}
