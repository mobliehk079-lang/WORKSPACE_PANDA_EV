// Panda Jump course: floating islands from the start beach to the PANDA EV charging station (~265 m).
// Everything that moves (platforms, spinners, blinking blocks, turntables) is driven by one shared clock,
// so every player in a room sees the same platform in the same place.
import * as THREE from '/vendor/three/three.module.min.js';
import { damp } from './rig.js';

const V3 = THREE.Vector3;
const COL = {
  grass: 0x7bd389, sand: 0xf3dfbf, rock: 0xc9a98a, stone: 0xe6e1ef, stoneTop: 0xb9e6a8,
  move: 0x8fa8ff, moveTop: 0xc9d4ff, lift: 0xa58bff, liftTop: 0xd6c9ff,
  crumble: 0xf2a65a, crumbleTop: 0xffd08f, pink: 0xff6fae, beam: 0xe8dcc8, beamTop: 0xffb3d1,
  blink: 0x5fd3ff, turn: 0xffe08a,
};
// Blinking blocks: group A is solid for [0, 2.6) s of every 4.4 s, group B for [2.2, 4.4) and [0, 0.4)
const BLINK_CYCLE = 4.4;
const blinkLeft = (group, ph) => (group === 'A' ? (ph < 2.6 ? 2.6 - ph : -1) : ph >= 2.2 ? BLINK_CYCLE - ph + 0.4 : ph < 0.4 ? 0.4 - ph : -1);

