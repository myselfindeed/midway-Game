import * as THREE from 'three';
import { createFighter, createDestroyer, createCarrier, createOcean, createSky, createClouds } from './models.js';

const CRUISE = 28;
const BOOST = 48;
const TURN = 1.55;
const FIRE_RATE = 0.09;
const BULLET_SPEED = 90;
const LOCK_FOV = 0.42;
const LOCK_RANGE = 90;
const MISSILE_CD = 22;
const SHIELD_CD = 25;
const SHIELD_DURATION = 2;
const SHIELD_DR = 0.5;

export class Game {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.input = input;
    this.ui = ui;
    this.running = false;
    this.paused = false;

    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc5e4f6, 90, 380);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 800);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x9ecff0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    const hemi = new THREE.HemisphereLight(0xd7ecff, 0x1a3040, 1.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
    sun.position.set(30, 90, 40);
    this.scene.add(sun);
    // Fill light so fighter.png panel detail reads from chase cam
    const fill = new THREE.DirectionalLight(0xa8c8ff, 0.45);
    fill.position.set(-40, 30, -20);
    this.scene.add(fill);

    this.scene.add(createSky());
    this.scene.add(createClouds());
    this.ocean = createOcean();
    this.scene.add(this.ocean);

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

    this.shieldAura = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x3dffa8, transparent: true, opacity: 0.22, wireframe: true })
    );
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
      radius: 22,
      fireCd: 2.5,
      aaDamage: 6,
    };
    carrier.mesh.position.set(0, -17.2, -95);
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
      d.mesh.position.set(p.x, -17.2, p.z);
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

  /** Keep ship cards facing camera so destroyer/carrier.png 质感可读 */
  updateShipBillboards() {
    const cam = this.camera.position;
    for (const s of this.aliveShips()) {
      const p = s.mesh.position;
      s.mesh.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
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

  spawnWave(phase) {
    const count = phase === 'A' ? 6 : 6;
    // Between player start (z≈40) and fleet (z≈-130)
    const baseZ = phase === 'A' ? -35 : -55;
    for (let i = 0; i < count; i++) {
      const mesh = createFighter(0xc44a4a, true);
      const x = (i - (count - 1) / 2) * 14 + (Math.random() - 0.5) * 4;
      const y = 10 + Math.random() * 8;
      const z = baseZ - Math.random() * 35 - (phase === 'B' ? 25 : 0);
      mesh.position.set(x, y, z);
      const enemy = {
        mesh,
        hp: phase === 'A' ? 28 : 36,
        maxHp: phase === 'A' ? 28 : 36,
        yaw: Math.PI,
        t: Math.random() * Math.PI * 2,
        fireCd: 1 + Math.random(),
      };
      this.enemies.push(enemy);
      this.scene.add(mesh);
    }
  }

  loop = () => {
    this._raf = requestAnimationFrame(this.loop);
    if (!this.running || this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  update(dt) {
    this.updatePlayer(dt);
    this.updateShipBillboards();
    this.updateLock();
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateExplosions(dt);
    this.updateCamera(dt);
    this.ui.updateCds(this.player.missileCd, this.player.shieldCd, MISSILE_CD, SHIELD_CD);
    this.ui.updateHp(this.player.hp, this.player.maxHp);
    this.ui.setLock(!!this.locked);

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
    p.mesh.position.y = THREE.MathUtils.clamp(p.mesh.position.y, 4, 40);
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

  updateLock() {
    const origin = this.player.mesh.position;
    const forward = new THREE.Vector3(
      -Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * Math.cos(this.player.pitch)
    );
    let best = null;
    let bestScore = LOCK_FOV;
    for (const e of this.lockTargets()) {
      const to = e.mesh.position.clone().sub(origin);
      const dist = to.length();
      const minDist = e.radius ? e.radius * 0.35 : 2;
      const maxDist = e.kind === 'carrier' || e.kind === 'destroyer' ? LOCK_RANGE + 40 : LOCK_RANGE;
      if (dist > maxDist || dist < minDist) continue;
      to.normalize();
      const ang = 1 - forward.dot(to);
      // Prefer aircraft slightly when angles are close
      const bias = e.kind === 'carrier' || e.kind === 'destroyer' ? 0.04 : 0;
      if (ang + bias < bestScore) {
        bestScore = ang + bias;
        best = e;
      }
    }
    this.locked = best;
  }

  spawnBullet(fromMesh, dir, fromPlayer, damage) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, fromPlayer ? 2.4 : 1.4, 5),
      new THREE.MeshBasicMaterial({ color: fromPlayer ? 0xe8fbff : 0xff6666 })
    );
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.position.copy(fromMesh.position).addScaledVector(dir, 2.4);
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
      if (dist > 0.001) {
        toPlayer.normalize();
        e.mesh.position.addScaledVector(toPlayer, 10 * dt);
        e.mesh.position.x += Math.sin(e.t * 1.7) * 4 * dt;
        e.mesh.position.y = THREE.MathUtils.clamp(e.mesh.position.y + Math.cos(e.t) * 2 * dt, 5, 36);
        e.mesh.lookAt(playerPos);
      }
      e.fireCd -= dt;
      if (e.fireCd <= 0 && dist < 75) {
        this.spawnBullet(e.mesh, toPlayer, false, 8);
        e.fireCd = 1.4 + Math.random() * 0.8;
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
    const desired = p.mesh.position.clone().addScaledVector(back, 7.2);
    desired.y += 1.8;
    this.camera.position.lerp(desired, 0.12);
    const look = p.mesh.position.clone();
    look.y += 0.35;
    this.camera.lookAt(look);
  }
}
