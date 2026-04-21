# REDGREEN Experiment — Extract SQLite DB to analysis-ready CSV files
# ====================================================================
#
# R equivalent of extract_to_csv.py. Uses the sqlite3 CLI (no RSQLite needed).
#
# Outputs (in output_dir):
#   sessions.csv   — one row per session
#   trials.csv     — one row per E-trial, with ground truth from simulation JSONs
#   keystates.csv  — frame-by-frame key presses with semantic response columns
#
# Usage:
#   Rscript extract_to_csv.R <db_path> <trial_data_dir> [output_dir]
#
# Required packages: jsonlite, dplyr
# Required system tool: sqlite3 CLI
# ---------------------------------------------------------------------------

suppressPackageStartupMessages({
  library(dplyr)
  library(jsonlite)
})


# =========================================================================
# Helper: run a SQL query via sqlite3 CLI and return a data.frame
# =========================================================================

sqlite3_query <- function(db_path, sql) {
  # Use sqlite3 in CSV mode with headers.
  cmd <- sprintf(
    'sqlite3 -header -csv %s %s',
    shQuote(db_path),
    shQuote(sql)
  )
  result <- system(cmd, intern = TRUE)

  if (length(result) == 0) {
    return(data.frame())
  }

  # Parse CSV output.
  con <- textConnection(result)
  on.exit(close(con))
  read.csv(con, stringsAsFactors = FALSE)
}


# =========================================================================
# Main extraction function
# =========================================================================

