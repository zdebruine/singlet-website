# Beta campaign status page (wireframe)

Route `/beta/campaign` on beta.singlet.bio (noindex, no navbar link; the owner bookmarks it). It reads
`/api/hpc/beta/campaign-status.json`, which the cluster feed job (`status_feed.sbatch`, Singlet-Bio/singlet-agents) writes every
10 minutes into the `singlet-beta-dashboard` bucket. The page refreshes itself every minute. Read-only.

```
Beta campaign
[ Running. Data from 4 minutes ago. ]          grey <25 min, amber <2 h ("the feed may have stopped"), red older

SAMPLES
[ Done 41,260 ][ Waiting to run 56,100 ][ In review 212 ][ Failed 37 ]
12 more set aside with a recorded reason. At the pace of the last 24 hours (3,100 samples a day), the rest would finish around 2026-12-02.
Samples finished per day   ▁▂▄▆▇▇█▇   (bars, hover for date and count)

WHAT WENT WRONG                                  shown only when something failed, is in review or a worker halted
- 30 failed: the count matrix could not be written. Examples: GSM..., GSM...
- 212 in review: a required output file was empty.

NETWORK
Download speed, estimated   ▓▓▓▓▓▓▓▓░░  0.72 of 0.90 GB/s; target 80%

COMPUTE IN USE
H100 ▓▓▓▓▓▓░░ 2 of 3 GPUs running, 1 waiting     V100S, RTX 8000, CPU nodes, Large-memory node alike

DISK AND UPLOADS
Free disk ▓▓▓▓▓▓▓░░  12,400 GB free; downloads stop below 8,000 GB   (red under the floor)
5,100 samples uploaded to Beta so far. 240 are waiting for upload. Recent upload speed 11.5 MB/s. Reads downloaded but not yet on a device: 38 G pairs (downloads pause at 120 G).

Read-only. To pause or resume the campaign, ask the orchestrator in chat.
```

Fields come straight from the feed blocks `samples`, `eta`, `per_day`, `failed`, `review`, `halted_pilots`, `network`, `lanes`, `disk`,
`shipping`, `backlog`. Counts and public sample ids only.
