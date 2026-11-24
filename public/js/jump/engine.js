// Panda Jump — 3D platformer engine (Three.js, vendored in /vendor/three).
// Solo or multiplayer: each client simulates its own panda and sends its position ~15×/s;
// other players are drawn from the server's snapshots with a short interpolation delay.
// Pushing: press F / E / ✋ near a friend — the server checks the distance and knocks them back.
import * as THREE from '/vendor/three/three.module.min.js';
import { GLTFLoader } from '/vendor/three/GLTFLoader.js';
import { PandaRig, Hopper, damp } from './rig.js';
import { buildLevel } from './level.js';
import { isMuted, setMuted } from '../sound.js';

const V3 = THREE.Vector3;
const { clamp, lerp } = THREE.MathUtils;
const TAU = Math.PI * 2;
function dampAngle(a, b, k, dt) {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * (1 - Math.exp(-k * dt));
}
const lerpAngle = (a, b, k) => a + (((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI) * k;
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CHARACTERS = [
  { file: '/models/panda/panda_hero_pink_hoodie.glb', name: 'Hero Panda', desc: 'Pink hoodie', color: '#ff6fae' },
  { file: '/models/panda/panda_green_cap.glb', name: 'Green Cap', desc: 'Green cap and jacket', color: '#2fbf7f' },
  { file: '/models/panda/panda_pink_bow.glb', name: 'Pink Bow', desc: 'Pink bow and jacket', color: '#ff9ccf' },
  { file: '/models/panda/panda_smart_glasses.glb', name: 'Smart Glasses', desc: 'Glasses and green jacket', color: '#3fb6a8' },
];

// ---------------------------------------------------------------- tuning
const RAD = 0.3, H = 1.05, LAND_RAD = RAD * 0.75, STEP_UP = 0.3;
const MAX_SPEED = 6.2, GRAVITY = 28, FALL_MULT = 1.35;
const JUMP_V = 10, DOUBLE_V = 8.6, BOUNCE_V = 18, HEAD_BOUNCE_V = 9.5;
const COYOTE = 0.1, BUFFER = 0.13, STEP = 1 / 120;
const PUSH_RANGE = 1.5, PUSH_CD = 0.6, PUSH_POWER = 10, STUN = 0.45;
const SEND_EVERY = 1 / 15, INTERP_MS = 120;
const BEST_KEY = 'pev-jump-best';

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

let templatesP = null;
/** Loads the 4 character models once (cached for the session) */
export function loadTemplates(onProgress) {
  if (!templatesP) {
    const loader = new GLTFLoader();
    const prog = CHARACTERS.map(() => 0);
    templatesP = Promise.all(CHARACTERS.map((c, i) => loader.loadAsync(c.file, (e) => {
      if (e.total) { prog[i] = e.loaded / e.total; onProgress?.(prog.reduce((a, b) => a + b, 0) / prog.length); }
    }).then((g) => g.scene)));
    templatesP.catch(() => { templatesP = null; });
  }
  return templatesP;
}

function makeSky(top, bottom) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;\nvoid main(){ float h = clamp(vP.y * 1.6 + 0.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0);\n#include <colorspace_fragment>\n}',
  }));
  m.renderOrder = -1;
  return m;
}

function makeRenderer(canvas, lowSpec) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: !lowSpec || devicePixelRatio < 2, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, lowSpec ? 1.5 : 2));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  return r;
}

// ---------------------------------------------------------------- audio (WebAudio synth)
function makeSfx() {
  let ctx = null, master = null;
  const S = {
    init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    },
    tone(f, dur, type = 'sine', vol = 0.15, f2 = null, delay = 0) {
      if (!ctx || isMuted()) return;
      const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.03);
    },
    noise(dur, vol = 0.2, freq = 800) {
      if (!ctx || isMuted()) return;
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
      src.connect(f).connect(g).connect(master); src.start();
    },
    play(name, p = 0) {
      switch (name) {
        case 'jump': S.tone(420, 0.14, 'square', 0.06, 760); break;
        case 'double': S.tone(620, 0.18, 'triangle', 0.12, 1250); break;
        case 'land': S.noise(0.08, 0.25, 500); break;
        case 'bolt': { const f = 880 * Math.pow(2, p / 12); S.tone(f, 0.09, 'square', 0.05); S.tone(f * 1.5, 0.16, 'square', 0.05, null, 0.07); break; }
        case 'bounce': S.tone(260, 0.35, 'sine', 0.2, 980); break;
        case 'head': S.tone(330, 0.2, 'sine', 0.18, 660); break;
        case 'checkpoint': [523, 659, 784, 1047].forEach((f, i) => S.tone(f, 0.18, 'triangle', 0.12, null, i * 0.08)); break;
        case 'hit': S.tone(220, 0.25, 'sawtooth', 0.09, 70); S.noise(0.12, 0.2, 1200); break;
        case 'whoosh': S.noise(0.18, 0.18, 2400); break;
        case 'fall': S.tone(700, 0.6, 'sine', 0.12, 110); break;
        case 'splash': S.noise(0.45, 0.35, 1800); break;
        case 'crumble': S.noise(0.3, 0.3, 300); break;
        case 'tick': S.tone(660, 0.12, 'triangle', 0.14); break;
        case 'go': S.tone(990, 0.4, 'triangle', 0.16); break;
        case 'win': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => S.tone(f, 0.25, 'triangle', 0.13, null, i * 0.11)); break;
      }
    },
    close() { ctx?.close(); ctx = null; },
  };
  return S;
}

// ---------------------------------------------------------------- character preview (lobby)
export function createPreview(canvas, templates, { index = 0, onPick } = {}) {
  const renderer = makeRenderer(canvas, isTouchDevice());
  const scene = new THREE.Scene();
  scene.add(makeSky(0x8fd0ff, 0xffe3f1));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9b8c8, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.4, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
  ground.position.y = -0.2; ground.receiveShadow = true; scene.add(ground);
  const rigs = [], hops = [], pods = [];
  CHARACTERS.forEach((ch, i) => {
    const x = (i - 1.5) * 1.45;
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.16, 32), new THREE.MeshStandardMaterial({ color: ch.color, emissive: ch.color, emissiveIntensity: 0, roughness: 0.5 }));
    pod.position.set(x, 0.08, 0); pod.receiveShadow = true; scene.add(pod);
    const rig = new PandaRig(templates[i]);
    rig.root.position.set(x, 0.16, 0);
    rig.root.traverse((o) => { o.userData.index = i; });
    scene.add(rig.root);
    rigs.push(rig); hops.push(new Hopper(rig)); pods.push(pod);
  });
  let sel = index, raf = 0, last = performance.now(), t = 0;
  const resize = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    const narrow = cam.aspect < 1.4;
    cam.position.set(0, narrow ? 2.4 : 1.7, narrow ? 10.5 : 7);
    cam.lookAt(0, 0.6, 0); cam.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const ray = new THREE.Raycaster();
  const onDown = (e) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
    const hit = ray.intersectObjects(rigs.map((x) => x.root), true)[0];
    if (hit) onPick?.(hit.object.userData.index);
  };
  canvas.addEventListener('pointerdown', onDown);
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    rigs.forEach((rig, i) => {
      const on = i === sel, hop = hops[i];
      hop.update(dt);
      if (on && hop.grounded && (t % 2.2) < dt) hop.hop(5);
      rig.root.position.y = 0.16 + hop.y;
      rig.root.rotation.y = damp(rig.root.rotation.y, on ? Math.sin(t * 0.9) * 0.35 : (sel - i) * 0.25, 6, dt);
      rig.root.scale.setScalar(damp(rig.root.scale.x, on ? 1.18 : 0.95, 8, dt));
      rig.update(dt, { grounded: hop.grounded, vy: hop.vy, wave: on && hop.grounded ? 1 : 0, headYaw: on ? 0 : (sel - i) * 0.25 });
      pods[i].material.emissiveIntensity = damp(pods[i].material.emissiveIntensity, on ? 0.55 : 0, 8, dt);
    });
    renderer.render(scene, cam);
  };
  frame();
  return {
    set(i) { sel = i; hops[i].hop(6); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener('pointerdown', onDown); renderer.dispose(); renderer.forceContextLoss(); },
  };
}

