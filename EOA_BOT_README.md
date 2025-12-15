# EOA Wallet Bot - High-Speed Approval Revocation System

## Overview

The EOA Wallet Bot is a specialized defense system that protects your EOA (Externally Owned Account) wallet from token theft attacks. It monitors the mempool in real-time and automatically revokes approvals the instant it detects a `transferFrom()` call targeting your wallet.

## How It Works

1. **Mempool Monitoring**: Watches pending transactions via WebSocket and TxPool scanning
2. **Threat Detection**: Detects `transferFrom(yourWallet, attacker, amount)` calls instantly
3. **Instant Response**: Builds `approve(attacker, 0)` transaction to revoke approval
4. **MEV Bundle (Primary)**: Submits to Marlin Relay for GUARANTEED ordering (your tx executes before attacker's)
5. **Shotgun Broadcasting (Fallback)**: If MEV bundles disabled/fail, sends through multiple RPCs with premium gas
6. **Dynamic Gas Bidding**: Automatically outbids attacker by 50%+ to ensure priority

## Architecture

```
EOA Wallet Bot
├─ Async Mempool Watchers
│  ├─ WebSocket Monitoring (real-time pending tx stream)
│  └─ TxPool Scanning (500ms interval, premium tier)
├─ TransferFrom Detector
│  └─ Parses 0x23b872dd function calls targeting your wallet
├─ Approval Revoker
│  ├─ Builds approve(spender, 0) transaction
│  ├─ Dynamic gas bidding (150% of attacker's gas by default)
│  ├─ MEV Bundle (PRIMARY) - Marlin Relay for guaranteed ordering
│  └─ Shotgun broadcast (FALLBACK) - through primary + backup RPCs
└─ Statistics & Monitoring
   └─ Real-time stats on threats, MEV bundles, and shotgun broadcasts
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Your Wallet

Copy the example configuration:

```bash
cp eoa_bot_config.example.json eoa_bot_config.json
```

Edit `eoa_bot_config.json`:

```json
{
  "walletAddress": "0xYourTrustWalletAddress",
  "privateKey": "your_private_key_here",
  "rpcUrl": "https://your-premium-rpc.com",
  "wsRpcUrl": "wss://your-premium-rpc.com",
  "backupRpcUrls": [
    "https://backup-rpc-1.com",
    "https://backup-rpc-2.com"
  ],
  "chainId": 137,
  "gasPremium": 0.5,
  "maxGasPrice": "1000000000000"
}
```

**⚠️ SECURITY WARNING**:
- Never commit your private key to git
- Keep `eoa_bot_config.json` secure
- Add it to `.gitignore`

### 3. Run the Bot

```bash
node run_eoa_bot.js
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║              🤖 EOA WALLET BOT v1.0 🤖                     ║
║       High-Speed Approval Revocation System                ║
╚════════════════════════════════════════════════════════════╝

🤖 EOA Wallet Bot initialized
   Wallet: 0xYourAddress
   Chain ID: 137
   Gas Premium: 50%

🚀 Starting EOA Wallet Bot...
📡 WebSocket monitoring started
🔍 TxPool monitoring started

✅ EOA Wallet Bot is now monitoring mempool
   Watching for transferFrom() calls to: 0xYourAddress
   Ready to revoke approvals instantly
```

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `walletAddress` | Your EOA wallet address (Trust Wallet) | Required |
| `privateKey` | Your wallet's private key | Required |
| `rpcUrl` | Primary RPC endpoint (HTTP/HTTPS) | Required |
| `wsRpcUrl` | WebSocket RPC endpoint | Auto-detect |
| `backupRpcUrls` | Array of backup RPCs for shotgun broadcasting | `[]` |
| `chainId` | Chain ID (137 = Polygon) | `137` |
| `gasPremium` | Gas premium multiplier (0.5 = 50% over attacker) | `0.5` |
| `maxGasPrice` | Maximum gas price in wei | `1000 gwei` |
| `monitoringInterval` | TxPool scan interval in ms | `500` |
| `enableTxPoolMonitoring` | Enable premium txpool scanning | `true` |
| `enableWebSocketMonitoring` | Enable WebSocket monitoring | `true` |

## Choosing an RPC Provider

For best performance, use a premium RPC provider that supports:

1. **WebSocket connections** - For real-time pending transaction streaming
2. **txpool_content RPC method** - For premium mempool scanning
3. **Low latency** - Faster detection and response times

### Recommended Providers:

- **Infura**: https://infura.io (WebSocket + HTTP)
- **Alchemy**: https://www.alchemy.com (WebSocket + HTTP)
- **QuickNode**: https://www.quicknode.com (Premium tier required for txpool)
- **dRPC**: https://drpc.org (Good for backup)
- **Ankr**: https://www.ankr.com (Good for backup)

### Example Configuration with Multiple Providers:

```json
{
  "rpcUrl": "https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY",
  "wsRpcUrl": "wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY",
  "backupRpcUrls": [
    "https://polygon-mainnet.infura.io/v3/YOUR_INFURA_KEY",
    "https://lb.drpc.org/ogrpc?network=polygon&dkey=YOUR_DRPC_KEY",
    "https://rpc.ankr.com/polygon",
    "https://polygon.nodies.app"
  ]
}
```

## How Gas Premium Works

The bot uses **Dynamic Gas Bidding** to ensure your revocation transaction gets mined before the attacker's transaction:

1. **Detect attacker's gas**: Parse their `maxFeePerGas` and `maxPriorityFeePerGas`
2. **Calculate outbid gas**: Multiply by `(1 + gasPremium)`
3. **Apply safety cap**: Ensure gas doesn't exceed `maxGasPrice`

Example with 50% premium (`gasPremium: 0.5`):
- Attacker's gas: 100 gwei
- Your gas: 150 gwei (50% higher)
- Result: Your tx gets prioritized

**Recommendation**: Use 50% premium for normal threats, increase to 100% for high-value assets.

## Performance Metrics

Expected performance (with premium RPC):

- **Detection time**: 100-500ms from mempool entry
- **Response time**: 50-300ms (signing + broadcast)
- **Total reaction**: 150-800ms from threat to revocation sent

The bot tracks and displays:
- Threats detected
- Revocations sent
- Revocations confirmed
- Average response time

## Testing the Bot

### Dry Run Mode (Coming Soon)

To test without actual transactions:

```bash
node run_eoa_bot.js --dry-run
```

This will:
- Monitor the mempool
- Detect threats
- Build revocation transactions
- **Skip broadcasting** (simulate only)

### Manual Test

You can manually trigger the threat detection by watching for specific transactions in the mempool.

## Troubleshooting

### Bot not detecting transactions

1. **Check RPC provider**: Ensure WebSocket is connected
2. **Check txpool_content support**: Some RPCs don't support premium methods
3. **Check gas limits**: Ensure you have sufficient MATIC for gas

### Revocation transactions failing

1. **Insufficient gas**: Increase `gasPremium`
2. **RPC issues**: Add more backup RPCs
3. **Nonce conflicts**: Bot handles this automatically

### WebSocket disconnections

The bot automatically reconnects with exponential backoff. If disconnections persist:
1. Use a more reliable RPC provider
2. Enable only TxPool monitoring (`enableWebSocketMonitoring: false`)

## Security Best Practices

1. **Private Key Security**
   - Never share your private key
   - Never commit `eoa_bot_config.json` to git
   - Use environment variables for production

2. **RPC Security**
   - Use authenticated RPCs (with API keys)
   - Rotate API keys regularly
   - Monitor RPC usage for suspicious activity

3. **Monitoring**
   - Run the bot on a secure server (not public computer)
   - Monitor bot logs for unusual activity
   - Set up alerts for threat detection

## Advanced: Integration with Existing System

The EOA Wallet Bot uses the same infrastructure as the Safe defense system:

- `DynamicGasBidder` - Shared gas calculation logic
- `TxPoolMonitor` - Shared mempool scanning
- `PolygonGasCalculator` - Polygon-specific gas rules

You can run both systems simultaneously for multi-wallet protection.

## Roadmap

- [ ] Multi-chain support (Ethereum, BSC, Arbitrum, etc.)
- [ ] Proactive approval monitoring (detect approvals before attacks)
- [ ] MEV bundle support for guaranteed ordering
- [ ] Telegram/Discord alerts
- [ ] Web dashboard for monitoring
- [ ] Automatic approval revocation on detection (zero manual intervention)

## Support

For issues or questions, check the main repository or contact the development team.

---

**Built with the same battle-tested infrastructure as the Ultimate Defense Monitor V2**
