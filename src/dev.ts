import { UptimeSlave } from './index';
import { SlaveConfig } from './types';

// Development environment configuration
process.env.NODE_ENV = 'development';
process.env.API_KEY = process.env.API_KEY || 'dev-key';
process.env.PORT = process.env.PORT || '3001';
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.MASTER_URL = process.env.MASTER_URL || 'http://localhost:3000';
process.env.SLAVE_ID = process.env.SLAVE_ID || `dev-slave-${process.env.PORT}`;
process.env.SLAVE_NAME = process.env.SLAVE_NAME || `Development Slave (Port ${process.env.PORT})`;

console.log('🚀 Starting slave...');
console.log(`Slave ID: ${process.env.SLAVE_ID}`);
console.log(`Slave Name: ${process.env.SLAVE_NAME}`);
console.log(`Master URL: ${process.env.MASTER_URL}`);
console.log(`Listening on: http://${process.env.HOST}:${process.env.PORT}`);

// Create slave configuration
const config: SlaveConfig = {
  id: process.env.SLAVE_ID!,
  name: process.env.SLAVE_NAME,
  port: parseInt(process.env.PORT || '3001'),
  host: process.env.HOST || '0.0.0.0',
  masterUrl: process.env.MASTER_URL!,
  apiKey: process.env.API_KEY!,
  maxConcurrentChecks: 50,
  checkTimeout: 30000,
  retryAttempts: 3,
  services: []
};

// Start the slave
const slave = new UptimeSlave(config);

// Handle graceful shutdown
const cleanup = () => {
  console.log('\n👋 Shutting down slave...');
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
