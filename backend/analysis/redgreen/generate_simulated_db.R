# REDGREEN Experiment — Generate Simulated Database
# ==================================================
#
# R equivalent of generate_simulated_db.py. Uses the sqlite3 CLI to write the DB.
#
# Reads actual trial simulation_data.json files for frame counts and ground truth,
# then simulates realistic key-press sequences for N synthetic participants.
#
# Usage:
#   Rscript generate_simulated_db.R [--n-participants 6] [--output simulated.db] [--seed 42]
#
# Required packages: jsonlite
# Required system tool: sqlite3 CLI
# ---------------------------------------------------------------------------

suppressPackageStartupMessages({
  library(jsonlite)
})


# =========================================================================
# Paths (relative to this script)
# =========================================================================

get_script_dir <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("--file=", args, value = TRUE)
  if (length(file_arg) > 0) {
    return(dirname(normalizePath(sub("--file=", "", file_arg[1]))))
  }
  getwd()
}

SCRIPT_DIR <- get_script_dir()
TRIAL_DATA_DIR <- file.path(SCRIPT_DIR, "..", "..", "trial_data", "chs_training_zoom")


# =========================================================================
# Helper: execute SQL via sqlite3 CLI
# =========================================================================

sqlite3_exec <- function(db_path, sql) {
  # Pipe SQL to sqlite3 stdin to avoid quoting issues.
  tmp <- tempfile(fileext = ".sql")
  on.exit(unlink(tmp))
  writeLines(sql, tmp)
  system2("sqlite3", args = shQuote(db_path), stdin = tmp,
          stdout = TRUE, stderr = TRUE)
}

sqlite3_query_plain <- function(db_path, sql) {
  # Run a SELECT and return raw lines (no header, no CSV quoting).
  tmp <- tempfile(fileext = ".sql")
  on.exit(unlink(tmp))
  writeLines(sql, tmp)
  result <- system2("sqlite3", args = shQuote(db_path), stdin = tmp,
                    stdout = TRUE, stderr = FALSE)
  result[nzchar(result)]
}


# =========================================================================
# Load E-trial metadata from simulation JSONs
# =========================================================================

load_etrial_metadata <- function(trial_data_dir) {
  entries <- list.dirs(trial_data_dir, full.names = FALSE, recursive = FALSE)
  e_folders <- sort(entries[startsWith(entries, "E")])

  results <- lapply(e_folders, function(folder) {
    json_path <- file.path(trial_data_dir, folder, "simulation_data.json")
    if (!file.exists(json_path)) return(NULL)
    d <- fromJSON(json_path)
    data.frame(
      name = folder,
      rg_outcome = d$rg_outcome,
      num_frames = as.integer(d$num_frames),
      fps = as.integer(d$fps %||% 30L),
      stringsAsFactors = FALSE
    )
  })

  do.call(rbind, Filter(Negate(is.null), results))
}


# =========================================================================
# Simulate a key-press sequence for one trial
# =========================================================================

simulate_keypress_sequence <- function(num_frames, rg_outcome, accuracy,
                                       switch_rate = 0.03) {
  # Correct key: F=green, J=red
  correct_f <- if (rg_outcome == "green") 1L else 0L
  correct_j <- if (rg_outcome == "red")   1L else 0L

  f_state <- 0L
  j_state <- 0L
  commit_frame <- as.integer(num_frames * runif(1, 0.05, 0.25))

  frames <- vector("list", num_frames)

  for (i in seq_len(num_frames)) {
    idx <- i - 1L  # 0-based frame

    if (idx < commit_frame) {
      # Phase 1: initial uncertainty
      if (runif(1) < 0.05) {
        if (runif(1) < 0.5) {
          f_state <- 1L; j_state <- 0L
        } else {
          f_state <- 0L; j_state <- 1L
        }
      } else {
        f_state <- 0L; j_state <- 0L
      }
    } else {
      # Phase 2: active responding
      if (runif(1) < switch_rate) {
        roll <- runif(1)
        if (roll < 0.15) {
          f_state <- 0L; j_state <- 0L
        } else if (roll < 0.3) {
          f_state <- 1L - correct_f; j_state <- 1L - correct_j
        } else {
          f_state <- correct_f; j_state <- correct_j
        }
      } else if (f_state == 0L && j_state == 0L) {
        if (runif(1) < accuracy) {
          f_state <- correct_f; j_state <- correct_j
        } else {
          f_state <- 1L - correct_f; j_state <- 1L - correct_j
        }
      }
    }

    # Timing: ~33ms per frame with jitter
    rel_time <- if (idx == 0L) 0.0 else max(0.0, round(idx * (1000.0 / 30) + rnorm(1, 0, 2), 1))

    frames[[i]] <- list(frame = idx, f_pressed = f_state, j_pressed = j_state,
                        relative_time_ms = rel_time)
  }

  frames
}


