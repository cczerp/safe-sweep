# Safe Sweep Bot - Usage Guide

## Quick Start

### 1. Prerequisites Setup

Before running the bot, ensure you have:

- **Node.js 18+** installed
- An **Ethereum RPC endpoint** with WebSocket support (e.g., Alchemy, Infura, QuickNode)
- A **Gnosis Safe** deployed on the target network
- A **Safe module** address where tokens will be swept
- The **private key** of one of the Safe owners

### 2. Installation

```bash
git clone https://github.com/yourusername/safe-sweep.git
cd safe-sweep
npm install
```

### 3. Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your specific settings:

```env
# Required: WebSocket RPC URL
RPC_URL=wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Required: Your Gnosis Safe address
SAFE_ADDRESS=0x1234567890123456789012345678901234567890

# Required: Module address for token storage
MODULE_ADDRESS=0x0987654321098765432109876543210987654321

# Required: Private key of a Safe owner
OWNER_PRIVATE_KEY=0xYourPrivateKeyHere

# Optional: Addresses allowed to move tokens (comma-separated)
AUTHORIZED_ADDRESSES=0xYourAddress1,0xYourAddress2

# Optional: Gas price multiplier (default: 1.5)
GAS_MULTIPLIER=1.5
```

### 4. Build and Run

```bash
# Build the project
npm run build

# Start the bot
npm start
```

## Configuration Details

### RPC_URL

The bot requires a WebSocket endpoint to monitor the mempool in real-time:

- **Alchemy**: `wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
- **Infura**: `wss://mainnet.infura.io/ws/v3/YOUR_API_KEY`
- **QuickNode**: `wss://YOUR-ENDPOINT.quiknode.pro/YOUR_TOKEN/`

⚠️ **Important**: HTTP endpoints won't work. You MUST use a WebSocket (wss://) URL.

### SAFE_ADDRESS

The address of your Gnosis Safe that you want to protect. The bot will monitor for unauthorized `transferFrom` calls targeting this address.

### MODULE_ADDRESS

The address where tokens will be swept when a suspicious transaction is detected. This should be:
- A secure address you control
- Ideally another Safe or a module contract
- NOT the same as the Safe being protected

### OWNER_PRIVATE_KEY

The private key of one of the Safe owners. This key is used to:
- Sign emergency sweep transactions
- Must have signing authority on the Safe
- Should have sufficient ETH for gas fees

⚠️ **Security**: Never commit this key. Keep it secure. Consider using a dedicated key with minimal other permissions.

### AUTHORIZED_ADDRESSES

Comma-separated list of addresses that are allowed to execute `transferFrom` on your Safe's tokens without triggering the sweep.

Examples:
```env
# Single address
AUTHORIZED_ADDRESSES=0x1111111111111111111111111111111111111111

# Multiple addresses
AUTHORIZED_ADDRESSES=0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222

# Leave empty to flag ALL transferFrom calls
AUTHORIZED_ADDRESSES=
```

**Who to include:**
- Your own EOA addresses
- Trusted multisig signers
- Approved smart contracts that manage your tokens
- DeFi protocols you actively use

**Important**: Any address NOT in this list will trigger a sweep if it tries to `transferFrom` your Safe's tokens.

### GAS_MULTIPLIER

Multiplier applied to the malicious transaction's gas price to ensure your sweep transaction gets mined first.

- **Default**: 1.5 (50% higher gas)
- **Higher values**: More likely to front-run, but more expensive
- **Lower values**: Cheaper, but riskier

Example scenarios:
- `GAS_MULTIPLIER=1.2` - 20% more gas (minimal front-run)
- `GAS_MULTIPLIER=1.5` - 50% more gas (recommended)
- `GAS_MULTIPLIER=2.0` - 100% more gas (aggressive)

### MAX_GAS_PRICE (Optional)

Maximum gas price in wei that the bot will pay. This prevents excessive gas spending during network congestion.

```env
# Set maximum of 100 Gwei
MAX_GAS_PRICE=100000000000

# No limit (use with caution)
# MAX_GAS_PRICE=
```

## Operation

### Starting the Bot

```bash
npm start
```

You should see output like:
```
[2025-11-21T16:00:00.000Z] [SafeSweepBot] INFO: Initializing Safe Sweep Bot...
[2025-11-21T16:00:00.001Z] [SafeSweepBot] INFO: Safe Address: 0x1234567890123456789012345678901234567890
[2025-11-21T16:00:00.002Z] [SafeSweepBot] INFO: Module Address: 0x0987654321098765432109876543210987654321
[2025-11-21T16:00:00.003Z] [SafeSweepBot] SUCCESS: Bot initialized successfully
[2025-11-21T16:00:00.004Z] [SafeSweepBot] INFO: Starting Safe Sweep Bot...
[2025-11-21T16:00:00.005Z] [SafeSweepBot] WARN: ⚠️  Bot is now protecting your Safe from unauthorized transfers
[2025-11-21T16:00:01.000Z] [MempoolMonitor] SUCCESS: Mempool monitoring started
```

### When a Suspicious Transaction is Detected

