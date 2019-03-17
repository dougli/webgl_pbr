'use strict';

import * as THREE from '/js/node_modules/three/build/three.module.js';
import WebGL from '/js/WebGL.js';
import GLTFLoader from '/js/loaders/GLTFLoader.js';
import BufferGeometryUtils from '/js/utils/BufferGeometryUtils.js';

const CAMERA_ROTATE_SPEED = 1 / 200;
const CAMERA_PAN_SPEED = 1 / 600;

class Main {
  constructor() {
    this.mouseClicked = false;
    this.mousePrevPosition = new THREE.Vector2();

    this.cameraOffset = new THREE.Spherical(1, Math.PI * 0.5, 0);
    this.cameraLookAt = new THREE.Vector3();
  }

  run() {
    if (WebGL.isWebGL2Available() === false) {
      document.body.appendChild(WebGL.getWebGL2ErrorMessage());
      return;
    }

    this.scene = new THREE.Scene();

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    this.renderer = new THREE.WebGLRenderer({canvas, context});
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.gammaOutput = true;
    this.renderer.gammaFactor = 2.2;
    document.body.appendChild(this.renderer.domElement);

    const aspectRatio = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);

    this.loadShaders().then(() => {
      this.loadEnvironmentMap();
      this.loadModels();
    });
    this.addLights();
    this.addListeners();

