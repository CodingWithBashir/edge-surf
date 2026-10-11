/**
 * Procedural surfer + surfboard.
 *
 * No external models: the whole character is generated from primitives, merged
 * per body part and parented into a small skeleton that `Player` animates with
 * plain rotations. Colours come from the character / board definitions in
 * Content.js, so cosmetics are a data change rather than new assets.
 */

import * as THREE from 'three';
import { part, mergeParts, propMaterial, paint } from './GeometryUtils.js';

const QUALITY_SEGMENTS = {
  low: { radial: 6, sphere: [7, 5], boardCurve: 6 },
  medium: { radial: 8, sphere: [10, 7], boardCurve: 10 },
  high: { radial: 12, sphere: [14, 10], boardCurve: 18 },
};

/** Surfboard outline (nose points toward -Z once baked). */
function boardShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.25);
  shape.bezierCurveTo(0.3, 1.05, 0.345, 0.45, 0.315, 0.05);
  shape.lineTo(0.315, -0.55);
  shape.bezierCurveTo(0.3, -0.95, 0.2, -1.18, 0, -1.25);
  shape.bezierCurveTo(-0.2, -1.18, -0.3, -0.95, -0.315, -0.55);
  shape.lineTo(-0.315, 0.05);
  shape.bezierCurveTo(-0.345, 0.45, -0.3, 1.05, 0, 1.25);
  return shape;
}

function buildBoard(board, quality) {
  const seg = QUALITY_SEGMENTS[quality] ?? QUALITY_SEGMENTS.high;
  const parts = [];

  const deck = new THREE.ExtrudeGeometry(boardShape(), {
    depth: 0.11,
    bevelEnabled: true,
    bevelThickness: 0.032,
    bevelSize: 0.045,
    bevelSegments: 2,
    curveSegments: seg.boardCurve,
  });
  deck.rotateX(-Math.PI / 2);
  parts.push(paint(deck, board.rail));

  // Top laminate slightly inset so the rail colour reads as an outline.
  const top = new THREE.ExtrudeGeometry(boardShape(), {
    depth: 0.03,
    bevelEnabled: false,
    curveSegments: seg.boardCurve,
  });
  top.rotateX(-Math.PI / 2);
  top.scale(0.92, 1, 0.92);
  top.translate(0, 0.115, 0);
  parts.push(paint(top, board.body));

  // Decoration depending on board style.
  const decoParts = [];
  if (board.style === 'stripe') {
    const stripe = new THREE.BoxGeometry(0.1, 0.02, 2.1);
    decoParts.push(paint(stripe, board.stripe));
  } else if (board.style === 'gradient') {
    const panel = new THREE.ExtrudeGeometry(boardShape(), { depth: 0.02, bevelEnabled: false, curveSegments: seg.boardCurve });
    panel.rotateX(-Math.PI / 2);
    panel.scale(0.42, 1, 0.72);
    decoParts.push(paint(panel, board.stripe));
  } else if (board.style === 'bolt') {
    for (let i = 0; i < 3; i++) {
      const bolt = new THREE.BoxGeometry(0.2, 0.02, 0.5);
      bolt.translate((i - 1) * 0.09, 0, 0.45 - i * 0.45);
      bolt.rotateY(0.5 - i * 0.5);
      decoParts.push(paint(bolt, board.stripe));
    }
  } else if (board.style === 'scale') {
    for (let i = 0; i < 7; i++) {
      const scale = new THREE.ConeGeometry(0.14, 0.24, 3);
      scale.rotateX(Math.PI / 2);
      scale.translate(0, 0, 0.95 - i * 0.3);
      decoParts.push(paint(scale, board.stripe));
    }
  }
  for (const geometry of decoParts) {
    geometry.translate(0, 0.13, 0);
    parts.push(geometry);
  }

  // Fins.
  const finMaterial = [];
  for (let i = -1; i <= 1; i++) {
    const fin = new THREE.ConeGeometry(0.09, 0.28, 4);
    fin.rotateX(Math.PI);
    fin.translate(i * 0.17, -0.13, -0.92);
    fin.rotateY(i * 0.22);
    finMaterial.push(paint(fin, board.rail));
  }
  parts.push(...finMaterial);

  return mergeParts(parts);
}

