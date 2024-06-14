import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { StereoEffect } from './vendor/StereoEffects.js';
import { VRButton } from './vendor/VRButton.js';

const apertureInput = document.querySelector('#aperture');
const focusInput = document.querySelector('#focus');
const stInput = document.querySelector('#stplane');
const loadWrap = document.querySelector('#load-wrap');
const loadBtn = document.querySelector('#load');
const viewModeBtn = document.querySelector('#view-mode');
const gyroButton = document.querySelector('#gyro-button');


const scene = new THREE.Scene();
let width = window.innerWidth;
let height = window.innerHeight;
const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
const gyroCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);// 陀螺仪控制使用的相机
const renderer = new THREE.WebGLRenderer({ antialias: true });
let fragmentShader, vertexShader;
renderer.xr.enabled = true; // 启用WebXR
renderer.setSize(width, height);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

camera.position.z = 2;
gyroCamera.position.z = 2;
gyroCamera.lookAt(0, 0, 1); // 确保初始方向一致

const effect = new StereoEffect(renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target = new THREE.Vector3(0, 0, 1);
controls.panSpeed = 2;
controls.enabled = true; 

let useDeviceControls = false;
let fieldTexture;
let plane, planeMat, planePts;
const camsX = 17;
const camsY = 17;
const resX = 300;
const resY = 300;
const cameraGap = 0.08;
let aperture = Number(apertureInput.value);
let focus = Number(focusInput.value);
let isStereoView = true;
// 启用vconsole
const vConsole = new VConsole();

// 调整尺寸
window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  camera.aspect = width / height;
  gyroCamera.aspect = width / height;
  camera.updateProjectionMatrix();
  gyroCamera.updateProjectionMatrix();
  renderer.setSize(width, height);
  effect.setSize(width, height);
});
// 调整光圈
apertureInput.addEventListener('input', e => {
  aperture = Number(apertureInput.value);
  planeMat.uniforms.aperture.value = aperture;
});

// 调整焦距
focusInput.addEventListener('input', e => {
  focus = Number(focusInput.value);
  planeMat.uniforms.focus.value = focus;
});

// 点云可见不可见
stInput.addEventListener('input', () => {
  planePts.visible = stInput.checked;
});

// 加载按钮
loadBtn.addEventListener('click', async () => {
  loadBtn.setAttribute('disabled', true);
  await loadScene();
});

// 切换视图
viewModeBtn.addEventListener('click', () => {
  toggleViewMode();
});

function toggleViewMode() {
  isStereoView = !isStereoView;
  viewModeBtn.textContent = isStereoView ? 'Switch to Single View' : 'Switch to Left/Right View';
}
// 相机陀螺仪控制模式
gyroButton.addEventListener('click', () => {
  useDeviceControls = !useDeviceControls;
  if (useDeviceControls) {
    controls.enabled = false; // 禁用 OrbitControls
    initDeviceOrientationControls();
    console.log("陀螺仪模式已启动。");
  } else {
    controls.enabled = true; // 启用 OrbitControls
    disableDeviceOrientationControls();
    console.log("陀螺仪模式已关闭。");
  }
});

async function loadScene() {
  await loadShaders();
  initPlaneMaterial();
  await extractImages();
  loadPlane();
  animate();
}

// 调整vr视图
renderer.xr.addEventListener('sessionstart', () => {

  useDeviceControls = true;

  plane.position.set(0,0,-2)
  planePts.position.set(0, 1.6, -2.01);
  plane.updateMatrix();

  console.log('Plane position set to:', plane.position);
  console.log('PlanePts position set to:', planePts.position);
});

renderer.xr.addEventListener('sessionend', () => {
  scene.position.set(0,0,0);
});

// 加载着色器
async function loadShaders() {
  const [vertexShaderRes, fragmentShaderRes] = await Promise.all([
    fetch('./vertex.glsl'),
    fetch('./fragment.glsl')
  ]);
  vertexShader = await vertexShaderRes.text();
  fragmentShader = await fragmentShaderRes.text();
  console.log('Loaded shaders');
}

// 初始化平面
function initPlaneMaterial() {
  planeMat = new THREE.ShaderMaterial({
    uniforms: {
      field: { value: null }, // 初始化时设置为 null
      camArraySize: new THREE.Uniform(new THREE.Vector2(camsX, camsY)),
      aperture: { value: aperture },
      focus: { value: focus },
    },
    vertexShader,
    fragmentShader,
  });
}

