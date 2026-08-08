/* ===========================================================================
   BALL & BOX — CONFIGURATION
   ---------------------------------------------------------------------------
   Edit THIS file only. ballbox.html reads it, so the endpoint URL and all
   tuning live in one place and survive an update of the HTML.

   Loaded as a plain script tag rather than by fetch(), so it works from
   file:// as well as from GitHub Pages.

   Note: do not write a literal closing script tag anywhere in this file. If
   the config is ever inlined into an HTML page, the HTML parser would end the
   script block there — even inside a comment.

   Anything you delete or omit falls back to a sensible default, so a partial
   config is fine.

   This game is INDEPENDENT of the word game: its own endpoint, its own Sheet,
   its own config. Rows still carry a `game` column so the two logs can be
   joined later on player_key if you ever want a single patient timeline.
   =========================================================================== */

window.BALLBOX_CONFIG = {

  /* -----------------------------------------------------------------------
     1. GOOGLE SHEET ENDPOINT   ← the one thing you must set
     Use a SEPARATE Sheet from the word game.
     Apps Script ▸ Deploy ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone
     Paste the URL that ends in /exec (not /dev).
     ----------------------------------------------------------------------- */
  endpoint : '',

  /* Only if you set READ_KEY in ballbox_stats.gs. Visible in page source —
     it deters casual access, nothing more. */
  readKey  : '',

  /* false = run fully offline (local archive + CSV export only). */
  upload   : true,

  /* Satisfaction survey on the end screen. Leave url:'' to hide the button. */
  survey: {
    url       : '',
    nameField : '',     // e.g. 'entry.1022541388'
    sidField  : ''      // e.g. 'entry.1333325407'
  },


  /* -----------------------------------------------------------------------
     2. GAME
     ----------------------------------------------------------------------- */
  game: {

    /* ---- session shape -------------------------------------------------
       A wave spawns `pairsPerWave` MIRRORED PAIRS of balls (so 3 pairs =
       6 balls, symmetric about the patient's midline) and ends once
       `collectPerWave` have been placed. It ends early ON PURPOSE: the
       balls left over are the hemispatial-neglect measure. If every ball
       had to be collected there would be no omission to measure.        */
    pairsPerWave   : 3,
    collectPerWave : 4,
    waveIdleMs     : 14000,   // no successful placement for this long → next wave
    waveMaxMs      : 75000,   // hard ceiling per wave

    /* Stages come from the prescribed zones, grouped by tier (near → mid →
       far). Waves per stage is what the OT sets on the player form.      */
    wavesPerStage : 2,
    waveOptions   : [1, 2, 3, 4],

    /* How difficulty is ordered across the session:

       'zone'        Stages advance near → mid → far, but BOX SIZE is
                     shuffled within each stage. Difficulty still rises in a
                     way the patient can see, while the box-width term stays
                     uncorrelated with time. Use this if you want the Fitts
                     regression to mean anything: a difficulty order that
                     tracks the clock is indistinguishable from fatigue.

       'progressive' Stages advance near → mid → far AND boxes shrink stage
                     by stage, like the word game's 3 stages. Clearer as a
                     game; the Fitts slope from these sessions is confounded
                     and should not be reported. The mode is logged either
                     way so this can be checked after the fact.           */
    stageMode : 'zone',

    /* ---- prescription --------------------------------------------------
       Which zones get a box. 3–5 of:
         ipsi_mid       same side, mid reach   — baseline
         cross_midline  across the body        — midline crossing
         elevate        up and out             — shoulder flexion/abduction
         extend         far, same side         — elbow extension
         near_low       close and low          — the COMPENSATORY pattern;
                                                 a control condition, not a
                                                 training target            */
    zones : ['ipsi_mid', 'cross_midline', 'elevate'],

    /* Ball size prescribes the grip: 'small' forces a precision pinch,
       'large' a power grasp, 'mixed' randomises per pair.                */
    gripMode : 'mixed',

    /* Box mouth diameters, as multipliers of the base size. This is the W
       term in Fitts' law and the cheapest way to vary difficulty without
       pushing targets outside the patient's reach.                       */
    boxWLevels : [1.0, 0.70, 0.50],

    /* ---- scoring -------------------------------------------------------
       Points come off THIS BALL's value, never off the running total, so
       the number the patient watches only ever goes up.

       A ball dropped in mid-air is NEVER penalised. Losing your grip is the
       impairment being treated; charging the patient for it would score the
       diagnosis. Only a deliberate release into the WRONG box costs points,
       which is a perceptual/cognitive error, not a motor one.            */
    pointsByTier    : { near: 60, mid: 80, far: 100 },
    wrongBoxPenalty : 20,        // per wrong-box release, cumulative
    floorPct        : 0.4,       // never worth less than 40% of full value

    /* Small boxes are harder, so they are worth more. Keyed by the entries
       in boxWLevels above. */
    boxSizeBonus : { '1': 1.0, '0.7': 1.15, '0.5': 1.3 },

    /* Bonus for consecutive balls placed correctly at the first attempt.
       A wrong box PAUSES the streak (the count is kept) rather than
       resetting it, so earlier effort is never wiped out.                */
    streakBonus  : 25,
    streakLength : 3,

    /* Show the running score while playing? The total always appears on the
       summary screen either way. Some therapists hide it to reduce
       performance anxiety.                                                */
    showScore : true,

    /* ---- player form defaults ----
       side:    'left' | 'right'          (which arm is being trained)
       posture: 'sit' | 'stand' | 'wheelchair' | ''                        */
    defaultSide    : 'right',
    defaultPosture : 'sit',

    /* Appearance. 'camera' shows the live video behind the game; 'dark' and
       'light' replace it with a plain high-contrast background (the hand
       skeleton stays). Toggle in game with the ภาพ button or the V key.  */
    theme : 'camera',

    /* Camera framing: 'fill' (height-fill, sides cropped — best for a 4:3
       webcam on a wide screen), 'contain', or 'cover'.                    */
    fit : 'fill',

    /* Hold time in ms for the จบเกม button (dwell-to-confirm). */
    endHoldMs : 1200
  },


  /* -----------------------------------------------------------------------
     3. HAND / GRASP TUNING
     Aperture = dist(thumb tip, index tip) / dist(wrist, middle knuckle).
     Roughly 0.3 fully pinched, 1.6 fully open. LOWER close = the patient must
     pinch harder to grab. Both values are logged with every session, so a
     change here can never be mistaken for a change in the patient.
     ----------------------------------------------------------------------- */
  grip: {
    close : 0.62,
    open  : 0.95,
    fistFingers : 3
  },

  /* Pre-game open/close baseline test — a clean aperture measurement, taken
     before any reaching contaminates it. */
  pinchCheck: {
    enabled : true,
    cycles  : 5,
    timeoutMs : 20000
  },


  /* -----------------------------------------------------------------------
     4. BODY MODEL
     The patient's midline, scale and reach envelope. Zones are stored in
     body-relative polar coordinates, so the same prescription reproduces
     across sessions even though the patient sits differently each time and
     the screen size changes.
     ----------------------------------------------------------------------- */
  body: {
    /* Reach-envelope sweep: the patient sweeps their arm out through a half
       circle and the maximum radius per direction is recorded. This CANNOT
       be replaced by anthropometry: usable reach after a neurological event
       is an ability, not a bone length, and its change over weeks is itself
       an outcome measure. */
    calibMs : 9000,
    calibBins : 12,          // 12 × 15° over the frontal half-plane
    calibPctl : 0.80,        // R = 80th percentile of the per-direction maxima
    rFallbackPct : 0.42,     // × visible height, if the sweep is skipped

    /* Interocular distance, used to convert pixels to centimetres. Individual
       variation is about ±4 mm on 63 mm → roughly 6% error on the absolute
       scale, which is fine for within-patient change (the only valid claim)
       and not fine for comparing patients. */
    assumedIpdCm : 6.3,

    /* Eye line → suprasternal notch, in IPD units. Sets the origin that the
       zone geometry is measured from. */
    shoulderDropIpd : 3.2,

    /* Face detection rate. The head moves slowly; spending frames on it costs
       hand-tracking frame rate, which the quality gate cares about. */
    faceHz : 4,

    /* Above this |yaw| the face is too turned to trust for the midline. */
    yawGate : 0.55
  },


  /* -----------------------------------------------------------------------
     5. QUALITY GATES  (recorded with the session; used by any dashboard)
     ----------------------------------------------------------------------- */
  gates: {
    fpsMin       : 20,   // below this, velocity and smoothness are noise
    minDistPct   : 5,    // % of screen height; smaller is a nudge, not a reach
    minMovements : 10,   // per session, before it belongs on a trend line
    /* Fitts' law breaks down when the target is nearly as wide as the
       distance to it: below about 1 bit the model no longer describes the
       movement, so those trials must be excluded from the regression rather
       than fitted. They are still logged — a nudge is data about reach, just
       not about the speed/accuracy trade-off. */
    fittsIdMin   : 1.0,

    palmMin      : 0.45  // hand edge-on → the aperture reading foreshortens.
                         // Apply to APERTURE metrics only. Gating the
                         // kinematics on it would drop cross-midline reaches
                         // preferentially, which is the condition of interest.
  }
};
