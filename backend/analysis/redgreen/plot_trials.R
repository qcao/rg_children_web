# REDGREEN Experiment — Trial-Level Visualization
# ================================================
#
# Two-step workflow:
#   Step 1: Run extract_to_csv.py (or .R) to convert SQLite DB -> CSV files
#   Step 2: Run this R script to produce plots from the CSVs
#
# Produces two combined plots per trial (saved as PDF), each with:
#   LEFT panel:  Ball trajectory (from pre-generated PNG or magick fallback)
#   RIGHT panel: Time series (response L/R or correctness)
#
# When multiple participants exist, individual traces are overlaid with the
# "average observer" shown as a thicker line.
#
# Key mapping (counterbalance = FALSE):
#   F key -> GREEN sensor (left wall)  -> response = "L"
#   J key -> RED sensor   (right wall) -> response = "R"
#
# Required packages:
#   dplyr, tidyr, ggplot2, RColorBrewer, png, patchwork, jsonlite
#
# Optional (for fallback trajectory rendering when PNGs are missing):
#   magick
#
# Usage:
#   Rscript plot_trials.R <csv_dir> [output_dir] [trial_data_dir] [trajectory_dir]
#
#   csv_dir        : directory containing sessions.csv, trials.csv, keystates.csv
#   output_dir     : where to save PDFs (default: csv_dir/../plots)
#   trial_data_dir : path to trial_data/chs_training_zoom (for magick fallback)
#   trajectory_dir : path to pre-generated trajectory PNGs (default: none)
# ---------------------------------------------------------------------------

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(ggplot2)
  library(RColorBrewer)
  library(png)
  library(patchwork)
  library(jsonlite)
})

HAS_MAGICK <- requireNamespace("magick", quietly = TRUE)


# =========================================================================
# 1. Data loading from CSVs (produced by extract_to_csv.py)
# =========================================================================

load_csv_data <- function(csv_dir) {
  if (!dir.exists(csv_dir)) stop("CSV directory not found: ", csv_dir)

  sessions <- read.csv(file.path(csv_dir, "sessions.csv"), stringsAsFactors = FALSE)
  trials   <- read.csv(file.path(csv_dir, "trials.csv"),   stringsAsFactors = FALSE)
  ks       <- read.csv(file.path(csv_dir, "keystates.csv"), stringsAsFactors = FALSE)

  ks$is_correct <- as.logical(ks$is_correct)
  ks$response_numeric <- as.integer(ks$response_numeric)

  list(
    session_df  = as_tibble(sessions),
    trial_df    = as_tibble(trials),
    keystate_df = as_tibble(ks)
  )
}


# =========================================================================
# 2. Trajectory rendering
# =========================================================================

# --- 2a. Load a pre-generated trajectory PNG as a raster array ------------

load_trajectory_png <- function(trial_name, trajectory_dir) {
  if (is.null(trajectory_dir) || !dir.exists(trajectory_dir)) return(NULL)
  png_path <- file.path(trajectory_dir, paste0(trial_name, "_trajectory.png"))
  if (!file.exists(png_path)) return(NULL)
  readPNG(png_path)
}


# --- 2b. Render trajectory via magick (fallback) -------------------------
#
# Translates plot_trajectories.py TrajectoryPlotter to R/magick.
# Produces a raster array identical in layout to the Python version:
#   640x640 canvas, 20px border, 600px scene area, Y-flipped coords.

TRAJ_CONFIG <- list(
  world_width   = 20,
  world_height  = 20,
  canvas_size   = 600L,
  border        = 20L,
  output_width  = 640L,
  output_height = 640L,
  fps           = 30L
)


