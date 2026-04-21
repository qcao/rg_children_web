import React, { useRef, useEffect, useCallback } from 'react';

// ── Canvas drawing utilities ────────────────────────────────────────────

function drawRoundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSmallCoin(ctx, x, y, r) {
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, '#ffe066');
  grad.addColorStop(0.7, '#ffd700');
  grad.addColorStop(1, '#cc9900');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#b8860b';
  ctx.font = `bold ${r * 0.9}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', x, y + 0.5);
}

function easeInQuad(t) { return t * t; }

// ── Audio helpers ───────────────────────────────────────────────────────

let _audioCtx = null;
function ensureAudio() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function playCoinSpawnSfx() {
  const ac = ensureAudio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain); gain.connect(ac.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ac.currentTime);
  osc.frequency.linearRampToValueAtTime(1200, ac.currentTime + 0.08);
  gain.gain.setValueAtTime(0.15, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
  osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.12);
}

// ── Constants ───────────────────────────────────────────────────────────

const TUBE_WIDTH = 50;
const COIN_R = (TUBE_WIDTH - 4 * 4) / 2; // matches inner clipping width
const COIN_DIAM = COIN_R * 2;
const REVEAL_DURATION = 3.5; // seconds for end-of-trial reveal

// ── Main Component ──────────────────────────────────────────────────────

/**
 * CoinCollectorTubes renders two vertical glass tubes flanking the experiment
 * canvas. During reveal the loser tube's coins fall away; the winner stays.
 *
 * Props:
 *   fKeyHeld: boolean       — is F key currently held
 *   jKeyHeld: boolean       — is J key currently held
 *   isPlaying: boolean      — trial animation is running
 *   trialEnded: boolean     — trial animation has finished
 *   rgOutcome: 'red'|'green' — determines winner (green=left, red=right)
 *   coinInterval: number    — seconds of hold per coin (default 1.0)
 *   sfx: boolean            — enable sound effects
 *   canvasHeight: number    — height of the experiment canvas (for tube sizing)
 *   borderThickness: number — canvas border thickness for alignment
 *   onRevealComplete: ({ winnerCoins }) => void
 */
const CoinCollectorTubes = ({
  fKeyHeld = false,
  jKeyHeld = false,
  isPlaying = false,
  trialEnded = false,
  rgOutcome = 'green',
  coinInterval = 1.0,
  sfx = false,
  canvasHeight = 600,
  borderThickness = 0,
  onRevealComplete = null,
}) => {
  const leftCanvasRef = useRef(null);
  const rightCanvasRef = useRef(null);

  // Internal state via refs (animation loop, not React state)
  const stateRef = useRef({
    leftFill: 0,        // seconds of fill (continuous)
    rightFill: 0,
    leftCoins: 0,       // discrete coin count
    rightCoins: 0,
    leftHoldStart: null, // performance.now() when hold started
    rightHoldStart: null,
    leftFillAtHoldStart: 0,
    rightFillAtHoldStart: 0,
    phase: 'idle',       // idle | playing | reveal | done
    revealStart: null,
    winner: null,        // 'L' | 'R'
    winnerFillSnapshot: 0,
    loserFillSnapshot: 0,
    animFrameId: null,
  });

  const propsRef = useRef({ fKeyHeld, jKeyHeld, isPlaying, trialEnded, rgOutcome, coinInterval, sfx, borderThickness });
  useEffect(() => {
    propsRef.current = { fKeyHeld, jKeyHeld, isPlaying, trialEnded, rgOutcome, coinInterval, sfx, borderThickness };
  });

  const totalCanvasH = canvasHeight + 2 * borderThickness;
  const tubeH = totalCanvasH; // full height, no padding
  const maxCoins = Math.floor(tubeH / COIN_DIAM);
  const maxFillSeconds = maxCoins * coinInterval;

  // Reset when a new trial starts (isPlaying goes true while phase is idle)
  useEffect(() => {
    if (isPlaying && stateRef.current.phase === 'idle') {
      const s = stateRef.current;
      s.leftFill = 0; s.rightFill = 0;
      s.leftCoins = 0; s.rightCoins = 0;
      s.leftHoldStart = null; s.rightHoldStart = null;
      s.leftFillAtHoldStart = 0; s.rightFillAtHoldStart = 0;
      s.phase = 'playing';
      s.revealStart = null;
      s.winner = null;
    }
  }, [isPlaying]);

  // Transition to reveal when trial ends
  useEffect(() => {
    if (trialEnded && stateRef.current.phase === 'playing') {
      const s = stateRef.current;
      s.phase = 'reveal';
      s.winner = rgOutcome === 'green' ? 'L' : 'R';
      s.winnerFillSnapshot = s.winner === 'L' ? s.leftFill : s.rightFill;
      s.loserFillSnapshot = s.winner === 'L' ? s.rightFill : s.leftFill;
      s.revealStart = performance.now();
    }
  }, [trialEnded, rgOutcome]);

  // Reset to idle when trial is no longer playing or ended (new trial loading)
  useEffect(() => {
    if (!isPlaying && !trialEnded) {
      stateRef.current.phase = 'idle';
    }
  }, [isPlaying, trialEnded]);

  // ── Animation loop ──
  const animate = useCallback(() => {
    const s = stateRef.current;
    const p = propsRef.current;
    const now = performance.now();

    // Update fill (playing phase) — only when exactly one key is held
    if (s.phase === 'playing') {
      const exclusiveF = p.fKeyHeld && !p.jKeyHeld;
      const exclusiveJ = p.jKeyHeld && !p.fKeyHeld;

      // Left tube (F key, only if J not held)
      if (exclusiveF) {
        if (s.leftHoldStart === null) {
          s.leftHoldStart = now;
          s.leftFillAtHoldStart = s.leftFill;
        }
        s.leftFill = Math.min(maxFillSeconds,
          s.leftFillAtHoldStart + (now - s.leftHoldStart) / 1000);
      } else {
        if (s.leftHoldStart !== null) {
          s.leftFillAtHoldStart = s.leftFill;
          s.leftHoldStart = null;
        }
      }

      // Right tube (J key, only if F not held)
      if (exclusiveJ) {
        if (s.rightHoldStart === null) {
          s.rightHoldStart = now;
          s.rightFillAtHoldStart = s.rightFill;
        }
        s.rightFill = Math.min(maxFillSeconds,
          s.rightFillAtHoldStart + (now - s.rightHoldStart) / 1000);
      } else {
        if (s.rightHoldStart !== null) {
          s.rightFillAtHoldStart = s.rightFill;
          s.rightHoldStart = null;
        }
      }

      // Discrete coin count with SFX
      const newLeftCoins = Math.floor(s.leftFill / p.coinInterval);
      if (newLeftCoins > s.leftCoins) {
        s.leftCoins = newLeftCoins;
        if (p.sfx) playCoinSpawnSfx();
      }
      const newRightCoins = Math.floor(s.rightFill / p.coinInterval);
      if (newRightCoins > s.rightCoins) {
        s.rightCoins = newRightCoins;
        if (p.sfx) playCoinSpawnSfx();
      }
    }

    // Reveal phase timing
    if (s.phase === 'reveal') {
      const elapsed = (now - s.revealStart) / 1000;
      if (elapsed >= REVEAL_DURATION) {
        s.phase = 'done';
        const winnerCoins = s.winner === 'L' ? s.leftCoins : s.rightCoins;
        if (onRevealComplete) {
          onRevealComplete({ winnerCoins });
        }
      }
    }

    // Draw tubes
    drawTube(leftCanvasRef.current, 'L', s, p, maxFillSeconds, maxCoins);
    drawTube(rightCanvasRef.current, 'R', s, p, maxFillSeconds, maxCoins);

    if (s.phase !== 'done') {
      s.animFrameId = requestAnimationFrame(animate);
    }
  }, [maxFillSeconds, maxCoins, totalCanvasH, onRevealComplete]);

  // Start/stop animation loop
  useEffect(() => {
    const s = stateRef.current;
    if (s.animFrameId) cancelAnimationFrame(s.animFrameId);
    s.animFrameId = requestAnimationFrame(animate);
    return () => {
      if (s.animFrameId) cancelAnimationFrame(s.animFrameId);
    };
  }, [animate]);

  return (
    <>
      {/* Left tube */}
      <canvas
        ref={leftCanvasRef}
        width={TUBE_WIDTH}
        height={totalCanvasH}
        style={{
          position: 'absolute',
          left: -TUBE_WIDTH - 8,
          top: -borderThickness,
          width: TUBE_WIDTH,
          height: totalCanvasH,
          pointerEvents: 'none',
        }}
      />
      {/* Right tube */}
      <canvas
        ref={rightCanvasRef}
        width={TUBE_WIDTH}
        height={totalCanvasH}
        style={{
          position: 'absolute',
          right: -TUBE_WIDTH - 8,
          top: -borderThickness,
          width: TUBE_WIDTH,
          height: totalCanvasH,
          pointerEvents: 'none',
        }}
      />
    </>
  );
};

// ── Tube drawing ────────────────────────────────────────────────────────

function drawTube(canvas, side, state, props, maxFillSeconds, maxCoins) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pad = 4;
  const tubeX = pad;
  const tubeY = 0;
  const tubeW = W - pad * 2;
  const innerH = H;
  const innerW = tubeW - pad * 2;

  // Compute fill fraction
  const fill = side === 'L' ? state.leftFill : state.rightFill;
  let fillFrac = Math.min(1, fill / maxFillSeconds);

  const revealElapsed = (state.phase === 'reveal' || state.phase === 'done')
    ? (performance.now() - state.revealStart) / 1000 : 0;

  // During reveal: winner stays, loser coins fall down and fade
  let dropOffset = 0;
  let coinAlpha = 1;
  if (state.phase === 'reveal' || state.phase === 'done') {
    if (side === state.winner) {
      // Winner: freeze fill at snapshot
      fillFrac = state.winnerFillSnapshot / maxFillSeconds;
    } else {
      // Loser: freeze fill at snapshot, but apply drop + fade
      fillFrac = state.loserFillSnapshot / maxFillSeconds;
      const revealH = fillFrac * innerH;
      const drainT = Math.min(revealElapsed / 1.5, 1);
      dropOffset = easeInQuad(drainT) * (revealH + COIN_DIAM);
      coinAlpha = 1 - easeInQuad(drainT);
    }
  }

  // Glass tube background
  ctx.fillStyle = 'rgba(200,200,200,0.08)';
  drawRoundedRect(ctx, tubeX, tubeY, tubeW, innerH, 8);
  ctx.fill();

  // Curtain reveal: clip to revealed area and draw coins
  const revealH = fillFrac * innerH;
  const curtainY = tubeY + pad + (innerH - pad * 2) - revealH;

  if (revealH > 1) {
    ctx.save();
    // Clip to tube interior
    drawRoundedRect(ctx, tubeX + pad, tubeY + pad, innerW, innerH - pad * 2, 4);
    ctx.clip();
    // Clip to curtain area (moves down with coins during drain)
    ctx.beginPath();
    ctx.rect(0, curtainY + dropOffset, W, revealH + pad);
    ctx.clip();

    // Draw coin stack (clip naturally hides coins above fill level)
    ctx.globalAlpha = coinAlpha;
    const coinX = tubeX + tubeW / 2;
    const innerBottom = tubeY + innerH - pad;
    const visibleCoins = Math.min(maxCoins, Math.ceil(revealH / COIN_DIAM));
    for (let i = 0; i < visibleCoins; i++) {
      const coinY = innerBottom - COIN_R - i * COIN_DIAM + dropOffset;
      drawSmallCoin(ctx, coinX, coinY, COIN_R);
    }
    ctx.restore();
  }

  // Glass tube outline (black beaker style)
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, tubeX, tubeY, tubeW, innerH, 8);
  ctx.stroke();

  // Glass highlight
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(tubeX + 3, tubeY + 6, 4, innerH - 12);
}

export default CoinCollectorTubes;
