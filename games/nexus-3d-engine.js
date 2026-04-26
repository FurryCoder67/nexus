// =============================================================================
// NEXUS 3D Engine — Advanced WebGL/Three.js Game Engine
// Provides 3D graphics, physics, audio, and multiplayer support for all games
// =============================================================================

class Nexus3D {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      antialias: true,
      shadows: true,
      fog: true,
      postProcessing: true,
      physics: true,
      audio: true,
      ...options
    };
    
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.physics = null;
    this.audio = null;
    this.composer = null;
    
    this.gameObjects = new Map();
    this.animations = [];
    this.particles = [];
    this.lights = [];
    
    this.clock = new THREE.Clock();
    this.deltaTime = 0;
    this.isRunning = false;
    
    this.init();
  }

  async init() {
    await this.loadThreeJS();
    this.setupRenderer();
    this.setupScene();
    this.setupCamera();
    this.setupLights();
    this.setupControls();
    
    if (this.options.physics) await this.setupPhysics();
    if (this.options.audio) this.setupAudio();
    if (this.options.postProcessing) this.setupPostProcessing();
    
    this.setupEventListeners();
    this.start();
  }

  async loadThreeJS() {
    // Load Three.js and essential addons
    if (!window.THREE) {
      await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
    }
    
    // Load additional Three.js modules
    await Promise.all([
      this.loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'),
      this.loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js'),
      this.loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js'),
      this.loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js'),
      this.loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js')
    ]);
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: this.options.antialias,
      alpha: true 
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = this.options.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    
    this.container.appendChild(this.renderer.domElement);
  }

  setupScene() {
    this.scene = new THREE.Scene();
    
    if (this.options.fog) {
      this.scene.fog = new THREE.Fog(0x000000, 10, 1000);
    }
    
    // Add environment
    this.scene.background = new THREE.Color(0x0a0a0a);
  }

  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      75, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      1000
    );
    this.camera.position.set(0, 5, 10);
  }

  setupLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    this.scene.add(ambientLight);
    
    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    this.scene.add(directionalLight);
    
    // Accent lights for atmosphere
    const purpleLight = new THREE.PointLight(0x7c3aed, 0.5, 50);
    purpleLight.position.set(-10, 5, -10);
    this.scene.add(purpleLight);
    
    const cyanLight = new THREE.PointLight(0x06b6d4, 0.5, 50);
    cyanLight.position.set(10, 5, 10);
    this.scene.add(cyanLight);
    
    this.lights = [ambientLight, directionalLight, purpleLight, cyanLight];
  }

  setupControls() {
    if (THREE.OrbitControls) {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
    }
  }

  async setupPhysics() {
    // Simple physics simulation
    this.physics = {
      gravity: new THREE.Vector3(0, -9.81, 0),
      bodies: [],
      
      addBody(mesh, mass = 1, type = 'dynamic') {
        const body = {
          mesh,
          mass,
          type,
          velocity: new THREE.Vector3(),
          acceleration: new THREE.Vector3(),
          forces: []
        };
        this.bodies.push(body);
        return body;
      },
      
      update(deltaTime) {
        this.bodies.forEach(body => {
          if (body.type === 'static') return;
          
          // Apply gravity
          body.acceleration.copy(this.gravity);
          
          // Apply forces
          body.forces.forEach(force => {
            body.acceleration.add(force.clone().divideScalar(body.mass));
          });
          
          // Update velocity and position
          body.velocity.add(body.acceleration.clone().multiplyScalar(deltaTime));
          body.mesh.position.add(body.velocity.clone().multiplyScalar(deltaTime));
          
          // Clear forces
          body.forces = [];
        });
      }
    };
  }

  setupAudio() {
    this.audio = {
      listener: new THREE.AudioListener(),
      sounds: new Map(),
      
      load(name, url) {
        const sound = new THREE.Audio(this.listener);
        const audioLoader = new THREE.AudioLoader();
        audioLoader.load(url, (buffer) => {
          sound.setBuffer(buffer);
          this.sounds.set(name, sound);
        });
      },
      
      play(name, volume = 1) {
        const sound = this.sounds.get(name);
        if (sound && !sound.isPlaying) {
          sound.setVolume(volume);
          sound.play();
        }
      },
      
      stop(name) {
        const sound = this.sounds.get(name);
        if (sound && sound.isPlaying) {
          sound.stop();
        }
      }
    };
    
    this.camera.add(this.audio.listener);
  }

  setupPostProcessing() {
    if (!THREE.EffectComposer) return;
    
    this.composer = new THREE.EffectComposer(this.renderer);
    
    const renderPass = new THREE.RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);
    
    if (THREE.UnrealBloomPass) {
      const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.5, 0.4, 0.85
      );
      this.composer.addPass(bloomPass);
    }
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.onWindowResize());
    
    // Keyboard input
    this.keys = {};
    window.addEventListener('keydown', (e) => this.keys[e.code] = true);
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    
    // Mouse input
    this.mouse = { x: 0, y: 0, buttons: {} };
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    window.addEventListener('mousedown', (e) => this.mouse.buttons[e.button] = true);
    window.addEventListener('mouseup', (e) => this.mouse.buttons[e.button] = false);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  // Game Object Management
  createGameObject(name, geometry, material, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    this.scene.add(mesh);
    this.gameObjects.set(name, mesh);
    
    return mesh;
  }

  getGameObject(name) {
    return this.gameObjects.get(name);
  }

  removeGameObject(name) {
    const obj = this.gameObjects.get(name);
    if (obj) {
      this.scene.remove(obj);
      this.gameObjects.delete(name);
    }
  }

  // Particle System
  createParticleSystem(config) {
    const particles = new THREE.BufferGeometry();
    const particleCount = config.count || 1000;
    
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * config.spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * config.spread;
      positions[i * 3 + 2] = (Math.random() - 0.5) * config.spread;
      
      const color = new THREE.Color(config.color || 0xffffff);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      
      sizes[i] = config.size || 1;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: config.size || 1,
      vertexColors: true,
      transparent: true,
      opacity: config.opacity || 0.8
    });
    
    const particleSystem = new THREE.Points(particles, material);
    this.scene.add(particleSystem);
    this.particles.push(particleSystem);
    
    return particleSystem;
  }

  // Animation System
  animate(object, property, to, duration = 1000, easing = 'easeInOut') {
    const from = object[property];
    const startTime = Date.now();
    
    const animation = {
      object,
      property,
      from: typeof from === 'object' ? from.clone() : from,
      to,
      duration,
      startTime,
      easing,
      active: true
    };
    
    this.animations.push(animation);
    return animation;
  }

  updateAnimations() {
    const now = Date.now();
    
    this.animations = this.animations.filter(anim => {
      if (!anim.active) return false;
      
      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);
      
      // Apply easing
      let easedProgress = progress;
      switch (anim.easing) {
        case 'easeIn':
          easedProgress = progress * progress;
          break;
        case 'easeOut':
          easedProgress = 1 - (1 - progress) * (1 - progress);
          break;
        case 'easeInOut':
          easedProgress = progress < 0.5 
            ? 2 * progress * progress 
            : 1 - 2 * (1 - progress) * (1 - progress);
          break;
      }
      
      // Update property
      if (typeof anim.from === 'object' && anim.from.lerp) {
        anim.object[anim.property].lerpVectors(anim.from, anim.to, easedProgress);
      } else {
        anim.object[anim.property] = anim.from + (anim.to - anim.from) * easedProgress;
      }
      
      return progress < 1;
    });
  }

  // Utility Methods
  createMaterial(type, options = {}) {
    switch (type) {
      case 'basic':
        return new THREE.MeshBasicMaterial(options);
      case 'lambert':
        return new THREE.MeshLambertMaterial(options);
      case 'phong':
        return new THREE.MeshPhongMaterial(options);
      case 'standard':
        return new THREE.MeshStandardMaterial(options);
      case 'physical':
        return new THREE.MeshPhysicalMaterial(options);
      default:
        return new THREE.MeshStandardMaterial(options);
    }
  }

  createGeometry(type, ...params) {
    switch (type) {
      case 'box':
        return new THREE.BoxGeometry(...params);
      case 'sphere':
        return new THREE.SphereGeometry(...params);
      case 'cylinder':
        return new THREE.CylinderGeometry(...params);
      case 'plane':
        return new THREE.PlaneGeometry(...params);
      case 'cone':
        return new THREE.ConeGeometry(...params);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  // Main Loop
  start() {
    this.isRunning = true;
    this.animate();
  }

  stop() {
    this.isRunning = false;
  }

  update() {
    this.deltaTime = this.clock.getDelta();
    
    if (this.controls) this.controls.update();
    if (this.physics) this.physics.update(this.deltaTime);
    
    this.updateAnimations();
    
    // Update particles
    this.particles.forEach(system => {
      if (system.material.uniforms && system.material.uniforms.time) {
        system.material.uniforms.time.value = this.clock.elapsedTime;
      }
    });
    
    // Call user update function if defined
    if (this.onUpdate) this.onUpdate(this.deltaTime);
  }

  render() {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  animate = () => {
    if (!this.isRunning) return;
    
    requestAnimationFrame(this.animate);
    this.update();
    this.render();
  }

  // Input Helpers
  isKeyPressed(key) {
    return !!this.keys[key];
  }

  isMouseButtonPressed(button) {
    return !!this.mouse.buttons[button];
  }

  getMousePosition() {
    return { x: this.mouse.x, y: this.mouse.y };
  }

  // Raycasting
  raycast(origin, direction, objects) {
    const raycaster = new THREE.Raycaster(origin, direction);
    return raycaster.intersectObjects(objects);
  }

  raycastFromCamera(objects) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.mouse, this.camera);
    return raycaster.intersectObjects(objects);
  }
}

// Export for use in games
window.Nexus3D = Nexus3D;