export function buildLevel(scene, { lowSpec = false, text = (s) => s } = {}) {
  const world = new THREE.Group();
  scene.add(world);
  const L = {
    world, colliders: [], movers: [], crumbles: [], pads: [], bolts: [], checkpoints: [], spinners: [],
    blinkers: [], turntables: [], clouds: [], npcSlots: [],
    spawn: new V3(0, 0, -2), goal: { pos: new V3(), radius: 1.3, ring: null, disc: null },
  };
  const matCache = new Map();
  const mat = (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
    return matCache.get(key);
  };
  const shade = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };
  const add = (c) => { Object.assign(c, { active: true, dx: 0, dy: 0, dz: 0 }); L.colliders.push(c); return c; };

  // ---------------------------------------------------------------- builders
  function island(x, top, z, w, d, { topc = COL.grass, base = COL.sand, under = true } = {}) {
    const g = new THREE.Group(); g.position.set(x, top, z);
    const h = 1.2;
    const b = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(base))); b.position.y = -h / 2 - 0.06;
    const t = shade(new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.2, d + 0.1), mat(topc))); t.position.y = -0.1;
    g.add(b, t);
    if (under) {
      const depth = Math.min(w, d) * 0.9 + 1;
      const cone = shade(new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.48, depth, 7), mat(COL.rock, { flatShading: true })), false);
      cone.rotation.x = Math.PI; cone.position.y = -h - 0.06 - depth / 2;
      g.add(cone);
    }
    world.add(g);
    return add({ kind: 'box', x, y: top, z, hx: w / 2 + 0.05, hz: d / 2 + 0.05, h: h + 0.06, group: g });
  }
  function pillar(x, top, z, r) {
    const g = new THREE.Group(); g.position.set(x, top, z);
    const h = top + 9;
    const b = shade(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 1.05, h, 20), mat(COL.stone))); b.position.y = -h / 2 - 0.06;
    const t = shade(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.2, 24), mat(COL.stoneTop))); t.position.y = -0.1;
    g.add(b, t); world.add(g);
    return add({ kind: 'cyl', x, y: top, z, r: r + 0.04, h, group: g });
  }
  function block(x, top, z, w, d, h, base, topc, own = false) {
    const g = new THREE.Group(); g.position.set(x, top, z);
    const inner = new THREE.Group(); g.add(inner);
    const mb = own ? new THREE.MeshStandardMaterial({ color: base, roughness: 0.7, transparent: true }) : mat(base);
    const mt = own ? new THREE.MeshStandardMaterial({ color: topc, roughness: 0.6, transparent: true }) : mat(topc);
    const b = shade(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mb)); b.position.y = -h / 2 - 0.04;
    const t = shade(new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.12, d + 0.06), mt)); t.position.y = -0.06;
    inner.add(b, t); world.add(g);
    const c = add({ kind: 'box', x, y: top, z, hx: w / 2 + 0.03, hz: d / 2 + 0.03, h: h + 0.04, group: g });
    c.inner = inner; c.mats = [mb, mt];
    return c;
  }
  function mover(c, axis, amp, speed, phase = 0) {
    L.movers.push({ c, base: new V3(c.x, c.y, c.z), axis: new V3(...axis), amp, speed, phase });
    c.moving = true;
  }
  function pusher(x, top, z, amp, speed, phase) {
    const c = block(x, top + 1.3, z, 1.0, 0.8, 1.3, 0xff5d73, 0xffffff);
    for (const sx of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.82), mat(0xffffff));
      stripe.position.set(sx * 0.3, -0.7, 0); c.inner.add(stripe);
    }
    mover(c, [1, 0, 0], amp, speed, phase);
  }
  function crumbleBlock(x, top, z, s) {
    const c = block(x, top, z, s, s, 0.5, COL.crumble, COL.crumbleTop);
    for (let i = 0; i < 3; i++) {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, 0.02, 0.05), mat(0x9a5b2a));
      crack.position.set((i - 1) * s * 0.12, 0.005, (i - 1) * s * 0.28);
      crack.rotation.y = (i - 1) * 0.5;
      c.inner.add(crack);
    }
    const cr = { c, base: new V3(x, top, z), state: 'idle', t: 0, vy: 0 };
    c.crumble = cr; L.crumbles.push(cr);
  }
  function blinker(x, top, z, s, group) {
    const c = block(x, top, z, s, s, 0.4, COL.blink, 0xd8f6ff, true);
    c.mats[0].emissive = new THREE.Color(COL.blink); c.mats[1].emissive = new THREE.Color(0xffffff);
    const b = { c, group, on: true };
    c.blink = b; L.blinkers.push(b);
  }
  function turntable(x, top, z, r, speed) {
    const g = new THREE.Group(); g.position.set(x, top, z);
    const spin = new THREE.Group(); g.add(spin);
    const base = shade(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.5, 40), mat(0xffffff))); base.position.y = -0.3;
    spin.add(base);
    for (let i = 0; i < 8; i++) {
      const wedge = shade(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.06, 20, 1, false, (i / 8) * Math.PI * 2, Math.PI / 8), mat(i % 2 ? COL.turn : COL.pink)), false);
      wedge.position.y = -0.03; spin.add(wedge);
    }
    const hub = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 16), mat(0x2b2340))); hub.position.y = 0.03;
    spin.add(hub);
    const stem = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 9 + top, 12), mat(COL.stone)), false); stem.position.y = -0.55 - (9 + top) / 2;
    g.add(stem); world.add(g);
    const c = add({ kind: 'cyl', x, y: top, z, r, h: 0.55, group: g });
    c.spin = { speed, a: 0, da: 0, mesh: spin };
    L.turntables.push(c);
  }
  function jumpPad(x, top, z) {
    const g = new THREE.Group(); g.position.set(x, top, z);
    const base = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 24), mat(0xffffff))); base.position.y = -0.14;
    const spring = shade(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 20), mat(0xd8cfe8, { metalness: 0.5, roughness: 0.4 })));
    spring.rotation.x = Math.PI / 2; spring.position.y = -0.1;
    const plate = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 24), mat(COL.pink, { emissive: COL.pink, emissiveIntensity: 0.25 })));
    plate.position.y = -0.05;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.3, 3), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.4 }));
    arrow.position.y = 0.25;
    g.add(base, spring, plate, arrow); world.add(g);
    const c = add({ kind: 'cyl', x, y: top, z, r: 0.85, h: 0.2, group: g });
    const pad = { c, plate, arrow, t: 1 };
    c.bounce = pad; L.pads.push(pad);
  }
  function spinner(x, top, z, len, speed, color = 0xff5d73) {
    const g = new THREE.Group(); g.position.set(x, top, z);
    const post = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.9, 16), mat(0xffffff))); post.position.y = 0.45;
    const bar = new THREE.Group(); bar.position.y = 0.5;
    bar.add(shade(new THREE.Mesh(new THREE.BoxGeometry(len * 2, 0.3, 0.3), mat(color))));
    for (let i = -3; i <= 3; i++) {
      if (!i) continue;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.32), mat(0xffffff));
      stripe.position.x = (i / 3.5) * len; bar.add(stripe);
    }
    for (const sx of [-1, 1]) {
      const cap = shade(new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), mat(0xffd23f)));
      cap.position.x = sx * len; bar.add(cap);
    }
    g.add(post, bar); world.add(g);
    add({ kind: 'cyl', x, y: top + 0.9, z, r: 0.34, h: 0.9 });
    L.spinners.push({ bar, x, z, top, L: len, speed, a: 0 });
  }
  function tree(x, y, z, s = 1, collide = true) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s);
    const trunk = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.9, 8), mat(0x9b6b43))); trunk.position.y = 0.45;
    const c1 = shade(new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), mat(0x55c17a, { flatShading: true }))); c1.position.y = 1.15;
    const c2 = shade(new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(0x7ad694, { flatShading: true }))); c2.position.set(0.12, 1.6, 0.05);
    g.add(trunk, c1, c2); world.add(g);
    if (collide) add({ kind: 'cyl', x, y: y + 0.9 * s, z, r: 0.2 * s, h: 0.9 * s });
  }
  function flowers(x, y, z, n = 5) {
    const colors = [0xff6fae, 0xffd23f, 0xffffff, 0xa58bff];
    for (let i = 0; i < n; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), mat(colors[i % colors.length]));
      const a = i * 2.4, r = 0.25 + (i % 3) * 0.25;
      f.position.set(x + Math.cos(a) * r, y + 0.06, z + Math.sin(a) * r);
      world.add(f);
    }
  }

  // lightning-bolt collectible
  const boltShape = new THREE.Shape();
  boltShape.moveTo(0.1, 0.5); boltShape.lineTo(-0.24, 0.0); boltShape.lineTo(-0.02, 0.0);
  boltShape.lineTo(-0.12, -0.5); boltShape.lineTo(0.24, 0.06); boltShape.lineTo(0.02, 0.06); boltShape.closePath();
  const boltGeo = new THREE.ExtrudeGeometry(boltShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  boltGeo.center();
  const boltMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb400, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.2 });
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,230,120,0.9)'); gr.addColorStop(1, 'rgba(255,230,120,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  function bolt(x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const m = new THREE.Mesh(boltGeo, boltMat); m.castShadow = !lowSpec; m.scale.setScalar(1.1);
    const glow = new THREE.Sprite(glowMat); glow.scale.setScalar(1.3);
    g.add(glow, m); world.add(g);
    L.bolts.push({ g, m, pos: new V3(x, y, z), taken: false, seed: L.bolts.length * 1.7 });
  }
  const boltRow = (x0, y0, z0, x1, y1, z1, n) => { for (let i = 0; i < n; i++) { const k = n === 1 ? 0 : i / (n - 1); bolt(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z0 + (z1 - z0) * k); } };

  function checkpoint(platform, fx, fz, spawnPos) {
    const g = new THREE.Group(); g.position.set(fx, platform.y, fz);
    const pole = shade(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 8), mat(0xffffff))); pole.position.y = 1;
    const ball = shade(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(0xffd23f))); ball.position.y = 2.05;
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xb8b3c4, side: THREE.DoubleSide, roughness: 0.7 });
    const flag = shade(new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.45), flagMat)); flag.position.set(0.4, 0.7, 0);
    g.add(pole, ball, flag); world.add(g);
    const cp = { flag, flagMat, spawn: spawnPos, active: false, n: L.checkpoints.length + 1 };
    platform.checkpoint = cp; L.checkpoints.push(cp);
    add({ kind: 'cyl', x: fx, y: platform.y + 2, z: fz, r: 0.08, h: 2 });
  }

  function textTexture(lines, bg, fg = '#fff', w = 256, h = 160) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    lines.forEach(([txt, size], i) => { x.font = `700 ${size}px sans-serif`; x.fillText(txt, w / 2, (h / (lines.length + 1)) * (i + 1)); });
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }
  function chargingStation(x, top, z) {
    const g = new THREE.Group(); g.position.set(x, top, z + 1.9);
    const body = shade(new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.6), mat(0xffffff, { roughness: 0.4 }))); body.position.y = 1.05;
    const capTop = shade(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.8), mat(0x2fbf7f))); capTop.position.y = 2.18;
    const tex = textTexture([['PANDA EV', 40], ['⚡ CHARGE', 30]], '#2fbf7f');
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.55), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25 }));
    screen.position.set(0, 1.45, -0.305); screen.rotation.y = Math.PI;
    const cable = shade(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 20, Math.PI * 1.4), mat(0x2b2340))); cable.position.set(0.62, 0.9, 0); cable.rotation.y = Math.PI / 2;
    const plug = shade(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), mat(0x2b2340))); plug.position.set(0.62, 0.55, -0.1);
    g.add(body, capTop, screen, cable, plug); world.add(g);
    add({ kind: 'box', x, y: top + 2.26, z: z + 1.9, hx: 0.65, hz: 0.4, h: 2.26 });
    const goal = L.goal;
    goal.pos.set(x, top, z);
    goal.ring = new THREE.Mesh(new THREE.TorusGeometry(goal.radius, 0.08, 10, 40), new THREE.MeshStandardMaterial({ color: 0x2fbf7f, emissive: 0x2fbf7f, emissiveIntensity: 1 }));
    goal.ring.rotation.x = -Math.PI / 2; goal.ring.position.set(x, top + 0.06, z);
    goal.disc = new THREE.Mesh(new THREE.CircleGeometry(goal.radius, 40), new THREE.MeshBasicMaterial({ color: 0x7dffc0, transparent: true, opacity: 0.3, depthWrite: false }));
    goal.disc.rotation.x = -Math.PI / 2; goal.disc.position.set(x, top + 0.03, z);
    world.add(goal.ring, goal.disc);
  }
  function cloud(x, y, z, s) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s);
    const m = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + ((i * 37) % 6) / 10, 1), m);
      b.position.set((i - 2) * 0.9, ((i * 13) % 4) / 10, ((i * 7) % 8) / 10 - 0.4);
      g.add(b);
    }
    world.add(g); L.clouds.push({ g, speed: 0.3 + (s % 0.4) });
  }
  const npc = (x, y, z, yaw, msg, winMsg) => L.npcSlots.push({ pos: new V3(x, y, z), yaw, msg: text(msg), winMsg: winMsg && text(winMsg) });

  // ---------------------------------------------------------------- the course
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: 0x4fc3e8, roughness: 0.25, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -8, 130); sea.receiveShadow = true;
  world.add(sea);

  // 1 · start beach
  island(0, 0, 0, 8, 8);
  tree(-3, 0, -3); tree(3.1, 0, -2.6, 0.9); tree(3, 0, 2.8, 1.1);
  flowers(-2.5, 0, 2.5); flowers(2, 0, -0.5, 4);
  npc(-2.2, 0, 0.8, 0.6, 'Hi! Collect the lightning bolts ⚡ and get to the charging station!');
  boltRow(0, 0.9, 0.5, 0, 0.9, 3.5, 3);

  // 2 · stepping-stone pillars
  pillar(0, 0, 7, 1.1); pillar(1.5, 0.5, 10.5, 1.1); pillar(-0.5, 1, 14, 1.1); pillar(1, 1.3, 17.5, 1.1);
  bolt(0, 0.9, 7); bolt(0.8, 2.1, 8.8); bolt(1.5, 1.4, 10.5); bolt(-0.5, 1.9, 14); bolt(1, 2.2, 17.5);

  // 3 · meadow + checkpoint 1
  const p1 = island(0, 1.5, 23, 6, 6);
  checkpoint(p1, 2.3, 24.6, new V3(0, 1.5, 22.5));
  tree(-2.3, 1.5, 25, 0.9); flowers(-1.5, 1.5, 21.5);
  bolt(-1.5, 2.4, 22); bolt(1.5, 2.4, 22);

  // 4 · sliding platforms
  mover(block(0, 1.5, 29.5, 3, 3, 0.5, COL.move, COL.moveTop), [1, 0, 0], 3.5, 1.2, 0);
  mover(block(0, 1.5, 33.5, 3, 3, 0.5, COL.move, COL.moveTop), [1, 0, 0], 3.5, 1.2, Math.PI);
  bolt(0, 2.6, 29.5); bolt(0, 2.6, 33.5);

  // 5 · small island + stairs
  island(0, 1.5, 39.5, 5, 5);
  bolt(0, 2.4, 39.5);
  island(2.5, 2.6, 44.5, 2.5, 2.5, { under: false }); island(4.5, 3.7, 47.5, 2.5, 2.5, { under: false }); island(2.5, 4.8, 50.5, 2.5, 2.5, { under: false });
  bolt(2.5, 3.5, 44.5); bolt(4.5, 4.6, 47.5); bolt(2.5, 5.7, 50.5);

  // 6 · jump pad + checkpoint 2
  const p3 = island(0, 5.9, 57, 6, 6);
  checkpoint(p3, -2.3, 55, new V3(0, 5.9, 55.5));
  jumpPad(0, 6.1, 59);
  tree(-2.4, 5.9, 59, 0.8);
  npc(2.2, 5.9, 57.2, -0.8, 'Step on the pink pad to bounce up!');
  bolt(-1.5, 6.8, 56); bolt(1.5, 6.8, 55.5); bolt(0, 9.6, 60.4); bolt(0, 11.6, 62.2);

  // 7 · high island
  island(0, 10.5, 66, 5, 5);
  bolt(-1.5, 11.4, 66); bolt(1.5, 11.4, 66);

  // 8 · crumbling blocks
  crumbleBlock(0, 10.5, 71.2, 2.4); crumbleBlock(-2.2, 10.5, 74.4, 2.4); crumbleBlock(0, 10.5, 77.6, 2.4); crumbleBlock(2.2, 10.5, 80.8, 2.4);
  bolt(0, 11.4, 71.2); bolt(-2.2, 11.4, 74.4); bolt(0, 11.4, 77.6); bolt(2.2, 11.4, 80.8);

  // 9 · checkpoint 3 + lift
  const p5 = island(0, 10.5, 86, 6, 6);
  checkpoint(p5, -2.3, 84.6, new V3(0, 10.5, 85));
  tree(2.4, 10.5, 84, 0.85); flowers(1.8, 10.5, 88);
  bolt(0, 11.4, 87.5);
  mover(block(0, 12.75, 92, 3, 3, 0.5, COL.lift, COL.liftTop), [0, 1, 0], 2.25, 0.9, -Math.PI / 2);
  bolt(0, 13.6, 92);

  // 10 · spinner arena
  island(0, 15, 98.5, 8, 8);
  spinner(0, 15, 98.5, 3.7, 1.5);
  bolt(-3, 15.9, 95.5); bolt(3, 15.9, 95.5); bolt(-3, 15.9, 101.5); bolt(3, 15.9, 101.5); bolt(0, 16.7, 103.5);

  // 11 · halfway island + checkpoint 4
  const p7 = island(0, 15, 108.5, 8, 8);
  checkpoint(p7, -3.2, 107, new V3(0, 15, 107.5));
  tree(3.2, 15, 105.5, 0.9); tree(-3.3, 15, 111.6, 1); flowers(2.5, 15, 111);
  npc(2.4, 15, 110.5, -0.6, 'Halfway there! Mind the sliding blocks on the bridge.');
  bolt(0, 15.9, 106); bolt(0, 15.9, 110);

  // 12 · narrow bridge with sliding blocks (good place to push your friends off!)
  island(0, 15, 118.5, 1.3, 12, { topc: COL.beamTop, base: COL.beam, under: false });
  pusher(0, 15, 116, 2.0, 1.6, 0);
  pusher(0, 15, 121, 2.0, 1.6, Math.PI);
  boltRow(0, 15.9, 114, 0, 15.9, 123.5, 4);

  // 13 · rest island
  const p8 = island(0, 15, 128.5, 6, 6);
  tree(-2.3, 15, 130.5, 0.8); flowers(2, 15, 127);
  npc(2.2, 15, 129.8, -0.7, 'Blue blocks blink on and off. Keep moving!');
  bolt(-1.5, 15.9, 127.5); bolt(1.5, 15.9, 127.5);
  void p8;

  // 14 · blinking blocks
  blinker(0, 15, 135, 2.6, 'A'); blinker(2.4, 15.6, 138.5, 2.6, 'B'); blinker(0, 16.2, 142, 2.6, 'A');
  blinker(-2.4, 16.8, 145.5, 2.6, 'B'); blinker(0, 17.4, 149, 2.6, 'A');
  bolt(0, 15.9, 135); bolt(2.4, 16.5, 138.5); bolt(0, 17.1, 142); bolt(-2.4, 17.7, 145.5); bolt(0, 18.3, 149);

  // 15 · checkpoint 5
  const p9 = island(0, 17.4, 154.5, 6, 6);
  checkpoint(p9, 2.3, 152.6, new V3(0, 17.4, 153.5));
  tree(-2.4, 17.4, 156.4, 0.9);
  bolt(0, 18.3, 155.5);

  // 16 · turntables
  turntable(0, 17.4, 162.5, 3.4, 0.7);
  turntable(0, 17.4, 171, 3.4, -0.9);
  bolt(0, 18.3, 162.5); bolt(0, 18.3, 171); bolt(2.6, 18.3, 166.8); bolt(-2.6, 18.3, 166.8);

  // 17 · island before the spiral
  island(0, 17.4, 179.5, 6, 6);
  flowers(-2, 17.4, 178); tree(2.4, 17.4, 181.5, 0.85);
  bolt(0, 18.3, 179.5);

  // 18 · pillar spiral up
  const spiral = [[2.8, 18.5, 185.5], [4.6, 19.6, 189], [2.6, 20.7, 192.5], [0, 21.8, 195.5], [-2.2, 22.9, 198.8]];
  for (const [x, y, z] of spiral) { pillar(x, y, z, 1.0); bolt(x, y + 0.9, z); }

  // 19 · checkpoint 6
  const p11 = island(0, 23, 204.5, 6, 6);
  checkpoint(p11, -2.3, 202.6, new V3(0, 23, 203.5));
  npc(2.3, 23, 205.8, -0.7, 'Two spinning bars next. Jump over them!');
  bolt(0, 23.9, 206);

  // 20 · double spinner arena
  island(0, 23, 214, 9, 9);
  spinner(-2.1, 23, 212, 2.0, 2.0, 0xa58bff);
  spinner(2.1, 23, 216, 2.0, -2.2, 0xff5d73);
  bolt(2.6, 23.9, 211); bolt(-2.6, 23.9, 217); bolt(0, 23.9, 214);

  // 21 · three sliding platforms
  mover(block(0, 23, 222, 2.6, 2.6, 0.5, COL.move, COL.moveTop), [1, 0, 0], 3, 1.4, 0);
  mover(block(0, 23, 226, 2.6, 2.6, 0.5, COL.move, COL.moveTop), [1, 0, 0], 3, 1.4, 2.1);
  mover(block(0, 23, 230, 2.6, 2.6, 0.5, COL.move, COL.moveTop), [1, 0, 0], 3, 1.4, 4.2);
  bolt(0, 24.1, 222); bolt(0, 24.1, 226); bolt(0, 24.1, 230);

  // 22 · checkpoint 7
  const p12 = island(0, 23, 235.5, 5, 5);
  checkpoint(p12, 1.8, 234, new V3(0, 23, 234.5));
  bolt(0, 23.9, 236.5);

  // 23 · crumbling climb + final pad
  crumbleBlock(1.5, 23, 241, 2.2); crumbleBlock(-1, 23.6, 244.5, 2.2); crumbleBlock(1.5, 24.2, 248, 2.2);
  bolt(1.5, 23.9, 241); bolt(-1, 24.5, 244.5); bolt(1.5, 25.1, 248);
  island(0, 24.2, 253, 5, 5);
  jumpPad(0, 24.4, 254.5);
  bolt(0, 27.5, 256); bolt(0, 29.6, 257.8);

  // 24 · goal: PANDA EV charging station
  island(0, 29, 262, 9, 9);
  chargingStation(0, 29, 262.5);
  tree(-3.5, 29, 265.3, 1); tree(3.6, 29, 258.8, 0.8); flowers(-2.8, 29, 259); flowers(2.8, 29, 265);
  npc(2.4, 29, 263.4, -0.5, 'Almost there! Step into the green ring', 'Yay! Fully charged!');

  // scenery
  const far = [[-34, -3, 25, 9], [36, 0, 55, 11], [-40, 4, 92, 12], [32, 8, 125, 10], [-36, 10, 170, 11], [38, 14, 210, 12], [-30, 18, 250, 10], [-20, -2, -30, 10], [26, -4, -18, 8]];
  for (const [x, y, z, s] of far) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.9, 1.5, 9), mat(COL.grass, { flatShading: true }));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(s * 0.9, s * 1.6, 9), mat(COL.rock, { flatShading: true }));
    cone.rotation.x = Math.PI; cone.position.y = -0.75 - s * 0.8;
    g.add(top, cone); world.add(g);
    for (let i = 0; i < 4; i++) tree(x + Math.cos(i * 1.7) * s * 0.5, y + 0.75, z + Math.sin(i * 1.7) * s * 0.5, 1.6 + (i % 2), false);
  }
  const nClouds = lowSpec ? 12 : 26;
  for (let i = 0; i < nClouds; i++) {
    const r1 = Math.sin(i * 12.9898) * 43758.5453, r2 = Math.sin(i * 78.233) * 12345.678;
    const f1 = r1 - Math.floor(r1), f2 = r2 - Math.floor(r2);
    cloud((f1 - 0.5) * 130, 8 + f2 * 30, -30 + (i / nClouds) * 320, 1.2 + f1 * 1.6);
  }

  // ---------------------------------------------------------------- per-frame update
  /** worldT: shared clock in seconds (same for everyone in a room); dt: frame/physics step */
  L.updatePlatforms = (worldT, dt) => {
    for (const m of L.movers) {
      const c = m.c, o = Math.sin(worldT * m.speed + m.phase) * m.amp;
      const nx = m.base.x + m.axis.x * o, ny = m.base.y + m.axis.y * o, nz = m.base.z + m.axis.z * o;
      c.dx = nx - c.x; c.dy = ny - c.y; c.dz = nz - c.z;
      c.x = nx; c.y = ny; c.z = nz;
      c.group.position.set(nx, ny, nz);
    }
    for (const c of L.turntables) {
      const a = (worldT * c.spin.speed) % (Math.PI * 2);
      let da = a - c.spin.a;
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      c.spin.da = da; c.spin.a = a; c.spin.mesh.rotation.y = a;
    }
    for (const s of L.spinners) { s.a = (worldT * s.speed) % (Math.PI * 2); s.bar.rotation.y = s.a; }
    const ph = ((worldT % BLINK_CYCLE) + BLINK_CYCLE) % BLINK_CYCLE;
    for (const b of L.blinkers) {
      const left = blinkLeft(b.group, ph);
      b.on = left > 0;
      b.c.active = b.on;
      const warn = b.on && left < 0.8;
      const flash = warn ? (Math.sin(worldT * 30) > 0 ? 0.9 : 0.15) : 0.3;
      for (const m of b.c.mats) { m.opacity = b.on ? 1 : 0.14; m.emissiveIntensity = b.on ? flash : 0; m.depthWrite = b.on; }
    }
    for (const cr of L.crumbles) {
      const c = cr.c, g = c.group;
      cr.t += dt;
      if (cr.state === 'shake') {
        c.inner.position.set(Math.sin(cr.t * 90) * 0.04, 0, Math.cos(cr.t * 77) * 0.04);
        if (cr.t > 0.6) { cr.state = 'fall'; cr.t = 0; cr.vy = 0; c.active = false; L.onCrumble?.(cr); }
      } else if (cr.state === 'fall') {
        cr.vy -= 22 * dt; g.position.y += cr.vy * dt; g.rotation.z += dt * 0.8;
        if (cr.t > 1.3) { cr.state = 'gone'; cr.t = 0; g.visible = false; }
      } else if (cr.state === 'gone') {
        if (cr.t > 2.4) resetCrumble(cr, true);
      } else g.scale.setScalar(damp(g.scale.x, 1, 10, dt));
    }
  };
  function resetCrumble(cr, pop) {
    const c = cr.c, g = c.group;
    cr.state = 'idle'; cr.t = 0; cr.vy = 0;
    g.position.copy(cr.base); g.rotation.set(0, 0, 0); g.visible = true;
    c.inner.position.set(0, 0, 0); c.active = true;
    g.scale.setScalar(pop ? 0.2 : 1);
  }
  L.updateDecor = (dt, t) => {
    for (const b of L.bolts) {
      if (b.taken) continue;
      b.m.rotation.y = t * 2.5 + b.seed;
      b.g.position.y = b.pos.y + Math.sin(t * 2.2 + b.seed) * 0.1;
    }
    for (const pd of L.pads) {
      pd.t = Math.min(1, pd.t + dt * 3);
      pd.plate.scale.set(1, pd.t < 1 ? 1 + Math.sin(pd.t * Math.PI * 3) * (1 - pd.t) * 0.6 : 1, 1);
      pd.arrow.position.y = 0.25 + Math.sin(t * 4) * 0.08;
      pd.arrow.rotation.y = t;
    }
    for (const cp of L.checkpoints) {
      cp.flag.position.y = damp(cp.flag.position.y, cp.active ? 1.65 : 0.7, 5, dt);
      cp.flag.rotation.y = Math.sin(t * 3 + cp.n) * 0.25;
    }
    for (const c of L.clouds) { c.g.position.x += c.speed * dt; if (c.g.position.x > 75) c.g.position.x = -75; }
    const g = L.goal, s = 1 + Math.sin(t * 3) * 0.05;
    g.ring.scale.set(s, s, 1);
    g.disc.material.opacity = 0.22 + Math.sin(t * 3) * 0.1;
  };
  /** Back to a fresh run: bolts back, flags down, crumbling blocks restored */
  L.reset = () => {
    for (const b of L.bolts) { b.taken = false; b.g.visible = true; }
    for (const cp of L.checkpoints) { cp.active = false; cp.flagMat.color.set(0xb8b3c4); cp.flag.position.y = 0.7; }
    for (const cr of L.crumbles) resetCrumble(cr, false);
  };
  return L;
}
