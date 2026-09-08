import * as THREE from 'three';
import { OBJECTS, ROOMS, OBSTACLES } from './world.js';
export function createScene(canvas, game) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); renderer.setClearColor(0x09151b); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x09151b, .033);
  const camera = new THREE.PerspectiveCamera(70, 1, .08, 200);
  scene.add(new THREE.HemisphereLight(0xc6e8e4, 0x21332b, 2.3));
  const sun = new THREE.DirectionalLight(0xffeed2, 2); sun.position.set(3, 8, 5); scene.add(sun);
  let group = null, room = '', meshes = new Map(), core = null;
  const material = (color, glow = false) => glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: .83, metalness: .2, flatShading: true });
  const box = (w, h, d, color, x, y, z, glow = false) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, glow)); m.position.set(x, y, z); group.add(m); return m; };
  function rebuild() {
    if (group) { scene.remove(group); group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    group = new THREE.Group(); scene.add(group); meshes = new Map(); core = null; room = game.state.room;
    const color = ROOMS[room].color, tint = new THREE.Color(color), dark = tint.clone().multiplyScalar(.22), wall = tint.clone().multiplyScalar(.4);
    scene.fog.color.set(room === 'greenhouse' ? 0x0a1510 : 0x09151b);
    box(14, .25, 14, dark, 0, -.15, 0); box(14, .3, 14, 0x152328, 0, 4.8, 0);
    for (const z of [-7, 7]) {
      if ((room === 'airlock' && z < 0) || (room === 'corridor' && z > 0)) {
        box(5.75, 4.8, .25, wall, -4.125, 2.4, z); box(5.75, 4.8, .25, wall, 4.125, 2.4, z); box(2.5, 1.3, .25, wall, 0, 4.15, z);
        box(2.5, .2, 5, dark, 0, -.1, z + Math.sign(z) * 2); box(2.5, 3.5, .1, 0x172e32, 0, 1.75, z + Math.sign(z) * 4);
      } else box(14, 4.8, .25, wall, 0, 2.4, z);
    }
    box(.25, 4.8, 14, wall, -7, 2.4, 0); box(.25, 4.8, 14, wall, 7, 2.4, 0);
    for (let i = -6; i <= 6; i += 3) {
      box(.1, 4.8, .16, 0x526464, i, 2.4, -6.84); box(.1, 4.8, .16, 0x526464, i, 2.4, 6.84);
      box(.12, .02, 14, 0x3b5353, i, .005, 0); box(14, .02, .04, 0x3b5353, 0, .005, i);
      box(.15, .15, 14, 0x385054, i, 4.5, 0);
      if (i % 2 === 0) box(.08, .025, 12, color, i, .02, 0, true);
    }
    for (const x of [-6.8, 6.8]) { box(.08, .12, 12, color, x, .35, 0, true); box(.1, .08, 11, color, x, 3.8, 0, true); }
    for (const z of [-4, 0, 4]) { box(5, .06, .25, room === 'greenhouse' ? 0x516c3e : 0xc8e5d9, 0, 4.6, z, true); }
    // Viewport: layered flat geometry forms a planet and a sparse, seeded star field.
    box(.08, 2.6, 5.5, 0x02090e, 6.82, 2.5, -2.9);
    const planet = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 2), material(0x6899a4)); planet.scale.set(.07, 1, 1); planet.position.set(6.73, 2.2, -3.8); group.add(planet);
    for (const [a, b, c] of game.stars) box(.015, .014 + a * .015, .025, 0xb3d0d3, 6.7, 1.4 + b * 2.2, -5.5 + c * 5, true);
    for (const z of [-5.75, -.1]) box(.25, 3, .15, 0x688483, 6.65, 2.5, z);
    box(.25, .15, 5.8, 0x688483, 6.65, 1.05, -2.9); box(.25, .15, 5.8, 0x688483, 6.65, 3.96, -2.9);
    for (const o of OBSTACLES[room] || []) { box(o.w, o.h, o.d, 0x5b6560, o.x, o.h / 2, o.z); box(o.w + .04, .1, o.d + .04, 0x829085, o.x, o.h - .12, o.z); box(.13, o.h, o.d + .03, 0x9d9e7d, o.x - o.w * .3, o.h / 2, o.z); }
    for (const o of OBJECTS[room]) {
      const start = group.children.length;
      if (o.kind === 'door' || o.kind === 'sealed') {
        const side = Math.abs(o.x) > 6; const w = o.w === 1 ? 2.35 : o.w;
        const door = box(side ? .3 : w, 3.25, side ? w : .3, 0x1d3034, o.x, 1.63, o.z);
        door.userData.arrivalPortal = (room === 'airlock' && o.id === 'airlock_door') || (room === 'corridor' && o.id === 'return');
        box(side ? .4 : w + .35, .2, side ? w + .35 : .4, color, o.x, 3.35, o.z);
        for (const edge of [-1, 1]) box(side ? .4 : .13, 3.4, side ? .13 : .4, 0x789391, o.x + (side ? 0 : edge * (w / 2 + .1)), 1.7, o.z + (side ? edge * (w / 2 + .1) : 0));
        box(side ? .4 : .025, 3, side ? .025 : .4, color, o.x, 1.5, o.z, true);
        box(side ? .5 : .3, .5, side ? .3 : .5, color, o.x + (side ? -.1 : .75), 1.3, o.z + (o.z < 0 ? .2 : -.2), true);
        if (room === 'reactor') { const overlap = door.clone(); overlap.material = material(0x733d4a); overlap.position.z += .00001; group.add(overlap); }
      } else if (o.kind === 'plant') {
        box(1.5, .55, 1.4, 0x303f32, o.x, .28, o.z); box(1.35, .05, 1.25, 0x18291b, o.x, .58, o.z);
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(.48, 0), material(0x719658)); leaf.scale.set(.7, 1.5, .7); leaf.position.set(o.x, 1.13, o.z); group.add(leaf);
        for (const direction of [-1, 1]) { const l = leaf.clone(); l.material = material(0x476c41); l.scale.set(.8, .5, .65); l.rotation.z = direction * .5; l.position.set(o.x + direction * .32, .95, o.z); group.add(l); }
        box(.15, .12, .1, 0x8fad7c, o.x, .4, o.z + .72, true);
      } else if (o.kind === 'card') box(o.w, o.h, o.d, 0xc8be88, o.x, o.y, o.z);
      else if (o.kind === 'vent') { box(o.w, o.h, .8, 0x10191b, o.x, o.y, o.z); for (let i = 0; i < 5; i++) box(o.w, .04, .85, 0x647577, o.x, .15 + i * .14, o.z); }
      else {
        if (o.kind !== 'pickup') { box(1.2, .9, .85, 0x263d3f, o.x, .45, o.z); box(1.3, .08, .95, 0x657b78, o.x, .92, o.z); }
        else { box(1, .7, .8, 0x33474a, o.x, .35, o.z); }
        const c = o.kind === 'log' ? 0xe2ce93 : o.kind === 'pickup' ? 0xaccbb5 : o.kind === 'lever' ? 0xd2a25f : color;
        box(o.w, o.h, o.d, c, o.x, o.y, o.z, o.kind !== 'pickup');
        if (o.kind === 'terminal' || o.kind === 'panel') { box(o.w * .82, o.h * .75, .04, 0x0e2626, o.x, o.y, o.z + o.d / 2 + .025); for (let i = 0; i < 3; i++) box(o.w * (.6 - i * .13), .035, .02, 0xa2d6bd, o.x - i * .06, o.y + .2 - i * .14, o.z + o.d / 2 + .05, true); }
      }
      meshes.set(o.id, group.children.slice(start));
    }
    if (room === 'reactor') { core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), material(0xedaf85, true)); core.position.set(0, 3.2, -2.5); group.add(core); const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, .065, 6, 32), material(0x90bbb5)); ring.position.copy(core.position); ring.rotation.x = .6; group.add(ring); }
    if (room === 'airlock') { for (const x of [-3, 3]) { box(.9, 1.1, 1.8, 0x344f51, x, .55, 2); box(.7, .1, 1.6, 0x718b86, x, 1.13, 2); } }
    if (room === 'power') for (const x of [-6, 6]) for (const z of [-4, 0, 3]) box(.6, 3, 1.5, 0x514642, x, 1.5, z);
    if (room === 'greenhouse') { // Deliberate unsupported floor patch behind the far planter.
      box(1.55, .03, 1.9, 0x030906, 6.1, .015, -6.05); scene.children[0].intensity = 1.05;
    } else scene.children[0].intensity = 2.3;
  }
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  return { render() { if (room !== game.state.room) rebuild(); for (const [id, list] of meshes) for (const m of list) m.visible = !game.removed.has(id) && (id !== 'bio_cell' || game.watered.length === 12) && !(m.userData.arrivalPortal && Math.abs(game.pos.x) < 2 && Math.abs(game.pos.z - m.position.z) < 3); camera.position.set(game.pos.x, game.pos.y, game.pos.z); camera.rotation.set(game.pitch, game.yaw, 0, 'YXZ'); if (core) { core.rotation.y = game.tick / 180; core.rotation.z = game.tick / 400; } renderer.render(scene, camera); } };
}
