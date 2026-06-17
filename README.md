# FlowVis Medical 🫁 🩸

**FlowVis Medical** is a high-performance, web-based 3D visualization tool designed for the interactive exploration of medical fluid dynamics. It allows researchers and clinicians to visualize organ geometries and complex flow data (streamlines) directly in the browser using `.vtp` (VTK XML PolyData) files.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Three.js](https://img.shields.io/badge/Three.js-r160-black.svg)
![vtk.js](https://img.shields.io/badge/vtk.js-latest-orange.svg)

## 🚀 Key Features

### 1. High-End Medical Visualization
- **Organ Rendering:** Visualize complex organ meshes with adjustable transparency to see internal flow patterns.
- **VTP Support:** Native support for modern XML-based VTK PolyData (`.vtp`), including support for triangle strips and scalar data.
- **Dynamic Centering:** Automatically fits the camera and controls to the bounding box of the uploaded data.

### 2. Advanced Flow Representation
- **Animated Glyphs:** High-performance instanced rendering of markers (Cones, Capsules, Spheres, Ribbons) that follow flow paths in real-time.
- **Streamline Styles:** Switch between classic 3D Tubes and technical Flat Ribbons.
- **Enhanced Organic Smoke:** A sophisticated particle-based "Gas Flow" effect featuring:
    - **Procedural Textures:** Soft, blended clouds for an organic look.
    - **Diffusion Logic:** Particles grow and dissipate over their lifecycle.
    - **Turbulence:** Simulated fluid drift for realistic motion.
    - **Data-Driven Colors:** Particles inherit scalar values (velocity/pressure) from the underlying VTP data.

### 3. Interactive Dashboard
- **Real-time Controls:** Adjust flow speed, glyph density, marker size, and tube radius on the fly.
- **Layer Management:** Toggle visibility of organ meshes, streamlines, and animation layers.
- **Glassmorphism UI:** A sleek, modern control panel with a scrollable interface for complex configurations.

## 🛠 Tech Stack

- **[Three.js](https://threejs.org/):** Core 3D engine for rendering and animation.
- **[vtk.js](https://kitware.github.io/vtk-js/):** Robust parsing and processing of VTK data formats.
- **[esm.sh / Skypack](https://esm.sh/):** Modern ES module delivery for high-performance dependency management.
- **Vanilla JavaScript & CSS:** Lightweight and fast implementation without heavy framework overhead.

## 📥 Installation & Usage

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/flowvis-medical.git
   cd flowvis-medical
   ```

2. **Run a local server:**
   Since the application uses ES modules and file readers, it must be served via HTTP. You can use any static server:
   ```bash
   # Using Python
   python3 -m http.server
   
   # Using Node.js (npx)
   npx serve .
   ```

3. **Open in Browser:**
   Navigate to `http://localhost:8000` (or the port provided by your server).

4. **Upload Data:**
   - Select an **Organ Mesh (.vtp)** to define the surgical/anatomical space.
   - Select **Streamlines (.vtp)** to visualize the fluid dynamics.
   - Use the sidebar to fine-tune the visualization.

## 🏗 Architecture (The 4-Layer Model)

1. **Data Layer:** Handles VTP parsing and conversion of VTK cell arrays into Three.js-compatible BufferGeometries.
2. **Engine Layer:** Manages the Three.js scene, camera, lighting, and the 60 FPS rendering loop.
3. **Pipeline Layer:** Generates geometry on-demand (Tubes, Ribbons, Particles) and handles the instanced animation engine.
4. **Control Layer:** Connects the HTML5 dashboard to the internal state, ensuring smooth real-time updates.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---
Developed with ❤️ for Medical Visualization.
