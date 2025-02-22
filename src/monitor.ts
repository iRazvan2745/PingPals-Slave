import { ping } from './utils/ping';
import { ServiceConfig, MonitoringResult } from './types';
import { Logger } from './utils/logger';

interface MonitorConfig {
  maxConcurrent: number;
  timeout: number;
  retryAttempts: number;
}

export class UptimeMonitor {
  private services: Map<string, ServiceConfig> = new Map();
  private logger: Logger;
  private config: MonitorConfig;

  constructor(config: MonitorConfig) {
    this.config = config;
    this.logger = new Logger('MONITOR', 'uptime-monitor');
  }

  addService(service: ServiceConfig) {
    this.services.set(service.id, service);
  }

  removeService(serviceId: string) {
    this.services.delete(serviceId);
  }

  clearServices() {
    this.services.clear();
  }

  getServices(): ServiceConfig[] {
    return Array.from(this.services.values());
  }

  private async checkHttpService(service: ServiceConfig): Promise<MonitoringResult> {
    if (service.type !== 'http') {
      throw new Error('Invalid service type: expected HTTP service');
    }

    const startTime = Date.now();
    let error: string | null = null;
    let success = false;
    let duration = 0;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, service.timeout || this.config.timeout);

        const fetchStartTime = Date.now();
        
        const response = await fetch(service.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'PingPals-Monitor/1.0',
            'Accept': 'application/json'
          }
        });

        clearTimeout(timeoutId);
        duration = Date.now() - fetchStartTime;

        if (response.status === 200) {
          try {
            const data = await response.json();
            
            // Validate that the response is an array of service statuses
            if (Array.isArray(data)) {
              const isValid = data.every(item => 
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.name === 'string' &&
                typeof item.type === 'string' &&
                (item.type === 'http' || item.type === 'icmp') &&
                typeof item.interval === 'number' &&
                typeof item.timeout === 'number' &&
                typeof item.lastStatus === 'boolean' &&
                Array.isArray(item.assignedSlaves)
              );
              
              if (isValid) {
                success = true;
                error = null;
              } else {
                success = false;
                error = 'Invalid response data format';
              }
            } else {
              success = false;
              error = 'Response is not an array of services';
            }
          } catch (parseError) {
            success = false;
            error = 'Invalid JSON response';
          }
        } else {
          success = false;
          error = `HTTP ${response.status}: ${response.statusText}`;
        }
        break;
      } catch (err) {
        duration = Date.now() - startTime;
        const isTimeout = err instanceof Error && (
          err.name === 'AbortError' || 
          err.message.includes('timeout') || 
          err.message.includes('abort')
        );
        
        const isTlsError = err instanceof Error && (
          err.message.includes('TLS') || 
          err.message.includes('SSL') ||
          err.message.includes('CERT')
        );

        error = isTimeout 
          ? 'Request timed out'
          : isTlsError
          ? 'TLS connection failed'
          : (err instanceof Error ? err.message : String(err));

        if (attempt === this.config.retryAttempts) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      }
    }

    return {
      serviceId: service.id,
      timestamp: Date.now(),
      success,
      duration,
      error: error || 'Unknown error'
    };
  }

  private async checkIcmpService(service: ServiceConfig): Promise<MonitoringResult> {
    const startTime = Date.now();
    let error: string | null = null;
    let success = false;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        if (service.type !== 'icmp') throw new Error('Invalid service type');
        
        const result = await ping(service.host, {
          timeout: service.timeout || this.config.timeout
        });

        success = result.alive;
        error = success ? null : (result.error || 'Host is not responding to ICMP');
        
        // If we get a permission error, log it clearly
        if (error?.toLowerCase().includes('permission denied')) {
          this.logger.error('Permission denied when running ping command. Please ensure sudo privileges are configured.');
          error = 'Permission denied for ICMP check. Configure sudo privileges.';
        }
        
        break;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        if (attempt === this.config.retryAttempts) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
      serviceId: service.id,
      timestamp: Date.now(),
      success,
      duration,
      error
    };
  }

  async checkService(service: ServiceConfig): Promise<MonitoringResult> {
    this.logger.info(`Checking service ${service.name} (${service.id})`);
    
    try {
      const result = service.type === 'http' 
        ? await this.checkHttpService(service)
        : await this.checkIcmpService(service);

      if (result.success) {
        this.logger.info(`Service ${service.name} is UP (${result.duration}ms)`);
      } else {
        this.logger.warn(`Service ${service.name} is DOWN: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to check service ${service.name}: ${errorMessage}`);
      
      return {
        serviceId: service.id,
        timestamp: Date.now(),
        success: false,
        duration: 0,
        error: errorMessage
      };
    }
  }
}
