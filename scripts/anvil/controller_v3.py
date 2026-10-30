#!/usr/bin/env python3
"""Campaign v3 controller. Runs as a short Slurm job (controller_v3.sbatch) that resubmits itself with --begin every
~30 min, so the campaign needs neither the laptop nor its internet once launched.

Each run: guards -> count -> retry failures once -> publish finished studies -> next wave (within throttles) -> log ->
resubmit itself unless everything is terminal or a stop condition holds.

State lives in $PROJECT/singlet_campaign/state_v3/ (markers, one file per study / sample; the results dir holds the
per-sample truth: out/pileup_stats.json = done, .rejected = failed). Restarting the controller redoes nothing.
  STOP    file: controller does not resubmit itself (jobs already queued keep running).
  PAUSE   file: controller keeps counting, publishing and retrying but submits no new wave.
  ABORT   written by the controller on a guard trip (balance < MIN_BALANCE, date > CUTOFF); same effect as STOP.
  DONE    written when every study is terminal.
Env: CONTROLLER_DRY=1 prints what it would submit and writes nothing / submits nothing.
"""
import csv, datetime as dt, glob, json, os, re, subprocess, sys, time

R = "/anvil/projects/x-bio260157/singlet_campaign"
S = f"{R}/smoke_v3"
ST = f"{R}/state_v3"
RES = os.environ.get("SINGLET_RESULTS_DIR", "/anvil/scratch/x-zdebruine/results_v3")
DRY = os.environ.get("CONTROLLER_DRY") == "1"
TIERS = [("A", f"{ST}/targets/tierA.tsv"), ("C", f"{ST}/targets/tierC.tsv")]  # tier C opens only after A published cleanly
MIN_BALANCE = float(os.environ.get("MIN_BALANCE", 94100))   # spend cap 20,000 SU from the 114,109.8 start balance (2026-10-20); a wave is held if balance - in-flight estimates - wave estimate would cross it
CUTOFF = dt.date.fromisoformat(os.environ.get("CUTOFF", "2026-11-05"))
# ---- sizing (measured by the smoke runs; see README-v3.md). Slurm bills max(cores, mem/1.896 GB) and MaxMemPerCPU is 1896 MB,
# so the cores requested are derived from the memory: asking for less memory than the index needs fails, more is wasted SU.
PROC_MEM_G = int(os.environ.get("PROC_MEM_G", 48))          # peak RSS at the 30 M read cap: mouse 41.6 GB, human 32.8 GB (smoke runs) + headroom
PROC_CPUS = int(os.environ.get("PROC_CPUS", -(-PROC_MEM_G * 1000 // 1896)))   # = cores Slurm would bill for that memory anyway
PROC_MIN_PER_SAMPLE = float(os.environ.get("PROC_MIN_PER_SAMPLE", 5.0))       # wall minutes per sample at the 30 M read cap (smoke: human 5.0, mouse 2.8 at 16 threads)
PROC_PER_JOB = int(os.environ.get("PROC_PER_JOB", 8))      # samples per process job: short jobs backfill into mixed nodes
PROC_TIME_MIN = int(os.environ.get("PROC_TIME_MIN", int(PROC_PER_JOB * PROC_MIN_PER_SAMPLE * 1.5 + 5)))   # measured wall x1.5
DL_CPUS = int(os.environ.get("DL_CPUS", 2)); DL_MEM_G = int(os.environ.get("DL_MEM_G", 4))
DL_PER_JOB = int(os.environ.get("DL_PER_JOB", 6)); DL_TIME_MIN = int(os.environ.get("DL_TIME_MIN", 40))
SLOT_CAP = int(os.environ.get("SLOT_CAP", 24))               # most process jobs one wave may run at once
MAX_LIVE_WAVES = int(os.environ.get("MAX_LIVE_WAVES", 2))   # never queue more than ~2 waves ahead
SU_PER_SAMPLE = float(os.environ.get("SU_PER_SAMPLE", 1.8))  # ~1.6 align (25 SU/h x 3.9 min mean, genome load per sample) + 0.15 download + retries
PUB_CHUNK = int(os.environ.get("PUB_CHUNK", 6))
INTERVAL_MIN = int(os.environ.get("INTERVAL_MIN", 30))
RETRYABLE = re.compile(r"^(download_fail|runtime_fail|process_no_output)")
LOGF = f"{R}/logs/v3/controller.log"


def log(m):
    line = f"{dt.datetime.now().isoformat(timespec='seconds')} {m}"
    print(line, flush=True)
    if not DRY:
        os.makedirs(os.path.dirname(LOGF), exist_ok=True)
        with open(LOGF, "a") as f:
            f.write(line + "\n")


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def touch(path, text=""):
    if DRY:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text or dt.datetime.now().isoformat(timespec="seconds") + "\n")


def balance():
    r = sh(["mybalance"])
    for line in r.stdout.splitlines():
        p = line.split()
        if p and p[0] == "bio260157":
            return float(p[-1])
    return None


def load_targets(path):
    studies = {}
    if not os.path.exists(path):
        return studies
    for line in open(path):
        f = line.rstrip("\n").split("\t")
        if len(f) < 8 or f[0] in ("gsm", "") or f[0].startswith("#"):
            continue
        studies.setdefault(f[4], []).append(f)
    return studies


def sample_state(gsm):
    d = f"{RES}/{gsm}"
    if os.path.exists(f"{d}/out/pileup_stats.json"):
        return "done", ""
    if os.path.exists(f"{d}/.rejected"):
        try:
            why = open(f"{d}/.rejected").read().split()[0]
        except OSError:
            why = "unknown"
        return "failed", why
    if os.path.exists(f"{R}/state/oom_v3/{gsm}") or os.path.exists(f"{ST}/oom_v3/{gsm}"):
        return "oom", ""
    return "pending", ""


def published(gse):
    return os.path.exists(f"{ST}/study/{gse}.published")


def live_jobs():
    r = sh(["squeue", "-u", os.environ.get("USER", "x-zdebruine"), "-h", "-o", "%i|%j|%T"])
    return [l.split("|") for l in r.stdout.splitlines()]


def submit(args, env=None):
    if DRY:
        log("DRY sbatch " + " ".join(args))
        return "DRYJOB"
    e = dict(os.environ, **(env or {}))
    r = subprocess.run(["sbatch", "--parsable"] + args, capture_output=True, text=True, env=e)
    if r.returncode:
        log(f"sbatch failed: {r.stderr.strip()}")
        return None
    return r.stdout.strip().split(";")[0]


def idle_cores():
    """Idle cores in the shared partition right now (sinfo %C = allocated/idle/other/total)."""
    r = sh(["sinfo", "-p", "shared", "-h", "-o", "%C"])
    try:
        return int(r.stdout.split()[0].split("/")[1])
    except (IndexError, ValueError):
        return None


def chunks(seq, n):
    return [seq[i:i + n] for i in range(0, len(seq), n)]


def write_list(path, items):
    if not DRY:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w").write("".join(items))
    return path


def mark_submitted(rows, wid):
    for r in rows:
        touch(f"{ST}/sample/{r[0]}.sub", wid + "\n")


def tm(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def submit_wave(wid, rows, retry=False, slots=None):
    """Download array (DL_CPUS/DL_MEM_G, DL_PER_JOB samples per task) then process arrays per species
    (PROC_CPUS/PROC_MEM_G, PROC_PER_JOB samples per task, --time = measured wall x1.5) with afterany on the download array."""
    wdir = f"{ST}/waves/{wid}"; tag = "r_" if retry else ""
    mark_submitted(rows, wid)
    dls = [write_list(f"{wdir}/{tag}dl_{i:04d}.tsv", ["\t".join(r) + "\n" for r in c]) for i, c in enumerate(chunks(rows, DL_PER_JOB))]
    dl_list = write_list(f"{wdir}/{tag}dl.list", [p + "\n" for p in dls])
    idle = idle_cores() or 0
    dl_thr = max(2, min(25, idle // (4 * DL_CPUS) if idle else 4))
    jobs = {}
    jid = submit(["--array", f"0-{len(dls) - 1}%{dl_thr}", "-J", f"v3dl_{wid}", "-c", str(DL_CPUS), f"--mem={DL_MEM_G}G",
                  "-t", tm(DL_TIME_MIN), f"{S}/download_v3.sbatch"], {"DL_BATCH_LIST": dl_list, "DL_LIMIT_S": str((DL_TIME_MIN - 5) * 60)})
    jobs["dl"] = jid
    for sp in ("human", "mouse"):
        sub = [r for r in rows if r[3] == sp]
        if not sub:
            continue
        procs = [write_list(f"{wdir}/{tag}proc_{sp}_{i:04d}.tsv", ["\t".join(r) + "\n" for r in c]) for i, c in enumerate(chunks(sub, PROC_PER_JOB))]
        pl = write_list(f"{wdir}/{tag}proc_{sp}.list", [p + "\n" for p in procs])
        thr = slots or SLOT_CAP
        dep = ["--dependency", f"afterany:{jid}"] if jid else []
        jobs[sp] = submit(["--array", f"0-{len(procs) - 1}%{thr}", "-J", f"v3proc_{wid}", "-c", str(PROC_CPUS), f"--mem={PROC_MEM_G}G",
                           "-t", tm(PROC_TIME_MIN)] + dep + [f"{S}/process_v3.sbatch"],
                          {"PROC_BATCH_LIST": pl, "PROC_LIMIT_S": str((PROC_TIME_MIN - 4) * 60)})
    return jobs


def submit_oom_retry(wid, rows):
    """OOM at PROC_MEM_G: one retry with +50% memory (cores follow), 2 samples per task, RETRY=1 (OOM again = rejected)."""
    wdir = f"{ST}/waves/{wid}"; mem = int(PROC_MEM_G * 1.5); cpus = -(-mem * 1000 // 1896); out = {}
    mark_submitted(rows, wid)
    for sp in ("human", "mouse"):
        sub = [r for r in rows if r[3] == sp]
        if not sub:
            continue
        lst = [write_list(f"{wdir}/oom_{sp}_{i:04d}.tsv", ["\t".join(r) + "\n" for r in c]) for i, c in enumerate(chunks(sub, 2))]
        pl = write_list(f"{wdir}/oom_{sp}.list", [p + "\n" for p in lst])
        t = int(2 * PROC_MIN_PER_SAMPLE * 1.5 + 5)
        out[sp] = submit(["--array", f"0-{len(lst) - 1}%4", "-c", str(cpus), f"--mem={mem}G", "-t", tm(t), "-J", f"v3oom_{wid}",
                          f"{S}/process_v3.sbatch"], {"PROC_BATCH_LIST": pl, "RETRY": "1", "PROC_LIMIT_S": str((t - 4) * 60)})
    return out


def main():
    today = dt.date.today()
    log(f"=== controller run {'(DRY) ' if DRY else ''}host={os.uname().nodename} ===")
    for f in ("STOP", "ABORT", "DONE"):
        if os.path.exists(f"{ST}/{f}"):
            log(f"{f} marker present: exiting without resubmitting")
            return
    bal = balance()
    abort = None
    if today > CUTOFF:
        abort = f"date {today} past cutoff {CUTOFF}"
    elif bal is not None and bal < MIN_BALANCE:
        abort = f"balance {bal:.0f} SU below {MIN_BALANCE:.0f}"
    if abort:
        log(f"ABORT: {abort}. No new work; running jobs finish, controller will not resubmit.")
        touch(f"{ST}/ABORT", abort + "\n")
        return
    paused = os.path.exists(f"{ST}/PAUSE")

    tiers = [(t, p, load_targets(p)) for t, p in TIERS]
    wave_files = sorted(glob.glob(f"{ST}/waves/*/studies.json"))
    in_wave = {}
    for wf in wave_files:
        for g in json.load(open(wf))["studies"]:
            in_wave[g] = wf
    live = live_jobs()
    live_names = [j[1] for j in live]

    # ---- count + retry + publish -------------------------------------------------
    retry_rows, oom_rows, to_publish, requeue_rows = [], [], [], []
    tier_summary, unsettled_studies = {}, 0
    pub_failed = 0
    for t, path, studies in tiers:
        cnt = dict(studies=len(studies), submitted=0, published=0, empty=0, pub_failed=0, done=0, failed=0, pending=0)
        for gse, rows in sorted(studies.items()):
            if gse not in in_wave:
                continue
            cnt["submitted"] += 1
            if published(gse):
                cnt["published"] += 1
                continue
            if os.path.exists(f"{ST}/study/{gse}.empty"):
                cnt["empty"] += 1
                continue
            if os.path.exists(f"{ST}/study/{gse}.publish_failed"):
                cnt["pub_failed"] += 1
                pub_failed += 1
                continue
            states = [(r, *sample_state(r[0])) for r in rows]
            nd = sum(s == "done" for _, s, _ in states)
            nf = sum(s == "failed" for _, s, _ in states)
            cnt["done"] += nd; cnt["failed"] += nf
            settled = True
            for r, s, why in states:
                if s == "failed" and RETRYABLE.match(why) and not os.path.exists(f"{ST}/sample/{r[0]}.retried"):
                    retry_rows.append(r); settled = False
                    if not DRY:
                        d = f"{RES}/{r[0]}"
                        for x in (".rejected", ".dl_attempts"):
                            try: os.remove(f"{d}/{x}")
                            except OSError: pass
                        try: os.remove(f"{R}/state/attempts_v3/{r[0]}")
                        except OSError: pass
                    touch(f"{ST}/sample/{r[0]}.retried", why + "\n")
                elif s == "oom":
                    settled = False
                    if not os.path.exists(f"{ST}/sample/{r[0]}.oom_retried"):
                        oom_rows.append(r); touch(f"{ST}/sample/{r[0]}.oom_retried")
                elif s == "pending":
                    settled = False
                    cnt["pending"] += 1
                    # leftover: its last submission has no live job any more (job ran out of time, node failure, ...)
                    sp_ = f"{ST}/sample/{r[0]}.sub"
                    last = open(sp_).read().strip() if os.path.exists(sp_) else ""
                    if last and not any(n.endswith("_" + last) for n in live_names):
                        qf = f"{ST}/sample/{r[0]}.requeue"
                        k = int(open(qf).read() or 0) if os.path.exists(qf) else 0
                        if k >= 3:
                            if not DRY:
                                open(f"{RES}/{r[0]}/.rejected", "w").write("stuck_requeue\n")
                        else:
                            requeue_rows.append(r); touch(qf, f"{k + 1}\n")
            if not settled:
                unsettled_studies += 1
                continue
            if nd == 0:
                touch(f"{ST}/study/{gse}.empty", "no usable sample; nothing to publish\n")
                cnt["empty"] += 1
                continue
            # settled with >= 1 done sample: publish (once per attempt)
            q = f"{ST}/study/{gse}.publish_queued"
            if os.path.exists(q):
                jid = open(q).read().split()[0] if os.path.getsize(q) else ""
                age_h = (time.time() - os.path.getmtime(q)) / 3600
                if jid and any(j[0] == jid for j in live):
                    continue
                if age_h < 0.2:
                    continue
                n = int(open(f"{ST}/study/{gse}.publish_attempts").read() or 0) if os.path.exists(f"{ST}/study/{gse}.publish_attempts") else 0
                if n >= 2:
                    touch(f"{ST}/study/{gse}.publish_failed", f"publish job ended twice without a .published marker; see {ST}/study/{gse}.publish_error\n")
                    log(f"{gse}: PUBLISH FAILED twice")
                    continue
                if not DRY:
                    os.remove(q)
            to_publish.append((t, path, gse))
        tier_summary[t] = cnt

    # retries (one wave of resubmitted fetch+align; OOM handled separately)
    rid = dt.datetime.now().strftime("%Y%m%dT%H%M")
    if retry_rows or requeue_rows:
        allr = retry_rows + [r for r in requeue_rows if r not in retry_rows]
        j = submit_wave(f"retry_{rid}", allr, retry=True)
        log(f"retry wave: {len(retry_rows)} first-failure retries + {len(requeue_rows)} leftovers of expired jobs -> {j}; est {len(allr) * SU_PER_SAMPLE:.0f} SU")
    if oom_rows:
        j = submit_oom_retry(f"oomretry_{rid}", oom_rows)
        log(f"OOM retry: {len(oom_rows)} samples at 72G -> {j}; est {len(oom_rows) * 4:.0f} SU")

    # publish jobs, grouped by tier targets file, PUB_CHUNK studies per job
    by_path = {}
    for t, path, gse in to_publish:
        by_path.setdefault(path, []).append(gse)
    for path, gl in by_path.items():
        for i in range(0, len(gl), PUB_CHUNK):
            chunk = gl[i:i + PUB_CHUNK]
            jid = submit(["-J", "v3pub", f"{S}/publish_v3.sbatch", path] + chunk)
            log(f"publish job {jid}: {' '.join(chunk)}")
            for g in chunk:
                a = f"{ST}/study/{g}.publish_attempts"
                n = (int(open(a).read() or 0) if os.path.exists(a) else 0) + 1
                touch(a, f"{n}\n"); touch(f"{ST}/study/{g}.publish_queued", f"{jid}\n")

    # ---- next wave: sized to what the shared partition can run now -----------------
    idle = idle_cores()
    pend_proc = len([1 for j in sh(["squeue", "-u", os.environ.get("USER", "x-zdebruine"), "-h", "-r", "-t", "PENDING", "-o", "%j"]).stdout.split() if j.startswith("v3proc_")]) if not DRY else 0
    live_waves = len({w for n in live_names for w in re.findall(r"^v3proc_((?:A|C)_\w+)$", n)})
    tierA_clean = tier_summary.get("A") and all(
        published(g) or os.path.exists(f"{ST}/study/{g}.empty") for g in tiers[0][2]) and pub_failed == 0
    new_wave = None
    for t, path, studies in tiers:
        if t == "C" and not tierA_clean:
            log("tier C closed: tier A not fully published cleanly yet" if studies else "tier C: no targets file yet")
            continue
        todo = [g for g in sorted(studies) if g not in in_wave]
        if not todo:
            continue
        slots = min(SLOT_CAP, (idle or 0) // PROC_CPUS)
        why = None
        if paused: why = "PAUSE file"
        elif live_waves >= MAX_LIVE_WAVES: why = f"{live_waves} waves live (max {MAX_LIVE_WAVES})"
        elif pend_proc > 0: why = f"{pend_proc} process jobs of ours are still pending (queue not drained, no pile-up)"
        elif idle is None: why = "cannot read sinfo"
        elif slots < 1: why = f"only {idle} idle cores in shared, a process job needs {PROC_CPUS}"
        if why:
            log(f"tier {t}: {len(todo)} studies waiting; hold: {why}")
            break
        # one pass of the idle capacity: slots jobs x PROC_PER_JOB samples, whole studies, at least one study
        target = slots * PROC_PER_JOB
        pick, n = [], 0
        for g in todo:
            if pick and n + len(studies[g]) > target * 1.25:
                break
            pick.append(g); n += len(studies[g])
            if n >= target:
                break
        est = n * SU_PER_SAMPLE
        inflight_est = sum(json.load(open(w))["est_su"] for w in wave_files if not all(
            published(g) or os.path.exists(f"{ST}/study/{g}.empty") for g in json.load(open(w))["studies"]))
        if bal is not None and bal - inflight_est - est < MIN_BALANCE:
            log(f"tier {t}: wave of {n} samples (est {est:.0f} SU) would take balance {bal:.0f} - in-flight {inflight_est:.0f} below {MIN_BALANCE:.0f}; holding")
            break
        wid = f"{t}_{rid}"
        rows = [r for g in pick for r in studies[g]]
        log(f"WAVE {wid}: tier {t}, {len(pick)} studies, {n} samples, est {est:.0f} SU (balance {bal}, in-flight est {inflight_est:.0f}); "
            f"idle shared cores {idle} -> {slots} slots of {PROC_CPUS} cores/{PROC_MEM_G}G/{PROC_TIME_MIN} min; "
            f"download {DL_CPUS}c/{DL_MEM_G}G/{DL_TIME_MIN} min")
        jobs = submit_wave(wid, rows, slots=slots)
        log(f"  jobs: {jobs}")
        if not DRY:
            os.makedirs(f"{ST}/waves/{wid}", exist_ok=True)
            json.dump(dict(studies=pick, samples=n, est_su=est, tier=t, jobs=jobs, slots=slots, at=dt.datetime.now().isoformat()),
                      open(f"{ST}/waves/{wid}/studies.json", "w"))
        new_wave = wid
        break

    # ---- report ----------------------------------------------------------------
    for t, c in tier_summary.items():
        log(f"tier {t}: {c}")
    log(f"balance={bal} idle_shared_cores={idle} paused={paused} live_jobs={len(live)} date={today} cutoff={CUTOFF}")

    # ---- terminal? resubmit ------------------------------------------------------
    def terminal(g):
        return published(g) or os.path.exists(f"{ST}/study/{g}.empty") or os.path.exists(f"{ST}/study/{g}.publish_failed")
    a_done = bool(tiers[0][2]) and not new_wave and all(terminal(g) for g in tiers[0][2])
    c_targets = tiers[1][2]
    if a_done and tierA_clean and not c_targets and not os.path.exists(f"{ST}/NO_TIER_C"):
        if not os.path.exists(f"{ST}/targets/tierC.requested"):
            jid = submit(["-J", "v3_prep_C", f"{S}/prep_targets_v3.sbatch", "C"])
            touch(f"{ST}/targets/tierC.requested", f"{jid}\n")
            log(f"tier A published cleanly: tier C target preparation submitted ({jid}); waves follow once targets exist")
    elif a_done and (not tierA_clean) and not c_targets:
        log("tier A terminal WITH publish failures: tier C stays closed")
    all_terminal = a_done and (not c_targets and (os.path.exists(f"{ST}/NO_TIER_C") or not tierA_clean) or
                               bool(c_targets) and all(terminal(g) for g in c_targets) and all(g in in_wave for g in c_targets))
    if all_terminal:
        log("ALL OPENED STUDIES TERMINAL: writing DONE, not resubmitting")
        touch(f"{ST}/DONE")
        return
    jid = submit(["--begin", f"now+{INTERVAL_MIN}minutes", "-J", "v3_controller", f"{S}/controller_v3.sbatch"])
    log(f"controller resubmitted: {jid} in {INTERVAL_MIN} min")


if __name__ == "__main__":
    main()