render_trajectory_magick <- function(json_path, texture_dir, config = TRAJ_CONFIG) {
  if (!HAS_MAGICK) {
    warning("magick package not available; cannot render trajectory for: ", json_path)
    return(NULL)
  }
  library(magick)

  data <- fromJSON(json_path)
  ow <- config$output_width
  oh <- config$output_height
  bt <- config$border
  cs <- config$canvas_size
  ww <- config$world_width
  wh <- config$world_height
  scale <- cs / ww

  # Coordinate transform: world (x, y, w, h) -> pixel (px, py, pw, ph), Y-flipped.
  transform <- function(x, y, w = 0, h = 0) {
    px <- as.integer(bt + x * scale)
    py <- as.integer(bt + (wh - y - h) * scale)
    pw <- as.integer(w * scale)
    ph <- as.integer(h * scale)
    list(x = px, y = py, w = pw, h = ph)
  }

  # Helper: tile a texture image into a rectangle on the canvas.
  tile_texture <- function(canvas, tex, px, py, pw, ph, alpha_blend = 1.0) {
    if (is.null(tex) || pw <= 0 || ph <= 0) return(canvas)

    # Create a tiled fill of the target size.
    tw <- image_info(tex)$width
    th <- image_info(tex)$height
    cols <- ceiling(pw / tw)
    rows <- ceiling(ph / th)

    # Build tile grid.
    row_img <- tex
    if (cols > 1) {
      row_img <- image_append(rep(tex, cols))
    }
    grid_img <- row_img
    if (rows > 1) {
      grid_img <- image_append(rep(row_img, rows), stack = TRUE)
    }
    tiled <- image_crop(grid_img, geometry_area(pw, ph))

    if (alpha_blend < 1.0) {
      # Semi-transparent overlay (for occluders).
      tiled <- image_modulate(tiled, brightness = 100)
      canvas <- image_composite(
        canvas, tiled,
        offset = geometry_point(px, py),
        operator = "blend",
        compose_args = sprintf("%d", as.integer(alpha_blend * 100))
      )
    } else {
      canvas <- image_composite(canvas, tiled, offset = geometry_point(px, py))
    }
    canvas
  }

  # Load textures.
  load_tex <- function(filename) {
    p <- file.path(texture_dir, filename)
    if (!file.exists(p)) return(NULL)
    tryCatch(image_read(p), error = function(e) NULL)
  }

  tex_barrier      <- load_tex("barrier.png")
  tex_red_sensor   <- load_tex("yellow.jpg")
  tex_green_sensor <- load_tex("green.jpg")
  tex_occluder     <- load_tex("cloud.jpg")
  tex_ball         <- load_tex("ball.png")

  # Convert barrier to grayscale (matching Python).
  if (!is.null(tex_barrier)) {
    tex_barrier <- image_modulate(tex_barrier, saturation = 0)
  }

  # Create white canvas.
  canvas <- image_blank(ow, oh, color = "white")

  # --- Draw scene elements ---

  # Barriers (jsonlite parses JSON array of objects as a data.frame).
  barriers <- data$barriers
  if (is.data.frame(barriers) && nrow(barriers) > 0) {
    for (i in seq_len(nrow(barriers))) {
      bar <- barriers[i, ]
      t <- transform(bar$x, bar$y, bar$width, bar$height)
      if (!is.null(tex_barrier)) {
        canvas <- tile_texture(canvas, tex_barrier, t$x, t$y, t$w, t$h)
      } else {
        canvas <- image_composite(
          canvas,
          image_blank(t$w, t$h, color = "black"),
          offset = geometry_point(t$x, t$y)
        )
      }
    }
  }

  # Red sensor (yellow.jpg).
  rs <- data$red_sensor
  if (!is.null(rs)) {
    t <- transform(rs$x, rs$y, rs$width, rs$height)
    if (!is.null(tex_red_sensor)) {
      canvas <- tile_texture(canvas, tex_red_sensor, t$x, t$y, t$w, t$h)
    } else {
      canvas <- image_composite(
        canvas,
        image_blank(t$w, t$h, color = "#FFD700"),
        offset = geometry_point(t$x, t$y)
      )
    }
  }

  # Green sensor (green.jpg).
  gs <- data$green_sensor
  if (!is.null(gs)) {
    t <- transform(gs$x, gs$y, gs$width, gs$height)
    if (!is.null(tex_green_sensor)) {
      canvas <- tile_texture(canvas, tex_green_sensor, t$x, t$y, t$w, t$h)
    } else {
      canvas <- image_composite(
        canvas,
        image_blank(t$w, t$h, color = "#4CAF50"),
        offset = geometry_point(t$x, t$y)
      )
    }
  }

  # Occluders (semi-transparent).
  occluders <- data$occluders
  if (is.data.frame(occluders) && nrow(occluders) > 0) {
    for (i in seq_len(nrow(occluders))) {
      occ <- occluders[i, ]
      t <- transform(occ$x, occ$y, occ$width, occ$height)
      if (!is.null(tex_occluder)) {
        canvas <- tile_texture(canvas, tex_occluder, t$x, t$y, t$w, t$h, alpha_blend = 0.5)
      } else {
        canvas <- image_composite(
          canvas,
          image_blank(t$w, t$h, color = "rgba(200,200,200,0.5)"),
          offset = geometry_point(t$x, t$y)
        )
      }
    }
  }

  # Canvas borders (barrier texture on all 4 sides).
  if (!is.null(tex_barrier)) {
    canvas <- tile_texture(canvas, tex_barrier, 0, 0, ow, bt)          # top
    canvas <- tile_texture(canvas, tex_barrier, 0, bt + cs, ow, bt)    # bottom
    canvas <- tile_texture(canvas, tex_barrier, 0, 0, bt, oh)          # left
    canvas <- tile_texture(canvas, tex_barrier, bt + cs, 0, bt, oh)    # right
  } else {
    canvas <- image_composite(canvas, image_blank(ow, bt, "black"), offset = geometry_point(0, 0))
    canvas <- image_composite(canvas, image_blank(ow, bt, "black"), offset = geometry_point(0, bt + cs))
    canvas <- image_composite(canvas, image_blank(bt, oh, "black"), offset = geometry_point(0, 0))
    canvas <- image_composite(canvas, image_blank(bt, oh, "black"), offset = geometry_point(bt + cs, 0))
  }

  # --- Draw trajectory ---
  step <- data$step_data
  if (is.null(step) || length(step) == 0) return(NULL)

  radius_world <- if (!is.null(data$radius)) {
    data$radius
  } else if (!is.null(data$target$size)) {
    data$target$size / 2
  } else {
    1
  }

  # step_data is a named list keyed by frame index string.
  frame_keys <- as.integer(names(step))
  frame_keys <- sort(frame_keys)

  pts_x <- integer(length(frame_keys))
  pts_y <- integer(length(frame_keys))

  for (i in seq_along(frame_keys)) {
    s <- step[[as.character(frame_keys[i])]]
    wx <- s$x + radius_world
    wy <- s$y + radius_world
    pts_x[i] <- as.integer(bt + wx * scale)
    pts_y[i] <- as.integer(bt + (wh - wy) * scale)
  }

  # --- Draw trajectory + labels using ragg (avoids ImageMagick font issues) ---
  # Strategy: export magick canvas to temp PNG, then overlay trajectory/text
  # using R's native graphics device (ragg), which has its own font system.

  step <- data$step_data
  if (is.null(step) || length(step) == 0) return(NULL)

  radius_world <- if (!is.null(data$radius)) {
    data$radius
  } else if (!is.null(data$target$size)) {
    data$target$size / 2
  } else {
    1
  }

  frame_keys <- sort(as.integer(names(step)))

  pts_x <- integer(length(frame_keys))
  pts_y <- integer(length(frame_keys))

  for (i in seq_along(frame_keys)) {
    s <- step[[as.character(frame_keys[i])]]
    wx <- s$x + radius_world
    wy <- s$y + radius_world
    pts_x[i] <- as.integer(bt + wx * scale)
    pts_y[i] <- as.integer(bt + (wh - wy) * scale)
  }

  # Composite ball texture onto the scene at start position.
  radius_px <- max(as.integer(radius_world * scale), 4L)
  if (!is.null(tex_ball)) {
    ball_size <- radius_px * 2
    ball_resized <- image_resize(tex_ball, geometry_size_pixels(ball_size, ball_size))
    # Circular mask for ball.
    mask <- image_blank(ball_size, ball_size, "none")
    mask <- image_draw(mask)
    symbols(ball_size / 2, ball_size / 2, circles = radius_px,
            inches = FALSE, bg = "white", fg = NA, add = TRUE)
    dev.off()
    ball_masked <- image_composite(ball_resized, mask, operator = "CopyOpacity")
    ball_x <- pts_x[1] - radius_px
    ball_y <- pts_y[1] - radius_px
    canvas <- image_composite(canvas, ball_masked, offset = geometry_point(ball_x, ball_y))
  }

  # Re-draw borders on top (clean edges, matching Python).
  if (!is.null(tex_barrier)) {
    canvas <- tile_texture(canvas, tex_barrier, 0, 0, ow, bt)
    canvas <- tile_texture(canvas, tex_barrier, 0, bt + cs, ow, bt)
    canvas <- tile_texture(canvas, tex_barrier, 0, 0, bt, oh)
    canvas <- tile_texture(canvas, tex_barrier, bt + cs, 0, bt, oh)
  }

  # Export scene to temp PNG, then overlay trajectory with ragg device.
  tmp_scene <- tempfile(fileext = ".png")
  image_write(canvas, tmp_scene, format = "png")
  scene_raster <- readPNG(tmp_scene)

  tmp_final <- tempfile(fileext = ".png")
  ragg::agg_png(tmp_final, width = ow, height = oh, res = 72)
  par(mar = c(0, 0, 0, 0))
  plot(NA, xlim = c(0, ow), ylim = c(oh, 0),  # Y inverted: 0 at top
       asp = 1, xaxs = "i", yaxs = "i", axes = FALSE, xlab = "", ylab = "")
  rasterImage(scene_raster, 0, 0, ow, oh)

  # Trajectory polyline.
  lines(pts_x, pts_y, col = "black", lwd = 2)

  # Whole-second markers with labels.
  fps <- config$fps
  for (sec in seq_len(length(pts_x) %/% fps)) {
    idx <- sec * fps
    if (idx > length(pts_x)) break
    px <- pts_x[idx]; py <- pts_y[idx]
    points(px, py, pch = 19, cex = 0.8, col = "black")
    # White background for label.
    rect(px + 3, py - 9, px + 18, py + 5, col = "white", border = NA)
    text(px + 6, py - 2, labels = as.character(sec), cex = 0.7, col = "black")
  }

  # Fallback ball (red circle) if no ball texture.
  if (is.null(tex_ball)) {
    symbols(pts_x[1], pts_y[1], circles = radius_px,
            inches = FALSE, bg = "red", fg = "darkred", lwd = 1, add = TRUE)
  }

  dev.off()

  # Read back the final composited image.
  final_raster <- readPNG(tmp_final)
  unlink(c(tmp_scene, tmp_final))

  final_raster
}


