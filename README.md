# Safe Sweep Bot

A security bot that monitors the Ethereum mempool for unauthorized token transfers from your Gnosis Safe and automatically sweeps tokens to a safe module before malicious transactions can execute.

## Overview

This bot provides real-time protection against unauthorized token transfers by:

1. **Monitoring the mempool** for pending transactions targeting your Safe
2. **Detecting suspicious `transferFrom` calls** that aren't from authorized addresses
3. **Immediately sweeping all tokens** to a designated Safe module before the malicious transaction executes
4. **Using higher gas prices** to ensure the protective transaction is mined first

## How It Works

### Threat Model

The bot protects against scenarios where:
- An attacker obtains approval to spend tokens from your Safe (through phishing, malicious dApp, or other means)
- The attacker submits a `transferFrom` transaction to drain tokens
- You wouldn't legitimately approve such transfers without your direct control

### Protection Mechanism

1. **Mempool Monitoring**: Connects to an Ethereum node via WebSocket to receive pending transactions in real-time
2. **Transaction Analysis**: Analyzes each pending transaction for:
   - `transferFrom` calls with your Safe as the `from` address
   - Transactions from unauthorized addresses
3. **Emergency Sweep**: Upon detecting a suspicious transaction:
   - Immediately creates a Safe transaction to transfer all affected tokens to the module
   - Uses a higher gas price (configurable multiplier) to front-run the malicious transaction
   - Executes through proper Safe transaction signing and execution

## Installation

### Prerequisites

- Node.js 18+ and npm
- A Gnosis Safe with at least one owner
- A Safe module address (where tokens will be swept)
- An Ethereum RPC endpoint with WebSocket support (e.g., Alchemy, Infura)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/safe-sweep.git
cd safe-sweep
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
RPC_URL=wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SAFE_ADDRESS=0xYourSafeAddress
MODULE_ADDRESS=0xYourModuleAddress
OWNER_PRIVATE_KEY=0xYourPrivateKey
AUTHORIZED_ADDRESSES=0xYourAddress1,0xYourAddress2
GAS_MULTIPLIER=1.5
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | Yes | WebSocket RPC URL for mempool monitoring |
| `SAFE_ADDRESS` | Yes | Address of the Gnosis Safe to protect |
| `MODULE_ADDRESS` | Yes | Address where tokens should be swept |
| `OWNER_PRIVATE_KEY` | Yes | Private key of a Safe owner (to sign transactions) |
| `AUTHORIZED_ADDRESSES` | No | Comma-separated list of addresses allowed to move tokens |
| `CHECK_INTERVAL_MS` | No | Mempool check interval (default: 1000ms) |
| `GAS_MULTIPLIER` | No | Multiplier for gas price vs malicious tx (default: 1.5) |
| `MAX_GAS_PRICE` | No | Maximum gas price in wei (prevents overpaying) |

### Authorized Addresses

List all addresses that legitimately control token movements from your Safe:
- Your own addresses
- Trusted multisig signers
- Approved contract addresses

Any transaction from an address NOT in this list will trigger the emergency sweep.

## Usage

### Build the project:
```bash
npm run build
```

### Start the bot:
```bash
npm start
```

### Development mode (with hot reload):
```bash
npm run dev
```

### Run linter:
```bash
npm run lint
```

## Security Considerations

### Private Key Security
- **NEVER** commit your `.env` file or expose your private key
- Use a dedicated owner key with minimal permissions
- Consider using a hardware wallet in production

### Gas Price Strategy
- The bot uses a gas multiplier (default 1.5x) to front-run malicious transactions
- Configure `MAX_GAS_PRICE` to prevent paying excessive gas during network congestion
- Ensure you have sufficient ETH in the owner account for gas

### False Positives
- Review your `AUTHORIZED_ADDRESSES` list carefully
- The bot will sweep tokens for ANY transaction not from an authorized address
- Test thoroughly on testnet before using on mainnet

### Module Security
- Ensure your module address is secure and under your control
- Consider using a separate Safe as the module
- Regularly audit token balances in the module

## Architecture

```
┌─────────────────────┐
│  Mempool Monitor    │
│  (WebSocket)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Transaction         │
│ Analyzer            │
└──────────┬──────────┘
           │
           ▼ (if suspicious)
┌─────────────────────┐
│ Token Sweeper       │
│ (Gnosis Safe SDK)   │
└─────────────────────┘
```

### Components

- **MempoolMonitor**: Monitors pending transactions via WebSocket
- **TransactionAnalyzer**: Analyzes transactions for suspicious `transferFrom` calls
- **TokenSweeper**: Executes emergency token transfers via Safe SDK

## Troubleshooting

### Bot not detecting transactions
- Verify your RPC URL supports WebSocket connections
- Check that `SAFE_ADDRESS` is correct and checksummed
- Ensure the RPC endpoint provides mempool access

### Sweep transactions failing
- Verify the owner private key is a valid Safe owner
- Ensure sufficient ETH for gas in the owner account
- Check Safe transaction threshold (must be 1 for immediate execution)

### High gas costs
- Adjust `GAS_MULTIPLIER` to a lower value (but still high enough to front-run)
- Set `MAX_GAS_PRICE` to prevent excessive gas spending
- Monitor gas prices and consider network conditions

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Disclaimer

This bot is provided as-is for security purposes. Use at your own risk. Always:
- Test thoroughly on testnet
- Audit the code before use
- Monitor bot operation continuously
- Have backup security measures

The authors are not responsible for any loss of funds due to misconfiguration or bugs.