function buildHair(style, color, quality) {
  const seg = QUALITY_SEGMENTS[quality] ?? QUALITY_SEGMENTS.high;
  const parts = [];
  const sphere = (r) => new THREE.SphereGeometry(r, seg.sphere[0], seg.sphere[1]);

  switch (style) {
    case 'long': {
      parts.push(part(sphere(0.205), color, { position: [0, 0.03, -0.01], scale: [1, 1.05, 1.08] }));
      parts.push(part(sphere(0.17), color, { position: [0, -0.16, 0.09], scale: [1, 1.3, 0.85] }));
      break;
    }
    case 'bun': {
      parts.push(part(sphere(0.2), color, { position: [0, 0.03, 0], scale: [1, 1, 1.05] }));
      parts.push(part(new THREE.SphereGeometry(0.12, seg.sphere[0], seg.sphere[1]), color, { position: [0, 0.19, -0.09] }));
      break;
    }
    case 'cap': {
      parts.push(part(sphere(0.215), color, { position: [0, 0.05, 0], scale: [1, 0.85, 1] }));
      parts.push(part(new THREE.CylinderGeometry(0.29, 0.29, 0.035, seg.radial), color, { position: [0, 0.02, 0.16] }));
      break;
    }
    case 'ponytail': {
      parts.push(part(sphere(0.205), color, { position: [0, 0.04, 0], scale: [1, 1, 1.05] }));
      parts.push(
        part(new THREE.CylinderGeometry(0.075, 0.045, 0.5, seg.radial), color, {
          position: [0, -0.1, 0.2],
          rotation: [0.5, 0, 0],
        })
      );
      break;
    }
    default: {
      parts.push(part(sphere(0.2), color, { position: [0, 0.035, 0], scale: [1, 0.95, 1.05] }));
      break;
    }
  }
  return mergeParts(parts);
}

/**
 * Build the full surfer rig.
 * @param {{character:any, board:any, quality?:'low'|'medium'|'high'}} spec
 */
