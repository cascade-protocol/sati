# Contributing to SATI

Thank you for your interest in SATI! This is a community-driven standard.

## How to Contribute

### 1. Specification Feedback

Review [docs/specification.md](./docs/specification.md) and open issues for:
- Technical concerns
- Security considerations
- Design improvements
- Use case gaps

### 2. Integration Proposals

Building an agent framework or protocol? We'd love to hear about:
- Integration requirements
- Missing features
- Compatibility concerns

### 3. Implementation Contributions

**Registry Program:**
- Bug fixes and optimizations
- Test coverage improvements
- Security hardening

**SDK:**
- Helper functions
- Documentation
- Additional examples

**SAS Schemas:**
- Schema improvements
- Validation helpers

## Development Setup

```bash
# Prerequisites
# - Rust 1.89.0 (locked via rust-toolchain.toml)
# - Solana CLI 2.0+
# - Anchor 0.32.1+
# - Node.js 18+
# - pnpm

# Setup
git clone https://github.com/cascade-protocol/sati.git
cd sati
pnpm install
anchor build
pnpm --filter @sati/sdk build
anchor test
```

## Code Style

### Rust (Anchor Programs)

```rust
// Follow Anchor best practices
// Use rustfmt for formatting
pub fn register_agent(
    ctx: Context<RegisterAgent>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    // Validate inputs
    require!(name.len() <= MAX_NAME_LENGTH, SatiRegistryError::NameTooLong);

    // Implementation...
    Ok(())
}
```

### TypeScript (SDK)

```typescript
// Use @solana/kit (NOT @solana/web3.js for new code)
// Generated code uses Codama - don't edit src/generated/
import { address, type Address } from "@solana/kit";
import { getRegisterAgentInstructionAsync } from "./generated";

// Helper functions go in src/helpers.ts
export function toAddress(pubkey: PublicKey): Address {
  return address(pubkey.toBase58());
}
```

## SDK Structure

```
sdk/
├── scripts/
│   └── generate-clients.ts  # Codama generation script
├── src/
│   ├── generated/           # Auto-generated (DO NOT EDIT)
│   ├── helpers.ts           # Utility functions
│   ├── schemas.ts           # SAS schema definitions
│   └── index.ts             # Exports
└── package.json
```

**Important:** Never edit files in `src/generated/`. To update:
1. Modify the Anchor program
2. Run `anchor build`
3. Run `pnpm --filter @sati/sdk generate`

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### PR Guidelines

- **Clear description:** Explain what and why
- **Reference issues:** Link to relevant issues
- **Tests:** Add tests for new functionality
- **Documentation:** Update docs for API changes
- **Small commits:** Keep commits focused and atomic

## Testing

```bash
# Run all Anchor tests
anchor test

# Run specific test file
anchor test --skip-deploy -- tests/sati-registry.test.ts

# Build and test SDK
cd sdk && pnpm build && pnpm test
```

## Documentation

- **Code comments:** Explain _why_, not _what_
- **Function docs:** Document all public APIs
- **Examples:** Add usage examples in `examples/`
- **Specification:** Update spec for protocol changes

## Community

- **Questions:** Use [GitHub Discussions](https://github.com/cascade-protocol/sati/discussions)
- **Bugs:** Open an issue with reproduction steps
- **Features:** Discuss in issue before implementing
- **Twitter:** [@opwizardx](https://twitter.com/opwizardx)

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).
