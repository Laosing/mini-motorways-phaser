import { Scene } from "phaser";
import { EventBus } from "../EventBus";
import { Building } from "../Building";
import { House } from "../House";
import { Worker } from "../Worker";
import { Path } from "../Path";
import { Roundabout } from "../Roundabout";

export class Game extends Scene {
    camera: Phaser.Cameras.Scene2D.Camera;
    background: Phaser.GameObjects.Image;
    gameText: Phaser.GameObjects.Text;
    controls?: Phaser.Types.Input.Keyboard.CursorKeys;

    public buildings: Building[] = [];
    public houses: House[] = [];
    public roundabouts: Roundabout[] = [];
    private workers: Worker[] = [];
    
    private placementMode: "ROAD" | "ROUNDABOUT" = "ROAD";
    private isDrawing: boolean = false;
    private isDeleting: boolean = false;
    private shadowPath: Phaser.GameObjects.Rectangle | null = null;
    private shadowLine: Phaser.GameObjects.Line | null = null;
    private shadowRoundabout: Phaser.GameObjects.Graphics | null = null;
    private dragStartGrid: { x: number, y: number } | null = null;
    private lastSpawnTime: number = 0; // For worker spawning
    private lastStructureSpawnTime: number = 0; // For houses/buildings
    private isSpawningPaused: boolean = false;
    private structureSpawnCounter: number = 0;
    private colorPalette: number[] = [
        0xef4444, // Red
        0x3b82f6, // Blue
        0xfacc15, // Yellow
        0x10b981, // Green
        0xa855f7, // Purple
    ];
    public workerGrid: Map<string, Worker[]> = new Map();
    public structureGrid: Map<string, Building | House> = new Map();

    constructor() {
        super("Game");
    }