extract_to_csv <- function(db_path, trial_data_dir, output_dir) {

  if (!file.exists(db_path)) stop("DB not found: ", db_path)
  if (!dir.exists(trial_data_dir)) stop("Trial data dir not found: ", trial_data_dir)

  # Check sqlite3 is available.
  if (system("which sqlite3", intern = FALSE, ignore.stdout = TRUE) != 0) {
    stop("sqlite3 CLI not found. Install SQLite or use the Python version instead.")
  }

  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

  # --- Sessions ---
  cat("Extracting sessions...\n")
  session_df <- sqlite3_query(db_path, "
    SELECT id AS session_id, prolific_pid, average_score,
           randomized_profile_id, time_taken, completed
    FROM redgreen_session
    WHERE (ignore_data = 0 OR ignore_data IS NULL)
  ")

  write.csv(session_df, file.path(output_dir, "sessions.csv"), row.names = FALSE)
  cat(sprintf("  sessions.csv: %d rows\n", nrow(session_df)))

  # --- Ground truth from simulation JSONs ---
  cat("Reading ground truth from simulation JSONs...\n")
  e_folders <- list.dirs(trial_data_dir, full.names = FALSE, recursive = FALSE)
  e_folders <- sort(e_folders[startsWith(e_folders, "E")])

  gt_list <- lapply(e_folders, function(folder) {
    json_path <- file.path(trial_data_dir, folder, "simulation_data.json")
    if (!file.exists(json_path)) return(NULL)
    d <- fromJSON(json_path)
    data.frame(
      global_trial_name = folder,
      rg_outcome = d$rg_outcome,
      num_frames = as.integer(d$num_frames),
      ground_truth_side = if (d$rg_outcome == "green") "L" else "R",
      stringsAsFactors = FALSE
    )
  })
  gt_df <- do.call(rbind, Filter(Negate(is.null), gt_list))

  # --- Trials ---
  cat("Extracting trials...\n")
  trial_raw <- sqlite3_query(db_path, "
    SELECT id AS trial_id, session_id, trial_index, global_trial_name,
           score, completed, counterbalance
    FROM trial
    WHERE trial_type != 'ftrial'
  ")

  # Keep only trials from valid sessions.
  trial_df <- trial_raw %>%
    filter(session_id %in% session_df$session_id) %>%
    left_join(gt_df, by = "global_trial_name")

  write.csv(trial_df, file.path(output_dir, "trials.csv"), row.names = FALSE)
  cat(sprintf("  trials.csv: %d rows\n", nrow(trial_df)))

  # --- Build lookup for keystates enrichment ---
  pid_map <- setNames(session_df$prolific_pid, session_df$session_id)

  trial_meta <- trial_df %>%
    mutate(prolific_pid = pid_map[as.character(session_id)]) %>%
    select(trial_id, session_id, prolific_pid, global_trial_name,
           counterbalance, rg_outcome, ground_truth_side)

  # --- Keystates ---
  cat("Extracting keystates...\n")
  valid_ids <- paste(trial_meta$trial_id, collapse = ",")

  ks_raw <- sqlite3_query(db_path, sprintf("
    SELECT trial_id, frame, f_pressed, j_pressed, relative_time_ms, session_id
    FROM keystate
    WHERE trial_id IN (%s)
    ORDER BY trial_id, frame
  ", valid_ids))

  if (nrow(ks_raw) == 0) {
    warning("No keystate rows found for valid trials.")
    write.csv(
      data.frame(
        trial_id = integer(), session_id = integer(), prolific_pid = character(),
        global_trial_name = character(), frame = integer(),
        f_pressed = integer(), j_pressed = integer(), relative_time_ms = numeric(),
        counterbalance = integer(), rg_outcome = character(),
        ground_truth_side = character(), response_label = character(),
        response_numeric = integer(), is_correct = logical(),
        stringsAsFactors = FALSE
      ),
      file.path(output_dir, "keystates.csv"), row.names = FALSE
    )
    cat("  keystates.csv: 0 rows\n")
    return(invisible(NULL))
  }

  # Enrich with trial metadata.
  ks_df <- ks_raw %>%
    inner_join(
      trial_meta %>% select(trial_id, prolific_pid, global_trial_name,
                            counterbalance, rg_outcome, ground_truth_side),
      by = "trial_id"
    ) %>%
    mutate(
      f_pressed = as.integer(f_pressed),
      j_pressed = as.integer(j_pressed),
      counterbalance = as.integer(counterbalance)
    )

  # Derive semantic response (applying counterbalance).
  # When counterbalance = 0: F=green(L), J=red(R)
  # When counterbalance = 1: F=red(R),   J=green(L)
  ks_df <- ks_df %>%
    mutate(
      chose_green = as.integer(
        (counterbalance == 0 & f_pressed == 1 & j_pressed == 0) |
        (counterbalance == 1 & j_pressed == 1 & f_pressed == 0)
      ),
      chose_red = as.integer(
        (counterbalance == 0 & j_pressed == 1 & f_pressed == 0) |
        (counterbalance == 1 & f_pressed == 1 & j_pressed == 0)
      )
    ) %>%
    mutate(
      response_label = case_when(
        chose_green == 1L ~ "L",
        chose_red == 1L   ~ "R",
        TRUE              ~ "?"
      ),
      response_numeric = chose_red - chose_green,
      is_correct = case_when(
        response_label == "?" ~ NA,
        response_label == ground_truth_side ~ TRUE,
        TRUE ~ FALSE
      )
    ) %>%
    select(trial_id, session_id, prolific_pid, global_trial_name, frame,
           f_pressed, j_pressed, relative_time_ms, counterbalance,
           rg_outcome, ground_truth_side, response_label, response_numeric,
           is_correct)

  write.csv(ks_df, file.path(output_dir, "keystates.csv"), row.names = FALSE)
  cat(sprintf("  keystates.csv: %d rows\n", nrow(ks_df)))

  cat(sprintf("\nDone. Files saved to %s\n", output_dir))
  invisible(list(session_df = session_df, trial_df = trial_df, keystate_df = ks_df))
}


# =========================================================================
# CLI entry point
# =========================================================================

if (!interactive()) {
  args <- commandArgs(trailingOnly = TRUE)

  if (length(args) < 2) {
    cat("Usage: Rscript extract_to_csv.R <db_path> <trial_data_dir> [output_dir]\n")
    quit(status = 1)
  }

  db_path <- args[1]
  trial_data_dir <- args[2]
  output_dir <- if (length(args) >= 3) args[3] else file.path(dirname(db_path), "csv_data")

  cat(sprintf("DB: %s\nTrial data: %s\nOutput: %s\n", db_path, trial_data_dir, output_dir))
  extract_to_csv(db_path, trial_data_dir, output_dir)
}