# --- 2c. Build trajectory ggplot from raster array or PNG -----------------

ggplot_trajectory <- function(trial_name, trial_data_dir = NULL,
                              trajectory_dir = NULL, texture_dir = NULL) {

  # Try pre-generated PNG first.
  raster_data <- load_trajectory_png(trial_name, trajectory_dir)

  # Fallback: render via magick.
  if (is.null(raster_data) && !is.null(trial_data_dir)) {
    json_path <- file.path(trial_data_dir, trial_name, "simulation_data.json")
    if (file.exists(json_path)) {
      tex_dir <- if (!is.null(texture_dir)) texture_dir else "frontend/public"
      raster_data <- render_trajectory_magick(json_path, tex_dir)
    }
  }

  if (is.null(raster_data)) {
    # Return a placeholder plot.
    return(
      ggplot() +
        annotate("text", x = 0.5, y = 0.5, label = paste(trial_name, "\n(no trajectory)"),
                 size = 4, hjust = 0.5) +
        theme_void() +
        coord_fixed()
    )
  }

  # Wrap raster in a ggplot.
  ggplot() +
    annotation_raster(raster_data, xmin = 0, xmax = 1, ymin = 0, ymax = 1) +
    scale_x_continuous(limits = c(0, 1), expand = c(0, 0)) +
    scale_y_continuous(limits = c(0, 1), expand = c(0, 0)) +
    coord_fixed(ratio = 1) +
    theme_void() +
    theme(plot.margin = margin(2, 2, 2, 2))
}


