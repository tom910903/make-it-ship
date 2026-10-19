# Task: make the test suite green

CI is failing: `cartTotal with 15% discount rounds the discount half up` fails.
The test describes the intended behavior (discount rounded half up to the nearest cent). Fix the code, not the test.
Constraints: no new dependencies; `lineTotal` and the no-discount behavior must not change.
