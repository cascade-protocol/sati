# SATI Dashboard

SATI Identity Service dashboard and API. Serves the web application and provides backend endpoints for agent registration, discovery, feedback, reputation, and hosted SDK infrastructure.

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
   - `VITE_HELIUS_API_KEY` - Helius RPC API key (powers all on-chain operations)
   - `SATI_AGENT_SIGNER_KEY` - Server signing key (base58-encoded keypair)
   - `PINATA_JWT` - Pinata JWT for IPFS metadata uploads

4. Start development server:
   ```bash
   pnpm dev
   ```

## Deployment

Build and deploy to Cloudflare Workers:
```bash
pnpm build && pnpm deploy
```

Set secrets via Wrangler:
```bash
wrangler secret put VITE_HELIUS_API_KEY
wrangler secret put SATI_AGENT_SIGNER_KEY
wrangler secret put PINATA_JWT
```

## API Endpoints

### Identity Service

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/register` | Register agent identity (x402 paywalled, $0.30 USDC) |
| `GET` | `/api/agents` | List/search agents |
| `GET` | `/api/agents/:mint` | Get agent details with reputation |
| `GET` | `/api/reputation/:mint` | Get reputation summary |
| `GET` | `/api/feedback/:mint` | List feedback for an agent |
| `POST` | `/api/feedback` | Submit feedback (server-signed) |

### Demo Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/echo` | Agent blind signature (x402 paywalled) |
| `POST` | `/api/predict` | AI prediction with validation attestation (x402 paywalled) |
| `POST` | `/api/build-feedback-tx` | Build feedback transaction for browser wallet signing |
| `POST` | `/api/credit-score` | Compute and publish on-chain credit score |

### SDK Infrastructure

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/photon/:network` | Photon RPC proxy for compressed account queries |
| `POST` | `/api/upload-metadata` | Upload metadata JSON to IPFS (rate limited: 10/min per IP, 100KB max) |
| `GET` | `/api/health` | Health check |

The Photon proxy and metadata upload endpoints power the SDK's zero-config experience. The SDK defaults to these hosted endpoints so developers don't need API keys to get started.

## Architecture

- **React 19** + Vite + React Compiler (frontend)
- **Hono** on Cloudflare Workers (backend)
- **TanStack Query** for server state
- **Tailwind v4** + shadcn/ui
- **x402** payment middleware for paywalled endpoints

## License

Apache-2.0
