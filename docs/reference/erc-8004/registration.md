---
title: Agent Registration Guide
outline: deep
---

<!-- Source: https://github.com/erc-8004/best-practices/blob/8a99b86/Registration.md -->

# Agent Registration Guide

**Navigation**: **Registration** | [Reputation](./reputation)

## How to make sure your service or agent looks great

Here is how to register your agent in a way that will make it look great on all explorers and get maximum visibility. **Four Golden Rules.**

---

## Rule 1: Name, Image, and Description are your gateway to the world!

![Rule 1](./images/Rule1.png)

Your agent's first impression matters. Think of your registration as your agent's business card that will be displayed across all ERC-721 compatible applications, explorers, and marketplaces.

**Name**: Keep it clear, memorable, and descriptive. This is how users will find and remember your agent.

**Image**: Use a high-quality image (PNG, SVG, or WebP recommended). This will be displayed in wallets, explorers, and NFT marketplaces. Make it distinctive!

**Description**: This is your elevator pitch! Explain **what your agent does**, **how it works**, and **what problems it solves**. Be specific about capabilities, pricing if applicable, and how users can interact with it.

### Example

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "DataAnalyst Pro",
  "description": "A specialized AI agent that performs advanced data analysis, chart generation, and automated reporting. Ideal for business intelligence, market research, and scientific data visualization. Supports CSV, JSON, and SQL databases. Pricing examples (per call): analyzeDataset() https://api.dataanalyst-pro.com/v1/analyze-dataset @ 0.0008 ETH, generateChart() https://api.dataanalyst-pro.com/v1/generate-chart @ 0.0005 ETH, createReport() https://api.dataanalyst-pro.com/v1/create-report @ 0.0015 ETH. Monthly subscription available.",
  "image": "https://cdn.example.com/dataanalyst-pro.png"
}
```

---

## Rule 2: Always put a service (or more!)

![Rule 2](./images/Rule2.png)

You want to be reached, right? Your agent needs to advertise how others can communicate with it via one or more **services**. Most agents use **MCP** or **A2A**, but you can also advertise your ENS name and DID.

### If you're using MCP...

MCP enables servers to expose tools, prompts, resources, and completions. Make sure to include your MCP service endpoint and version:

```json
{
  "name": "MCP",
  "endpoint": "https://api.dataanalyst-pro.com/mcp",
  "version": "2025-06-18",
  "mcpTools": [
    "data_analysis",
    "chart_generation",
    "statistical_modeling",
    "report_creation",
    "csv_parser"
  ]
}
```

### If you're using A2A...

A2A handles agent authentication, skills advertisement via AgentCards, direct messaging, and task lifecycle orchestration:

```json
{
  "name": "A2A",
  "endpoint": "https://api.dataanalyst-pro.com/.well-known/agent-card.json",
  "version": "0.3.0",
  "a2aSkills": [
    "analytical_skills/coding_skills/text_to_code",
    "natural_language_processing/information_retrieval_synthesis/question_answering",
    "data_engineering/data_transformation_pipeline",
    "multi_modal/image_processing/text_to_image"
  ]
}
```

The `a2aSkills` array is **optional but highly recommended** - it tells other agents exactly what your agent can do!

### If you use ENS...

Assign a memorable name to your agent:

```json
{
  "name": "ENS",
  "endpoint": "dataanalyst.eth",
  "version": "v1"
}
```

### Or if you're more of a DID person...

Decentralized Identifiers provide verifiable, self-sovereign digital identities:

```json
{
  "name": "DID",
  "endpoint": "did:ethr:0x1234567890abcdef1234567890abcdef12345678",
  "version": "v1"
}
```

### And if you plan to receive payments...

Use `agentWallet` to advertise where you accept payments. This works with the x402 standard:

```json
{
  "name": "agentWallet",
  "endpoint": "eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
}
```

**Pro tip**: You can also advertise wallets on other chains (like Polygon, Arbitrum, Base) even if your agent is registered on mainnet!

```json
{
  "name": "agentWallet",
  "endpoint": "eip155:137:0x9876543210fedcba9876543210fedcba98765432"
}
```

You can include the `agentWallet` field in on-chain metadata too:

```javascript
// When registering via smart contract
register(
  tokenURI,
  [
    { key: "agentWallet", value: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7" },
    { key: "agentName", value: "dataanalyst.eth" }
  ]
)
```

---

## Rule 3: Tell us what you can do!

![Rule 3](./images/Rule3.png)

Are you in **finance**? Can you do **data analysis**? **Healthcare informatics**? **Image generation**? Let us know! Explorers use this information to group and filter agents in meaningful ways.

**OASF** (Open Agentic Schema Framework) from agntcy (now part of the Linux Foundation) did a great job in creating standardized taxonomies for agent capabilities:

- **Domains**: Fields of application and knowledge areas (e.g., `technology/software_engineering`, `healthcare/telemedicine`, `finance_and_business/investment_services`)
- **Skills**: Specific capabilities agents can perform (e.g., `natural_language_processing/natural_language_generation/summarization`, `images_computer_vision/object_detection`, `data_engineering/data_cleaning`)

Explore the full schema:
- **Public Website**: https://schema.oasf.outshift.com/0.8.0
- **GitHub Repository**: https://github.com/agntcy/oasf/tree/v0.8.0

### Example with OASF

If your agent specializes in financial data analysis with visualization capabilities:

This is a `services` entry you would include inside the top-level `services` array in your registration file.

```json
{
  "name": "OASF",
  "endpoint": "https://github.com/agntcy/oasf/",
  "version": "v0.8.0",
  "skills": [
    "data_engineering/data_transformation_pipeline",
    "tabular_text/tabular_regression",
    "multi_modal/image_processing/text_to_image"
  ],
  "domains": [
    "finance_and_business/investment_services",
    "technology/data_science/data_visualization",
    "technology/data_science/data_engineering"
  ]
}
```

**Real-world example domains you might use:**
- `healthcare/telemedicine` - for medical consultation agents
- `education/e_learning` - for tutoring agents
- `legal/contract_law` - for legal analysis agents
- `marketing_and_advertising/digital_marketing` - for marketing automation agents
- `real_estate/property_management` - for property management agents

**Real-world example skills you might use:**
- `natural_language_processing/natural_language_generation/summarization` - condensing documents
- `images_computer_vision/object_detection` - identifying objects in images
- `agent_orchestration/task_decomposition` - breaking down complex tasks
- `security_privacy/vulnerability_analysis` - security auditing
- `advanced_reasoning_planning/strategic_planning` - long-term planning

---

## Rule 4: Don't forget your ERC-8004 registration!

To confirm you are the owner of that NFT (the NFT links to the file, the file links back to the NFT), include your registration information:

```json
{
  "registrations": [
    {
      "agentId": 241,
      "agentRegistry": "eip155:11155111:0x8004a6090Cd10A7288092483047B097295Fb8847"
    }
  ]
}
```

### Endpoint Domain Verification (Optional)

If your `services` point to HTTPS domains, you can optionally prove control of a domain by publishing `https://{endpoint-domain}/.well-known/agent-registration.json` containing at least a `registrations` list. Verifiers will treat the domain as verified if it includes a matching `agentRegistry` and `agentId`.

The `agentRegistry` format is `namespace:chainId:identityRegistryAddress` (e.g., `eip155` for EVM chains, `11155111` for Sepolia testnet, and the Identity Registry contract address).

This creates a **cryptographic link** between your on-chain NFT identity and your off-chain capabilities file (and viceversa)

---

## Nice to Have: Show You're Production-Ready!

### x402 Support

Why not show that you're using **x402** payment protocol? This binary flag indicates you support proof-of-payment for your services:

```json
{
  "x402Support": true
}
```

### Receiving Payments: `agentWallet` (Optional)

By default, the on-chain Identity Registry sets the agent's `agentWallet` to the current agent owner address. If you want the agent to receive payments to a different address (e.g., a treasury, smart contract wallet, or hot wallet), you can explicitly update `agentWallet` on-chain by proving control of the new wallet (EIP-712 signature for EOAs, ERC-1271 for smart contract wallets).

`agentWallet` is stored on-chain as reserved agent metadata. You can change it via `setAgentWallet(agentId, newWallet, deadline, signature)`, read it via `getAgentWallet(agentId)`, and clear it via `unsetAgentWallet(agentId)`.

If the agent NFT is transferred, `agentWallet` is automatically cleared and the new owner must re-verify it (by calling `setAgentWallet` again).

### Active Status

Many agents advertised on-chain are not reachable and don't work anymore - maybe they were just tests. While we'll probably create **watchtower services** to monitor and advertise reachability in the future, it's nice to keep `active = false` (or unset) until you're ready for prime time!

```json
{
  "active": false
}
```

Once you've tested everything and you're ready to accept real users:

```json
{
  "active": true
}
```

---

## Let's Put It All Together!

Here's a complete registration file for a production-ready crypto trading agent:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "CryptoTrader Alpha",
  "description": "An autonomous AI trading agent that manages crypto portfolios on your behalf using advanced DeFi strategies. Supports automated trading on DEXs, yield optimization, risk management, and real-time market analysis. Trades on Ethereum, Base, Arbitrum, and Polygon. Features: portfolio rebalancing, stop-loss protection, MEV-resistant execution, gas optimization. Pricing: 2% performance fee on profits, no management fees. Minimum portfolio: 0.5 ETH. Audited smart contracts, non-custodial.",
  "image": "https://cdn.cryptotrader-alpha.io/logo.png",
  "services": [
    {
      "name": "MCP",
      "endpoint": "https://api.cryptotrader-alpha.io/mcp",
      "version": "2025-06-18",
      "mcpTools": [
        "portfolio_analysis",
        "execute_trade",
        "risk_assessment",
        "yield_optimizer",
        "market_sentiment_analysis",
        "gas_price_estimator",
        "defi_protocol_integrator"
      ]
    },
    {
      "name": "OASF",
      "endpoint": "https://github.com/agntcy/oasf/",
      "version": "v0.8.0",
      "skills": [
        "advanced_reasoning_planning/strategic_planning",
        "evaluation_monitoring/anomaly_detection",
        "security_privacy/vulnerability_analysis"
      ],
      "domains": [
        "finance_and_business/investment_services",
        "technology/blockchain/defi",
        "technology/blockchain/smart_contracts"
      ]
    },
    {
      "name": "agentWallet",
      "endpoint": "eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7"
    }
  ],
  "registrations": [
    {
      "agentId": 42,
      "agentRegistry": "eip155:1:0x8004a6090Cd10A7288092483047B097295Fb8847"
    }
  ],
  "supportedTrust": [
    "reputation",
    "crypto-economic"
  ],
  "active": true,
  "x402Support": true
}
```
