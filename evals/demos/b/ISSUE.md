# Bug: thousands separators break parse_price

`parse_price("1,234.50")` raises `ValueError` (it turns the comma into a dot: "1.234.50").
Expected: `1234.5`.

Must keep working: `"12.50"`, `"$3"`, and European decimal comma `"12,50"` → `12.5`.
A comma followed by exactly three digits and then a dot (or another comma group) is a thousands separator.
Please add a regression test. Do not change `total_value`'s behavior.
