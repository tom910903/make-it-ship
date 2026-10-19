# Two independent additions

1. `src/text.js`: add `kebab(s)` — lowercase words joined by `-` ("Hello World" → "hello-world", "fooBar baz" → "foo-bar-baz"). Tests in `test/text.test.js`.
2. `src/math.js`: add `mean(xs)` — arithmetic mean of a non-empty number array; throws `RangeError` on an empty array. Tests in `test/math.test.js`.

The two changes are independent (different files). Constraints: no new dependencies; existing functions unchanged.
