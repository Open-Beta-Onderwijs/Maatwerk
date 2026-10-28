# Performance notes

Measurements that decisions rest on. Synthetic data only.

## Opdracht batch memory (Step 5b, ADR-0002 section 5a "Limits")

Question: a class batch keeps every compiled job until the merge. Does it need a cap on
parallelism?

Setup: `cargo run --release -p maatwerk-core --example batch_memory -- <students> <workers>` on
the tiny fixture's opdrachten (`crates/maatwerk-core/tests/fixtures`). Every student gets two
opdrachten (the images one, 2 pages, and the 3-page one), duplex. Peak working set polled from
PowerShell every 50 ms (`Process.PeakWorkingSet64`). Windows 11, 16 logical CPUs, system fonts
on, 2026-10-28.

| Students | Jobs | Workers     | Pages | Merged PDF | Time  | Peak working set |
| -------- | ---- | ----------- | ----- | ---------- | ----- | ---------------- |
| 30       | 60   | 1           | 179   | 2.0 MiB    | 1.3 s | ~109 MiB         |
| 30       | 60   | 4 (default) | 179   | 2.0 MiB    | 0.5 s | ~118 MiB         |
| 60       | 120  | 4 (default) | 359   | 4.0 MiB    | 1.1 s | ~153 MiB         |

Findings:

- Each job keeps only its PDF bytes until the merge (~35 KiB per job here); the laid-out document
  is dropped right after export. Memory grows with the PDFs and Typst's memoisation cache, not
  with the number of workers.
- Students with the same opdracht differ only in the header, so Typst's memoisation (comemo)
  reuses most of the work; the time per job falls well below a cold compile. The cache is
  trimmed after every compile (`comemo::evict(10)`, as the Typst CLI does).
- **Decision:** no cap beyond the reference's `max(2, min(4, cpus - 1))`. Revisit if teachers'
  opdrachten with many large images show otherwise (images are embedded once per job PDF).

Not measured yet: the Tauri process as a whole (Step 6), and opdrachten with large photos.
