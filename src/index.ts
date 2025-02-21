import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { t } from 'elysia';
import { UptimeMonitor } from './monitor';
import { SlaveConfig, MonitoringResult, ServiceConfig } from './types';
import { Logger } from './utils/logger';
import cron from 'node-cron';

class UptimeSlave {
  private monitor: UptimeMonitor;
  private config: SlaveConfig;
  private app: Elysia;
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private logger: Logger;

  constructor(config: SlaveConfig) {
    this.config = config;
    this.monitor = new UptimeMonitor({
      maxConcurrent: config.maxConcurrentChecks || 50,
      timeout: config.checkTimeout || 30000,
      retryAttempts: config.retryAttempts || 3
    });
    this.logger = new Logger('SLAVE', config.id);
    this.app = new Elysia()
      .use(swagger({
        documentation: {
          info: {
            title: 'PingPals Slave API',
            version: '1.0.0',
            description: `Slave node ${config.id} API`
          },
          tags: [
            { name: 'health', description: 'Health check endpoints' },
            { name: 'services', description: 'Service management endpoints' }
          ]
        }
      }))
      .use(cors())
      .get('/health', () => ({ status: 'ok' }), {
        detail: {
          tags: ['health'],
          description: 'Health check endpoint'
        }
      })
      .post('/service', async ({ body }) => {
        // Validate service configuration based on type
        if (body.type === 'http' && !body.url) {
          throw new Error('URL is required for HTTP services');
        }
        if (body.type === 'icmp' && !body.host) {
          throw new Error('Host is required for ICMP services');
        }
        return this.addService(body as ServiceConfig);
      }, {
        body: t.Object({
          id: t.String(),
          name: t.String(),
          type: t.Union([t.Literal('http'), t.Literal('icmp')]),
          interval: t.Number(),
          timeout: t.Number(),
          url: t.Optional(t.String()),
          host: t.Optional(t.String())
        }),
        detail: {
          tags: ['services'],
          description: 'Add a new service to monitor'
        }
      })
      .delete('/service/:id', async ({ params }) => {
        return this.removeService(params.id);
      }, {
        detail: {
          tags: ['services'],
          description: 'Remove a service from monitoring'
        }
      });
  }

  async start(port: number) {
    // Initialize services
    this.log(`🔄 Initializing ${this.config.services.length} services...`);
    for (const service of this.config.services) {
      await this.addService(service);
    }

    // Start the server
    this.app.listen(port);
    this.log(`🔍 Slave monitor ${this.config.id} is running on port ${port}`);
    this.log(`📚 Swagger documentation available at http://localhost:${port}/swagger`);

    // Start heartbeat
    setInterval(() => this.sendHeartbeat(), 30000);
    this.sendHeartbeat().catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`Failed to send initial heartbeat: ${errorMessage}`);
    });
  }

  private async addService(service: ServiceConfig) {
    this.log(`➕ Adding service ${service.name} (${service.id})`);
    
    // Add to monitor
    this.monitor.addService(service);

    // Create monitoring task
    const task = cron.schedule(`*/${service.interval} * * * * *`, async () => {
      try {
        const result = await this.monitor.checkService(service);
        await this.sendReport(result);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logError(`Error monitoring service ${service.name}: ${errorMessage}`);
      }
    });

    // Start monitoring immediately
    const initialResult = await this.monitor.checkService(service);
    await this.sendReport(initialResult);

    this.tasks.set(service.id, task);
    return { status: 'ok', message: `Service ${service.name} added and monitoring started` };
  }

  private removeService(serviceId: string) {
    this.log(`➖ Removing service ${serviceId}`);
    const task = this.tasks.get(serviceId);
    if (task) {
      task.stop();
      this.tasks.delete(serviceId);
    }
    this.monitor.removeService(serviceId);
    return { status: 'ok', message: `Service ${serviceId} removed` };
  }

  private async sendHeartbeat() {
    try {
      const response = await fetch(`${this.config.masterUrl}/heartbeat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Slave-Id': this.config.id,
          'X-Slave-Name': this.config.name || 'Unnamed Slave',
          'X-Slave-Services': JSON.stringify(Array.from(this.monitor.getServices().keys()))
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to send heartbeat: ${response.statusText}`);
      }

      this.log('💓 Heartbeat sent successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`❌ Failed to send heartbeat: ${errorMessage}`);
      throw error;
    }
  }

  private async sendReport(result: MonitoringResult) {
    try {
      const response = await fetch(`${this.config.masterUrl}/report`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Slave-Id': this.config.id
        },
        body: JSON.stringify({
          ...result,
          slaveId: this.config.id
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to send report: ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`❌ Failed to send report: ${errorMessage}`);
      throw error;
    }
  }

  private log(message: string) {
    this.logger.info(message);
  }

  private logError(message: string) {
    this.logger.error(message);
  }

  private logWarn(message: string) {
    this.logger.warn(message);
  }
}

// Start the slave with configuration
const config: SlaveConfig = {
  id: process.env.SLAVE_ID || `slave-${Math.random().toString(36).slice(2, 9)}`,
  name: process.env.SLAVE_NAME || 'Unnamed Slave',
  port: parseInt(process.env.PORT || '3001'),
  masterUrl: process.env.MASTER_URL || 'http://localhost:3000',
  apiKey: process.env.API_KEY || '',
  services: [],
  maxConcurrentChecks: parseInt(process.env.MAX_CONCURRENT_CHECKS || '50'),
  checkTimeout: parseInt(process.env.CHECK_TIMEOUT || '30000'),
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
  host: process.env.HOST || 'localhost'
};

const slave = new UptimeSlave(config);
slave.start(config.port || 3001);