# =========================================================================
# 3. ggplot2: Response time series (L vs R)
# =========================================================================

ggplot_response_timeseries <- function(ks_trial, trial_name, ground_truth_side,
                                       x_max = 20) {

  participants <- unique(ks_trial$prolific_pid)
  n_part <- length(participants)

  if (n_part <= 8) {
    pal <- brewer.pal(max(3, n_part), "Set1")[seq_len(n_part)]
  } else {
    pal <- colorRampPalette(brewer.pal(8, "Set1"))(n_part)
  }
  names(pal) <- participants

  jitter_map <- setNames(
    seq(-0.03 * (n_part - 1) / 2, 0.03 * (n_part - 1) / 2, length.out = n_part),
    participants
  )

  plot_df <- ks_trial %>%
    mutate(
      time_s = relative_time_ms / 1000,
      y_jittered = response_numeric + jitter_map[prolific_pid]
    )

  p <- ggplot(plot_df, aes(x = time_s, y = y_jittered, color = prolific_pid)) +
    geom_line(linewidth = 0.6, alpha = if (n_part > 1) 0.5 else 0.9)

  if (n_part > 1) {
    avg_df <- ks_trial %>%
      group_by(frame) %>%
      summarise(
        mean_resp = mean(response_numeric, na.rm = TRUE),
        time_s = mean(relative_time_ms, na.rm = TRUE) / 1000,
        .groups = "drop"
      )

    p <- p +
      geom_line(data = avg_df, aes(x = time_s, y = mean_resp),
                color = "gray70", linewidth = 1.2, alpha = 0.4, inherit.aes = FALSE)
  }

  gt_y <- if (ground_truth_side == "L") -1 else 1
  p <- p +
    geom_hline(yintercept = gt_y, linetype = "dashed", color = "gray50", linewidth = 0.8)

  p <- p +
    scale_color_manual(values = pal) +
    scale_x_continuous(
      limits = c(0, x_max),
      breaks = seq(0, x_max, by = 2)
    ) +
    scale_y_continuous(
      breaks = c(-1, 0, 1),
      labels = c("L (green)", "Uncertain", "R (red)"),
      limits = c(-1.3, 1.3)
    ) +
    labs(
      title = sprintf("%s | Response: L (green) vs R (red)", trial_name),
      subtitle = sprintf("Ground truth: %s  |  %d observer(s)", ground_truth_side, n_part),
      x = "Time (s)",
      y = "Response",
      color = "Participant"
    ) +
    theme_minimal(base_size = 11) +
    theme(
      legend.position = if (n_part > 8) "none" else "bottom",
      plot.title = element_text(size = 12, face = "bold")
    )

  p
}


