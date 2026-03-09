import { Scene, GameObjects } from "phaser";
import { Path } from "./Path";
import { GridUtils } from "./GridUtils";

export interface BuildingConfig {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: number;
    gridX: number;
    gridY: number;
}

interface Pin {
    circle: GameObjects.Arc;
    gridX: number;
    gridY: number;
}

export class Building extends GameObjects.Container {
    private pins: Map<number, Pin> = new Map();
    public gridX: number;
    public gridY: number;
    public bodyColor: number;
    public static readonly GRID_SIZE = 32;

    constructor(
        scene: Scene,
        gridX: number,
        gridY: number,
        gridWidth: number = 2,
        gridHeight: number = 3,
        color: number = 0x4a90e2,
        entranceDir?: "up" | "down" | "left" | "right",
    ) {
        const x = gridX * Building.GRID_SIZE;
        const y = gridY * Building.GRID_SIZE;
        const width = gridWidth * Building.GRID_SIZE;
        const height = gridHeight * Building.GRID_SIZE;

        super(scene, x, y);

        this.gridX = gridX;
        this.gridY = gridY;
        this.bodyColor = color;

        // Main building body (no stroke now)
        const shape = scene.add.rectangle(0, 0, width, height, color);
        shape.setOrigin(0, 0);
        this.add(shape);

        // Determine entrance directions
        const directions = ["up", "down", "left", "right"] as const;
        const primaryDir = entranceDir || directions[Math.floor(Math.random() * directions.length)];
        const opposites: Record<string, "up" | "down" | "left" | "right"> = { up: "down", down: "up", left: "right", right: "left" };
        const finalDirs = [primaryDir, opposites[primaryDir]];

        // Custom border graphics
        const border = scene.add.graphics();
        border.lineStyle(3, 0x2c3e50);
        border.beginPath();

        // Draw border segments with gaps for TWO doors
        if (primaryDir === "up" || primaryDir === "down") {
            // Horizontal gaps on top and bottom
            // Segment 1: Bottom Right
            border.moveTo(24, height);
            border.lineTo(width, height);
            // Segment 2: Right Edge
            border.lineTo(width, 0);
            // Segment 3: Top Right
            border.lineTo(24, 0);

            // Segment 4: Top Left
            border.moveTo(8, 0);
            border.lineTo(0, 0);
            // Segment 5: Left Edge
            border.lineTo(0, height);
            // Segment 6: Bottom Left
            border.lineTo(8, height);
        } else {
            // Vertical gaps on left and right
            // Segment 1: Left Bottom
            border.moveTo(0, 24);
            border.lineTo(0, height);
            // Segment 2: Bottom Edge
            border.lineTo(width, height);
            // Segment 3: Right Bottom
            border.lineTo(width, 24);

            // Segment 4: Right Top
            border.moveTo(width, 8);
            border.lineTo(width, 0);
            // Segment 5: Top Edge
            border.lineTo(0, 0);
            // Segment 6: Left Top
            border.lineTo(0, 8);
        }

        border.strokePath();
        this.add(border);

        // Create two doors and two driveways
        finalDirs.forEach(dir => {
            let doorX = 16, doorY = height, doorW = 16, doorH = 4;
            let dStartX = gridX, dStartY = gridY + gridHeight - 1;
            let dTargetX = gridX, dTargetY = gridY + gridHeight;

            if (dir === "up") {
                dStartX = gridX; dStartY = gridY;
                dTargetX = gridX; dTargetY = gridY - 1;
                doorX = 16; doorY = 0; doorW = 16; doorH = 4;
            } else if (dir === "left") {
                dStartX = gridX; dStartY = gridY;
                dTargetX = gridX - 1; dTargetY = gridY;
                doorX = 0; doorY = 16; doorW = 4; doorH = 16;
            } else if (dir === "right") {
                dStartX = gridX + gridWidth - 1; dStartY = gridY;
                dTargetX = gridX + gridWidth; dTargetY = gridY;
                doorX = width; doorY = 16; doorW = 4; doorH = 16;
            }
            // "down" is the default case initialization above

            const doorSegment = scene.add.rectangle(doorX, doorY, doorW, doorH, color);
            this.add(doorSegment);

            // Create automatic entrance path (fixture)
            Path.add(scene, dStartX, dStartY, dTargetX, dTargetY, true);
        });

        scene.add.existing(this);
        this.setSize(width, height);
        this.setDepth(2);

        // Initial appearance
        this.setAlpha(0);
        scene.tweens.add({
            targets: this,
            alpha: 1,
            duration: 500,
            ease: "Power2",
            onComplete: () => {
                // Initial spawn loop
                this.startPinGeneration();
            },
        });
    }

    private startPinGeneration() {
        // Spawn a pin every 2 seconds if there is space
        this.scene.time.addEvent({
            delay: 2000,
            callback: this.createDemandPin,
            callbackScope: this,
            loop: true,
        });
    }

    public get hasDemand(): boolean {
        return this.pins.size > 0;
    }

    // Returns all absolute grid coordinates that have a pin
    public getAvailablePinLocations(): { x: number; y: number }[] {
        return Array.from(this.pins.values()).map((p) => ({
            x: p.gridX,
            y: p.gridY,
        }));
    }

    public createDemandPin() {
        const gridWidth = Math.floor(this.width / Building.GRID_SIZE);
        const gridHeight = Math.floor(this.height / Building.GRID_SIZE);
        const maxPins = gridWidth * gridHeight;

        if (this.pins.size >= maxPins) return;

        // Find empty cells
        const emptyCells: { lx: number; ly: number }[] = [];
        for (let ly = 0; ly < gridHeight; ly++) {
            for (let lx = 0; lx < gridWidth; lx++) {
                if (!this.pins.has(GridUtils.getKey(lx, ly))) {
                    emptyCells.push({ lx, ly });
                }
            }
        }

        if (emptyCells.length === 0) return;

        // Pick a random empty cell
        const { lx, ly } =
            emptyCells[Math.floor(Math.random() * emptyCells.length)];

        // Absolute coordinates
        const gx = Math.floor(this.x / Building.GRID_SIZE) + lx;
        const gy = Math.floor(this.y / Building.GRID_SIZE) + ly;

        // Visual position
        const pinX = (lx + 0.5) * Building.GRID_SIZE;
        const pinY = (ly + 0.5) * Building.GRID_SIZE;

        const circle = this.scene.add.circle(pinX, pinY, 6, this.bodyColor);
        circle.setStrokeStyle(2, 0xffffff);
        this.add(circle).setDepth(5);

        this.pins.set(GridUtils.getKey(lx, ly), {
            circle,
            gridX: gx,
            gridY: gy,
        });

        // Pulse animation
        this.scene.tweens.add({
            targets: circle,
            scale: 1.2,
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
        });
    }

    public collectDemandAt(gx: number, gy: number) {
        // Convert absolute back to local to find the pin
        const lx = gx - Math.floor(this.x / Building.GRID_SIZE);
        const ly = gy - Math.floor(this.y / Building.GRID_SIZE);
        const key = GridUtils.getKey(lx, ly);

        const pin = this.pins.get(key);
        if (pin) {
            pin.circle.destroy();
            this.pins.delete(key);
        }
    }

    // Keep the old collectDemand for backward compatibility or simple workers
    public collectDemand() {
        if (this.pins.size > 0) {
            const firstKey = this.pins.keys().next().value;
            const pin = firstKey && this.pins.get(firstKey);
            if (pin) {
                this.collectDemandAt(pin.gridX, pin.gridY);
            }
        }
    }
}
