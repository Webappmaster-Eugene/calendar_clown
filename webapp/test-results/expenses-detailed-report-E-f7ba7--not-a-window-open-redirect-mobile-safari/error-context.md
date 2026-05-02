# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: expenses-detailed-report.spec.ts >> Expenses — Excel button (authenticated download) >> clicking Excel issues an authenticated request, not a window.open redirect
- Location: e2e/expenses-detailed-report.spec.ts:127:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /Users/johnn/Library/Caches/ms-playwright/webkit-2272/pw_run.sh
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```