```
[2025-11-21T16:05:00.000Z] [TransactionAnalyzer] WARN: SUSPICIOUS transferFrom detected!
[2025-11-21T16:05:00.001Z] [TransactionAnalyzer] WARN:   TX Hash: 0xabc123...
[2025-11-21T16:05:00.002Z] [TransactionAnalyzer] WARN:   Sender: 0x2222222222222222222222222222222222222222 (UNAUTHORIZED)
[2025-11-21T16:05:00.003Z] [TransactionAnalyzer] WARN:   Token: 0xdac17f958d2ee523a2206206994597c13d831ec7
[2025-11-21T16:05:00.004Z] [SafeSweepBot] WARN: 🚨 ALERT: Suspicious transaction detected! 🚨
[2025-11-21T16:05:00.005Z] [TokenSweeper] WARN: 🚨 INITIATING EMERGENCY TOKEN SWEEP! 🚨
[2025-11-21T16:05:01.000Z] [TokenSweeper] INFO: Sweeping token 0xdac17f958d2ee523a2206206994597c13d831ec7...
[2025-11-21T16:05:02.000Z] [TokenSweeper] INFO: Found 1000.0 USDT to sweep
[2025-11-21T16:05:03.000Z] [TokenSweeper] INFO: Sweep transaction submitted: 0xdef456...
[2025-11-21T16:05:15.000Z] [TokenSweeper] SUCCESS: Sweep transaction confirmed!
[2025-11-21T16:05:15.001Z] [SafeSweepBot] SUCCESS: ✅ Successfully protected Safe by sweeping tokens!
```

### Stopping the Bot

Press `Ctrl+C` to gracefully shut down:
```
^C[2025-11-21T16:10:00.000Z] [SafeSweepBot] INFO: Received SIGINT, shutting down gracefully...
[2025-11-21T16:10:00.001Z] [MempoolMonitor] INFO: Mempool monitoring stopped
[2025-11-21T16:10:00.002Z] [SafeSweepBot] SUCCESS: Bot stopped
```

## Testing

### Running Tests

```bash
npm test
```

### Testing on Testnet

Before running on mainnet, test on a testnet:

1. Deploy a test Safe on Goerli/Sepolia
2. Configure `.env` with testnet RPC and addresses
3. Fund the Safe with test tokens
4. Create a test scenario where an unauthorized address has approval
5. Have that address submit a `transferFrom` transaction
6. Verify the bot sweeps tokens successfully

## Monitoring

### What to Monitor

1. **Bot Status**: Ensure the bot is running continuously
2. **Gas Balance**: Owner account must have ETH for gas
3. **Module Balance**: Verify swept tokens arrive in the module
4. **Logs**: Review logs for any errors or suspicious activity

### Recommended Setup

- Run the bot as a systemd service or in a screen session
- Set up log rotation to manage log file size
- Configure alerts for bot downtime
- Monitor owner account ETH balance
- Regular security audits of authorized addresses

## Troubleshooting

### Bot Not Detecting Transactions

**Issue**: Bot starts but doesn't log pending transactions

**Solutions**:
- Verify RPC URL is WebSocket (wss://) not HTTP
- Check RPC endpoint provides mempool access
- Ensure RPC API key has sufficient rate limits
- Test RPC connection: `wscat -c wss://your-rpc-url`

### Sweep Transactions Failing

**Issue**: Bot detects suspicious tx but sweep fails

**Solutions**:
- Verify owner private key is a valid Safe owner
- Ensure owner account has sufficient ETH for gas
- Check Safe threshold is 1 (or adjust code for multi-sig)
- Verify module address is valid
- Check token contract has sufficient balance

### High Gas Costs

**Issue**: Bot is spending too much on gas

**Solutions**:
- Reduce `GAS_MULTIPLIER` (but stay above 1.2)
- Set `MAX_GAS_PRICE` to cap spending
- Review false positive rate on `AUTHORIZED_ADDRESSES`
- Consider running only during critical periods

### False Positives

**Issue**: Bot sweeps tokens for legitimate transactions

**Solutions**:
- Add legitimate addresses to `AUTHORIZED_ADDRESSES`
- Review transaction logs to identify authorized users
- Consider adding your own addresses to the whitelist

## Production Deployment

### Security Best Practices

1. **Private Key Management**
   - Use hardware wallet or KMS for production
   - Rotate keys regularly
   - Never commit keys to version control

2. **High Availability**
   - Run multiple bot instances (with coordination)
   - Use redundant RPC endpoints
   - Set up automatic restart on failure

3. **Monitoring & Alerts**
   - Set up health checks
   - Alert on bot downtime
   - Monitor gas spending
   - Track sweep transactions

4. **Regular Audits**
   - Review authorized addresses monthly
   - Audit module security
   - Check for bot updates
   - Verify Safe configuration

### Example Systemd Service

Create `/etc/systemd/system/safe-sweep.service`:

```ini
[Unit]
Description=Safe Sweep Bot
After=network.target

[Service]
Type=simple
User=safesweep
WorkingDirectory=/home/safesweep/safe-sweep
ExecStart=/usr/bin/node /home/safesweep/safe-sweep/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/safe-sweep/output.log
StandardError=append:/var/log/safe-sweep/error.log

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable safe-sweep
sudo systemctl start safe-sweep
sudo systemctl status safe-sweep
```

## Support

For issues and questions:
- Check the [README.md](README.md) for general information
- Review logs for error messages
- Test configuration on testnet first
- Open an issue on GitHub with detailed logs

## Important Notes

⚠️ **Disclaimer**: This bot is provided as-is. Always:
- Test thoroughly on testnet
- Understand the code before using
- Keep private keys secure
- Monitor continuously
- Have backup security measures