    create() {
        this.camera = this.cameras.main;
        this.camera.setBackgroundColor("#779944"); // Warm earthy base (match tiny-yurts #794)

        // Disable right-click context menu
        this.input.mouse?.disableContextMenu();

        // Add game grid
        this.add
            .grid(
                0,
                0,
                1024,
                768,
                Building.GRID_SIZE,
                Building.GRID_SIZE,
                0x000000,
                0.1,
            )
            .setDepth(0)
            .setOrigin(0, 0);

        Path.init(this);

        // Random initial placement
        this.spawnRandomStructure();

        if (this.input.keyboard) {
            this.controls = this.input.keyboard.addKeys({
                up: Phaser.Input.Keyboard.KeyCodes.W,
                down: Phaser.Input.Keyboard.KeyCodes.S,
                left: Phaser.Input.Keyboard.KeyCodes.A,
                right: Phaser.Input.Keyboard.KeyCodes.D,
            }) as Phaser.Types.Input.Keyboard.CursorKeys;
        }

        this.input.on(
            "wheel",
            (
                _pointer: Phaser.Input.Pointer,
                _gameObjects: any,
                _deltaX: number,
                deltaY: number,
                _deltaZ: number,
            ) => {
                const zoomSpeed = 0.001;
                const newZoom = this.camera.zoom - deltaY * zoomSpeed;
                this.camera.setZoom(Phaser.Math.Clamp(newZoom, 0.1, 4));
            },
        );

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            const worldPointer = this.camera.getWorldPoint(pointer.x, pointer.y);
            const gx = Math.floor(worldPointer.x / Building.GRID_SIZE);
            const gy = Math.floor(worldPointer.y / Building.GRID_SIZE);

            if (pointer.leftButtonDown()) {
                if (this.placementMode === "ROAD") {
                    const isOccupiedByStructure = this.isGridOccupied(gx, gy);
                    const house = this.getHouseAt(gx, gy);
                    
                    if (isOccupiedByStructure && !house) return;

                    this.isDrawing = true;
                    this.isDeleting = false;
                    this.dragStartGrid = { x: gx, y: gy };
                    
                    this.updateShadowPath(gx, gy);
                    if (!isOccupiedByStructure) {
                        this.addPathAtGrid(gx, gy);
                    }
                } else if (this.placementMode === "ROUNDABOUT") {
                    const offset = Math.floor(Roundabout.SIZE / 2);
                    this.placeRoundabout(gx - offset, gy - offset);
                }
            } else if (pointer.rightButtonDown()) {
                this.isDeleting = true;
                this.isDrawing = false;
                this.removePathAtGrid(gx, gy);
            }
        });

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            const worldPointer = this.camera.getWorldPoint(pointer.x, pointer.y);
            const gx = Math.floor(worldPointer.x / Building.GRID_SIZE);
            const gy = Math.floor(worldPointer.y / Building.GRID_SIZE);

            // Always update the shadow highlight
            this.updateShadowPath(gx, gy);

            if (this.isDrawing && this.dragStartGrid) {
                const dx = gx - this.dragStartGrid.x;
                const dy = gy - this.dragStartGrid.y;

                // Stop if we moved too far (more than 1 cell in any direction)
                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                    return;
                }

                if (gx !== this.dragStartGrid.x || gy !== this.dragStartGrid.y) {
                    // Check if we are dragging out of a house to rotate it
                    const startHouse = this.getHouseAt(this.dragStartGrid.x, this.dragStartGrid.y);
                    if (startHouse) {
                        const dx = gx - this.dragStartGrid.x;
                        const dy = gy - this.dragStartGrid.y;
                        let dir: any = null;

                        if (dx > 0 && dy === 0) dir = "right";
                        else if (dx < 0 && dy === 0) dir = "left";
                        else if (dx === 0 && dy > 0) dir = "down";
                        else if (dx === 0 && dy < 0) dir = "up";
                        else if (dx > 0 && dy > 0) dir = "down-right";
                        else if (dx > 0 && dy < 0) dir = "up-right";
                        else if (dx < 0 && dy > 0) dir = "down-left";
                        else if (dx < 0 && dy < 0) dir = "up-left";
                        
                        if (dir) {
                            // Only rotate if the target grid cell is clear of other houses/buildings
                            if (!this.isGridOccupied(gx, gy, false)) {
                                // Diagonal clipping check for house driveway
                                let canRotate = true;
                                if (dir.includes("-")) { // Diagonal directions have '-' like 'up-left'
                                    if (this.isGridOccupied(startHouse.gridX, gy) || 
                                        this.isGridOccupied(gx, startHouse.gridY)) {
                                        canRotate = false;
                                    }
                                }
                                
                                if (canRotate) {
                                    startHouse.setDirection(dir);
                                }
                            }
                        }
                    }

                    if (!this.isGridOccupied(gx, gy) && this.isPastHalfwayInto(worldPointer, this.dragStartGrid, { x: gx, y: gy })) {
                        this.addPathAtGrid(gx, gy);
                        this.dragStartGrid = { x: gx, y: gy };
                    }
                }
            } else if (this.isDeleting) {
                this.removePathAtGrid(gx, gy);
            }
        });

        this.input.on("pointerup", () => {
            this.isDrawing = false;
            this.isDeleting = false;
            this.dragStartGrid = null;
            if (this.shadowPath) this.shadowPath.setVisible(false);
            if (this.shadowLine) this.shadowLine.setVisible(false);
        });

        EventBus.emit("current-scene-ready", this);
    }

    private updateShadowPath(gx: number, gy: number) {
        if (!this.shadowPath) {
            this.shadowPath = this.add.rectangle(0, 0, Building.GRID_SIZE, Building.GRID_SIZE, 0xdca26f, 0.2);
            this.shadowPath.setOrigin(0, 0);
            this.shadowPath.setDepth(2);
        }

        if (this.placementMode === "ROUNDABOUT") {
            if (!this.shadowRoundabout) {
                this.shadowRoundabout = this.add.graphics();
                this.shadowRoundabout.setDepth(2.5);
            }
            this.shadowRoundabout.clear();
            
            const offset = Math.floor(Roundabout.SIZE / 2);
            const tgx = gx - offset;
            const tgy = gy - offset;
            
            const size = Roundabout.SIZE * Building.GRID_SIZE;
            const canPlace = Roundabout.canPlaceAt(this, tgx, tgy);
            
            // Draw the roundabout ghost centered
            this.shadowRoundabout.setPosition(tgx * Building.GRID_SIZE, tgy * Building.GRID_SIZE);
            Roundabout.draw(this.shadowRoundabout, size, 0.5);
            
            // Add a red/green overlay to indicate valid placement
            this.shadowRoundabout.fillStyle(canPlace ? 0x00ff00 : 0xff0000, 0.2);
            this.shadowRoundabout.fillRect(0, 0, size, size);
            
            this.shadowRoundabout.setVisible(true);
            if (this.shadowPath) this.shadowPath.setVisible(false);
            if (this.shadowLine) this.shadowLine.setVisible(false);
            return;
        }

        if (this.shadowRoundabout) this.shadowRoundabout.setVisible(false);

        // ROAD mode
        this.shadowPath.setSize(Building.GRID_SIZE, Building.GRID_SIZE);
        this.shadowPath.setFillStyle(0xdca26f, 0.2);
        this.shadowPath.setPosition(gx * Building.GRID_SIZE, gy * Building.GRID_SIZE);
        const occupied = this.isGridOccupied(gx, gy);
        // Show hover highlight even if occupied (subtle hint of where the mouse is)
        this.shadowPath.setVisible(true);
        if (occupied) {
            this.shadowPath.setFillStyle(0xff0000, 0.1); // Light red for occupied
        } else {
            this.shadowPath.setFillStyle(0xdca26f, 0.3); // Normal road color
        }

        // Add a line connecting drag start to current shadow
        if (this.dragStartGrid) {
            if (!this.shadowLine) {
                this.shadowLine = this.add.line(0, 0, 0, 0, 0, 0, 0xdca26f, 0.5);
                this.shadowLine.setLineWidth(12);
                this.shadowLine.setDepth(2);
                this.shadowLine.setAlpha(0.5);
            }
            const x1 = (this.dragStartGrid.x + 0.5) * Building.GRID_SIZE;
            const y1 = (this.dragStartGrid.y + 0.5) * Building.GRID_SIZE;
            const x2 = (gx + 0.5) * Building.GRID_SIZE;
            const y2 = (gy + 0.5) * Building.GRID_SIZE;
            this.shadowLine.setTo(x1, y1, x2, y2);
            this.shadowLine.setVisible(!occupied);
        }
    }

    private placeRoundabout(gx: number, gy: number) {
        if (Roundabout.canPlaceAt(this, gx, gy)) {
            const rb = new Roundabout(this, gx, gy);
            this.roundabouts.push(rb);
            
            // Mark as occupied in structure grid
            for (let ox = 0; ox < Roundabout.SIZE; ox++) {
                for (let oy = 0; oy < Roundabout.SIZE; oy++) {
                    this.structureGrid.set(`${gx + ox},${gy + oy}`, rb as any);
                }
            }
            
            // Re-render paths to show connectivity
            Path.render();
            
            // Switch back to ROAD mode after placement (optional, Mini Motorways does this)
            this.setPlacementMode("ROAD");
        }
    }

    public setPlacementMode(mode: "ROAD" | "ROUNDABOUT") {
        this.placementMode = mode;
        if (this.shadowPath) this.shadowPath.setVisible(false);
        if (this.shadowLine) this.shadowLine.setVisible(false);
        if (this.shadowRoundabout) this.shadowRoundabout.setVisible(false);
        this.dragStartGrid = null;
        this.isDrawing = false;
        
        // Notify UI if needed via EventBus
        EventBus.emit("placement-mode-changed", mode);
    }

    private getHouseAt(gx: number, gy: number): House | undefined {
        return this.houses.find(h => {
            const hw = Math.floor(h.width / 32);
            const hh = Math.floor(h.height / 32);
            return gx >= h.gridX && gx < h.gridX + hw && gy >= h.gridY && gy < h.gridY + hh;
        });
    }

    private isGridOccupied(gx: number, gy: number, includePaths: boolean = false): boolean {
        const structure = this.structureGrid.get(`${gx},${gy}`);
        
        if (includePaths) {
            return !!structure || Path.isAt(gx, gy);
        }

        // Roundabouts don't block road placement
        if (structure instanceof Roundabout) {
            return false;
        }

        return !!structure;
    }

    private isPastHalfwayInto(pointer: { x: number, y: number }, from: { x: number, y: number }, to: { x: number, y: number }): boolean {
        const centerX = (from.x + 0.5) * Building.GRID_SIZE;
        const centerY = (from.y + 0.5) * Building.GRID_SIZE;
        
        const dx = pointer.x - centerX;
        const dy = pointer.y - centerY;
        
        const cellSize = Building.GRID_SIZE;
        const fuzzyness = 8; // Pixels slack
        const threshold = cellSize - fuzzyness;

        const moveX = to.x - from.x;
        const moveY = to.y - from.y;

        // Using tiny-yurts style math for directional thresholds
        if (moveX === 0) { // Vertical
            return moveY > 0 ? (dy > threshold) : (dy < -threshold);
        }
        if (moveY === 0) { // Horizontal
            return moveX > 0 ? (dx > threshold) : (dx < -threshold);
        }
        
        // Diagonal connections need more travel distance to "feel" right
        // Sum of horizontal and vertical distance relative to center
        const diagThreshold = cellSize * 2 - fuzzyness;
        if (moveX > 0 && moveY > 0) return (dx + dy) > diagThreshold; 
        if (moveX > 0 && moveY < 0) return (dx - dy) > diagThreshold;
        if (moveX < 0 && moveY > 0) return (-dx + dy) > diagThreshold;
        if (moveX < 0 && moveY < 0) return (-dx - dy) > diagThreshold;

        return false;
    }

    private addPathAtGrid(gridX: number, gridY: number) {
        if (!this.dragStartGrid) return;
        const x1 = this.dragStartGrid.x;
        const y1 = this.dragStartGrid.y;
        const x2 = gridX;
        const y2 = gridY;

        if (x1 === x2 && y1 === y2) return;
        if (this.isGridOccupied(x2, y2)) return;

        // Diagonal clipping check
        if (Math.abs(x1 - x2) === 1 && Math.abs(y1 - y2) === 1) {
            if (this.isGridOccupied(x1, y2) || this.isGridOccupied(x2, y1)) {
                return;
            }
        }

        Path.add(this, x1, y1, x2, y2);
    }

    private removePathAtGrid(gridX: number, gridY: number) {
        const structure = this.structureGrid.get(`${gridX},${gridY}`);
        if (structure instanceof Roundabout) {
            const rb = structure as Roundabout;
            const sx = rb.gridX;
            const sy = rb.gridY;
            
            // 1. Remove from structureGrid (all 3x3 cells)
            for (let ox = 0; ox < Roundabout.SIZE; ox++) {
                for (let oy = 0; oy < Roundabout.SIZE; oy++) {
                    this.structureGrid.delete(`${sx + ox},${sy + oy}`);
                }
            }
            
            // 2. Remove from roundabouts array
            this.roundabouts = this.roundabouts.filter(r => r !== rb);
            
            // 3. Cleanup paths and destroy container
            rb.removeRoundabout();
            
            // 4. Force re-render
            Path.render();
            return;
        }

        Path.removeAt(gridX, gridY);
    }

    update(time: number, delta: number) {
        if (!this.controls) {
            return;
        }

        const speed = 10;
        if (this.controls.left.isDown) {
            this.camera.scrollX -= speed;
        } else if (this.controls.right.isDown) {
            this.camera.scrollX += speed;
        }

        if (this.controls.up.isDown) {
            this.camera.scrollY -= speed;
        } else if (this.controls.down.isDown) {
            this.camera.scrollY += speed;
        }

        // Cleanup despawned workers
        this.workers = this.workers.filter(w => !w.isDespawned);

        // Update spatial grid for collisions
        this.workerGrid.clear();
        for (const w of this.workers) {
            const gx = Math.floor(w.x / Building.GRID_SIZE);
            const gy = Math.floor(w.y / Building.GRID_SIZE);
            const key = `${gx},${gy}`;
            if (!this.workerGrid.has(key)) this.workerGrid.set(key, []);
            this.workerGrid.get(key)!.push(w);
        }

        // Update workers
        this.workers.forEach((w) => w.update(time, delta));

        // Spawn structures every 5 seconds (if not paused)
        if (!this.isSpawningPaused && time > this.lastStructureSpawnTime + 5000) {
            this.spawnRandomStructure();
            this.lastStructureSpawnTime = time;
        }

        // Spawn workers for demand
        this.assignTasks(time);
    }

    private assignTasks(time: number) {
        // Global throttle: 100ms between any worker spawning on the map
        if (time < this.lastSpawnTime + 100) return;

        const assignedPinKeys = new Set(
            this.workers.map(w => w.getTargetPinKey()).filter(k => k !== null) as string[]
        );

        const houseWorkerCounts = new Map<House, number>();
        this.workers.forEach(w => {
            const h = w.getHomeHouse();
            houseWorkerCounts.set(h, (houseWorkerCounts.get(h) || 0) + 1);
        });

        for (const building of this.buildings) {
            if (building.hasDemand) {
                const pinLocations = building.getAvailablePinLocations();
                for (const loc of pinLocations) {
                    const pinKey = `${loc.x},${loc.y}`;
                    
                    if (!assignedPinKeys.has(pinKey)) {
                        for (const house of this.houses) {
                            // Per-house throttle: 1s between workers from the same house
                            if (time < house.lastSpawnTime + 1000) continue;

                            const currentCount = houseWorkerCounts.get(house) || 0;
                            if (currentCount >= 2) continue;

                            // Color match check: house must match building
                            if (house.bodyColor !== building.bodyColor) continue;

                            const tempWorker = new Worker(this, house);
                            if (tempWorker.canReach(loc.x, loc.y, building)) {
                                tempWorker.setTargetBuilding(building, loc.x, loc.y);
                                this.workers.push(tempWorker);
                                assignedPinKeys.add(pinKey);
                                houseWorkerCounts.set(house, currentCount + 1);
                                
                                this.lastSpawnTime = time;
                                house.lastSpawnTime = time;
                                
                                // We spawned one, move to the next pin (or stop for this frame if we want strict staggering)
                                // To respect the global 100ms throttle, we must return here.
                                return; 
                            } else {
                                // IMPORTANT: Destroy the temp objects if no path is found
                                tempWorker.destroy();
                            }
                        }
                    }
                }
            }
        }
    }

    private spawnRandomStructure() {
        const gridW = 32;
        const gridH = 24;

        const isHouse = (this.structureSpawnCounter % 3) < 2;
        const w = isHouse ? 1 : 2;
        const h = isHouse ? 1 : 3;

        const colorIndex = Math.floor(this.structureSpawnCounter / 3) % this.colorPalette.length;
        const structureColor = this.colorPalette[colorIndex];

        // 1. House Clustering Logic:
        const sameColorHouses = this.houses.filter(h => h.bodyColor === structureColor);
        const shouldSeedNewNeighborhood = isHouse && sameColorHouses.length > 0 && (sameColorHouses.length % 6 === 5);

        if (isHouse && sameColorHouses.length > 0 && !shouldSeedNewNeighborhood) {
            // Growth phase: preferred houses with FEWER neighbors to grow neighborhoods balancedly
            const sameColorHousesWithCounts = sameColorHouses.map(h => {
                const neighbors = sameColorHouses.filter(other => 
                    other !== h && Phaser.Math.Distance.Between(h.gridX, h.gridY, other.gridX, other.gridY) <= 2
                );
                return { house: h, count: neighbors.length };
            });
            
            // Shuffle then Sort by count ascending (grow sparse areas/new seeds first)
            Phaser.Utils.Array.Shuffle(sameColorHousesWithCounts);
            sameColorHousesWithCounts.sort((a, b) => a.count - b.count);

            for (const entry of sameColorHousesWithCounts) {
                const neighbor = entry.house;
                const searchZone: { gx: number, gy: number }[] = [];
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dy = -2; dy <= 2; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        searchZone.push({ gx: neighbor.gridX + dx, gy: neighbor.gridY + dy });
                    }
                }
                Phaser.Utils.Array.Shuffle(searchZone);

                for (const adj of searchZone) {
                    if (this.tryToSpawnAt(adj.gx, adj.gy, w, h, isHouse, structureColor)) {
                        this.structureSpawnCounter++;
                        return; 
                    }
                }
            }
        }

        // 2. Fallback / Seed Selection: Increased search thoroughness (500 trials)
        for (let i = 0; i < 500; i++) {
            const gx = Math.floor(Math.random() * (gridW - w + 1));
            const gy = Math.floor(Math.random() * (gridH - h + 1));
            
            // If seeding a new neighborhood, prioritize spots FAR from existing same-color houses
            if (shouldSeedNewNeighborhood) {
                const minDist = sameColorHouses.reduce((min, h) => {
                    const d = Phaser.Math.Distance.Between(gx, gy, h.gridX, h.gridY);
                    return Math.min(min, d);
                }, Infinity);
                
                // Require at least 10 tiles distance for a new neighborhood seed
                if (minDist < 10 && i < 450) continue; 
            }

            if (this.tryToSpawnAt(gx, gy, w, h, isHouse, structureColor)) {
                this.structureSpawnCounter++;
                return; 
            }
        }
    }

    private tryToSpawnAt(gx: number, gy: number, w: number, h: number, isHouse: boolean, color: number): boolean {
        const gridW = 32;
        const gridH = 24;
        const orientations: ("up" | "down" | "left" | "right")[] = ["up", "down", "left", "right"];

        // Bounds check
        if (gx < 0 || gx + w > gridW || gy < 0 || gy + h > gridH) return false;

        // Try orientations
        Phaser.Utils.Array.Shuffle(orientations);
        for (const entranceDir of orientations) {
            const driveways: { x: number; y: number }[] = [];
            // Primary driveway
            let d1x = gx, d1y = gy;
            if (entranceDir === "down") d1y = gy + h;
            else if (entranceDir === "up") d1y = gy - 1;
            else if (entranceDir === "left") d1x = gx - 1;
            else if (entranceDir === "right") d1x = gx + w;
            driveways.push({ x: d1x, y: d1y });

            // Secondary driveway for buildings (opposite side)
            if (!isHouse) {
                const opposites: Record<string, string> = { up: "down", down: "up", left: "right", right: "left" };
                const oppDir = opposites[entranceDir];
                let d2x = gx, d2y = gy;
                if (oppDir === "down") d2y = gy + h;
                else if (oppDir === "up") d2y = gy - 1;
                else if (oppDir === "left") d2x = gx - 1;
                else if (oppDir === "right") d2x = gx + w;
                driveways.push({ x: d2x, y: d2y });
            }

            // Bounds check for all driveways
            let outOfBounds = false;
            for (const d of driveways) {
                if (d.x < 0 || d.x >= gridW || d.y < 0 || d.y >= gridH) {
                    outOfBounds = true;
                    break;
                }
            }
            if (outOfBounds) continue;

            // 1. FOOTPRINT CHECK: Must be clear of OTHER STRUCTURES and PATHS
            let footprintConflict = false;
            for (let ox = 0; ox < w; ox++) {
                for (let oy = 0; oy < h; oy++) {
                    // We check for paths here to prevent spawning on user-placed roads
                    if (this.isGridOccupied(gx + ox, gy + oy, true)) {
                        footprintConflict = true; break;
                    }
                }
                if (footprintConflict) break;
            }
            if (footprintConflict) continue;

            // 2. DRIVEWAY CHECK: All driveways must be structurally empty (no other buildings)
            let drivewayConflict = false;
            for (const d of driveways) {
                // We DON'T include paths here because buildings connect TO roads.
                if (this.isGridOccupied(d.x, d.y, false)) {
                    drivewayConflict = true;
                    break;
                }
            }
            if (driveways.length > 0 && drivewayConflict) continue; // Only continue if there are driveways and a conflict

            // 3. (Optional) SEPARATION BUFFER:
            // Still check distance between separate buildings
            if (!isHouse) {
                let bufferConflict = false;
                for (let ox = -1; ox <= w; ox++) {
                    for (let oy = -1; oy <= h; oy++) {
                        if (ox >= 0 && ox < w && oy >= 0 && oy < h) continue; // Skip footprint
                        if (this.isGridOccupied(gx + ox, gy + oy, false)) { 
                            bufferConflict = true; break;
                        }
                    }
                    if (bufferConflict) break;
                }
                if (bufferConflict) continue;
            }

            // ALL CLEAR - SPAWN!
            let structure: Building | House;
            if (isHouse) {
                structure = new House(this, gx, gy, 1, 1, color, entranceDir as any);
                this.houses.push(structure as House);
            } else {
                structure = new Building(this, gx, gy, 2, 3, color, entranceDir as any);
                this.buildings.push(structure as Building);
            }

            // Fill structure grid for fast lookup
            for (let ox = 0; ox < w; ox++) {
                for (let oy = 0; oy < h; oy++) {
                    this.structureGrid.set(`${gx + ox},${gy + oy}`, structure);
                }
            }

            console.log(`Spawned ${isHouse ? "House" : "Building"} at ${gx}, ${gy} facing ${entranceDir}`);
            return true;
        }

        return false;
    }

    public toggleSpawning() {
        this.isSpawningPaused = !this.isSpawningPaused;
        return this.isSpawningPaused;
    }

    changeScene() {
        this.scene.start("GameOver");
    }
}
