export const ROOMS = {
  airlock: { name: 'Arrival airlock', sector: '01', color: 0x3a9390, subtitle: 'The silence after the signal.' },
  corridor: { name: 'Transit concourse', sector: '02', color: 0xc59149, subtitle: 'All paths lead inward.' },
  power: { name: 'Power distribution', sector: '03', color: 0xc96c45, subtitle: 'A spark is only the beginning.' },
  lab: { name: 'Research laboratory', sector: '04', color: 0x6a8ebc, subtitle: 'Something here is still listening.' },
  greenhouse: { name: 'Botanical reserve', sector: '05', color: 0x668e58, subtitle: 'Life finds a way to wait.' },
  reactor: { name: 'Reactor core', sector: '06', color: 0xb65865, subtitle: 'Bring us back to the light.' },
};
const obj = (id, label, x, z, kind = 'panel', extra = {}) => ({ id, label, x, z, y: 1.25, w: 1, h: 1, d: .55, kind, ...extra });
export const OBJECTS = {
  airlock: [obj('airlock_door', 'Open transit hatch', 0, -6.6, 'door', { w: 2.5, h: 3, y: 1.5 }), obj('early_log', 'Read expedition log', -4.5, -4, 'log'), obj('fuse', 'Take ceramic fuse', 4, -3, 'pickup', { y: 1, w: .45, h: .5 })],
  corridor: [obj('power_door', 'Power • access reader', -5, -6.6, 'door'), obj('lab_door', 'Research • access reader', -1.7, -6.6, 'door'), obj('greenhouse_door', 'Botanical reserve', 1.7, -6.6, 'door'), obj('reactor_door', 'Reactor • service lift', 5, -6.6, 'door'), obj('return', 'Arrival airlock', 0, 6.6, 'door'), obj('sealed', 'Decommissioned • welded shut', 6.6, 1, 'sealed'), obj('vent', 'Service duct', -6.4, 1, 'vent', { y: .45, h: .75 }), obj('speaker', 'Play maintenance recording', -5, -3, 'speaker'), obj('vent_lock', 'Duct access terminal', -6.1, 3.3), obj('keycard', '', 3.3, 1.85, 'card', { y: .12, w: .12, h: .06, d: .25, hidden: true }), obj('lab_log', 'Read laboratory memo', 4.6, -2.5, 'log')],
  power: [obj('return', 'Transit concourse', 0, 6.6, 'door'), obj('fuse_socket', 'Distribution fuse socket', -3, -4.5), obj('breaker', 'Main breaker', 3, -4.5, 'lever'), obj('wire', 'Take copper conductor', 4, 0, 'pickup', { w: .6, h: .3, y: 1 }), obj('power_log', 'Read service notes', -4, 0, 'log')],
  lab: [obj('return', 'Transit concourse', 0, 6.6, 'door'), obj('lab_socket', 'Auxiliary fuse receptacle', -4, -4.5), obj('terminal', 'Station control terminal', 0, -4.5, 'terminal'), obj('casing', 'Take regulator housing', 4, -3, 'pickup', { w: .6, h: .4, y: 1 }), obj('lab_notes', 'Read research notes', -4, 0, 'log')],
  greenhouse: [obj('return', 'Transit concourse', 0, 6.6, 'door'), obj('grow_log', 'Read botanical care notice', -5, 3, 'log'), ...Array.from({ length: 12 }, (_, i) => obj(`plant_${i}`, 'Irrigate specimen', -4.5 + (i % 4) * 3, -4 + Math.floor(i / 4) * 3, 'plant', { y: .9, w: .9, h: 1.4 })), obj('bio_cell', 'Collect bioelectric cell', 5.8, 4.5, 'pickup', { y: 1, w: .6, h: .7 })],
  reactor: [obj('return', 'Transit lift', 0, 6.6, 'door'), obj('regulator', 'Install reactor regulator', -4, -3.5), obj('sequence', 'Reactor ignition terminal', 0, -4.8, 'terminal'), obj('calibrate', 'Calibrate', 4, -3.5), obj('ignite', 'Ignite core', 0, -1, 'lever')],
};
export const OBSTACLES = { corridor: [{ x: 3.3, z: 2.8, w: 1.8, d: 1.6, h: 1.5 }], power: [{ x: 0, z: 0, w: 2, d: 2, h: 1.1 }], lab: [{ x: 3, z: 1, w: 2.5, d: 1.4, h: 1.1 }] };
export const LOGS = {
  early_log: ['Expedition log / 014', 'The old core speaks in colors. Cold comes before life; life comes before heat. The service palette assigns cold to BLUE, life to GREEN, and heat to RED. Convert those colors using the original bus index: RED = 1, GREEN = 2, BLUE = 3. I left the start order with the arrival crew. — Chief engineer Imani'],
  lab_log: ['Research access / memorandum', 'Laboratory authorization: 7319. The distribution circuit must be bridged before the station controller can restore power. Keep the ceramic fuse for the distribution room.'],
  power_log: ['Distribution / service notes', 'Fit the ceramic fuse into the distribution socket, then engage the main breaker. The lab controller handles final station energization. A copper conductor and regulator housing can be combined into a replacement reactor regulator.'],
  lab_notes: ['Research / 062', 'After station power returns, irrigate all twelve botanical specimens. The mature reserve yields the bioelectric cell needed for reactor ignition. Combine the regulator components in your inventory.'],
  grow_log: ['Botanical reserve / night cycle', 'Low illumination is intentional: these specimens require a dark growth cycle. Irrigate each of the twelve planters, then collect the bioelectric cell from the extraction pedestal.'],
};