    this.updateCamera();
    this.frame();
  }

  async loadShaders() {
    const [vertex, fragment] = await Promise.all([
      fetch('/shaders/StandardPBR.vert'),
      fetch('/shaders/StandardPBR.frag'),
    ]);

    if (!vertex.ok || !fragment.ok) {
      console.error('Failed to fetch shader, got ' + Response.status + ' error from server.');
      return;
    }

    const [
      vertexShader,
      fragmentShader,
      dummyDiffuse,
      dummyNormal,
    ] = await Promise.all([
      vertex.text(),
      fragment.text(),
      new Promise((resolve, reject) => {
        new THREE.TextureLoader().load('/images/1x1.png', resolve, () => {}, reject);
      }),
      new Promise((resolve, reject) => {
        new THREE.TextureLoader().load('/images/normal_1x1.png', resolve, () => {}, reject);
      }),
    ]);

    this.pbrShader = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: [
        '#version 300 es\n',
        THREE.ShaderChunk.common,
        THREE.ShaderChunk.lights_pars_begin,
        fragmentShader,
      ].join('\n'),
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib['lights'],
        {
          tDiffuse: new THREE.Uniform(dummyDiffuse),
          tNormal: new THREE.Uniform(dummyNormal),
          tMetallicRoughness: new THREE.Uniform(dummyDiffuse),
          roughness: new THREE.Uniform(0.5),
          metallicness: new THREE.Uniform(0.0),
        }
      ]),
      lights: true,
    });
  }

  loadEnvironmentMap() {
    const loader = new THREE.CubeTextureLoader();
    loader.setPath('/textures/Lycksele3/');
    const textureCube = loader.load([
      'posx.jpg', 'negx.jpg',
      'posy.jpg', 'negy.jpg',
      'posz.jpg', 'negz.jpg',
    ]);
    this.scene.background = textureCube;
  }

  async loadModels() {
    const models = [
      // '/models/head_lee_perry_smith',
      // '/models/gray_big_rock',
      '/models/mecha_04',
    ];

    for (const path of models) {
      this.loadModel(path).then((gltf) => {
        this.scene.add(gltf.scene);
      }, (error) => {
        console.error(error);
      });
    }
  }

  loadModel(gltfPath) {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(gltfPath + '/scene.gltf', (gltf) => {
        // Replace the default shader with ours
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const pbr = this.pbrShader.clone();
            const mat = object.material;

            if (mat.map) {
              mat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
              pbr.uniforms.tDiffuse = new THREE.Uniform(mat.map);
            } else {
              pbr.uniforms.tDiffuse.value.needsUpdate = true;
            }

            if (mat.normalMap) {
              if (object.geometry instanceof THREE.BufferGeometry) {
                const tangents = this.calculateTangents(object.geometry);
                object.geometry.addAttribute('tangent', tangents);
                pbr.uniforms.tNormal = new THREE.Uniform(mat.normalMap);
              } else if (object.geometry instanceof THREE.Geometry) {
                console.error('Ignoring normal maps loaded through Geometry object');
              }
            } else {
              pbr.uniforms.tNormal.value.needsUpdate = true;
            }

            pbr.uniforms.roughness = new THREE.Uniform(mat.roughness);
            pbr.uniforms.metallicness = new THREE.Uniform(mat.metalness);
            if (mat.roughnessMap) {
              pbr.uniforms.tMetallicRoughness = new THREE.Uniform(mat.roughnessMap);
            } else {
              pbr.uniforms.tMetallicRoughness.value.needsUpdate = true;
            }

            pbr.transparent = mat.transparent;
            pbr.side = mat.side;
            object.material = pbr;
          }
        });

        resolve(gltf);
      }, (xhr) => {
        console.log(gltfPath + ' ' + (xhr.loaded / xhr.total * 100) + '% loaded');
      }, (error) => {
        reject(error);
      });
    });
  }

  calculateTangents(geometry) {
    const tStart = new Date().getTime();

    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const indices = geometry.getIndex();

    const tangents = new THREE.BufferAttribute(
      new Float32Array(pos.array.length),
      3,
      false,
    );

    const bitangents = new THREE.BufferAttribute(
      new Float32Array(pos.array.length),
      3,
      false,
    );

    if (!indices) {
      console.error('Ignoring normal maps loaded without indices');
      return;
    }

    const tangent = new THREE.Vector3();
    for (let ii = 0; ii < indices.count; ii += 3) {
      const a = indices.array[ii], b = indices.array[ii + 1], c = indices.array[ii + 2];

      const dABx = pos.getX(b) - pos.getX(a);
      const dABy = pos.getY(b) - pos.getY(a);
      const dABz = pos.getZ(b) - pos.getZ(a);

      const dACx = pos.getX(c) - pos.getX(a);
      const dACy = pos.getY(c) - pos.getY(a);
      const dACz = pos.getZ(c) - pos.getZ(a);

      const dUVABx = uv.getX(b) - uv.getX(a);
      const dUVABy = uv.getY(b) - uv.getY(a);

      const dUVACx = uv.getX(c) - uv.getX(a);
      const dUVACy = uv.getY(c) - uv.getY(a);

      tangent.set(
        dUVACy * dABx - dUVABy * dACx,
        dUVACy * dABy - dUVABy * dACy,
        dUVACy * dABz - dUVABy * dACz,
      ).normalize();

      for (let idx of [a, b, c]) {
        tangents.setXYZ(
          idx,
          (tangents.getX(idx) + tangent.x),
          (tangents.getY(idx) + tangent.y),
          (tangents.getZ(idx) + tangent.z),
        );
      }
    }

    for (let jj = 0; jj < tangents.count; jj++) {
      tangent.set(tangents.getX(jj), tangents.getY(jj), tangents.getZ(jj)).normalize();
      tangents.setXYZ(jj, tangent.x, tangent.y, tangent.z);
    }
    return tangents;
  }

  addLights() {
    const light = new THREE.AmbientLight(0x010101);
    this.scene.add(light);

    const sunlight = new THREE.DirectionalLight(0xffffff, 1);
    sunlight.position.set(-10, 10, 10);
    this.scene.add(sunlight);
  }

  addListeners() {
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onMouseWheel);
    window.addEventListener('resize', this.onWindowResize);
  }

  onWindowResize = (event) => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  onMouseDown = (event) => {
    this.mouseClicked = true;
    this.mousePrevPosition.set(event.pageX, event.pageY);
  };

  onMouseUp = (event) => {
    this.mouseClicked = false;
  };

  onMouseMove = (event) => {
    if (this.mouseClicked) {
      const xDiff = this.mousePrevPosition.x - event.pageX;
      const yDiff = this.mousePrevPosition.y - event.pageY;
      if (event.altKey) {
        const cameraVector = new THREE.Vector3();
        cameraVector.setFromSpherical(this.cameraOffset);

        const right = cameraVector.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
        const up = cameraVector.clone().cross(right).normalize();
        const panSpeed = CAMERA_PAN_SPEED * this.cameraOffset.radius;
        this.cameraLookAt
          .sub(right.multiplyScalar(xDiff * panSpeed))
          .add(up.multiplyScalar(yDiff * panSpeed));
      } else {
        this.cameraOffset.phi += yDiff * CAMERA_ROTATE_SPEED;
        this.cameraOffset.theta += xDiff * CAMERA_ROTATE_SPEED;
        this.cameraOffset.makeSafe();
      }

      this.updateCamera();
      this.mousePrevPosition.set(event.pageX, event.pageY);
    }
  };

  onMouseWheel = (event) => {
    if (event.deltaY < 0) {
      // Zoom in
      this.cameraOffset.radius *= 0.8;
    } else if (event.deltaY > 0) {
      // Zoom out
      this.cameraOffset.radius *= 1.25;
    }
    this.updateCamera();
  };

  updateCamera() {
    this.camera.position
      .setFromSpherical(this.cameraOffset)
      .add(this.cameraLookAt);
    this.camera.lookAt(this.cameraLookAt);
  }

  frame = () => {
    requestAnimationFrame(this.frame);
    this.renderer.render(this.scene, this.camera);
  };
}

function main() {
  const m = new Main();
  m.run();
}

main();