# =========================================================================
# Compute trial score (backend formula)
# =========================================================================

compute_score <- function(keystates, rg_outcome) {
  correct_f <- if (rg_outcome == "green") 1L else 0L
  correct_j <- if (rg_outcome == "red")   1L else 0L

  correct <- 0L
  incorrect <- 0L

  for (ks in keystates) {
    f <- ks$f_pressed; j <- ks$j_pressed
    if (f == correct_f && j == correct_j && f != j) {
      correct <- correct + 1L
    } else if (f != correct_f && j != correct_j && f != j) {
      incorrect <- incorrect + 1L
    }
  }

  total <- length(keystates)
  if (total == 0L) return(20.0)
  20.0 + 100.0 * ((correct - incorrect) / total)
}


# =========================================================================
# SQL escaping helper
# =========================================================================

sql_quote <- function(x) {
  if (is.null(x) || is.na(x)) return("NULL")
  if (is.numeric(x)) return(as.character(x))
  # Escape single quotes by doubling them.
  paste0("'", gsub("'", "''", as.character(x)), "'")
}


# =========================================================================
# Main: generate the simulated database
# =========================================================================

create_db <- function(db_path, n_participants = 6L, seed = 42L,
                      trial_data_dir = TRIAL_DATA_DIR) {

  set.seed(seed)

  etrial_meta <- load_etrial_metadata(trial_data_dir)
  if (is.null(etrial_meta) || nrow(etrial_meta) == 0) {
    stop(sprintf("No E-trial folders found in %s", trial_data_dir))
  }

  cat(sprintf("Found %d E-trials\n", nrow(etrial_meta)))
  cat(sprintf("Generating data for %d simulated participants\n", n_participants))

  # Remove existing DB if present.
  if (file.exists(db_path)) unlink(db_path)

  # V3 familiarization trial names.
  ftrial_names <- c(
    "T_v3_ball_sensor_red", "T_v3_keys", "T_v3_area_no_ball",
    "T_v3_green_mid", "T_v3_red_mid", "T_v3_keyswitch_ball_stable",
    "T_v3_keyswitch_practice_1", "T_v3_keyswitch_practice_2",
    "T_v3_occluder_intro", "T_v3_occluder_practice", "T_v3_before_test"
  )

  # --- Create schema ---
  sqlite3_exec(db_path, "
    CREATE TABLE redgreen_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      randomized_profile_id INTEGER,
      start_time DATETIME,
      end_time DATETIME,
      prolific_pid VARCHAR(100),
      study_id VARCHAR(100),
      prolific_session_id VARCHAR(100),
      average_score FLOAT,
      time_taken FLOAT,
      randomized_trial_order JSON,
      ignore_data BOOLEAN,
      completed BOOLEAN,
      has_timed_out BOOLEAN,
      experiment_name VARCHAR(100)
    );

    CREATE TABLE trial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      start_time DATETIME,
      end_time DATETIME,
      trial_type VARCHAR(20),
      trial_index INTEGER,
      global_trial_name VARCHAR(100),
      counterbalance BOOLEAN,
      score FLOAT,
      completed BOOLEAN,
      first_frame_utc DATETIME,
      last_frame_utc DATETIME,
      FOREIGN KEY (session_id) REFERENCES redgreen_session(id)
    );

    CREATE TABLE keystate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trial_id INTEGER NOT NULL,
      frame INTEGER,
      f_pressed BOOLEAN,
      j_pressed BOOLEAN,
      session_id INTEGER NOT NULL,
      relative_time_ms FLOAT,
      FOREIGN KEY (trial_id) REFERENCES trial(id),
      FOREIGN KEY (session_id) REFERENCES redgreen_session(id)
    );

    CREATE TABLE config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      config_data BLOB NOT NULL,
      FOREIGN KEY (session_id) REFERENCES redgreen_session(id)
    );
  ")

  base_time <- as.POSIXct("2026-03-01 10:00:00", tz = "UTC")
  fmt <- "%Y-%m-%d %H:%M:%OS6"

  for (p in seq_len(n_participants)) {
    accuracy <- runif(1, 0.4, 0.9)
    profile_id <- p
    pid <- sprintf("sim_participant_%03d", p)

    # Randomize E-trial order.
    etrial_order <- sample(etrial_meta$name)

    session_start <- base_time + (p - 1) * 7200 + sample(0:1800, 1)

    # --- Insert session ---
    order_json <- toJSON(etrial_order, auto_unbox = TRUE)
    session_sql <- sprintf(
      "INSERT INTO redgreen_session
       (randomized_profile_id, start_time, prolific_pid, study_id,
        prolific_session_id, randomized_trial_order, ignore_data,
        completed, has_timed_out, experiment_name)
       VALUES (%d, %s, %s, %s, %s, %s, 0, 1, 0, 'redgreen');",
      profile_id,
      sql_quote(format(session_start, fmt)),
      sql_quote(pid),
      sql_quote("simulated_study"),
      sql_quote(paste0("sim_session_", pid)),
      sql_quote(as.character(order_json))
    )
    sqlite3_exec(db_path, session_sql)

    # Get session_id (auto-increment = p).
    session_id <- p
    trial_time <- session_start + 30

    # --- Familiarization trials (no keystate, not completed) ---
    ftrial_sqls <- character(length(ftrial_names))
    for (fi in seq_along(ftrial_names)) {
      ftrial_sqls[fi] <- sprintf(
        "INSERT INTO trial (session_id, start_time, trial_type, trial_index,
         global_trial_name, counterbalance, completed)
         VALUES (%d, %s, 'ftrial', %d, %s, 0, 0);",
        session_id, sql_quote(format(trial_time, fmt)),
        fi - 1L, sql_quote(sprintf("F%d", fi))
      )
      trial_time <- trial_time + runif(1, 15, 45)
    }
    sqlite3_exec(db_path, paste(ftrial_sqls, collapse = "\n"))

    # --- Experimental trials ---
    trial_scores <- numeric(length(etrial_order))

    # Build a lookup for trial metadata.
    meta_lookup <- setNames(
      split(etrial_meta, seq_len(nrow(etrial_meta))),
      etrial_meta$name
    )

    # Collect all SQL for this participant in batches.
    all_trial_sql <- character(length(etrial_order))
    all_ks_sql <- list()

    for (ei in seq_along(etrial_order)) {
      tname <- etrial_order[ei]
      meta <- meta_lookup[[tname]]
      num_frames <- meta$num_frames
      rg_outcome <- meta$rg_outcome

      trial_start <- trial_time
      trial_duration <- num_frames / 30.0

      # Simulate key presses.
      keystates <- simulate_keypress_sequence(num_frames, rg_outcome, accuracy)
      score <- compute_score(keystates, rg_outcome)
      trial_scores[ei] <- score

      first_frame_utc <- trial_start
      last_frame_utc <- trial_start + trial_duration

      # trial_id will be: length(ftrial_names) + (p-1)*total_trials_per_session + ei
      # But we need actual auto-increment IDs. We'll query after insert.
      all_trial_sql[ei] <- sprintf(
        "INSERT INTO trial
         (session_id, start_time, end_time, trial_type, trial_index,
          global_trial_name, counterbalance, score, completed,
          first_frame_utc, last_frame_utc)
         VALUES (%d, %s, %s, 'trial', %d, %s, 0, %f, 1, %s, %s);",
        session_id,
        sql_quote(format(trial_start, fmt)),
        sql_quote(format(last_frame_utc, fmt)),
        ei - 1L,
        sql_quote(tname),
        score,
        sql_quote(format(first_frame_utc, fmt)),
        sql_quote(format(last_frame_utc, fmt))
      )

      # Store keystates with a placeholder; we need trial_id after insert.
      all_ks_sql[[ei]] <- keystates

      trial_time <- last_frame_utc + runif(1, 3, 8)
    }

    # Insert all trials for this participant.
    sqlite3_exec(db_path, paste(all_trial_sql, collapse = "\n"))

    # Now get the trial IDs we just inserted (E-trials for this session).
    trial_id_lines <- sqlite3_query_plain(db_path, sprintf(
      "SELECT id FROM trial WHERE session_id = %d AND trial_type = 'trial' ORDER BY id;",
      session_id
    ))
    trial_ids <- as.integer(trial_id_lines)

    if (length(trial_ids) != length(etrial_order)) {
      stop(sprintf("Expected %d trial IDs, got %d", length(etrial_order), length(trial_ids)))
    }

    # Insert keystates in batches (large INSERT with multiple VALUES).
    cat(sprintf("  Participant %d/%d: %s, accuracy=%.2f, inserting keystates...",
                p, n_participants, pid, accuracy))

    batch_size <- 500L
    ks_values <- character(0)

    for (ei in seq_along(all_ks_sql)) {
      tid <- trial_ids[ei]
      for (ks in all_ks_sql[[ei]]) {
        ks_values <- c(ks_values, sprintf(
          "(%d, %d, %d, %d, %d, %f)",
          tid, ks$frame, ks$f_pressed, ks$j_pressed, session_id, ks$relative_time_ms
        ))

        if (length(ks_values) >= batch_size) {
          sqlite3_exec(db_path, sprintf(
            "INSERT INTO keystate (trial_id, frame, f_pressed, j_pressed, session_id, relative_time_ms) VALUES %s;",
            paste(ks_values, collapse = ",\n")
          ))
          ks_values <- character(0)
        }
      }
    }
    # Flush remaining.
    if (length(ks_values) > 0) {
      sqlite3_exec(db_path, sprintf(
        "INSERT INTO keystate (trial_id, frame, f_pressed, j_pressed, session_id, relative_time_ms) VALUES %s;",
        paste(ks_values, collapse = ",\n")
      ))
    }

    # Update session with final stats.
    session_end <- trial_time
    avg_score <- mean(trial_scores)
    time_taken <- as.numeric(difftime(session_end, session_start, units = "secs"))

    sqlite3_exec(db_path, sprintf(
      "UPDATE redgreen_session SET average_score = %f, time_taken = %f, end_time = %s WHERE id = %d;",
      avg_score, time_taken, sql_quote(format(session_end, fmt)), session_id
    ))

    cat(sprintf(" avg_score=%.1f\n", avg_score))
  }

  # Summary.
  n_sess <- sqlite3_query_plain(db_path, "SELECT COUNT(*) FROM redgreen_session;")
  n_trials <- sqlite3_query_plain(db_path,
    "SELECT COUNT(*) FROM trial WHERE trial_type='trial' AND completed=1;")
  n_ks <- sqlite3_query_plain(db_path, "SELECT COUNT(*) FROM keystate;")

  cat(sprintf("\nSimulated DB written to: %s\n", db_path))
  cat(sprintf("  Sessions: %s\n  Completed E-trials: %s\n  Keystate rows: %s\n",
              n_sess, n_trials, n_ks))
}


# =========================================================================
# CLI argument parsing
# =========================================================================

if (!interactive()) {
  args <- commandArgs(trailingOnly = TRUE)

  n_participants <- 6L
  output <- file.path(SCRIPT_DIR, "simulated.db")
  seed <- 42L

  i <- 1L
  while (i <= length(args)) {
    if (args[i] == "--n-participants" && i < length(args)) {
      n_participants <- as.integer(args[i + 1L])
      i <- i + 2L
    } else if (args[i] == "--output" && i < length(args)) {
      output <- args[i + 1L]
      i <- i + 2L
    } else if (args[i] == "--seed" && i < length(args)) {
      seed <- as.integer(args[i + 1L])
      i <- i + 2L
    } else {
      cat(sprintf("Unknown argument: %s\n", args[i]))
      cat("Usage: Rscript generate_simulated_db.R [--n-participants N] [--output PATH] [--seed S]\n")
      quit(status = 1)
    }
  }

  create_db(output, n_participants, seed)
}
