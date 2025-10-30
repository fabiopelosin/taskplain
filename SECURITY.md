# Taskplain Security Policy

## Supported Versions

Taskplain is currently pre-1.0. We provide security fixes for the latest published version (`0.x` series). If you rely on an older release, please upgrade to receive patches.

| Version | Supported            |
| ------- | -------------------- |
| 0.x     | ✅ Latest minor only |
| < 0.x   | ❌                   |

## Reporting a Vulnerability

Please report security issues privately. **Do not** open a public GitHub issue describing the vulnerability.

### How to Report

Submit a report through GitHub's private vulnerability reporting form: <https://github.com/fabiopelosin/taskplain/security/advisories/new>

### What to Include

- A clear description of the issue and its impact.
- Steps or code required to reproduce the vulnerability.
- Affected versions (npm package version or git commit).
- Any proposed mitigations or fixes (optional but appreciated).

### Response Process

- **Acknowledgement:** We aim to respond within 48 hours.
- **Triage:** We will reproduce the issue, assess severity, and determine next steps.
- **Fix & Release:** Critical fixes are prioritized and shipped as quickly as possible. You will be updated on progress and release timing.
- **Disclosure:** Once a fix is available, we will coordinate a publication date. Credit is given in advisories unless you request anonymity.

## Security Best Practices

- Run `pnpm run prepublishOnly` before publishing or distributing builds to ensure tests and type checks pass.
- Avoid running Taskplain against untrusted repositories without first reviewing scripts or tasks stored in the repo.
- Keep your Node.js runtime up to date to benefit from upstream security patches.

## Vulnerability Handling After Release

Security advisories are published through GitHub and summarized in `docs/changelog.md`. Subscribe to repository notifications to stay informed.

Thank you for responsibly disclosing vulnerabilities and helping keep Taskplain users safe.