# =========================================================================
# 4. ggplot2: Correctness time series with cumulative % annotation
# =========================================================================

ggplot_correctness_timeseries <- function(ks_trial, trial_name, ground_truth_side,
                                          x_max = 20) {

  participants <- unique(ks_trial$prolific_pid)
  n_part <- length(participants)

  if (n_part <= 8) {
    pal <- brewer.pal(max(3, n_part), "Set1")[seq_len(n_part)]
  } else {
    pal <- colorRampPalette(brewer.pal(8, "Set1"))(n_part)
  }
  names(pal) <- participants

  jitter_map <- setNames(
    seq(-0.02 * (n_part - 1) / 2, 0.02 * (n_part - 1) / 2, length.out = n_part),
    participants
  )

  plot_df <- ks_trial %>%
    arrange(prolific_pid, frame) %>%
    group_by(prolific_pid) %>%
    mutate(
      correct_int = as.integer(is_correct %in% TRUE),
      decided_int = as.integer(!is.na(is_correct)),
      cum_correct = cumsum(correct_int),
      cum_decided = cumsum(decided_int),
      cum_pct = if_else(cum_decided > 0, cum_correct / cum_decided * 100, NA_real_),
      correct_y = case_when(
        is.na(is_correct) ~ 0.5,
        is_correct         ~ 1.0,
        TRUE               ~ 0.0
      ),
      time_s = relative_time_ms / 1000,
      y_jittered = correct_y + jitter_map[prolific_pid]
    ) %>%
    ungroup()

  final_pct <- plot_df %>%
    group_by(prolific_pid) %>%
    slice_tail(n = 1) %>%
    ungroup() %>%
    filter(!is.na(cum_pct))

  p <- ggplot(plot_df, aes(x = time_s, y = y_jittered, color = prolific_pid)) +
    geom_line(linewidth = 0.6, alpha = if (n_part > 1) 0.5 else 0.9)

  if (nrow(final_pct) > 0) {
    p <- p +
      geom_text(
        data = final_pct,
        aes(x = time_s, y = y_jittered, label = sprintf("%.0f%%", cum_pct)),
        hjust = -0.1, size = 3, show.legend = FALSE
      )
  }

  if (n_part > 1) {
    avg_df <- plot_df %>%
      group_by(frame) %>%
      summarise(
        mean_correct = mean(correct_y, na.rm = TRUE),
        time_s = mean(time_s, na.rm = TRUE),
        .groups = "drop"
      )

    avg_overall_pct <- ks_trial %>%
      filter(!is.na(is_correct)) %>%
      summarise(pct = mean(is_correct) * 100) %>%
      pull(pct)

    p <- p +
      geom_line(data = avg_df, aes(x = time_s, y = mean_correct),
                color = "gray70", linewidth = 1.2, alpha = 0.4, inherit.aes = FALSE) +
      annotate("text",
               x = max(avg_df$time_s) * 1.02,
               y = tail(avg_df$mean_correct, 1),
               label = sprintf("Avg: %.0f%%", avg_overall_pct),
               fontface = "bold", size = 3.5, hjust = 0, color = "gray50")
  }

  p <- p +
    scale_color_manual(values = pal) +
    scale_x_continuous(
      limits = c(0, x_max),
      breaks = seq(0, x_max, by = 2)
    ) +
    scale_y_continuous(
      breaks = c(0, 0.5, 1),
      labels = c("Incorrect", "Uncertain", "Correct"),
      limits = c(-0.15, 1.15)
    ) +
    labs(
      title = sprintf("%s | Correctness (ground truth: %s)", trial_name, ground_truth_side),
      subtitle = sprintf("%d observer(s)", n_part),
      x = "Time (s)",
      y = "Correct?",
      color = "Participant"
    ) +
    theme_minimal(base_size = 11) +
    theme(
      legend.position = if (n_part > 8) "none" else "bottom",
      plot.title = element_text(size = 12, face = "bold")
    )

  p
}


