# Token-Savings Benchmark

## Results

> **Token heuristic:** estimated tokens = chars / 4. All figures are aggregate byte counts of command outputs or raw file reads; no personal data, file contents, or identifiers appear in this table.

| Scenario | Old chars | Old ≈tok | New chars | New ≈tok | Saved chars | Saved % |
|----------|----------:|---------:|----------:|---------:|------------:|--------:|
| daily-summary | 76,783 | 19,196 | 6,236 | 1,559 | 70,547 | 91.9% |
| session-start (context) | 25,662 | 6,416 | 6,580 | 1,645 | 19,082 | 74.4% |
| daily task-update | 19,929 | 4,982 | 4,163 | 1,041 | 15,766 | 79.1% |
| weekly-review | 3,178 | 795 | 550 | 138 | 2,628 | 82.7% |
| single lookup | 858 | 215 | 12 | 3 | 846 | 98.6% |
|----------|----------:|---------:|----------:|---------:|------------:|--------:|
| **TOTAL** | **126,410** | **31,603** | **17,541** | **4,385** | **108,869** | **86.1%** |

## Summary

Across 5 representative workflow scenarios, replacing raw file reads with structured CLI command output reduces context size by approximately **86.1%** (from ~31,603 estimated tokens to ~4,385 estimated tokens). The largest gains come from the daily-summary workflow where the full markdown task export is multiplied across multiple reads and combined with raw memory files; the CLI equivalent compresses this into two compact JSON outputs. Single-field lookups show the most dramatic percentage savings since only the requested value is returned rather than the entire person file.
