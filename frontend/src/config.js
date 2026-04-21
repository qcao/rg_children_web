// Configuration file for app settings
// Paths are relative to the public folder

export const config = {
  // Show F/J key press indicators on all interactive (non-frozen) pages
  // Displays current key state (F/J pressed) at the bottom-left of the screen
  // Set to true to show, false to hide
  showKeyIndicators: true,

  // Show image-based key indicators (icon_green.png / icon_yellow.png) below canvas during test trials
  // Set to true to show, false to hide
  showTestTrialKeyIcons: false,

  // Whether to randomly swap red and green sensor positions in test phase (counterbalancing)
  // Set to true to enable random swap per trial, false to keep sensors in original positions (default: false)
  randomSwapRedGreenSensor: false,

  // For E trials (test phase): swap sensor positions so green is on left, red is on right
  // No longer needed when JSONs already have correct layout (green left, red right)
  swapSensorsForETrials: false,
  
  // Ball texture path relative to public folder (e.g., '/ball.png' or '/ball_uniform.png')
  // Set to null or empty string to disable texture and use default blue fill
  ballTexturePath: '/ball.png',
  // Ball texture rotation rate in degrees per second (animation time)
  ballRotationRate: 180, // Set to 0 to disable rotation, or a positive/negative value for rotation speed
  // Barrier texture path relative to public folder
  // Set to null or empty string to disable texture and use default black fill
  barrierTexturePath: '/barrier.png',
  // Red sensor texture path relative to public folder (v2: yellow flower garden)
  // Set to null or empty string to disable texture and use default red fill
  redSensorTexturePath: '/yellow.jpg',
  // Green sensor texture path relative to public folder
  // Set to null or empty string to disable texture and use default green fill
  greenSensorTexturePath: '/green.jpg',
  // Occluder texture path relative to public folder
  // Set to null or empty string to disable texture and use default gray fill
  occluderTexturePath: '/cloud.jpg',
  // Canvas border thickness in pixels (applied equally on all sides)
  // Border uses the barrier texture
  canvasBorderThickness: 20,
  // Starting audio file path relative to public folder (e.g., '/beginning_audio.wav')
  // Set to null or empty string to use default sine wave tone (1000Hz, 50ms)
  startingAudioPath: '/beginning_audio.wav',
  // Ending audio file path relative to public folder (e.g., '/ending_audio.mp3')
  // Set to null or empty string to use default sine wave tone (500Hz, 50ms)
  endingAudioPath: '/ending_audio.mp3',
  showCoinTubes: true,
  coinInterval: 1.0,
  tubeSfx: false,
};

