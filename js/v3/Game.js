import * as THREE from 'three';
import { createFighter, createDestroyer, createCarrier, createOcean, createSky, createClouds, createIsland } from './models.js';

const CRUISE = 28;
const BOOST = 48;
const TURN = 1.55;
const FIRE_RATE = 0.09;
const BULLET_SPEED = 90;
const GUN_RANGE = 130;
const MISSILE_CD = 22;
const SHIELD_CD = 25;
const SHIELD_DURATION = 2;
const SHIELD_DR = 0.5;
const OPEN_RANGE = CRUISE * 12;
const CONE = THREE.MathUtils.degToRad(120);
const APPROACH = 14;

export class Game {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.input = input;
    this.ui = ui;
    this.running = false;
    this.paused = false;

    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 30000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x4ea0ea);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x1d4e86, 1.35);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
    sun.position.set(30, 90, 40);
    this.scene.add(sun);
    // Fill light so fighter.png panel detail reads from chase cam
    const fill = new THREE.DirectionalLight(0xa8c8ff, 0.45);
    fill.position.set(-40, 30, -20);
    this.scene.add(fill);

    this.sky = createSky();
    this.scene.add(this.sky);
    this.clouds = createClouds();
    this.scene.add(this.clouds);
    this.ocean = createOcean();
    this.scene.add(this.ocean);
    this.landChunks = new Map();
    this.landChunkKey = '';

    this.player = {
      mesh: createFighter(0x4aa3ff, false),
      hp: 100,
      maxHp: 100,
      yaw: 0,
      pitch: 0,
      speed: CRUISE,
      fireCd: 0,
      missileCd: 0,
      shieldCd: 0,
      shieldT: 0,
      invuln: 0,
    };
    this.player.mesh.position.set(0, 14, 40);
    this.scene.add(this.player.mesh);

    this.shieldMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vPos;
        void main() {
          float lat = abs(fract(vPos.y * 1.7 + uTime * 0.35) - 0.5);
          float lon = abs(fract(vPos.x * 1.5 - uTime * 0.22) - 0.5);
          float net = smoothstep(0.07, 0.0, min(lat, lon));
          float flow = smoothstep(0.55, 1.0, sin(vPos.y * 9.0 - uTime * 7.5) * sin(vPos.x * 7.0 + uTime * 5.0));
          float arc = smoothstep(0.82, 1.0, sin(vPos.z * 16.0 + uTime * 18.0));
          float a = net * (0.28 + flow * 0.85) + arc * 0.75;
          vec3 col = mix(vec3(0.25, 0.85, 1.0), vec3(0.9, 1.0, 1.0), max(flow, arc));
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.shieldAura = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.45, 28, 18), this.shieldMat);
    const net = new THREE.Mesh(
      new THREE.SphereGeometry(2.48, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x8af4ff, wireframe: true, transparent: true, opacity: 0.4 })
    );
    this.shieldAura.add(shell);
    this.shieldAura.add(net);
    this.shieldAura.visible = false;
    this.player.mesh.add(this.shieldAura);

    this.enemies = [];
    this.ships = [];
    this.bullets = [];
    this.missiles = [];
    this.explosions = [];
    this.locked = null;
    this.spawnFleet();

    this.phase = 'A';
    this.kills = 0;
    this.killTarget = 6;
    this.checkpoint = 'start';
    this.ended = false;
    this.elapsed = 0;
    this._raf = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  resetToCheckpoint() {
    this.ended = false;
    if (this.checkpoint === 'start') this.elapsed = 0;
    this.clearCombatants(false);
    this.player.hp = this.player.maxHp;
    this.player.yaw = 0;
    this.player.pitch = 0;
    this.player.speed = CRUISE;
    this.player.fireCd = 0;
    this.player.missileCd = 0;
    this.player.shieldCd = 0;
    this.player.shieldT = 0;
    this.player.invuln = 1.2;
    this.player.mesh.position.set(0, 14, 40);
    this.player.mesh.rotation.set(0, 0, 0);
    this.locked = null;
    this.restoreFleet();

    if (this.checkpoint === 'cp1') {
      this.phase = 'B';
      this.kills = 6;
      this.killTarget = 12;
      this.spawnWave('B');
    } else {
      this.phase = 'A';
      this.kills = 0;
      this.killTarget = 6;
      this.spawnWave('A');
    }
    this.ui.updateMission(this.kills, this.killTarget, this.phase);
    this.ui.updateHp(this.player.hp, this.player.maxHp);
  }

  spawnFleet() {
    this.clearFleet();

    const carrier = {
      kind: 'carrier',
      mesh: createCarrier(),
      hp: 400,
      maxHp: 400,
      radius: 40,
      fireCd: 2.5,
      aaDamage: 6,
    };
    carrier.mesh.position.set(0, -18, -110);
    this.ships.push(carrier);
    this.scene.add(carrier.mesh);

    const escorts = [
      { x: -32, z: -78 },
      { x: 36, z: -88 },
    ];
    for (const p of escorts) {
      const d = {
        kind: 'destroyer',
        mesh: createDestroyer(),
        hp: 160,
        maxHp: 160,
        radius: 10,
        fireCd: 1.2 + Math.random(),
        aaDamage: 9,
      };
      d.mesh.position.set(p.x, -18, p.z);
      this.ships.push(d);
      this.scene.add(d.mesh);
    }
  }

  clearFleet() {
    for (const s of this.ships) this.scene.remove(s.mesh);
    this.ships.length = 0;
  }

  restoreFleet() {
    // Recreate so sunk ships return on checkpoint / retry
    this.spawnFleet();
  }

  aliveShips() {
    return this.ships.filter((s) => s.hp > 0);
  }

  lockTargets() {
    return [...this.enemies, ...this.aliveShips()];
  }

  chunkHash(ix, iz, salt) {
    let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ salt;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  /** Keep a ring of island patches around the player. Old patches drop off behind. */
  updateLand() {
    const CHUNK = 280;
    const RING = 2;
    const p = this.player.mesh.position;
    const cx = Math.floor(p.x / CHUNK);
    const cz = Math.floor(p.z / CHUNK);
    const key = `${cx},${cz}`;
    if (key === this.landChunkKey) return;
    this.landChunkKey = key;
    const need = new Set();
    for (let dz = -RING; dz <= RING; dz++) {
      for (let dx = -RING; dx <= RING; dx++) need.add(`${cx + dx},${cz + dz}`);
    }
    const drop = [];
    for (const [k, group] of this.landChunks) {
      if (!need.has(k)) drop.push([k, group]);
    }
    for (const [k, group] of drop) {
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          if (obj.material.normalMap) obj.material.normalMap.dispose();
          obj.material.dispose();
        }
      });
      this.landChunks.delete(k);
    }
    for (const k of need) {
      if (this.landChunks.has(k)) continue;
      const [ix, iz] = k.split(',').map(Number);
      if (this.chunkHash(ix, iz, 3) > 0.55) {
        this.landChunks.set(k, new THREE.Group());
        continue;
      }
      const x = (ix + 0.5) * CHUNK + (this.chunkHash(ix, iz, 1) - 0.5) * CHUNK * 0.5;
      const z = (iz + 0.5) * CHUNK + (this.chunkHash(ix, iz, 2) - 0.5) * CHUNK * 0.5;
      const nearFleet = Math.hypot(x, z + 110) < 130;
      if (nearFleet) {
        this.landChunks.set(k, new THREE.Group());
        continue;
      }
      const radius = 26 + this.chunkHash(ix, iz, 4) * 22;
      const island = createIsland(x, z, radius);
      this.scene.add(island);
      this.landChunks.set(k, island);
    }
  }

  updateShipBillboards() {
    if (!this.clouds) return;
    this.clouds.position.x = this.player.mesh.position.x;
    this.clouds.position.z = this.player.mesh.position.z;
    for (const cloud of this.clouds.children) {
      cloud.lookAt(this.camera.position);
    }
  }

  startLevel() {
    this.checkpoint = 'start';
    this.resetToCheckpoint();
    this.running = true;
    this.paused = false;
    this.clock.start();
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  setPaused(v) {
    this.paused = v;
    if (!v && this.running) this.clock.getDelta();
  }

  clearCombatants(keepPlayer = true) {
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies.length = 0;
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.bullets.length = 0;
    for (const m of this.missiles) this.scene.remove(m.mesh);
    this.missiles.length = 0;
    for (const x of this.explosions) this.scene.remove(x.mesh);
    this.explosions.length = 0;
    if (!keepPlayer) {
      /* player stays */
    }
  }

  playerForward() {
    const yaw = this.player.yaw;
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  spawnWave(phase) {
    const count = 1;
    const origin = this.player.mesh.position;
    const fwd = this.playerForward();
    const half = CONE * 0.5;
    for (let i = 0; i < count; i++) {
      const slot = count === 1 ? 0 : -half + (i / (count - 1)) * CONE;
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), slot);
      const mesh = createFighter(0xc44a4a, true);
      mesh.position.set(
        origin.x + dir.x * OPEN_RANGE,
        origin.y + (i - (count - 1) / 2) * 1.8,
        origin.z + dir.z * OPEN_RANGE
      );
      mesh.lookAt(origin.x, origin.y, origin.z);
      mesh.rotateY(Math.PI);
      const enemy = {
        mesh,
        hp: phase === 'A' ? 28 : 36,
        maxHp: phase === 'A' ? 28 : 36,
        slot,
        hold: OPEN_RANGE,
        t: Math.random() * Math.PI * 2,
        fireCd: 6 + Math.random() * 2,
      };
      this.enemies.push(enemy);
      this.scene.add(mesh);
    }
  }

  loop = () => {
    this._raf = requestAnimationFrame(this.loop);
    if (!this.running || this.paused) {
      this.ui.setEngine(false);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    if (this.ocean?.material?.uniforms?.uTime) {
      this.ocean.material.uniforms.uTime.value = this.elapsed;
      this.ocean.material.uniforms.uCam.value.copy(this.camera.position);
    }
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  update(dt) {
    this.updatePlayer(dt);
    this.updateLand();
    this.updateShipBillboards();
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateExplosions(dt);
    this.updateCamera(dt);
    this.updateAim();
    this.ui.updateCds(this.player.missileCd, this.player.shieldCd, MISSILE_CD, SHIELD_CD);
    this.ui.updateHp(this.player.hp, this.player.maxHp);
    this.ui.updateFlight(this.player.speed, this.player.mesh.position.y, this.elapsed);
    this.ui.setEngine(true, this.player.speed);

    if (!this.ended && this.player.hp <= 0) {
      this.ended = true;
      this.running = false;
      this.ui.onDefeat(this.checkpoint);
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    const ax = this.input.axis.x;
    const ay = this.input.axis.y;

    p.yaw -= ax * TURN * dt;
    p.pitch = THREE.MathUtils.clamp(p.pitch - ay * TURN * 0.85 * dt, -0.55, 0.55);

    p.speed = this.input.boosting ? BOOST : CRUISE;
    const forward = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch)
    );
    p.mesh.position.addScaledVector(forward, p.speed * dt);
    // Soft sea avoidance only. No ceiling, so climbing does not hit a wall.
    if (p.mesh.position.y < -8) {
      const depth = -8 - p.mesh.position.y;
      p.mesh.position.y += depth * Math.min(1, dt * 2.4);
    }
    if (p.mesh.position.y < -15) p.mesh.position.y = -15;
    if (this.ocean) {
      this.ocean.position.x = p.mesh.position.x;
      this.ocean.position.z = p.mesh.position.z;
    }
    p.mesh.rotation.order = 'YXZ';
    p.mesh.rotation.y = p.yaw;
    p.mesh.rotation.x = p.pitch;
    p.mesh.rotation.z = THREE.MathUtils.clamp(-ax * 0.45, -0.5, 0.5);

    p.fireCd = Math.max(0, p.fireCd - dt);
    p.missileCd = Math.max(0, p.missileCd - dt);
    p.shieldCd = Math.max(0, p.shieldCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    if (p.shieldT > 0) {
      p.shieldT = Math.max(0, p.shieldT - dt);
      this.shieldAura.visible = true;
      this.shieldMat.uniforms.uTime.value = this.elapsed;
    } else {
      this.shieldAura.visible = false;
    }

    if (this.input.firing && p.fireCd <= 0) {
      this.spawnBullet(p.mesh, forward, true, 12);
      p.fireCd = FIRE_RATE;
      this.ui.playSfx('shoot');
    }

    if (this.input.consumeMissile() && p.missileCd <= 0 && this.locked) {
      this.spawnMissile(this.locked);
      p.missileCd = MISSILE_CD;
      this.ui.playSfx('missile');
    }

    if (this.input.consumeShield() && p.shieldCd <= 0) {
      p.shieldT = SHIELD_DURATION;
      p.shieldCd = SHIELD_CD;
      this.ui.playSfx('shield');
    }

    this.ui.setSkillDisabled(p.missileCd > 0, p.shieldCd > 0);

    const exhaust = p.mesh.getObjectByName('exhaust');
    if (exhaust) {
      const boost = this.input.boosting ? 1.45 : 1;
      const pulse = 0.82 + Math.sin(performance.now() * 0.02) * 0.18;
      exhaust.scale.set(boost, boost * pulse, boost);
    }
  }

  updateAim() {
    const origin = this.player.mesh.position;
    let best = null;
    let bestDist = GUN_RANGE;
    for (const e of this.enemies) {
      const dist = e.mesh.position.distanceTo(origin);
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    const self = this.projectScreen(origin);
    const lead = { x: self.x, y: Math.max(72, self.y - 210) };
    if (!best) {
      this.locked = null;
      this.ui.setAim({ state: 'idle', frameX: lead.x, frameY: lead.y });
      return;
    }
    const projected = this.projectScreen(best.mesh.position);
    const inside = projected.inFront
      && Math.abs(projected.x - lead.x) < 48
      && Math.abs(projected.y - lead.y) < 48;
    if (inside) {
      this.locked = best;
      this.ui.setAim({ state: 'aimed', frameX: lead.x, frameY: lead.y });
    } else {
      this.locked = null;
      this.ui.setAim({
        state: 'track',
        frameX: lead.x,
        frameY: lead.y,
        x: projected.x,
        y: projected.y,
        behind: !projected.inFront,
      });
    }
  }

  projectScreen(world) {
    const camFwd = new THREE.Vector3();
    this.camera.getWorldDirection(camFwd);
    const to = world.clone().sub(this.camera.position);
    const inFront = camFwd.dot(to) > 0;
    const ndc = world.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      inFront,
      x: (ndc.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-ndc.y * 0.5 + 0.5) * rect.height + rect.top,
    };
  }

  spawnBullet(fromMesh, dir, fromPlayer, damage) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, fromPlayer ? 2.4 : 1.4, 5),
      new THREE.MeshBasicMaterial({ color: fromPlayer ? 0xe8fbff : 0xff6666 })
    );
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.position.copy(fromMesh.position).addScaledVector(dir, 3.15);
    this.scene.add(mesh);
    this.bullets.push({
      mesh,
      vel: dir.clone().multiplyScalar(BULLET_SPEED),
      life: 1.6,
      fromPlayer,
      damage,
    });
  }

  spawnMissile(targetEnemy) {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb347 })
    );
    mesh.position.copy(this.player.mesh.position);
    this.scene.add(mesh);
    this.missiles.push({
      mesh,
      target: targetEnemy,
      speed: 70,
      life: 4,
      damage: 55,
    });
  }

  updateEnemies(dt) {
    const playerPos = this.player.mesh.position;
    for (const e of this.enemies) {
      e.t += dt;
      const toPlayer = playerPos.clone().sub(e.mesh.position);
      const dist = toPlayer.length();
      e.hold = Math.max(52, (e.hold ?? OPEN_RANGE) - APPROACH * dt);
      const dir = this.playerForward().applyAxisAngle(new THREE.Vector3(0, 1, 0), e.slot || 0);
      const desired = playerPos.clone().addScaledVector(dir, e.hold);
      desired.y = playerPos.y + Math.sin(e.t * 0.7) * 2.2;
      const toSlot = desired.sub(e.mesh.position);
      const gap = toSlot.length();
      if (gap > 0.2) {
        toSlot.multiplyScalar(1 / gap);
        const speed = THREE.MathUtils.clamp(gap * 1.25, 18, 40);
        e.mesh.position.addScaledVector(toSlot, speed * dt);
      }
      if (e.mesh.position.y < -12) e.mesh.position.y = -12;
      e.mesh.lookAt(playerPos);
      e.mesh.rotateY(Math.PI);
      e.fireCd -= dt;
      if (e.fireCd <= 0 && dist < 78) {
        const shot = playerPos.clone().sub(e.mesh.position);
        if (shot.lengthSq() > 0.01) {
          this.spawnBullet(e.mesh, shot.normalize(), false, 8);
          e.fireCd = 1.5 + Math.random() * 0.8;
        }
      }
    }

    // Ship AA — fire upward at player when in range
    for (const s of this.aliveShips()) {
      s.fireCd -= dt;
      const toPlayer = playerPos.clone().sub(s.mesh.position);
      const dist = toPlayer.length();
      const range = s.kind === 'carrier' ? 95 : 70;
      if (s.fireCd <= 0 && dist < range) {
        toPlayer.normalize();
        const muzzle = { position: s.mesh.position.clone() };
        muzzle.position.y = -12;
        this.spawnBullet(muzzle, toPlayer, false, s.aaDamage);
        s.fireCd = s.kind === 'carrier' ? 1.8 + Math.random() : 1.1 + Math.random() * 0.6;
      }
    }
  }

  hitRadius(target) {
    return target.radius || 2.2;
  }

  updateProjectiles(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      if (b.fromPlayer) {
        for (const e of this.lockTargets()) {
          if (b.mesh.position.distanceTo(e.mesh.position) < this.hitRadius(e)) {
            this.damageTarget(e, b.damage);
            hit = true;
            break;
          }
        }
      } else if (this.player.invuln <= 0 && b.mesh.position.distanceTo(this.player.mesh.position) < 1.5) {
        this.damagePlayer(b.damage);
        hit = true;
      }
      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      if (!m.target || m.target.hp <= 0) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
        continue;
      }
      const dir = m.target.mesh.position.clone().sub(m.mesh.position).normalize();
      m.mesh.position.addScaledVector(dir, m.speed * dt);
      m.mesh.lookAt(m.target.mesh.position);
      if (m.mesh.position.distanceTo(m.target.mesh.position) < this.hitRadius(m.target)) {
        // Hellfire bonus vs ships
        const bonus = m.target.kind === 'destroyer' || m.target.kind === 'carrier' ? 1.6 : 1;
        this.damageTarget(m.target, m.damage * bonus);
        this.spawnExplosion(m.target.mesh.position.clone());
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      } else if (m.life <= 0) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }

  damageTarget(e, dmg) {
    if (e.kind === 'destroyer' || e.kind === 'carrier') {
      this.damageShip(e, dmg);
      return;
    }
    e.hp -= dmg;
    if (e.hp <= 0) {
      this.spawnExplosion(e.mesh.position.clone());
      this.scene.remove(e.mesh);
      const idx = this.enemies.indexOf(e);
      if (idx >= 0) this.enemies.splice(idx, 1);
      if (this.locked === e) this.locked = null;
      this.kills += 1;
      this.ui.playSfx('explode');
      this.ui.updateMission(this.kills, this.killTarget, this.phase);
      this.checkPhase();
    }
  }

  damageShip(s, dmg) {
    if (s.hp <= 0) return;
    s.hp -= dmg;
    if (s.hp <= 0) {
      s.hp = 0;
      this.spawnExplosion(s.mesh.position.clone().setY(-16));
      this.spawnExplosion(s.mesh.position.clone().add(new THREE.Vector3(4, 1, -3)));
      this.scene.remove(s.mesh);
      if (this.locked === s) this.locked = null;
      this.ui.playSfx('explode');
      const label = s.kind === 'carrier' ? '航母重创沉没！' : '驱逐舰击沉！';
      this.ui.flashSubtitle(`${label}（关卡1额外战果，通关仍以击落敌机为准）`, 3200);
    }
  }

  damagePlayer(dmg) {
    let d = dmg;
    if (this.player.shieldT > 0) d *= 1 - SHIELD_DR;
    this.player.hp = Math.max(0, this.player.hp - d);
    this.ui.playSfx('hit');
    this.player.invuln = 0.35;
  }

  checkPhase() {
    if (this.phase === 'A' && this.kills >= 6) {
      this.checkpoint = 'cp1';
      this.phase = 'B';
      this.killTarget = 12;
      this.ui.onCheckpoint();
      this.spawnWave('B');
      this.ui.updateMission(this.kills, this.killTarget, this.phase);
    } else if (this.phase === 'B' && this.kills >= 12 && !this.ended) {
      this.ended = true;
      this.running = false;
      this.ui.onVictory();
    } else if (!this.ended) {
      this.spawnWave(this.phase);
    }
  }

  spawnExplosion(pos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff9944, transparent: true, opacity: 0.9 })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.explosions.push({ mesh, life: 0.45, age: 0 });
  }

  updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const x = this.explosions[i];
      x.age += dt;
      const t = x.age / x.life;
      x.mesh.scale.setScalar(1 + t * 3.5);
      x.mesh.material.opacity = Math.max(0, 1 - t);
      if (t >= 1) {
        this.scene.remove(x.mesh);
        this.explosions.splice(i, 1);
      }
    }
  }

  updateCamera() {
    const p = this.player;
    const back = new THREE.Vector3(
      Math.sin(p.yaw) * Math.cos(p.pitch),
      -Math.sin(p.pitch) * 0.35 + 0.35,
      Math.cos(p.yaw) * Math.cos(p.pitch)
    );
    const desired = p.mesh.position.clone().addScaledVector(back, 7.6);
    desired.y += 3.1;
    this.camera.position.lerp(desired, 0.12);
    const look = p.mesh.position.clone();
    look.y -= 0.55;
    this.camera.lookAt(look);
    if (this.sky) this.sky.position.copy(this.camera.position);
  }
}
