# Cascade Tabs

Non-custodial smart account management for API-based USDC spending.

## Features

- Create Squads smart accounts with 1-of-1 threshold
- Deposit/withdraw USDC to/from vault
- Configure spending limits for API key access
- Generate API keys for third-party facilitators

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```

3. Set required variables in `.env`:
   - `VITE_MAINNET_RPC` - Solana RPC endpoint
   - `VITE_MAINNET_WS` - Solana WebSocket endpoint

4. Start development server:
   ```bash
   pnpm dev
   ```

## Deployment

Build and deploy to Cloudflare Workers:
```bash
pnpm build && pnpm deploy
```

### Worker Configuration

Set secrets via Wrangler:
```bash
wrangler secret put HELIUS_RPC_URL
wrangler secret put EXECUTOR_KEY
```

Monitor deployed worker:
```bash
npx wrangler tail
```

## Worker API Endpoints

- `GET /api/health` - Health check
- `POST /api/verify` - Verify spending limit for payment
- `POST /api/settle` - Execute payment from spending limit

## Architecture

- **React 19** + Vite + React Compiler
- **TanStack Query** for server state
- **Tailwind v4** + shadcn/ui
- **@solana/react-hooks** (framework-kit v1)
- **@cascade-fyi/tabs-sdk** for Squads integration

## How It Works

1. **Create Account** - User creates a Squads smart account with themselves as owner
2. **Deposit** - Transfer USDC from wallet to the smart account vault
3. **Set Spending Limit** - Configure how much the facilitator can spend per day/transaction
4. **Get API Key** - Generated key encodes the smart account and spending limit addresses
5. **Use API Key** - Third-party services use the key to execute payments within limits
6. **Withdraw** - Owner can withdraw funds at any time

## License

MIT
