import { config as dotenvConfig } from 'dotenv';
import { Config } from '../types';

dotenvConfig();

export function loadConfig(): Config {
  const requiredEnvVars = [
    'RPC_URL',
    'SAFE_ADDRESS',
    'MODULE_ADDRESS',
    'OWNER_PRIVATE_KEY',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  const authorizedAddresses = process.env.AUTHORIZED_ADDRESSES
    ? process.env.AUTHORIZED_ADDRESSES.split(',').map(addr => addr.trim())
    : [];

  return {
    rpcUrl: process.env.RPC_URL!,
    safeAddress: process.env.SAFE_ADDRESS!,
    moduleAddress: process.env.MODULE_ADDRESS!,
    ownerPrivateKey: process.env.OWNER_PRIVATE_KEY!,
    authorizedAddresses,
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '1000'),
    gasMultiplier: parseFloat(process.env.GAS_MULTIPLIER || '1.5'),
    maxGasPrice: process.env.MAX_GAS_PRICE,
  };
}
