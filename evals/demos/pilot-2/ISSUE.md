Bug: `parseDuration("90s")` returns 5400 instead of 90. Seconds are multiplied by 60. Fix it with a regression test; hour/minute parsing must not change.