// ---------------------------------------------------------------- the game
/**
 * opts: { templates, ch, mode: 'solo' | 'multi', meId, t, send(msg) (multi), onExit(), onInvite(), onCharacter(i) }
 * returns { onNet(msg), destroy() }
 */
export function createGame(root, opts) {
  const { templates, mode, t } = opts;
  const multi = mode === 'multi';
  const lowSpec = isTouchDevice();
  let isTouch = lowSpec;
  let ch = opts.ch || 0;
  const Sfx = makeSfx();

  // ---------------------------------------------------------------- DOM
  root.classList.add('pj-root');
  root.innerHTML = `
    <canvas class="pj-canvas" tabindex="0"></canvas>
    <div class="pj-tags"></div>
    <div class="pj-hud">
      <div class="pj-pills">
        <span class="pj-pill" data-k="bolts">⚡ 0</span>
        <span class="pj-pill" data-k="time">00:00.0</span>
        <span class="pj-pill" data-k="falls" title="${escH(t('Falls'))}">💦 0</span>
        ${multi ? '<span class="pj-pill pj-code" data-k="room"></span>' : ''}
      </div>
      <div class="pj-btns">
        <button class="pj-ib" data-a="mute" aria-label="${escH(t('Sound'))}"></button>
        ${multi ? `<button class="pj-ib" data-a="players" aria-label="${escH(t('Players'))}">👥</button>` : ''}
        <button class="pj-ib" data-a="menu" aria-label="${escH(t('Menu'))}">⏸</button>
      </div>
    </div>
    <div class="pj-feed"></div>
    ${multi ? '<div class="pj-players"></div>' : ''}
    <div class="pj-count"></div>
    <div class="pj-toast"></div>
    <div class="pj-flash"></div>
    <div class="pj-help">${escH(t('WASD / arrows: move · Space: jump (twice for a double jump) · F: push · drag: turn the camera'))}</div>
    <div class="pj-touch">
      <div class="pj-joy"><i></i></div>
      <button class="pj-push" aria-label="${escH(t('Push'))}">✋</button>
      <button class="pj-jump" aria-label="${escH(t('Jump'))}">⤒</button>
    </div>
    <div class="pj-modal" hidden><div class="pj-panel"></div></div>`;
  const q = (s) => root.querySelector(s);
  const canvas = q('.pj-canvas');
  const tagsEl = q('.pj-tags');
  const modal = q('.pj-modal'), panel = q('.pj-panel');
  root.classList.toggle('touch', isTouch);
  if (isTouch) q('.pj-help').remove(); else setTimeout(() => q('.pj-help')?.classList.add('out'), 7000);

  // ---------------------------------------------------------------- renderer + scene
  const renderer = makeRenderer(canvas, lowSpec);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6efff, 45, 170);
  const sky = makeSky(0x5fb8ff, 0xd6efff); scene.add(sky);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0xb59b7a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowSpec ? 1024 : 2048, lowSpec ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const SUN_OFFSET = new V3(-10, 22, -8);

  const resize = () => {
    const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();

  const L = buildLevel(scene, { lowSpec, text: t });
  const colliders = L.colliders, goal = L.goal;
  L.onCrumble = (cr) => dust(cr.base, 8, 1.4);

  // ---------------------------------------------------------------- particles
  const particles = [];
  const pGeo = new THREE.IcosahedronGeometry(1, 0), confettiGeo = new THREE.PlaneGeometry(1, 0.55);
  function spawn(pos, vel, color, life, size, grav = 0, confetti = false) {
    let p = particles.find((x) => !x.alive && x.confetti === confetti);
    if (!p) {
      if (particles.length > 260) return;
      const m = new THREE.Mesh(confetti ? confettiGeo : pGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      p = { mesh: m, vel: new V3(), spinV: new V3(), confetti };
      scene.add(m); particles.push(p);
    }
    p.alive = true; p.life = p.max = life; p.size = size; p.grav = grav;
    p.mesh.visible = true; p.mesh.position.copy(pos); p.vel.copy(vel);
    p.mesh.material.color.set(color);
    p.spinV.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
  }
  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; p.mesh.visible = false; continue; }
      p.vel.y -= p.grav * dt;
      if (p.confetti) p.vel.multiplyScalar(1 - 1.5 * dt);
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.mesh.scale.setScalar(p.size * (p.confetti ? 1 : 0.4 + 0.6 * k));
      p.mesh.material.opacity = p.confetti ? Math.min(1, k * 3) : k * 0.85;
      p.mesh.rotation.x += p.spinV.x * dt; p.mesh.rotation.y += p.spinV.y * dt;
    }
  }
  function dust(pos, n = 8, power = 1.6) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.4;
      spawn(new V3(pos.x, pos.y + 0.08, pos.z), new V3(Math.cos(a) * power, 0.6 + Math.random() * 0.6, Math.sin(a) * power), 0xffffff, 0.45 + Math.random() * 0.2, 0.09 + Math.random() * 0.05, 1);
    }
  }
  function sparkle(pos, color = 0xffd23f, n = 12) {
    for (let i = 0; i < n; i++) {
      const v = new V3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 2);
      spawn(pos, v, color, 0.5 + Math.random() * 0.3, 0.07 + Math.random() * 0.05, 6);
    }
  }
  function confetti(pos, n = 90) {
    const colors = [0xff6fae, 0x2fbf7f, 0xffd23f, 0x5fb8ff, 0xffffff, 0xa58bff];
    for (let i = 0; i < n; i++) {
      const v = new V3(Math.random() - 0.5, 1.2 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(7 + Math.random() * 5);
      spawn(pos, v, colors[i % colors.length], 2.4 + Math.random(), 0.22, 7, true);
    }
  }

  // ---------------------------------------------------------------- player
  const player = {
    pos: L.spawn.clone(), vel: new V3(), yaw: 0, grounded: false, ground: null,
    coyote: 0, buffer: 0, airJumps: 1, cuttable: false, invuln: 0, dustT: 0, stun: 0,
    pushCd: 0, pushT: 0, respawn: L.spawn.clone(), rig: null,
  };
  function setCharacter(i) {
    ch = i;
    const old = player.rig;
    player.rig = new PandaRig(templates[i]);
    scene.add(player.rig.root);
    if (old) { scene.remove(old.root); player.rig.setSquash(1.3); sparkle(player.pos.clone().add(new V3(0, 0.6, 0)), 0xffffff, 14); }
  }
  setCharacter(ch);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24), new THREE.MeshBasicMaterial({ color: 0x1a1030, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);

  // ---------------------------------------------------------------- NPCs (the other characters)
  const npcs = [];
  L.npcSlots.forEach((slot, k) => {
    const others = [0, 1, 2, 3].filter((i) => i !== ch);
    const ci = others[k % others.length];
    const rig = new PandaRig(templates[ci]);
    rig.root.position.copy(slot.pos); rig.root.rotation.y = slot.yaw;
    scene.add(rig.root);
    const el = document.createElement('div'); el.className = 'pj-bubble'; el.style.opacity = 0;
    tagsEl.append(el);
    npcs.push({ rig, hop: new Hopper(rig), slot, el, name: t(CHARACTERS[ci].name), yaw: slot.yaw, hopT: 1 + k, near: false, ouch: 0 });
    colliders.push({ kind: 'cyl', x: slot.pos.x, y: slot.pos.y + 1.1, z: slot.pos.z, r: 0.35, h: 1.1, active: true, dx: 0, dy: 0, dz: 0 });
  });

  // ---------------------------------------------------------------- run state
  const stats = { bolts: 0, falls: 0, time: 0, combo: 0, comboT: 0 };
  let paused = false;        // solo pause (multi: menu open, world keeps going)
  let won = false, wonT = 0; // reached the goal in this run
  let inRing = false;
  let elapsed = 0;
  // multiplayer
  let room = null, offset = null, lastRound = -1, shownResults = -1, raceFinishedSent = false, placed = false;
  const startSlot = (i) => new V3(((i % 4) - 1.5) * 1.4, 0, -2.8 + Math.floor(i / 4) * 1.3);
  const remotes = new Map();
  const serverNow = () => Date.now() + (offset ?? 0);
  const worldTime = () => (multi ? serverNow() / 1000 : performance.now() / 1000);
  const raceState = () => (room && (room.status === 'countdown' || room.status === 'race') && room.players.find((p) => p.id === opts.meId)?.racing ? room.status : null);
  const frozen = () => raceState() === 'countdown' && serverNow() < room.startAt;

  function resetRun(spawnPos) {
    L.reset();
    Object.assign(stats, { bolts: 0, falls: 0, time: 0, combo: 0, comboT: 0 });
    const p = player;
    p.respawn.copy(L.spawn); p.pos.copy(spawnPos || L.spawn); p.vel.set(0, 0, 0);
    Object.assign(p, { yaw: 0, grounded: false, ground: null, coyote: 0, buffer: 0, airJumps: 1, invuln: 0, cuttable: false, stun: 0 });
    cam.yaw = 0; cam.pitch = 0.36; cam.target.copy(p.pos).add(new V3(0, 1, 0));
    jumpQueued = false; won = false; wonT = 0; raceFinishedSent = false;
  }

  // ---------------------------------------------------------------- input
  const keys = {};
  let jumpQueued = false, pushQueued = false, touchJump = false, gpJumpPrev = false, gpPushPrev = false;
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, lx: 0, ly: 0 };
  const cam = { yaw: 0, pitch: 0.36, dist: lowSpec ? 8 : 7.5, target: new V3(), shake: 0 };
  const typing = (e) => e.target?.closest?.('input, textarea, select, [contenteditable]');
  const onKeyDown = (e) => {
    if (typing(e) || document.querySelector('.overlay')) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    Sfx.init();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (modal.hidden) openMenu(); else closeModal(); return; }
    if (!modal.hidden) return;
    if (e.code === 'Space') jumpQueued = true;
    if (e.code === 'KeyF' || e.code === 'KeyE') pushQueued = true;
    if (e.code === 'Tab' && multi) { e.preventDefault(); togglePlayers(); }
  };
  const onKeyUp = (e) => { keys[e.code] = false; };
  const onBlur = () => { for (const k in keys) keys[k] = false; if (!multi && modal.hidden && !won) openMenu(); };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  const joyEl = q('.pj-joy'), knob = q('.pj-joy i');
  canvas.addEventListener('pointerdown', (e) => {
    Sfx.init();
    if (e.pointerType === 'touch' && !isTouch) { isTouch = true; root.classList.add('touch'); q('.pj-help')?.remove(); }
    canvas.setPointerCapture(e.pointerId);
    const r = root.getBoundingClientRect();
    if (e.pointerType !== 'mouse' && e.clientX - r.left < r.width * 0.45 && joy.id === null) {
      Object.assign(joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      joyEl.style.display = 'block'; joyEl.style.left = `${e.clientX - r.left}px`; joyEl.style.top = `${e.clientY - r.top}px`;
      knob.style.transform = '';
    } else if (look.id === null) Object.assign(look, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === joy.id) {
      let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
      const l = Math.hypot(dx, dy), max = 55;
      if (l > max) { dx *= max / l; dy *= max / l; }
      joy.x = dx / max; joy.y = dy / max;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === look.id) {
      const s = e.pointerType === 'mouse' ? 0.006 : 0.009;
      cam.yaw -= (e.clientX - look.lx) * s;
      cam.pitch = clamp(cam.pitch + (e.clientY - look.ly) * s * 0.7, 0.05, 1.15);
      look.lx = e.clientX; look.ly = e.clientY;
    }
  });
  const endPointer = (e) => {
    if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; joyEl.style.display = 'none'; }
    if (e.pointerId === look.id) look.id = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist + e.deltaY * 0.005, 4, 13); }, { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  const btnJump = q('.pj-jump'), btnPush = q('.pj-push');
  btnJump.addEventListener('pointerdown', (e) => { e.preventDefault(); Sfx.init(); touchJump = true; jumpQueued = true; btnJump.setPointerCapture(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel']) btnJump.addEventListener(ev, () => { touchJump = false; });
  btnPush.addEventListener('pointerdown', (e) => { e.preventDefault(); Sfx.init(); pushQueued = true; });

  function gamepad() {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) : null;
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
    return { lx: dz(gp.axes[0]), ly: dz(gp.axes[1]), rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0), jump: !!gp.buttons[0]?.pressed, push: !!(gp.buttons[2]?.pressed || gp.buttons[1]?.pressed) };
  }
  function moveInput() {
    let x = 0, z = 0;
    if (keys.KeyW || keys.ArrowUp) z += 1;
    if (keys.KeyS || keys.ArrowDown) z -= 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    x += joy.x; z -= joy.y;
    const gp = gamepad();
    if (gp) { x += gp.lx; z -= gp.ly; }
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    return { x, z };
  }
  const jumpHeld = () => keys.Space || touchJump || !!gamepad()?.jump;

  // ---------------------------------------------------------------- collisions
  function xzDist(c, x, z) {
    if (c.kind === 'box') {
      const cx = clamp(x, c.x - c.hx, c.x + c.hx), cz = clamp(z, c.z - c.hz, c.z + c.hz);
      return { d: Math.hypot(x - cx, z - cz), cx, cz };
    }
    return { d: Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r) };
  }
  function groundBelow(x, z, y) {
    let best = null;
    for (const c of colliders) {
      if (!c.active || c.remote || c.y > y + 0.05 || xzDist(c, x, z).d > 0) continue;
      if (!best || c.y > best.y) best = c;
    }
    return best;
  }

  // ---------------------------------------------------------------- player physics
  function doJump(v, double) {
    const p = player;
    p.vel.y = v; p.grounded = false; p.ground = null; p.coyote = 0; p.buffer = 0; p.cuttable = true;
    p.rig.setSquash(double ? 1.2 : 1.32);
    if (double) { p.rig.twirl(); sparkle(p.pos.clone().add(new V3(0, 0.3, 0)), 0xffffff, 10); Sfx.play('double'); }
    else { dust(p.pos, 6, 1.2); Sfx.play('jump'); }
  }
  function onLand(c, impact, sameGround) {
    const p = player;
    p.pos.y = c.y; p.cuttable = false;
    if (c.remote) { // landed on a friend's head
      p.vel.y = HEAD_BOUNCE_V; p.grounded = false; p.ground = null; p.airJumps = 1;
      p.rig.setSquash(1.3); Sfx.play('head'); sparkle(p.pos.clone(), 0xffffff, 8);
      return;
    }
    p.grounded = true; p.ground = c; p.airJumps = 1;
    if (c.bounce) {
      p.vel.y = BOUNCE_V; p.grounded = false; p.ground = null;
      p.rig.setSquash(1.4); c.bounce.t = 0;
      sparkle(p.pos.clone(), 0xff6fae, 14); Sfx.play('bounce');
      return;
    }
    p.vel.y = 0;
    if (!sameGround && impact > 3) {
      p.rig.setSquash(1 - Math.min(0.38, impact * 0.022));
      if (impact > 7) { dust(p.pos, 10, 2); Sfx.play('land'); }
    }
    if (c.crumble && c.crumble.state === 'idle') { c.crumble.state = 'shake'; c.crumble.t = 0; Sfx.play('crumble'); }
    if (c.checkpoint && !c.checkpoint.active) activateCheckpoint(c.checkpoint);
  }
  function activateCheckpoint(cp) {
    cp.active = true;
    cp.flagMat.color.set(0x2fbf7f);
    player.respawn.copy(cp.spawn);
    sparkle(new V3().setFromMatrixPosition(cp.flag.matrixWorld), 0x2fbf7f, 16);
    Sfx.play('checkpoint');
    toast(`✔ ${t('Checkpoint {n} saved', { n: cp.n })}`);
  }
  const tmp = new V3();
  function stepPlayer(dt, inp) {
    const p = player, pos = p.pos, vel = p.vel;
    const wasGrounded = p.grounded;
    const canMove = !frozen() && !(won && !multi) && p.stun <= 0 && !(multi && !modal.hidden);

    // ride moving platforms / turntables (ignore jumps caused by a clock correction)
    const g = p.ground;
    if (g && g.active) {
      if (g.moving && Math.abs(g.dx) + Math.abs(g.dy) + Math.abs(g.dz) < 0.5) { pos.x += g.dx; pos.y += g.dy; pos.z += g.dz; }
      if (g.spin && Math.abs(g.spin.da) < 0.2) {
        const a = g.spin.da, rx = pos.x - g.x, rz = pos.z - g.z, c = Math.cos(a), s = Math.sin(a);
        pos.x = g.x + rx * c + rz * s; pos.z = g.z - rx * s + rz * c; p.yaw += a;
      }
    }

    // horizontal intent, relative to the camera
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    let wx = fx * inp.z - fz * inp.x, wz = fz * inp.z + fx * inp.x;
    if (!canMove) { wx = 0; wz = 0; }
    const hasInput = Math.hypot(wx, wz) > 0.05;
    if (p.stun <= 0) {
      const accel = p.grounded ? (hasInput ? 55 : 45) : 20;
      let dvx = wx * MAX_SPEED - vel.x, dvz = wz * MAX_SPEED - vel.z;
      const dl = Math.hypot(dvx, dvz), maxDv = accel * dt;
      if (dl > maxDv) { dvx *= maxDv / dl; dvz *= maxDv / dl; }
      vel.x += dvx; vel.z += dvz;
    } else {
      p.stun -= dt;
      if (p.grounded) { vel.x *= 1 - 6 * dt; vel.z *= 1 - 6 * dt; }
      if (p.stun <= 0 && !p.grounded) p.airJumps = 1;
    }
    if (hasInput) p.yaw = dampAngle(p.yaw, Math.atan2(wx, wz), 14, dt);

    // jump: coyote time + buffer + double jump + variable height
    p.coyote = p.grounded ? COYOTE : p.coyote - dt;
    p.buffer -= dt;
    if (jumpQueued) { if (canMove) p.buffer = BUFFER; jumpQueued = false; }
    if (p.buffer > 0 && canMove) {
      if (p.coyote > 0) doJump(JUMP_V, false);
      else if (p.airJumps > 0) { p.airJumps--; doJump(DOUBLE_V, true); }
    }
    if (p.cuttable && !jumpHeld() && vel.y > 0) { vel.y *= 0.5; p.cuttable = false; }

    // push
    p.pushCd -= dt; p.pushT -= dt;
    if (pushQueued) { pushQueued = false; if (canMove && p.pushCd <= 0) doPush(); }

    // vertical
    const prevY = pos.y;
    vel.y = Math.max(vel.y - GRAVITY * (vel.y < 0 ? FALL_MULT : 1) * dt, -24);
    pos.y += vel.y * dt;
    p.grounded = false;
    const before = p.ground; p.ground = null;
    let landed = null;
    for (const c of colliders) {
      if (!c.active || xzDist(c, pos.x, pos.z).d > (c.remote ? 0.05 : LAND_RAD)) continue;
      const top = c.y, bot = c.y - c.h;
      if (vel.y <= 0 && prevY >= top - 0.06 && pos.y <= top) { if (!landed || top > landed.y) landed = c; }
      else if (vel.y > 0 && !c.remote && prevY + H <= bot + 0.06 && pos.y + H > bot) { pos.y = bot - H; vel.y = 0; p.cuttable = false; }
    }
    if (landed) onLand(landed, -vel.y, wasGrounded && before === landed);

    // horizontal move + wall push-out (with a small step-up)
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    for (const c of colliders) {
      if (!c.active) continue;
      const top = c.y, bot = c.y - c.h;
      if (pos.y >= top - 0.01 || pos.y + H <= bot) continue;
      let nx, nz;
      if (c.kind === 'box') {
        const { d, cx, cz } = xzDist(c, pos.x, pos.z);
        if (d >= RAD) continue;
        if (p.grounded && top - pos.y <= STEP_UP) { pos.y = top; continue; }
        if (d > 1e-5) { nx = (pos.x - cx) / d; nz = (pos.z - cz) / d; pos.x = cx + nx * RAD; pos.z = cz + nz * RAD; }
        else {
          const px = c.hx - Math.abs(pos.x - c.x), pz = c.hz - Math.abs(pos.z - c.z);
          if (px < pz) { nx = Math.sign(pos.x - c.x) || 1; nz = 0; pos.x = c.x + nx * (c.hx + RAD); }
          else { nz = Math.sign(pos.z - c.z) || 1; nx = 0; pos.z = c.z + nz * (c.hz + RAD); }
        }
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
        if (d >= c.r + RAD) continue;
        if (!c.remote && p.grounded && top - pos.y <= STEP_UP) { pos.y = top; continue; }
        nx = d > 1e-5 ? dx / d : 1; nz = d > 1e-5 ? dz / d : 0;
        pos.x = c.x + nx * (c.r + RAD); pos.z = c.z + nz * (c.r + RAD);
      }
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
    }

    // spinning bars knock you away
    p.invuln -= dt;
    for (const s of L.spinners) {
      if (p.invuln > 0 || pos.y > s.top + 0.65 || pos.y + H < s.top + 0.35) continue;
      const dirx = Math.cos(s.a), dirz = -Math.sin(s.a);
      const rx = pos.x - s.x, rz = pos.z - s.z;
      const tt = clamp(rx * dirx + rz * dirz, -s.L, s.L);
      const ox = rx - dirx * tt, oz = rz - dirz * tt, od = Math.hypot(ox, oz);
      if (od > RAD + 0.17 || Math.abs(tt) < 0.45) continue;
      let kx = s.speed * dirz * tt, kz = -s.speed * dirx * tt;
      const kl = Math.hypot(kx, kz) || 1; kx /= kl; kz /= kl;
      const ax = od > 1e-4 ? ox / od : kx, az = od > 1e-4 ? oz / od : kz;
      knock(kx * 8 + ax * 3, kz * 8 + az * 3, 7, 0.25);
      sparkle(tmp.copy(pos).setY(pos.y + 0.6), 0xff5d73, 10);
    }

    if (pos.y < Math.max(-7, p.respawn.y - 16)) respawnPlayer();
  }
  function knock(vx, vz, vy, stun) {
    const p = player;
    p.vel.set(vx, vy, vz); p.grounded = false; p.ground = null; p.invuln = 0.7; p.stun = stun; p.airJumps = 0; p.cuttable = false;
    p.rig.setSquash(0.65); cam.shake = 0.25; Sfx.play('hit');
  }
  function doPush() {
    const p = player;
    p.pushCd = PUSH_CD; p.pushT = 0.3;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    p.vel.x += fx * 3; p.vel.z += fz * 3;
    Sfx.play('whoosh');
    const hits = (x, y, z) => {
      const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz);
      return d < PUSH_RANGE && Math.abs(y - p.pos.y) < 1.2 && (d < 0.5 || (dx * fx + dz * fz) / d > 0.25);
    };
    let hit = false;
    for (const r of remotes.values()) {
      if (!r.visible || !hits(r.pos.x, r.pos.y, r.pos.z)) continue;
      opts.send?.({ t: 'push', to: r.id });
      sparkle(tmp.copy(r.pos).setY(r.pos.y + 0.7), 0xffffff, 10);
      hit = true;
    }
    for (const n of npcs) {
      if (!hits(n.rig.root.position.x, n.slot.pos.y, n.rig.root.position.z)) continue;
      n.hop.hop(6.5); n.rig.setSquash(0.7); n.ouch = 1.4;
      sparkle(tmp.copy(n.rig.root.position).setY(n.slot.pos.y + 0.7), 0xffffff, 10);
      hit = true;
    }
    if (hit) { Sfx.play('hit'); cam.shake = 0.12; navigator.vibrate?.(25); }
  }
  function respawnPlayer() {
    const p = player;
    stats.falls++;
    opts.send?.({ t: 'fall' });
    Sfx.play('splash'); setTimeout(() => Sfx.play('fall'), 60);
    flash();
    p.pos.copy(p.respawn); p.vel.set(0, 0, 0);
    Object.assign(p, { grounded: false, ground: null, airJumps: 1, yaw: 0, invuln: 0, stun: 0 });
    p.rig.setSquash(0.6);
    cam.yaw = 0; cam.target.copy(p.pos).add(new V3(0, 1, 0));
  }

  // ---------------------------------------------------------------- NPCs
  function updateNpcs(dt) {
    for (const n of npcs) {
      const rp = n.rig.root.position;
      const dx = player.pos.x - rp.x, dz = player.pos.z - rp.z, dy = player.pos.y - n.slot.pos.y;
      const near = Math.hypot(dx, dz, dy * 0.5) < 4.5;
      const cheer = won && !!n.slot.winMsg;
      n.yaw = near || cheer ? dampAngle(n.yaw, Math.atan2(dx, dz), 6, dt) : dampAngle(n.yaw, n.slot.yaw, 2, dt);
      n.rig.root.rotation.y = n.yaw;
      if (near && !n.near) n.hop.hop(5);
      n.near = near;
      n.ouch -= dt;
      n.hopT -= dt;
      if (n.hopT <= 0) { n.hopT = cheer ? 0.7 : 3 + Math.random() * 4; if (cheer || Math.random() < 0.5) n.hop.hop(cheer ? 6 : 4.5); }
      n.hop.update(dt);
      rp.y = n.slot.pos.y + n.hop.y;
      n.rig.update(dt, { grounded: n.hop.grounded, vy: n.hop.vy, wave: near && !cheer && n.ouch <= 0 ? 1 : 0, cheer: cheer ? 1 : 0, stun: n.ouch > 0 ? 1 : 0 });
      const show = near || cheer || n.ouch > 0;
      const msg = n.ouch > 0 ? t('Ouch!') : cheer ? n.slot.winMsg : n.slot.msg;
      placeTag(n.el, show, rp, 1.45, `<b>${escH(n.name)}</b>${escH(msg)}`);
    }
  }
  function placeTag(el, show, pos, up, html) {
    if (show) {
      tmp.copy(pos); tmp.y += up; tmp.project(camera);
      if (tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2) {
        el.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * root.clientWidth).toFixed(1)}px,${((-tmp.y * 0.5 + 0.5) * root.clientHeight).toFixed(1)}px) translate(-50%,-100%)`;
        if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
        el.style.opacity = 1;
        return;
      }
    }
    el.style.opacity = 0;
  }

  // ---------------------------------------------------------------- remote players
  function remoteFor(id, chIndex) {
    let r = remotes.get(id);
    const info = room?.players.find((p) => p.id === id);
    if (!r) {
      const el = document.createElement('div'); el.className = 'pj-tag';
      tagsEl.append(el);
      const col = { kind: 'cyl', x: 0, y: -100, z: 0, r: 0.32, h: H, active: false, remote: true, dx: 0, dy: 0, dz: 0 };
      colliders.push(col);
      r = { id, ch: -1, rig: null, buf: [], pos: new V3(0, -100, 0), yaw: 0, vy: 0, flags: 0, speed: 0, visible: false, el, col, name: '' };
      remotes.set(id, r);
    }
    if (info) r.name = info.name;
    if (chIndex !== r.ch && templates[chIndex]) {
      if (r.rig) scene.remove(r.rig.root);
      r.rig = new PandaRig(templates[chIndex]); r.ch = chIndex;
      r.rig.root.visible = r.visible;
      scene.add(r.rig.root);
    }
    return r;
  }
  function removeRemote(id) {
    const r = remotes.get(id);
    if (!r) return;
    if (r.rig) scene.remove(r.rig.root);
    r.el.remove();
    const i = colliders.indexOf(r.col); if (i >= 0) colliders.splice(i, 1);
    remotes.delete(id);
  }
  function updateRemotes(dt) {
    const rt = serverNow() - INTERP_MS;
    for (const r of remotes.values()) {
      const b = r.buf;
      if (!b.length || !r.rig) { r.visible = false; continue; }
      const last = b[b.length - 1];
      r.visible = serverNow() - last.t < 4000;
      let a = b[0], c = last;
      for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= rt) { a = b[i - 1]; c = b[i]; break; }
      const span = c.t - a.t;
      const k = span > 0 ? clamp((rt - a.t) / span, 0, 1.2) : 1;
      if (Math.hypot(c.x - a.x, c.z - a.z) > 6 || Math.abs(c.y - a.y) > 6) r.pos.set(c.x, c.y, c.z); // teleport (respawn)
      else r.pos.set(lerp(a.x, c.x, k), lerp(a.y, c.y, k), lerp(a.z, c.z, k));
      r.yaw = lerpAngle(a.yaw, c.yaw, clamp(k, 0, 1));
      r.vy = c.vy; r.flags = c.flags;
      r.speed = damp(r.speed, span > 0 ? clamp(Math.hypot(c.x - a.x, c.z - a.z) / (span / 1000) / MAX_SPEED, 0, 1) : 0, 8, dt);
      const grounded = !!(r.flags & 1);
      r.rig.root.visible = r.visible;
      r.rig.root.position.copy(r.pos);
      r.rig.root.rotation.y = r.yaw;
      r.rig.update(dt, { speed: grounded ? r.speed : 0, grounded, vy: r.vy, push: r.flags & 2 ? 1 : 0, cheer: r.flags & 4 ? 1 : 0, stun: r.flags & 8 ? 1 : 0 });
      if (grounded && !r.wasGrounded && r.lastVy < -6) r.rig.setSquash(0.7);
      if (!grounded && r.wasGrounded && r.vy > 5) r.rig.setSquash(1.3);
      r.wasGrounded = grounded; r.lastVy = r.vy;
      Object.assign(r.col, { x: r.pos.x, y: r.pos.y + H, z: r.pos.z, active: r.visible });
      const fin = room?.players.find((p) => p.id === r.id)?.finished != null;
      placeTag(r.el, r.visible && r.pos.distanceTo(player.pos) < 70, r.pos, 1.5, `${fin ? '🏁 ' : ''}${escH(r.name)}`);
    }
  }

  // ---------------------------------------------------------------- network
  function sampleOffset(now) {
    const est = now - Date.now();
    if (offset === null || est > offset) offset = est;
    else offset += (est - offset) * 0.02; // drift slowly back if clocks move
  }
  let sendT = 0;
  function sendState(dt) {
    if (!multi) return;
    sendT -= dt;
    if (sendT > 0) return;
    sendT = SEND_EVERY;
    const p = player;
    const flags = (p.grounded ? 1 : 0) | (p.pushT > 0 ? 2 : 0) | (won ? 4 : 0) | (p.stun > 0 ? 8 : 0);
    opts.send?.({ t: 's', s: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.yaw.toFixed(2), +p.vel.y.toFixed(1), flags] });
  }
  function onNet(m) {
    switch (m.t) {
      case 'w':
        sampleOffset(m.now);
        for (const d of m.d) {
          const [id, x, y, z, yaw, vy, flags, chIndex] = d;
          if (id === opts.meId) continue;
          const r = remoteFor(id, chIndex);
          const b = r.buf;
          if (b.length && b[b.length - 1].t >= m.now) continue;
          b.push({ t: m.now, x, y, z, yaw, vy, flags });
          if (b.length > 30) b.shift();
        }
        break;
      case 'room': onRoom(m.room); break;
      case 'pushed': {
        if (player.invuln > 0.4) break;
        knock(m.dx * PUSH_POWER, m.dz * PUSH_POWER, 6.5, STUN);
        navigator.vibrate?.([30, 20, 40]);
        break;
      }
      case 'fx': onFx(m); break;
    }
  }
  function onRoom(r) {
    room = r;
    sampleOffset(r.now);
    for (const id of [...remotes.keys()]) if (!r.players.some((p) => p.id === id)) removeRemote(id);
    for (const p of r.players) if (p.id !== opts.meId && remotes.has(p.id)) remoteFor(p.id, p.ch);
    const myIndex = Math.max(0, r.players.findIndex((p) => p.id === opts.meId));
    // first time in the room: stand on your own spot on the start beach
    if (!placed) { placed = true; if (!raceState()) resetRun(startSlot(myIndex)); }
    // a race starts: everyone goes to the start line
    if (r.status === 'countdown' && r.round !== lastRound && r.players.find((p) => p.id === opts.meId)?.racing) {
      lastRound = r.round;
      resetRun(startSlot(myIndex));
      closeModal();
      countdownShown = null;
    }
    if (r.results && r.results.round !== shownResults) { shownResults = r.results.round; setTimeout(() => showResults(r.results), 600); }
    renderPlayers();
    q('[data-k="room"]').textContent = r.id;
  }
  function onFx(m) {
    const name = (id) => escH(room?.players.find((p) => p.id === id)?.name || '?');
    const me = (id) => id === opts.meId;
    switch (m.k) {
      case 'ko': feed(`💥 ${t('{a} pushed {b} into the sea!', { a: me(m.by) ? t('You') : name(m.by), b: me(m.who) ? t('you') : name(m.who) })}`, me(m.by) ? 'good' : me(m.who) ? 'bad' : ''); break;
      case 'fall': if (!me(m.who)) feed(`💦 ${t('{name} fell into the sea', { name: name(m.who) })}`); break;
      case 'finish': feed(`🏁 ${t('{name} finished #{n} · {time}', { name: me(m.who) ? t('You') : name(m.who), n: m.place, time: fmtTime(m.time / 1000) })}`, me(m.who) ? 'good' : ''); break;
      case 'join': if (!me(m.who)) feed(`👋 ${t('{name} joined', { name: escH(m.name) })}`); break;
      case 'leave': feed(`🚪 ${t('{name} left', { name: escH(m.name) })}`); break;
      case 'push': if (!me(m.from) && !me(m.to)) { const r = remotes.get(m.to); if (r?.visible) sparkle(tmp.copy(r.pos).setY(r.pos.y + 0.7), 0xffffff, 8); } break;
    }
  }

  // ---------------------------------------------------------------- HUD / UI
  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const hudCache = {};
  const setPill = (k, v) => { if (hudCache[k] !== v) { hudCache[k] = v; q(`[data-k="${k}"]`).textContent = v; } };
  function updateHud() {
    setPill('bolts', `⚡ ${stats.bolts}/${L.bolts.length}`);
    const rs = raceState();
    let time = stats.time;
    if (rs === 'race' || (rs === 'countdown' && serverNow() >= room.startAt)) {
      const mine = room.players.find((p) => p.id === opts.meId);
      time = mine?.finished != null ? mine.finished / 1000 : Math.max(0, (serverNow() - room.startAt) / 1000);
    }
    setPill('time', `${rs ? '🏁 ' : ''}${fmtTime(time)}`);
    setPill('falls', `💦 ${stats.falls}`);
  }
  let countdownShown = null;
  function updateCountdown() {
    const el = q('.pj-count');
    let txt = '';
    if (raceState()) {
      const left = (room.startAt - serverNow()) / 1000;
      if (left > 0) txt = String(Math.ceil(left));
      else if (left > -1) txt = t('GO!');
    }
    if (txt !== countdownShown) {
      countdownShown = txt;
      el.textContent = txt;
      el.classList.remove('pop'); void el.offsetWidth; if (txt) el.classList.add('pop');
      if (txt) Sfx.play(txt === t('GO!') ? 'go' : 'tick');
    }
  }
  let toastTimer = 0;
  function toast(msg) {
    const el = q('.pj-toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function feed(html, cls = '') {
    const box = q('.pj-feed');
    const el = document.createElement('div'); el.className = `pj-feed-item ${cls}`; el.innerHTML = html;
    box.prepend(el);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6000);
  }
  function flash() { const f = q('.pj-flash'); f.style.transition = 'none'; f.style.opacity = 0.8; requestAnimationFrame(() => { f.style.transition = ''; f.style.opacity = 0; }); }

  const muteBtn = q('[data-a="mute"]');
  const syncMute = () => { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; };
  syncMute();
  muteBtn.onclick = () => { Sfx.init(); setMuted(!isMuted()); syncMute(); };
  q('[data-a="menu"]').onclick = () => (modal.hidden ? openMenu() : closeModal());
  q('[data-a="players"]')?.addEventListener('click', () => togglePlayers());

  function togglePlayers(force) { q('.pj-players')?.classList.toggle('open', force); }
  function renderPlayers() {
    const box = q('.pj-players');
    if (!box || !room) return;
    const host = room.hostId === opts.meId;
    const rs = room.status;
    const ranked = [...room.players].sort((a, b) => (a.finished ?? Infinity) - (b.finished ?? Infinity) || b.ko - a.ko);
    box.innerHTML = `
      <div class="pj-pl-head"><b>${escH(t('Room {code}', { code: room.id }))}</b><small>${room.players.length}/${room.max}</small></div>
      <div class="pj-pl-list">${ranked.map((p) => `<div class="pj-pl ${p.online ? '' : 'off'} ${p.id === opts.meId ? 'me' : ''}">
        <i style="background:${CHARACTERS[p.ch]?.color || '#ccc'}"></i>
        <span class="n">${p.id === room.hostId ? '👑 ' : ''}${escH(p.name)}</span>
        <span class="s">${p.finished != null ? `🏁 ${fmtTime(p.finished / 1000)}` : ''} 💥${p.ko}</span></div>`).join('')}</div>
      <div class="pj-pl-btns">
        ${host && rs === 'free' ? `<button class="pj-btn primary" data-a="start">🏁 ${escH(t('Start race'))}</button>` : ''}
        ${host && rs !== 'free' ? `<button class="pj-btn" data-a="stop">${escH(t('End race'))}</button>` : ''}
        ${!host && rs === 'free' ? `<small>${escH(t('The host can start a race. Until then, play freely!'))}</small>` : ''}
        ${rs !== 'free' ? `<small>${escH(rs === 'countdown' ? t('Race starting…') : t('Race in progress'))}</small>` : ''}
        <button class="pj-btn" data-a="invite">➕ ${escH(t('Invite'))}</button>
      </div>`;
    box.querySelector('[data-a="start"]')?.addEventListener('click', () => opts.send?.({ t: 'start' }));
    box.querySelector('[data-a="stop"]')?.addEventListener('click', () => opts.send?.({ t: 'stop' }));
    box.querySelector('[data-a="invite"]')?.addEventListener('click', () => opts.onInvite?.());
  }

  function openModal(html, { pause = true } = {}) {
    panel.innerHTML = html;
    modal.hidden = false;
    if (!multi && pause) paused = true;
    for (const k in keys) keys[k] = false;
    joy.x = joy.y = 0;
  }
  function closeModal() { modal.hidden = true; paused = false; canvas.focus({ preventScroll: true }); }
  modal.addEventListener('click', (e) => { if (e.target === modal && !won) closeModal(); });

  const charRow = () => `<div class="pj-chars">${CHARACTERS.map((c, i) => `<button class="pj-char ${i === ch ? 'on' : ''}" data-ch="${i}"><i style="background:${c.color}"></i>${escH(t(c.name))}</button>`).join('')}</div>`;
  function bindChars() {
    panel.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.ch);
      if (i === ch) return;
      setCharacter(i);
      opts.onCharacter?.(i);
      opts.send?.({ t: 'ch', ch: i });
      panel.querySelectorAll('[data-ch]').forEach((x) => x.classList.toggle('on', Number(x.dataset.ch) === i));
    }));
  }
  function openMenu() {
    const racing = !!raceState();
    openModal(`<h2>${escH(multi ? t('Menu') : t('Paused'))}</h2>
      <button class="pj-btn primary" data-a="resume">${escH(multi ? t('Back to the game') : t('Resume'))}</button>
      ${racing ? '' : `<button class="pj-btn" data-a="restart">↺ ${escH(t('Back to the start'))}</button>`}
      ${multi ? `<button class="pj-btn" data-a="invite">➕ ${escH(t('Invite colleagues'))}</button>` : ''}
      <div class="pj-sub">${escH(t('Character'))}</div>${charRow()}
      <button class="pj-btn ghost" data-a="exit">🚪 ${escH(multi ? t('Leave room') : t('Exit game'))}</button>
      <small class="pj-keys">${escH(isTouch ? t('Left side: move · ⤒ jump · ✋ push · drag on the right: camera') : t('WASD / arrows: move · Space: jump (twice for a double jump) · F: push · drag: turn the camera'))}</small>`);
    panel.querySelector('[data-a="resume"]').onclick = closeModal;
    panel.querySelector('[data-a="restart"]')?.addEventListener('click', () => { resetRun(); closeModal(); });
    panel.querySelector('[data-a="invite"]')?.addEventListener('click', () => opts.onInvite?.());
    panel.querySelector('[data-a="exit"]').onclick = () => opts.onExit?.();
    bindChars();
  }
  function showSoloWin() {
    const total = L.bolts.length;
    const stars = 1 + (stats.bolts === total ? 1 : 0) + (stats.falls === 0 ? 1 : 0);
    let best = null; try { best = JSON.parse(localStorage.getItem(BEST_KEY) || 'null'); } catch { /* */ }
    const record = !best || stats.time < best.time;
    if (record) try { localStorage.setItem(BEST_KEY, JSON.stringify({ time: stats.time, bolts: stats.bolts })); } catch { /* */ }
    openModal(`<h2>${escH(t('Fully charged!'))} ⚡</h2>
      <div class="pj-stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">⭐</span>`).join('')}</div>
      <p>${escH(t('Time'))} <b>${fmtTime(stats.time)}</b>${record ? ` <span class="pj-rec">${escH(t('New record!'))}</span>` : best ? ` <small>(${escH(t('Best'))} ${fmtTime(best.time)})</small>` : ''}<br>
      ⚡ <b>${stats.bolts}/${total}</b> · 💦 <b>${stats.falls}</b></p>
      <small>${escH(t('⭐ Finish · ⭐ All bolts · ⭐ No falls'))}</small>
      <button class="pj-btn primary" data-a="again">↺ ${escH(t('Play again'))}</button>
      <button class="pj-btn ghost" data-a="exit">🚪 ${escH(t('Exit game'))}</button>`, { pause: false });
    panel.querySelector('[data-a="again"]').onclick = () => { resetRun(); closeModal(); };
    panel.querySelector('[data-a="exit"]').onclick = () => opts.onExit?.();
  }
  function showResults(res) {
    const host = room?.hostId === opts.meId;
    openModal(`<h2>🏁 ${escH(t('Race {n} results', { n: res.round }))}</h2>
      <table class="pj-res"><thead><tr><th>#</th><th>${escH(t('Player'))}</th><th>${escH(t('Time'))}</th><th>💥</th><th>⚡</th></tr></thead><tbody>
      ${res.ranking.map((r, i) => `<tr class="${r.id === opts.meId ? 'me' : ''}"><td>${r.time != null ? ['🥇', '🥈', '🥉'][i] || i + 1 : '–'}</td><td>${escH(r.name)}</td><td>${r.time != null ? fmtTime(r.time / 1000) : escH(t('Did not finish'))}</td><td>${r.ko}</td><td>${r.bolts}</td></tr>`).join('')}
      </tbody></table>
      <small>${escH(t('💥 = friends you pushed into the sea'))}</small>
      ${host ? `<button class="pj-btn primary" data-a="again">🏁 ${escH(t('Race again'))}</button>` : ''}
      <button class="pj-btn ${host ? '' : 'primary'}" data-a="close">${escH(t('Play freely'))}</button>`, { pause: false });
    panel.querySelector('[data-a="again"]')?.addEventListener('click', () => { opts.send?.({ t: 'start' }); closeModal(); });
    panel.querySelector('[data-a="close"]').onclick = closeModal;
    if (res.ranking[0]?.id === opts.meId && res.ranking[0].time != null) { Sfx.play('win'); confetti(player.pos.clone().add(new V3(0, 2, 0)), 60); }
  }
  function reachGoal() {
    won = true; wonT = 0;
    Sfx.play('win');
    confetti(goal.pos.clone().add(new V3(0, 1.5, 0)));
    if (!multi) { setTimeout(() => { if (won) showSoloWin(); }, 1600); return; }
    if (raceState() === 'race' && !raceFinishedSent) { raceFinishedSent = true; opts.send?.({ t: 'finish', bolts: stats.bolts }); }
    else toast(`⚡ ${t('Fully charged!')} ${fmtTime(stats.time)}`);
  }

  // ---------------------------------------------------------------- camera
  function updateCamera(dt) {
    const gp = gamepad();
    if (gp) { cam.yaw -= gp.rx * 2.4 * dt; cam.pitch = clamp(cam.pitch + gp.ry * 1.6 * dt, 0.05, 1.15); }
    const p = player.pos;
    cam.target.x = damp(cam.target.x, p.x, 10, dt);
    cam.target.z = damp(cam.target.z, p.z, 10, dt);
    cam.target.y = damp(cam.target.y, p.y + 1, player.grounded ? 6 : 2.5, dt);
    const dist = cam.dist * (camera.aspect < 0.8 ? 1.2 : 1);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(cam.target.x - Math.sin(cam.yaw) * dist * cp, cam.target.y + dist * sp, cam.target.z - Math.cos(cam.yaw) * dist * cp);
    if (cam.shake > 0) {
      cam.shake -= dt;
      camera.position.x += (Math.random() - 0.5) * cam.shake * 0.8;
      camera.position.y += (Math.random() - 0.5) * cam.shake * 0.8;
    }
    camera.lookAt(cam.target);
    sky.position.copy(camera.position);
    sun.position.copy(p).add(SUN_OFFSET);
    sun.target.position.copy(p);
  }

  // ---------------------------------------------------------------- main loop
  resetRun();
  let acc = 0, last = performance.now(), raf = 0, destroyed = false;
  function frame() {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (paused) { renderer.render(scene, camera); return; }
    elapsed += dt;

    const gp = gamepad();
    if (gp && modal.hidden) {
      if (gp.jump && !gpJumpPrev) jumpQueued = true;
      if (gp.push && !gpPushPrev) pushQueued = true;
    }
    gpJumpPrev = !!gp?.jump; gpPushPrev = !!gp?.push;

    const inp = moveInput();
    const wt = worldTime();
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 8) { L.updatePlatforms(wt - (acc - STEP), STEP); stepPlayer(STEP, inp); acc -= STEP; steps++; }
    if (steps === 8) acc = 0;

    const p = player;
    if (!won && !frozen()) stats.time += dt;
    // bolts
    const c = tmp.copy(p.pos); c.y += 0.55;
    stats.comboT -= dt; if (stats.comboT <= 0) stats.combo = 0;
    for (const b of L.bolts) {
      if (b.taken || c.distanceTo(b.g.position) > 0.85) continue;
      b.taken = true; b.g.visible = false; stats.bolts++;
      sparkle(b.g.position.clone()); Sfx.play('bolt', Math.min(stats.combo, 12));
      stats.combo++; stats.comboT = 1.2;
      const el = q('[data-k="bolts"]'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
    // goal
    const ring = p.grounded && Math.hypot(p.pos.x - goal.pos.x, p.pos.z - goal.pos.z) < goal.radius && Math.abs(p.pos.y - goal.pos.y) < 0.5;
    if (ring && !inRing && !won) reachGoal();
    if (p.grounded || p.pos.y < goal.pos.y - 1) inRing = ring;
    if (won) {
      wonT += dt;
      if (!multi) p.yaw = dampAngle(p.yaw, Math.atan2(camera.position.x - p.pos.x, camera.position.z - p.pos.z), 4, dt);
      if (p.grounded && wonT % 1 < dt && wonT < 6) { p.vel.y = 6; p.grounded = false; p.ground = null; p.rig.setSquash(1.25); }
      if (multi && wonT > 6) won = false; // free play continues
    }
    // running dust
    const sp = Math.hypot(p.vel.x, p.vel.z);
    p.dustT -= dt;
    if (p.grounded && sp > 4 && p.dustT <= 0) { p.dustT = 0.14; spawn(p.pos.clone().setY(p.pos.y + 0.05), new V3(-p.vel.x * 0.1, 0.5, -p.vel.z * 0.1), 0xffffff, 0.4, 0.08, 0); }

    // player visuals
    const rig = p.rig;
    rig.root.position.copy(p.pos);
    rig.root.rotation.y = p.yaw;
    rig.root.visible = !(p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0);
    rig.update(dt, { speed: clamp(sp / MAX_SPEED, 0, 1), grounded: p.grounded, vy: p.vel.y, cheer: won ? 1 : 0, push: p.pushT > 0 ? 1 : 0, stun: p.stun > 0 ? 1 : 0 });
    const gb = groundBelow(p.pos.x, p.pos.z, p.pos.y);
    if (gb) {
      const h = p.pos.y - gb.y;
      blob.visible = true; blob.position.set(p.pos.x, gb.y + 0.02, p.pos.z);
      blob.scale.setScalar(clamp(1 - h * 0.08, 0.35, 1));
      blob.material.opacity = clamp(0.32 - h * 0.02, 0.1, 0.32);
    } else blob.visible = false;

    L.updateDecor(dt, elapsed);
    updateParticles(dt);
    updateNpcs(dt);
    updateRemotes(dt);
    updateCamera(dt);
    updateHud();
    if (multi) { updateCountdown(); sendState(dt); }
    renderer.render(scene, camera);
  }
  frame();
  canvas.focus({ preventScroll: true });
  // automated tests only: expose internals when the page set window.__PJ_DEBUG
  if (window.__PJ_DEBUG) window.__pj = { player, remotes, stats, cam, L, get room() { return room; }, push: () => { pushQueued = true; } };

  return {
    onNet,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
      Sfx.close();
      scene.traverse((o) => { o.geometry?.dispose?.(); });
      renderer.dispose();
      renderer.forceContextLoss();
      root.innerHTML = '';
    },
  };
}
