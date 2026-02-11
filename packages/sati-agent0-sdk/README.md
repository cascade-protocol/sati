# @cascade-fyi/sati-agent0-sdk

Agent0-compatible adapter for [SATI](https://github.com/cascade-protocol/sati) - Solana Agent Trust Infrastructure.

Provides agent0-sdk compatible interfaces backed by SATI's Solana infrastructure for agent identity, reputation, and feedback attestation.

## Installation

```bash
pnpm add @cascade-fyi/sati-agent0-sdk @cascade-fyi/sati-sdk @solana/kit
```

## Usage

```typescript
import { SatiAgent0Sdk } from "@cascade-fyi/sati-agent0-sdk";

const sdk = new SatiAgent0Sdk({ network: "mainnet" });
const agent = sdk.getAgent("SATIAgentMintAddress...");
const identity = await agent.getIdentity();
```

## License

Apache-2.0
