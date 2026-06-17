// Simple Mock for THREE.Vector3 to run in Node
class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x; this.y = y; this.z = z;
    }
    multiplyScalar(s) {
        this.x *= s; this.y *= s; this.z *= s;
        return this;
    }
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
}

function getVelocityAt(x, y, z) {
    const radial = Math.sqrt(x * x + z * z);
    if (radial === 0) return new Vector3(0, 0, 0);
    const vx = -z / radial;
    const vz = x / radial;
    const vy = Math.sin(radial * 0.5) * 0.5;
    const velocity = new Vector3(vx + x * 0.1, vy, vz + z * 0.1);
    const mag = Math.exp(-radial * 0.1) * 2;
    return velocity.multiplyScalar(mag);
}


function testDataLayer() {
    console.log("Testing Data Layer...");
    
    // Test 1: Origin should have zero velocity
    const v0 = getVelocityAt(0, 0, 0);
    if (v0.length() === 0) {
        console.log("✅ Test 1 Passed: Origin velocity is zero.");
    } else {
        console.error("❌ Test 1 Failed: Origin velocity should be zero.");
    }

    // Test 2: Symmetry check
    const v1 = getVelocityAt(5, 0, 0);
    const v2 = getVelocityAt(-5, 0, 0);
    if (Math.abs(v1.length() - v2.length()) < 0.001) {
        console.log("✅ Test 2 Passed: Radial symmetry maintained.");
    } else {
        console.error("❌ Test 2 Failed: Radial symmetry broken.");
    }

    // Test 3: Vertical component
    const v3 = getVelocityAt(2, 0, 2);
    if (Math.abs(v3.y - Math.sin(Math.sqrt(8) * 0.5) * 0.5 * Math.exp(-Math.sqrt(8) * 0.1) * 2) < 0.001) {
        console.log("✅ Test 3 Passed: Vertical component math correct.");
    } else {
        console.error("❌ Test 3 Failed: Vertical component math mismatch.");
    }
}

testDataLayer();
