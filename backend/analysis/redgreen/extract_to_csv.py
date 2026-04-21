#!/usr/bin/env python3
"""
Extract REDGREEN experiment data from SQLite into analysis-ready CSV files.

Outputs (in the same directory as the DB, or --output-dir):
  sessions.csv   — one row per session
  trials.csv     — one row per E-trial, with ground truth from simulation JSONs
  keystates.csv  — frame-by-frame key presses with semantic response columns

Usage:
    python extract_to_csv.py <db_path> <trial_data_dir> [--output-dir DIR]
"""

import argparse
import json
import os
import sqlite3
from pathlib import Path


def extract(db_path: str, trial_data_dir: str, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # --- Sessions ---
    sessions = conn.execute("""
        SELECT id AS session_id, prolific_pid, average_score,
               randomized_profile_id, time_taken, completed
        FROM redgreen_session
        WHERE (ignore_data = 0 OR ignore_data IS NULL)
    """).fetchall()
    session_ids = {r["session_id"] for r in sessions}

    with open(os.path.join(output_dir, "sessions.csv"), "w") as f:
        f.write("session_id,prolific_pid,average_score,randomized_profile_id,time_taken,completed\n")
        for r in sessions:
            f.write(f"{r['session_id']},{r['prolific_pid']},{r['average_score']},"
                    f"{r['randomized_profile_id']},{r['time_taken']},{r['completed']}\n")

    # --- Ground truth from simulation JSONs ---
    gt = {}
    trial_dir = Path(trial_data_dir)
    for entry in sorted(trial_dir.iterdir()):
        if not entry.name.startswith("E_"):
            continue
        jp = entry / "simulation_data.json"
        if not jp.exists():
            continue
        with open(jp) as jf:
            d = json.load(jf)
        gt[entry.name] = {
            "rg_outcome": d["rg_outcome"],
            "num_frames": d["num_frames"],
            "ground_truth_side": "L" if d["rg_outcome"] == "green" else "R",
        }

    # --- Trials ---
    trials = conn.execute("""
        SELECT id AS trial_id, session_id, trial_index, global_trial_name,
               score, completed, counterbalance
        FROM trial
        WHERE trial_type != 'ftrial'
    """).fetchall()

    with open(os.path.join(output_dir, "trials.csv"), "w") as f:
        f.write("trial_id,session_id,trial_index,global_trial_name,score,completed,"
                "counterbalance,rg_outcome,num_frames,ground_truth_side\n")
        for r in trials:
            if r["session_id"] not in session_ids:
                continue
            g = gt.get(r["global_trial_name"], {})
            f.write(f"{r['trial_id']},{r['session_id']},{r['trial_index']},"
                    f"{r['global_trial_name']},{r['score']},"
                    f"{r['completed']},{r['counterbalance']},"
                    f"{g.get('rg_outcome', '')},{g.get('num_frames', '')},"
                    f"{g.get('ground_truth_side', '')}\n")

    # Build lookup: trial_id -> (global_trial_name, counterbalance, prolific_pid, rg_outcome, ground_truth_side)
    trial_meta = {}
    pid_map = {r["session_id"]: r["prolific_pid"] for r in sessions}
    for r in trials:
        if r["session_id"] not in session_ids:
            continue
        g = gt.get(r["global_trial_name"], {})
        trial_meta[r["trial_id"]] = {
            "global_trial_name": r["global_trial_name"],
            "counterbalance": r["counterbalance"] or 0,
            "prolific_pid": pid_map.get(r["session_id"], ""),
            "session_id": r["session_id"],
            "rg_outcome": g.get("rg_outcome", ""),
            "ground_truth_side": g.get("ground_truth_side", ""),
        }

    # --- Keystates ---
    valid_ids = ",".join(str(tid) for tid in trial_meta)
    keystates = conn.execute(f"""
        SELECT trial_id, frame, f_pressed, j_pressed, relative_time_ms, session_id
        FROM keystate
        WHERE trial_id IN ({valid_ids})
        ORDER BY trial_id, frame
    """).fetchall()

    with open(os.path.join(output_dir, "keystates.csv"), "w") as f:
        f.write("trial_id,session_id,prolific_pid,global_trial_name,frame,"
                "f_pressed,j_pressed,relative_time_ms,counterbalance,"
                "rg_outcome,ground_truth_side,"
                "response_label,response_numeric,is_correct\n")
        for r in keystates:
            meta = trial_meta.get(r["trial_id"])
            if meta is None:
                continue
            fp = int(r["f_pressed"])
            jp = int(r["j_pressed"])
            cb = int(meta["counterbalance"])

            # Semantic mapping: F=green(L), J=red(R) when cb=0; swapped when cb=1
            if cb == 0:
                chose_green = (fp == 1 and jp == 0)
                chose_red = (jp == 1 and fp == 0)
            else:
                chose_green = (jp == 1 and fp == 0)
                chose_red = (fp == 1 and jp == 0)

            if chose_green:
                response_label = "L"
                response_numeric = -1
            elif chose_red:
                response_label = "R"
                response_numeric = 1
            else:
                response_label = "?"
                response_numeric = 0

            gt_side = meta["ground_truth_side"]
            if response_label == "?":
                is_correct = "NA"
            elif response_label == gt_side:
                is_correct = "TRUE"
            else:
                is_correct = "FALSE"

            f.write(f"{r['trial_id']},{meta['session_id']},{meta['prolific_pid']},"
                    f"{meta['global_trial_name']},{r['frame']},"
                    f"{fp},{jp},{r['relative_time_ms']},{cb},"
                    f"{meta['rg_outcome']},{gt_side},"
                    f"{response_label},{response_numeric},{is_correct}\n")

    conn.close()
    print(f"Extracted to {output_dir}/")
    print(f"  sessions.csv:  {len(sessions)} rows")
    print(f"  trials.csv:    {len([t for t in trials if t['session_id'] in session_ids])} rows")
    print(f"  keystates.csv: {len(keystates)} rows")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract REDGREEN DB to CSV")
    parser.add_argument("db_path", help="Path to SQLite database")
    parser.add_argument("trial_data_dir", help="Path to trial_data folder with E_* subdirs")
    parser.add_argument("--output-dir", default=None, help="Output directory (default: same as db)")
    args = parser.parse_args()

    if args.output_dir is None:
        args.output_dir = os.path.join(os.path.dirname(args.db_path), "csv_data")

    extract(args.db_path, args.trial_data_dir, args.output_dir)
