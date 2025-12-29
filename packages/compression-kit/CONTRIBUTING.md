# Contributing to @cascade-fyi/compression-kit

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Prerequisites

- **Node.js** >= 20.18.0
- **pnpm** >= 9.0.0

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/cascade-protocol/sati.git
   cd sati
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the package:
   ```bash
   pnpm --filter @cascade-fyi/compression-kit build
   ```

4. Run tests:
   ```bash
   pnpm --filter @cascade-fyi/compression-kit test
   ```

## Development Workflow

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build the package |
| `pnpm dev` | Watch mode for development |
| `pnpm test` | Run tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm type-check` | Type check without emitting |
| `pnpm lint` | Run Biome linter |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm check` | Run both type-check and lint |
| `pnpm clean` | Remove build artifacts |

### Making Changes

1. Create a new branch for your feature/fix
2. Make your changes
3. Run `pnpm check` to ensure code quality
4. Run `pnpm test` to verify tests pass
5. Commit with a descriptive message
6. Open a pull request

## Code Style

### Naming Conventions

Follow the framework-kit naming conventions for consistency with the Solana ecosystem:

**Function Parameters & Return Types:**
```typescript
// For action functions
export type ActionNameParameters = { ... };
export type ActionNameReturnType = { ... };

// Example
export type GetAccountParameters = {
  address: Address;
  commitment?: Commitment;
};
export type GetAccountReturnType = CompressedAccount | null;
```

**Configuration Types:**
```typescript
// Optional configuration
export type XxxOptions = { ... };

// Required configuration
export type XxxConfig = { ... };
```

**State Types:**
```typescript
// For persisted/serializable state
export type SerializableXxxState = { ... };
```

### TypeScript Guidelines

- Enable strict mode (already configured)
- Use explicit return types for public functions
- Prefer `interface` over `type` for object shapes that may be extended
- Use branded types for domain-specific values (e.g., `BN254`, `Address`)

### Documentation

All public exports must have JSDoc documentation:

```typescript
/**
 * Brief description of what the function does.
 *
 * @param paramName - Description of the parameter.
 * @returns Description of the return value.
 *
 * @example
 * ```typescript
 * const result = myFunction(input);
 * ```
 */
export function myFunction(paramName: ParamType): ReturnType {
  // implementation
}
```

### Formatting

- Use Biome for formatting and linting
- Line width: 120 characters
- Indent: 2 spaces
- Quote style: single quotes

Run `pnpm lint:fix` before committing to auto-fix formatting issues.

## Testing

### Writing Tests

Tests are located in the `tests/` directory:

```
tests/
├── bn254.test.ts      # BN254 field operations
├── address.test.ts    # Address derivation
└── conversion.test.ts # Conversion utilities
```

Use Vitest for testing:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../src/index.js';

describe('myFunction', () => {
  it('should handle valid input', () => {
    const result = myFunction(validInput);
    expect(result).toBe(expectedOutput);
  });

  it('should throw on invalid input', () => {
    expect(() => myFunction(invalidInput)).toThrow();
  });
});
```

### Test Coverage

We aim for meaningful test coverage. Run coverage report with:

```bash
pnpm test -- --coverage
```

## Pull Request Guidelines

1. **Title**: Use a clear, descriptive title
2. **Description**: Explain what changes were made and why
3. **Testing**: Describe how to test the changes
4. **Breaking Changes**: Clearly note any breaking changes

### PR Checklist

- [ ] Code compiles without errors (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Types are correct (`pnpm type-check`)
- [ ] Documentation updated if needed
- [ ] CHANGELOG updated for user-facing changes

## Reporting Issues

When reporting issues, please include:

1. Package version
2. Node.js version
3. Steps to reproduce
4. Expected vs actual behavior
5. Error messages (if any)

## Questions?

Open an issue or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