# =========================================================================
# 5. Main: generate all combined plots
# =========================================================================

generate_all_plots <- function(csv_dir,
                               output_dir = NULL,
                               trial_data_dir = NULL,
                               trajectory_dir = NULL,
                               texture_dir = NULL,
                               trials_subset = NULL,
                               time_scale = c("absolute", "trial")) {

  time_scale <- match.arg(time_scale)

  if (is.null(output_dir)) {
    output_dir <- file.path(csv_dir, "..", "plots")
  }
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

  cat("Loading CSV data...\n")
  data <- load_csv_data(csv_dir)

  trial_names <- sort(unique(data$keystate_df$global_trial_name))
  if (!is.null(trials_subset)) {
    trial_names <- intersect(trial_names, trials_subset)
  }

  n_sessions <- n_distinct(data$session_df$session_id)
  has_traj <- !is.null(trajectory_dir) || !is.null(trial_data_dir)

  # Compute x-axis range.
  # "absolute": max duration across all trials (rounded up to nearest 2s).
  # "trial": per-trial max duration.
  global_max_s <- data$keystate_df %>%
    summarise(m = max(relative_time_ms, na.rm = TRUE)) %>%
    pull(m) / 1000
  global_x_max <- ceiling(global_max_s / 2) * 2  # round up to nearest 2

  cat(sprintf("Generating plots for %d trials across %d sessions\n",
              length(trial_names), n_sessions))
  cat(sprintf("Time scale: %s (x_max = %s)\n",
              time_scale,
              if (time_scale == "absolute") sprintf("%.0fs", global_x_max) else "per trial"))
  if (has_traj) {
    cat(sprintf("Trajectory source: %s\n",
                if (!is.null(trajectory_dir)) paste("PNGs from", trajectory_dir) else "magick render"))
  }

  # Page dimensions.
  pw <- if (has_traj) 16 else 10
  ph <- if (has_traj) 6 else 4

  # Open multi-page PDFs: one for response, one for correctness.
  pdf_resp <- file.path(output_dir, "all_response.pdf")
  pdf_corr <- file.path(output_dir, "all_correctness.pdf")

  pdf(pdf_resp, width = pw, height = ph, onefile = TRUE)
  dev_resp <- dev.cur()

  pdf(pdf_corr, width = pw, height = ph, onefile = TRUE)
  dev_corr <- dev.cur()

  n_plotted <- 0L

  for (tname in trial_names) {
    ks_trial <- data$keystate_df %>% filter(global_trial_name == tname)
    if (nrow(ks_trial) == 0) next

    gt_side <- ks_trial$ground_truth_side[1]
    n_obs <- n_distinct(ks_trial$prolific_pid)

    # Determine x-axis limit for this trial.
    if (time_scale == "absolute") {
      x_max <- global_x_max
    } else {
      trial_max_s <- max(ks_trial$relative_time_ms, na.rm = TRUE) / 1000
      x_max <- ceiling(trial_max_s / 2) * 2
    }

    # Build time series plots.
    p_resp <- ggplot_response_timeseries(ks_trial, tname, gt_side, x_max = x_max)
    p_corr <- ggplot_correctness_timeseries(ks_trial, tname, gt_side, x_max = x_max)

    if (has_traj) {
      p_traj <- ggplot_trajectory(tname, trial_data_dir, trajectory_dir, texture_dir)
      combined_resp <- p_traj + p_resp + plot_layout(widths = c(1, 2))
      combined_corr <- p_traj + p_corr + plot_layout(widths = c(1, 2))
    } else {
      combined_resp <- p_resp
      combined_corr <- p_corr
    }

    # Print response page.
    dev.set(dev_resp)
    print(combined_resp)

    # Print correctness page.
    dev.set(dev_corr)
    print(combined_corr)

    n_plotted <- n_plotted + 1L
    cat(sprintf("  %s: %d observers, %d frames\n", tname, n_obs, max(ks_trial$frame)))
  }

  dev.off(dev_corr)
  dev.off(dev_resp)

  cat(sprintf("\nDone. %d trials plotted.\n", n_plotted))
  cat(sprintf("  Response:   %s\n", pdf_resp))
  cat(sprintf("  Correctness: %s\n", pdf_corr))

  invisible(data)
}


# =========================================================================
# 6. CLI entry point
# =========================================================================

if (!interactive()) {
  args <- commandArgs(trailingOnly = TRUE)

  script_dir <- tryCatch(
    dirname(normalizePath(sys.frame(1)$ofile)),
    error = function(e) getwd()
  )
  default_csv_dir <- file.path(script_dir, "csv_data")

  csv_dir        <- if (length(args) >= 1) args[1] else default_csv_dir
  output_dir     <- if (length(args) >= 2) args[2] else NULL
  trial_data_dir <- if (length(args) >= 3) args[3] else NULL
  trajectory_dir <- if (length(args) >= 4) args[4] else NULL
  time_scale     <- if (length(args) >= 5) args[5] else "absolute"

  cat(sprintf("CSV dir: %s\n", csv_dir))
  if (!is.null(trial_data_dir)) cat(sprintf("Trial data: %s\n", trial_data_dir))
  if (!is.null(trajectory_dir)) cat(sprintf("Trajectory PNGs: %s\n", trajectory_dir))

  generate_all_plots(csv_dir, output_dir,
                     trial_data_dir = trial_data_dir,
                     trajectory_dir = trajectory_dir,
                     time_scale = time_scale)
}