// 处理图像
async function extractImages() {
  const loader = new THREE.ImageLoader();
  const images = []; // 用于存储加载的图像
  const numFrames = camsX * camsY; // 总帧数（不同位置相机拍摄的不同画面，一个相机拍一帧）
  let loadedCount = 0; // 已加载的图像数量
  for (let i = 0; i < numFrames; i++) {
    const imageUrl = `./frames/frame${i + 1}.png`;
    await new Promise((resolve, reject) => {
      loader.load(imageUrl, (image) => {
        images[i] = image;
        loadedCount++;
        loadBtn.textContent = `Loaded ${Math.round(100 * loadedCount / numFrames)}%`;
        resolve(); // promise已完成
      }, undefined, reject); // 加载失败调用reject
    });
  }

  loadWrap.style.display = 'none';

  // 创建纹理数组，分块处理，减少内存占用
  const chunkSize = 8; // 一次处理8个图像块
  const chunks = Math.ceil(numFrames / chunkSize);
  
  for (let c = 0; c < chunks; c++) {
    const start = c * chunkSize;
    const end = Math.min(start + chunkSize, numFrames);
    const canvas = document.createElement('canvas');// 处理图像数据时临时存储图像。canvas 提供了在浏览器中动态绘制和处理图像的能力
    canvas.width = resX;
    canvas.height = resY;
    const ctx = canvas.getContext('2d');

    for (let i = start; i < end; i++) {
      ctx.drawImage(images[i], 0, 0, resX, resY);// 将图像绘制到 canvas 上，方便获取图像的像素数据
      const imageData = ctx.getImageData(0, 0, resX, resY);// 从 canvas 中获取图像数据
      if (!fieldTexture) {
        // 创建 DataTexture2DArray
        fieldTexture = new THREE.DataTexture2DArray(
          new Uint8Array(resX * resY * 4 * numFrames), resX, resY, numFrames
        );
      }
      fieldTexture.image.data.set(imageData.data, i * resX * resY * 4);// 将像素数据复制到纹理数组
    }

    fieldTexture.needsUpdate = true;// 设置 needsUpdate 标志，以便 Three.js 在下一次渲染时更新纹理数据
    planeMat.uniforms.field.value = fieldTexture;// 将 fieldTexture 作为 uniform 传递给着色器，以便在着色器中使用
  }

  console.log('Loaded images');
}

// 加载平面
function loadPlane() {
  const planeGeo = new THREE.PlaneGeometry(camsX * cameraGap * 4, camsY * cameraGap * 4, camsX, camsY);
  const planePtsGeo = new THREE.PlaneGeometry(camsX * cameraGap * 2, camsY * cameraGap * 2, camsX, camsY);
  const ptsMat = new THREE.PointsMaterial({ size: 0.01, color: 0xeeccff });
  planePts = new THREE.Points(planePtsGeo, ptsMat);
  planePts.position.set(0,0,-0.01);
  planePts.visible = stInput.checked;
  plane = new THREE.Mesh(planeGeo, planeMat); // 使用之前定义的 planeMat
  scene.add(planePts);
  scene.add(plane);
  console.log('Loaded plane');
}

function animate() {
  renderer.setAnimationLoop(() => {
    let activeCamera = useDeviceControls ? gyroCamera : camera;

    if (!useDeviceControls) {
      controls.update();
    }
   // 加载立体视图
    if (isStereoView) {
      effect.setSize(window.innerWidth, window.innerHeight);
      effect.render(scene, activeCamera);
    } else {
      renderer.setSize(width, height);
      renderer.render(scene, activeCamera);
    }
  });
}

// 实现陀螺仪控制
let initialOrientation = null;

function initDeviceOrientationControls() {
  window.addEventListener('deviceorientation', handleDeviceOrientation);
}

// 取消陀螺仪控制
function disableDeviceOrientationControls() {
  window.removeEventListener('deviceorientation', handleDeviceOrientation);
  initialOrientation = null;
}

// 将获取的度数转为弧度
function handleDeviceOrientation(event) {
  const alpha = event.alpha ? THREE.MathUtils.degToRad(event.alpha) : 0;
  const beta = event.beta ? THREE.MathUtils.degToRad(event.beta) : 0;
  const gamma = event.gamma ? THREE.MathUtils.degToRad(event.gamma) : 0;

  if (!initialOrientation) {
    initialOrientation = { alpha, beta, gamma };
  }

  updateCameraOrientation(alpha, beta, gamma);
}

function updateCameraOrientation(alpha, beta, gamma) {
  const alphaOffset = initialOrientation ? alpha - initialOrientation.alpha : 0;
  const betaOffset = initialOrientation ? beta - initialOrientation.beta : 0;
  const gammaOffset = initialOrientation ? gamma - initialOrientation.gamma : 0;

  const euler = new THREE.Euler(betaOffset, alphaOffset, -gammaOffset, 'YXZ');
  gyroCamera.quaternion.setFromEuler(euler);
  gyroCamera.updateMatrixWorld(true); // 确保相机更新，正确接收参数
}