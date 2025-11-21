# Contributing to Safe Sweep Bot

Thank you for your interest in contributing to Safe Sweep Bot! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- Git

### Initial Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/safe-sweep.git
   cd safe-sweep
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

## Development Workflow

### Making Changes

1. Create a new branch for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the `src/` directory

3. Build and test your changes:
   ```bash
   npm run build
   npm run lint
   npm test
   ```

4. Commit your changes with a descriptive message:
   ```bash
   git commit -m "Add feature: description of your changes"
   ```

### Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small
- Use async/await for asynchronous operations

### Linting

The project uses ESLint for code quality. Run the linter before committing:

```bash
npm run lint
```

Fix any linting errors that appear.

### Testing

Add tests for new features in `src/__tests__/`:

```typescript
import { YourClass } from '../services/YourClass';

describe('YourClass', () => {
  it('should do something', () => {
    const instance = new YourClass();
    expect(instance.doSomething()).toBe(expectedResult);
  });
});
```

Run tests with:
```bash
npm test
```

## Project Structure

```
safe-sweep/
├── src/
│   ├── services/         # Core services
│   │   ├── MempoolMonitor.ts
│   │   ├── TransactionAnalyzer.ts
│   │   └── TokenSweeper.ts
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/            # Utility functions
│   │   ├── config.ts
│   │   └── logger.ts
│   ├── __tests__/        # Test files
│   └── index.ts          # Main entry point
├── dist/                 # Compiled JavaScript (generated)
├── .env.example          # Example environment configuration
├── package.json          # Project dependencies
├── tsconfig.json         # TypeScript configuration
└── README.md            # Project documentation
```

## Adding New Features

### Example: Adding a New Detection Method

1. Add the method to `TransactionAnalyzer.ts`:
   ```typescript
   private async analyzeNewPattern(tx: PendingTransaction): Promise<SuspiciousTransaction | null> {
     // Your detection logic here
   }
   ```

2. Call it from the `analyze` method:
   ```typescript
   async analyze(tx: PendingTransaction): Promise<SuspiciousTransaction | null> {
     // Existing checks...
     
     // New check
     const newPatternResult = await this.analyzeNewPattern(tx);
     if (newPatternResult) return newPatternResult;
     
     return null;
   }
   ```

3. Add tests in `src/__tests__/TransactionAnalyzer.test.ts`

4. Update documentation in README.md if needed

### Example: Adding Configuration Options

1. Add the option to `src/types/index.ts`:
   ```typescript
   export interface Config {
     // Existing options...
     newOption: string;
   }
   ```

2. Update `src/utils/config.ts` to load it:
   ```typescript
   export function loadConfig(): Config {
     return {
       // Existing config...
       newOption: process.env.NEW_OPTION || 'default',
     };
   }
   ```

3. Update `.env.example` with the new variable

4. Document it in README.md

## Pull Request Process

1. Ensure all tests pass and linting is clean
2. Update documentation if needed
3. Push your changes to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

4. Create a Pull Request on GitHub with:
   - Clear title describing the change
   - Description of what changed and why
   - Any relevant issue numbers (e.g., "Fixes #123")

5. Wait for review and address any feedback

## Bug Reports

When reporting bugs, please include:

- Description of the issue
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (Node version, network, etc.)
- Relevant log output

## Feature Requests

For feature requests:

- Describe the feature and its use case
- Explain why it would be valuable
- Provide examples if possible

## Code Review Guidelines

When reviewing code:

- Be constructive and respectful
- Focus on code quality and correctness
- Check for security implications
- Verify tests are adequate
- Ensure documentation is updated

## Security

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email the maintainers directly with details
3. Wait for confirmation before disclosing publicly

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

If you have questions about contributing:
- Check existing issues and PRs
- Open a discussion on GitHub
- Review the README and USAGE documentation

Thank you for contributing to Safe Sweep Bot! 🚀