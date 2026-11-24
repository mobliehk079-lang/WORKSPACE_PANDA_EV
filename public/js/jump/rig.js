// Procedural animation for the Panda EV characters (public/models/panda/*.glb).
// Model spec: origin at the feet, facing +Z, no skeleton — the nodes Head, Arm_L, Arm_R, Leg_L, Leg_R
// have their pivots at neck / shoulders / hips, so we rotate them in code. Squash & stretch goes on the root.
import * as THREE from '/vendor/three/three.module.min.js';

const TAU = Math.PI * 2;
const { clamp, lerp } = THREE.MathUtils;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export class PandaRig {
  constructor(template) {
    this.root = new THREE.Group();          // world position + facing (yaw)
    this.model = template.clone(true);      // squash & stretch, lean, twirl
    this.root.add(this.model);
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const find = (n) => this.model.getObjectByName(n);
    this.parts = { head: find('Head'), armL: find('Arm_L'), armR: find('Arm_R'), legL: find('Leg_L'), legR: find('Leg_R') };
    this.rest = {};
    for (const [k, o] of Object.entries(this.parts)) if (o) this.rest[k] = o.rotation.clone();
    this.t = Math.random() * 10; this.phase = 0;
    this.run = 0; this.air = 0; this.waveW = 0; this.cheerW = 0; this.pushW = 0; this.stunW = 0;
    this.sq = 1; this.sqV = 0; this.spin = 0;
  }

  rot(k, x, y, z) {
    const o = this.parts[k]; if (!o) return;
    const r = this.rest[k];
    o.rotation.set(r.x + x, r.y + y, r.z + z);
  }
  setSquash(v) { this.sq = v; this.sqV = 0; }
  twirl() { this.spin = TAU; }

  /** st: speed 0..1, grounded, vy, wave, cheer, push, stun (0/1 targets), headYaw */
  update(dt, st = {}) {
    const { speed = 0, grounded = true, vy = 0, wave = 0, cheer = 0, push = 0, stun = 0, headYaw = 0 } = st;
    this.t += dt;
    this.run = damp(this.run, grounded ? speed : 0, 10, dt);
    this.air = damp(this.air, grounded ? 0 : 1, 14, dt);
    this.waveW = damp(this.waveW, wave, 6, dt);
    this.cheerW = damp(this.cheerW, cheer, 6, dt);
    this.pushW = damp(this.pushW, push, push ? 30 : 8, dt);
    this.stunW = damp(this.stunW, stun, 10, dt);
    if (grounded) this.phase += dt * (5 + 9 * speed);
    const { run, air, t } = this;
    const s = Math.sin(this.phase);
    const rising = clamp(vy / 6, -1, 1);
    const falling = Math.max(0, -rising);
    const breathe = Math.sin(t * 2.4);

    // legs: X rotation (negative = step forward)
    let legL = s * 0.85 * run, legR = -s * 0.85 * run;
    const flail = Math.sin(t * 14) * 0.18 * falling;
    legL = lerp(legL, rising > 0 ? -0.75 : -0.25 + flail, air);
    legR = lerp(legR, rising > 0 ? 0.4 : -0.1 - flail, air);

    // arms: swing on X (negative = forward), raise on Z (Arm_L up with −Z, Arm_R up with +Z)
    let armLx = -s * 0.9 * run, armRx = s * 0.9 * run;
    let armLz = breathe * 0.04 * (1 - run), armRz = -breathe * 0.04 * (1 - run);
    const raise = 1.45 + Math.sin(t * 18) * 0.25 * falling;
    armLz = lerp(armLz, -raise, air); armRz = lerp(armRz, raise, air);
    armLx = lerp(armLx, 0, air); armRx = lerp(armRx, 0, air);
    const w = this.waveW;
    armRz = lerp(armRz, 2.5 + Math.sin(t * 11) * 0.35, w); armRx = lerp(armRx, 0, w);
    const c = this.cheerW, cw = Math.sin(t * 12) * 0.25;
    armLz = lerp(armLz, -2.6 - cw, c); armRz = lerp(armRz, 2.6 + cw, c);
    armLx = lerp(armLx, 0, c); armRx = lerp(armRx, 0, c);
    // push: both arms straight forward
    const pw = this.pushW;
    armLx = lerp(armLx, -1.55, pw); armRx = lerp(armRx, -1.55, pw);
    armLz = lerp(armLz, 0.42, pw); armRz = lerp(armRz, -0.42, pw);
    // stunned: arms flop, head wobbles
    const sw = this.stunW;
    armLz = lerp(armLz, -0.9 + Math.sin(t * 9) * 0.5, sw); armRz = lerp(armRz, 0.9 + Math.cos(t * 9) * 0.5, sw);

    this.rot('legL', legL, 0, 0); this.rot('legR', legR, 0, 0);
    this.rot('armL', armLx, 0, armLz); this.rot('armR', armRx, 0, armRz);
    this.rot('head',
      Math.sin(this.phase * 2) * 0.06 * run - rising * 0.2 * air + Math.sin(t * 1.7) * 0.03 - c * 0.15 + pw * 0.1,
      headYaw + Math.sin(t * 7) * 0.35 * sw,
      Math.sin(t * 1.3) * 0.06 * (1 - run) + Math.sin(t * 9) * 0.08 * w + Math.sin(t * 6) * 0.3 * sw);

    // root: lean, bounce, squash & stretch (spring), twirl
    this.model.rotation.x = 0.13 * run + 0.25 * pw;
    this.model.position.y = Math.abs(s) * 0.07 * run;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.sqV += (-(this.sq - 1) * 260 - this.sqV * 15) * h;
      this.sq += this.sqV * h;
    }
    const stretch = 1 + 0.12 * clamp(vy / 12, 0, 1) * air;
    const sy = clamp(this.sq * stretch, 0.55, 1.5), sxz = 1 / Math.sqrt(sy);
    this.model.scale.set(sxz, sy, sxz);
    this.spin = damp(this.spin, 0, 5, dt);
    this.model.rotation.y = this.spin;
  }
}

/** Small hop for NPCs and the character preview */
export class Hopper {
  constructor(rig) { this.rig = rig; this.y = 0; this.vy = 0; }
  get grounded() { return this.y <= 0 && this.vy === 0; }
  hop(v = 5.5) { if (this.grounded) { this.vy = v; this.rig.setSquash(1.25); } }
  update(dt) {
    if (this.grounded) return;
    this.vy -= 22 * dt; this.y += this.vy * dt;
    if (this.y <= 0) { this.y = 0; this.vy = 0; this.rig.setSquash(0.75); }
  }
}
