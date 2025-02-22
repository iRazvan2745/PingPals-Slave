import * as pingModule from 'ping';

interface PingOptions {
  timeout?: number;
  retries?: number;
}

interface PingResult {
  alive: boolean;
  time?: number;
  error?: string;
}

export async function ping(host: string, options: PingOptions = {}): Promise<PingResult> {
  const timeout = options.timeout || 5000;

  try {
    const result = await pingModule.promise.probe(host, {
      timeout: timeout / 1000, // Convert to seconds
      min_reply: 1,
    });

    return {
      alive: result.alive,
      time: result.time,
      error: result.alive ? undefined : result.output
    };
  } catch (error) {
    return {
      alive: false,
      time: timeout,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
