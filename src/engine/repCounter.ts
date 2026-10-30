/**
 * Rep counter — hysteresis state machine with bad-rep rejection.
 * Repsify-style: a rep only counts when the full range of motion is
 * completed at a realistic speed. Half reps and lightning-fast reps
 * are rejected and shown as toasts.
 */

import { BodyFeatures, ExerciseDef, TrackJoint } from "./exercises";
import { OneEuro, clamp } from "./geometry";

export type RejectReason = "half" | "too_fast" | "jitter";

export interface RepCounterHooks {
  onRep: (depthDeg: number) => void;
  onReject: (reason: RejectReason) => void;
  /** timed exercises (plank): each earned chunk of hold time */
  onHoldSec?: (sec: number) => void;
}

type State = "init" | "rest" | "active";

interface Channel {
  value: number;
  state: State;
  activeSince: number | null;
  bottomDwell: number;
  restAt: number | null;
  smooth: OneEuro;
}

function makeChannel(): Channel {
  return {
    value: 0,
    state: "init",
    activeSince: null,
    bottomDwell: 0,
    restAt: null,
    smooth: new OneEuro(1.4, 0.03),
  };
}

function channelValue(f: BodyFeatures, joint: TrackJoint, idx: number): number {
  switch (joint) {
    case "elbow": return idx === 0 ? f.elbowL : f.elbowR;
    case "knee": return idx === 0 ? f.kneeL : f.kneeR;
    case "hip": return idx === 0 ? f.hipL : f.hipR;
    case "arm": return idx === 0 ? f.armL : f.armR;
    default: return f.torsoTilt; // custom = torso tilt
  }
}

export class RepCounter {
  private channels: Channel[];
  private lastRepAt = 0;
  private holdAcc = 0;
  private lastTickAt = 0;
  /** deepest flexion achieved in the current rep (form feedback) */
  private depthPeak = 0;

  constructor(
    public def: ExerciseDef,
    private hooks: RepCounterHooks,
    depthPct = 100
  ) {
    // How much of the standard movement counts as one rep: 100 = default
    // depth, 50 = half reps count, 150 = only deeper-than-default reps.
    const pct = clamp(depthPct, 20, 150) / 100;
    if (pct !== 1) {
      this.def = {
        ...def,
        bottom:
          def.start === "high"
            ? def.top - (def.top - def.bottom) * pct
            : def.top + (def.bottom - def.top) * pct,
      };
    }
    // Mountain-climbers & similar alternate legs — count each leg separately.
    const dual = def.id === "mountainclimber" || def.id === "highknees";
    this.channels = dual ? [makeChannel(), makeChannel()] : [makeChannel()];
  }

  reset() {
    this.channels = this.channels.map(makeChannel);
    this.holdAcc = 0;
    this.lastRepAt = 0;
    this.depthPeak = 0;
  }

  private restZone(def: ExerciseDef, v: number): boolean {
    return def.start === "high" ? v >= def.top : v <= def.top;
  }

  private activeZone(def: ExerciseDef, v: number): boolean {
    return def.start === "high" ? v <= def.bottom : v >= def.bottom;
  }

  update(f: BodyFeatures, tMs: number) {
    if (!f.ok) return;

    // ---- timed holds (plank) ----
    if (this.def.mode === "timed") {
      const good = this.def.holdScore ? this.def.holdScore(f) >= 0.5 : f.plankPose >= 0.42 && f.torsoTilt > 55;
      const dt = this.lastTickAt ? clamp((tMs - this.lastTickAt) / 1000, 0, 1.5) : 0;
      this.lastTickAt = tMs;
      if (good) {
        this.holdAcc += dt;
        if (this.holdAcc >= 1) {
          const whole = Math.floor(this.holdAcc);
          this.holdAcc -= whole;
          this.hooks.onHoldSec?.(whole);
        }
      }
      return;
    }
    this.lastTickAt = tMs;

    // ---- rep exercises ----
    for (const ch of this.channels) {
      const raw = channelValue(f, this.def.joint, this.channels.length > 1 ? (ch === this.channels[0] ? 0 : 1) : 0);
      if (!isFinite(raw)) continue;
      const v = ch.smooth.filter(raw, tMs);
      ch.value = v;

      const inRest = this.restZone(this.def, v);
      const inActive = this.activeZone(this.def, v);

      switch (ch.state) {
        case "init":
          if (inRest) {
            ch.state = "rest";
            ch.restAt = tMs;
          }
          break;

        case "rest":
          if (inActive) {
            ch.state = "active";
            ch.activeSince = tMs;
            ch.bottomDwell = 0;
            this.depthPeak = this.def.start === "high" ? 180 - v : v;
          }
          break;

        case "active": {
          // track how deep the rep goes (degrees of flexion from start)
          const depth = this.def.start === "high" ? 180 - v : v;
          if (depth > this.depthPeak) this.depthPeak = depth;

          if (inRest) {
            const bottomMs = tMs - (ch.activeSince ?? tMs);
            const totalMs = tMs - (ch.restAt ?? ch.activeSince ?? tMs);
            const cooldownOk = tMs - this.lastRepAt > 220;

            if (bottomMs >= this.def.minBottomMs && totalMs >= this.def.minRepMs && cooldownOk) {
              this.lastRepAt = tMs;
              ch.state = "rest";
              ch.restAt = tMs;
              this.hooks.onRep(Math.round(this.depthPeak));
              this.depthPeak = 0;
            } else if (bottomMs < this.def.minBottomMs) {
              ch.state = "rest";
              ch.restAt = tMs;
              this.hooks.onReject("half");
              this.depthPeak = 0;
            } else if (!cooldownOk) {
              ch.state = "rest";
              ch.restAt = tMs;
            } else {
              ch.state = "rest";
              ch.restAt = tMs;
              this.hooks.onReject("too_fast");
              this.depthPeak = 0;
            }
          } else if (bottomMsExceeded(tMs, ch, this.def)) {
            ch.bottomDwell = tMs - (ch.activeSince ?? tMs);
          }
          break;
        }
      }
    }
  }
}

function bottomMsExceeded(tMs: number, ch: Channel, def: ExerciseDef): boolean {
  return tMs - (ch.activeSince ?? tMs) > def.minRepMs * 3;
}