export function buildSurfer({ character, board, quality = 'high' }) {
  const seg = QUALITY_SEGMENTS[quality] ?? QUALITY_SEGMENTS.high;
  const material = propMaterial({ roughness: 0.62, flatShading: true });
  const geometries = [];

  const root = new THREE.Group();
  root.name = 'surfer';

  /* ------------------------------ board ------------------------------ */
  const boardGeometry = buildBoard(board, quality);
  const boardMesh = new THREE.Mesh(boardGeometry, material);
  boardMesh.name = 'board';
  geometries.push(boardGeometry);
  root.add(boardMesh);

  /* ------------------------------- body ------------------------------ */
  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'bodyRoot';
  root.add(bodyRoot);

  // Hips anchor every limb so a single rotation crouches the whole body.
  const hips = new THREE.Group();
  hips.position.set(0, 0.74, 0);
  hips.name = 'hips';
  bodyRoot.add(hips);

  // Torso (wetsuit) with a contrast band.
  const torsoParts = [
    part(new THREE.CapsuleGeometry(0.19, 0.34, 4, seg.radial), character.wetsuit, {
      position: [0, 0.3, 0.01],
      scale: [1.12, 1, 0.82],
    }),
    part(new THREE.CapsuleGeometry(0.2, 0.16, 4, seg.radial), character.wetsuitAlt, {
      position: [0, 0.14, 0.02],
      scale: [1.1, 1, 0.84],
    }),
    // Chest highlight.
    part(new THREE.BoxGeometry(0.24, 0.1, 0.02), character.board, { position: [0, 0.36, -0.16] }),
  ];
  const torsoGeometry = mergeParts(torsoParts);
  const torso = new THREE.Mesh(torsoGeometry, material);
  torso.name = 'torso';
  geometries.push(torsoGeometry);
  hips.add(torso);

  // Head + hair.
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.62, 0.02);
  headGroup.name = 'head';
  hips.add(headGroup);

  const headGeometry = mergeParts([
    part(new THREE.SphereGeometry(0.185, seg.sphere[0], seg.sphere[1]), character.skin, { scale: [1, 1.08, 1.02] }),
    part(new THREE.SphereGeometry(0.035, 6, 5), 0x1b2a33, { position: [-0.07, 0.02, -0.16] }),
    part(new THREE.SphereGeometry(0.035, 6, 5), 0x1b2a33, { position: [0.07, 0.02, -0.16] }),
  ]);
  const head = new THREE.Mesh(headGeometry, material);
  geometries.push(headGeometry);
  headGroup.add(head);

  const hairGeometry = buildHair(character.hairStyle, character.hair, quality);
  const hair = new THREE.Mesh(hairGeometry, material);
  geometries.push(hairGeometry);
  headGroup.add(hair);

  /* ------------------------------ limbs ------------------------------- */
  const limb = (radius, length, color, scale) => {
    const geometry = new THREE.CapsuleGeometry(radius, length, 3, seg.radial);
    if (scale) geometry.scale(scale[0], scale[1], scale[2]);
    return paint(geometry, color);
  };

  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.215, 0.5, 0);
    const geometry = limb(0.072, 0.4, character.wetsuit);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.24;
    shoulder.add(mesh);
    // Hand.
    const handGeometry = paint(new THREE.SphereGeometry(0.078, seg.sphere[0], seg.sphere[1]), character.skin);
    const hand = new THREE.Mesh(handGeometry, material);
    hand.position.y = -0.48;
    shoulder.add(hand);
    geometries.push(geometry, handGeometry);
    return shoulder;
  };

  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.155, 0.0, 0);
    hip.rotation.x = 0.5;

    const thighGeometry = limb(0.098, 0.34, character.wetsuitAlt);
    const thigh = new THREE.Mesh(thighGeometry, material);
    thigh.position.y = -0.21;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    knee.rotation.x = -1.0;
    hip.add(knee);

    const shinGeometry = limb(0.082, 0.32, character.wetsuitAlt);
    const shin = new THREE.Mesh(shinGeometry, material);
    shin.position.y = -0.2;
    knee.add(shin);

    const footGeometry = paint(new THREE.BoxGeometry(0.13, 0.08, 0.32), character.skin, 1);
    const foot = new THREE.Mesh(footGeometry, material);
    foot.position.set(0, -0.4, 0.06);
    knee.add(foot);

    geometries.push(thighGeometry, shinGeometry, footGeometry);
    return { hip, knee, foot };
  };

  const armL = makeArm(-1);
  const armR = makeArm(1);
  hips.add(armL, armR);

  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  hips.add(legL.hip, legR.hip);

  // Stance: arms out for balance, feet staggered like a real surfer.
  const stance = {
    armL: { z: -1.02, x: -0.35 },
    armR: { z: 1.02, x: -0.28 },
    legFront: 0.5,
    legBack: -1.0,
  };

  const rig = {
    root,
    board: boardMesh,
    bodyRoot,
    hips,
    torso,
    head: headGroup,
    hair,
    armL,
    armR,
    legL,
    legR,
    stance,
    material,
    geometries,
    /** Rest pose used to blend animations. */
    rest: {
      hipsY: hips.position.y,
      torsoX: 0,
      headX: 0,
      armLz: stance.armL.z,
      armRz: stance.armR.z,
      armLx: stance.armL.x,
      armRx: stance.armR.x,
      legLx: 0.5,
      legRx: 0.5,
      kneeLx: -1.0,
      kneeRx: -1.0,
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };

  applyPose(rig, rig.rest);
  return rig;
}

/** Write a pose onto the rig (used for the rest pose and for blending). */
export function applyPose(rig, pose) {
  rig.hips.position.y = pose.hipsY;
  rig.torso.rotation.x = pose.torsoX;
  rig.head.rotation.x = pose.headX;
  rig.armL.rotation.z = pose.armLz;
  rig.armR.rotation.z = pose.armRz;
  rig.armL.rotation.x = pose.armLx;
  rig.armR.rotation.x = pose.armRx;
  rig.legL.hip.rotation.x = pose.legLx;
  rig.legR.hip.rotation.x = pose.legRx;
  rig.legL.knee.rotation.x = pose.kneeLx;
  rig.legR.knee.rotation.x = pose.kneeRx;
}

/** Low-detail silhouette used for the character-select swatches. */
export function boardSwatch(board) {
  return { body: `#${board.body.toString(16).padStart(6, '0')}`, stripe: `#${board.stripe.toString(16).padStart(6, '0')}`, rail: `#${board.rail.toString(16).padStart(6, '0')}` };
}
