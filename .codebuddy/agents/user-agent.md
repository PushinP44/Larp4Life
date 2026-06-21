# CodeBuddy User Agent — General Game Dev Preferences

## Developer Profile
Game developer building browser-based projects using Vanilla JS. Participates in hackathons with strict tech-stack constraints. Values clean, modular, well-commented code. Works best with incremental delivery — one verified module at a time.

## Coding Style Preferences

### Always Do
- ES6 module syntax (`export`/`import`) — never `var`, never global scope
- Descriptive function names in camelCase: `getCarryingCapacity`, `revealEdge`, `stepPopulation`
- JSDoc comments above every exported function
- Explicit error messages: `throw new Error('buyItem: insufficient coins — need 150, have 42')`
- `const` by default, `let` only when reassignment is needed
- Arrow functions for callbacks, regular functions for named exports
- Early returns for guard clauses (avoid deep nesting)

### Never Do
- `var` declarations
- `document.write()`
- Inline `<style>` in JS-generated HTML
- Magic numbers without named constants
- `console.log` left in production code (use `// DEBUG:` prefix so they're easy to find)
- Shadowing variable names across scope levels

### Code Format
- 2-space indentation
- Single quotes for strings
- Semicolons always
- Max line length: 100 characters (break long chains)
- Group imports: built-in modules first, then local modules

## Response Preferences
- Show complete, runnable code — not pseudocode or abbreviated snippets
- If a function is long, write it all — don't use `// ... rest of function`
- When debugging, explain the root cause in one sentence before showing the fix
- When multiple approaches exist, recommend one and briefly explain why
- Use inline comments for non-obvious logic, not obvious code
- For math-heavy functions, add a comment showing the equation being implemented

## Feedback Style
- Flag scope creep immediately — one sentence explanation of why something is out of scope
- If a suggestion violates a constraint, say so directly: "This requires a build tool, which violates the static deployment constraint."
- Prefer flagging issues before writing code that violates constraints

## File Output Format
When outputting a complete file:
1. Start with the module header comment
2. List all imports
3. List all constants
4. List all exported functions (alphabetical order within each category)
5. Add a brief `// USAGE:` comment at the top showing how to import and call the main functions

## Testing Approach
- Write test cases as console.assert() blocks commented at the bottom of each file
- Self-test blocks should be copy-pasteable into the browser console
- Test edge cases: zero population, max stressor (L=100), zero resources, unsolvable-seed reroll, determinism (same seed → same result)
