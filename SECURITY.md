# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in SATI, please report it responsibly.

### How to Report

**Email**: security@cascade.fyi

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt within 48 hours
2. **Assessment**: We will assess the vulnerability within 7 days
3. **Resolution**: Critical issues will be addressed within 30 days
4. **Disclosure**: We coordinate disclosure timing with the reporter

### Scope

The following are in scope:
- SATI Program (`satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe`)
- SDK (`@cascade-fyi/sati-sdk`)
- Official documentation and examples

The following are out of scope:
- Third-party integrations
- Issues in dependencies (report to upstream maintainers)
- Social engineering attacks

### Safe Harbor

We will not pursue legal action against researchers who:
- Act in good faith
- Avoid privacy violations
- Do not disrupt services
- Report findings to us before public disclosure

## Security Best Practices

When using SATI:

1. **Verify program ID**: Always verify you're interacting with `satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe`
2. **Check token supply**: Agent NFTs must have supply=1 with renounced mint authority
3. **Validate attestations**: Verify attestation schemas match SATI standards
4. **Use multisig**: Production deployments should use Squads smart accounts

## Audit Status

- [ ] Initial security audit (pending)
- [ ] Bug bounty program (planned post-audit)
