# Feature request: slugify

Add `slugify(title: string): string` to `src/text.ts` for building URL slugs.

Rules:
1. Lowercase the result.
2. Remove diacritics (e.g. "Crème Brûlée" → "creme-brulee").
3. Any run of characters that are not `a-z` or `0-9` becomes a single `-`.
4. No leading or trailing `-`.
5. An input with no letters or digits returns `""`.

Examples: `slugify("Hello, World!")` → `"hello-world"`, `slugify("  Ship it -- now  ")` → `"ship-it-now"`.

Constraints: no new dependencies; existing functions must keep their behavior.
