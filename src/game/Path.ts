import Phaser, { Scene, GameObjects } from "phaser";

export interface PathPoint {
    x: number;
    y: number;
}

export class Path {
    public static paths: Path[] = [];
    public static connectivityGraph: Map<string, Set<string>> = new Map();
    public static pathGrid: Map<string, Path[]> = new Map();
    public static networkVersion: number = 0; 
    private static graphics: GameObjects.Graphics | null = null;

    public points: PathPoint[];
    public isFixture: boolean = false;
    public isOneWay: boolean = false;
    public isMotorway: boolean = false;
    public controlPoint: PathPoint | null = null;
    public cachedCurve: Phaser.Curves.QuadraticBezier | null = null;

    public static isAt(gridX: number, gridY: number): boolean {
        return this.pathGrid.has(`${gridX},${gridY}`);
    }

    public isAt(gridX: number, gridY: number): boolean {
        // 1. Node check (Endpoints)
        if ((this.points[0].x === gridX && this.points[0].y === gridY) ||
            (this.points[1].x === gridX && this.points[1].y === gridY)) {
            return true;
        }

        // 2. Line intersection check (Motorways are straight now)
        const sx = (this.points[0].x + 0.5) * 32;
        const sy = (this.points[0].y + 0.5) * 32;
        const ex = (this.points[1].x + 0.5) * 32;
        const ey = (this.points[1].y + 0.5) * 32;
        const tileRect = new Phaser.Geom.Rectangle(gridX * 32, gridY * 32, 32, 32);

        const line = new Phaser.Geom.Line(sx, sy, ex, ey);
        if (Phaser.Geom.Intersects.LineToRectangle(line, tileRect)) return true;

        return false;
    }

    public static isIntersection(gx: number, gy: number): boolean {
        const neighbors = this.connectivityGraph.get(`${gx},${gy}`);
        return (neighbors?.size || 0) >= 3;
    }

    constructor(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        isFixture: boolean = false,
        isOneWay: boolean = false,
        controlPoint: PathPoint | null = null
    ) {
        this.points = [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ];
        this.isFixture = isFixture;
        this.isOneWay = isOneWay;
        this.controlPoint = controlPoint;
    }

    private static motorwayGraphics: GameObjects.Graphics | null = null;
    private static entranceGraphics: GameObjects.Graphics | null = null;

    public static init(scene: Scene) {
        console.log("Path.init called");
        this.paths = [];
        this.connectivityGraph = new Map();
        
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(1); 
        
        this.motorwayGraphics = scene.add.graphics();
        this.motorwayGraphics.setDepth(0.1); 
        
        this.entranceGraphics = scene.add.graphics();
        this.entranceGraphics.setDepth(1.5); // ABOVE roads, BELOW buildings
        
        this.render();
    }

    public static add(
        _scene: Scene,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        isFixture: boolean = false,
        isOneWay: boolean = false,
        isMotorway: boolean = false,
        controlPoint: PathPoint | null = null
    ) {
        console.log(
            `Path.add: (${x1},${y1}) to (${x2},${y2}), isFixture: ${isFixture}, isOneWay: ${isOneWay}, isMotorway: ${isMotorway}`,
        );
        // Check if this segment already exists
        const exists = this.paths.some(
            (p) =>
                (p.points[0].x === x1 &&
                    p.points[0].y === y1 &&
                    p.points[1].x === x2 &&
                    p.points[1].y === y2) ||
                (p.points[0].x === x2 &&
                    p.points[0].y === y2 &&
                    p.points[1].x === x1 &&
                    p.points[1].y === y1),
        );

        if (!exists) {
            const path = new Path(x1, y1, x2, y2, isFixture, isOneWay, controlPoint);
            path.isMotorway = isMotorway;
            this.paths.push(path);
            this.updateConnectivity(x1, y1, x2, y2, true, isOneWay);
            this.networkVersion++;
            this.render();
        }
    }

    public static removeAt(gridX: number, gridY: number, includeMotorways: boolean = true) {
        const toRemove = this.paths.filter(
            (p) => {
                if (p.isFixture) return false;
                if (!includeMotorways && p.isMotorway) return false;
                
                // 1. Node check (Endpoints / Entrances)
                const isAtEndpoint = (p.points[0].x === gridX && p.points[0].y === gridY) ||
                                     (p.points[1].x === gridX && p.points[1].y === gridY);
                
                if (isAtEndpoint) return true;

                // 2. Line intersection check (Only for non-motorways)
                // We only allow removing tunnels via their entrances to prevent accidental deletion
                if (p.isMotorway) return false;

                const x1 = (p.points[0].x + 0.5) * 32;
                const y1 = (p.points[0].y + 0.5) * 32;
                const x2 = (p.points[1].x + 0.5) * 32;
                const y2 = (p.points[1].y + 0.5) * 32;
                const tileRect = new Phaser.Geom.Rectangle(gridX * 32, gridY * 32, 32, 32);

                const line = new Phaser.Geom.Line(x1, y1, x2, y2);
                if (Phaser.Geom.Intersects.LineToRectangle(line, tileRect)) return true;

                return false;
            }
        );

        if (toRemove.length === 0) return;

        toRemove.forEach((p) => {
            this.updateConnectivity(
                p.points[0].x,
                p.points[0].y,
                p.points[1].x,
                p.points[1].y,
                false,
                p.isOneWay
            );
            const index = this.paths.indexOf(p);
            if (index > -1) this.paths.splice(index, 1);
        });
        this.networkVersion++;
        this.render();
    }

    public static removeFixture(x1: number, y1: number, x2: number, y2: number) {
        const index = this.paths.findIndex(p => 
            p.isFixture && (
                (p.points[0].x === x1 && p.points[0].y === y1 && p.points[1].x === x2 && p.points[1].y === y2) ||
                (p.points[0].x === x2 && p.points[0].y === y2 && p.points[1].x === x1 && p.points[1].y === y1)
            )
        );

        if (index > -1) {
            const p = this.paths[index];
            this.updateConnectivity(p.points[0].x, p.points[0].y, p.points[1].x, p.points[1].y, false, p.isOneWay);
            this.paths.splice(index, 1);
            this.networkVersion++;
            this.render();
        }
    }

    private static updateConnectivity(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        add: boolean,
        isOneWay: boolean = false
    ) {
        const k1 = `${x1},${y1}`;
        const k2 = `${x2},${y2}`;

        if (add) {
            if (!this.connectivityGraph.has(k1))
                this.connectivityGraph.set(k1, new Set());
            this.connectivityGraph.get(k1)!.add(k2);
            
            if (!isOneWay) {
                if (!this.connectivityGraph.has(k2))
                    this.connectivityGraph.set(k2, new Set());
                this.connectivityGraph.get(k2)!.add(k1);
            }
        } else {
            const s1 = this.connectivityGraph.get(k1);
            s1?.delete(k2);
            if (s1 && s1.size === 0) this.connectivityGraph.delete(k1);

            if (!isOneWay) {
                const s2 = this.connectivityGraph.get(k2);
                s2?.delete(k1);
                if (s2 && s2.size === 0) this.connectivityGraph.delete(k2);
            }
        }
    }

    public static render() {
        if (!this.graphics || !this.motorwayGraphics || !this.entranceGraphics) return;

        const rg = this.graphics;
        const mg = this.motorwayGraphics;
        const eg = this.entranceGraphics;
        
        rg.clear();
        mg.clear();
        eg.clear();
        this.pathGrid.clear();

        if (this.paths.length === 0) return;

        const pathColor = 0xdca26f;
        const outlineColor = 0xffffff;
        const size = 32;

        // 1. Draw Tunnels (Straight Subterranean Style) AND Populate Grid
        this.paths.forEach(p => {
            if (p.isMotorway) {
                const tunnelColor = 0x34495e; 
                const x1 = (p.points[0].x + 0.5) * size;
                const y1 = (p.points[0].y + 0.5) * size;
                const x2 = (p.points[1].x + 0.5) * size;
                const y2 = (p.points[1].y + 0.5) * size;

                // Draw Dashed Subterranean line
                mg.lineStyle(6, tunnelColor, 0.5);
                const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
                const dashCount = Math.floor(dist / 10);
                for (let i = 0; i < dashCount; i += 2) {
                    const t1 = i / dashCount;
                    const t2 = (i + 1) / dashCount;
                    mg.lineBetween(
                        Phaser.Math.Linear(x1, x2, t1),
                        Phaser.Math.Linear(y1, y2, t1),
                        Phaser.Math.Linear(x1, x2, t2),
                        Phaser.Math.Linear(y1, y2, t2)
                    );
                }

                // Draw Tunnel Entrances
                const drawEntrance = (gx: number, gy: number) => {
                    const rx = (gx + 0.5) * size;
                    const ry = (gy + 0.5) * size;
                    eg.fillStyle(0x7f8c8d, 0.8);
                    eg.fillRect(rx - 12, ry - 12, 24, 24);
                    eg.lineStyle(2, tunnelColor, 1);
                    eg.strokeRect(rx - 12, ry - 12, 24, 24);
                };
                drawEntrance(p.points[0].x, p.points[0].y);
                drawEntrance(p.points[1].x, p.points[1].y);

                // Populate Grid for Tunnel (all cells it passes through)
                const distTiles = Math.max(Math.abs(p.points[0].x - p.points[1].x), Math.abs(p.points[0].y - p.points[1].y));
                const stepCount = Math.ceil(distTiles * 4) + 1;
                for (let i = 0; i <= stepCount; i++) {
                    const t = i / stepCount;
                    const gx = Math.floor(p.points[0].x + (p.points[1].x - p.points[0].x) * t + 0.001);
                    const gy = Math.floor(p.points[0].y + (p.points[1].y - p.points[0].y) * t + 0.001);
                    const key = `${gx},${gy}`;
                    if (!Path.pathGrid.has(key)) Path.pathGrid.set(key, []);
                    if (!Path.pathGrid.get(key)!.includes(p)) Path.pathGrid.get(key)!.push(p);
                }
                // Ensure the final endpoint cell is also definitely included
                const endKey = `${p.points[1].x},${p.points[1].y}`;
                if (!Path.pathGrid.has(endKey)) Path.pathGrid.set(endKey, []);
                if (!Path.pathGrid.get(endKey)!.includes(p)) Path.pathGrid.get(endKey)!.push(p);
            } else {
                // Populate Grid for Ground Road (ALL intermediate cells)
                const distTiles = Math.max(Math.abs(p.points[0].x - p.points[1].x), Math.abs(p.points[0].y - p.points[1].y));
                const stepCount = Math.ceil(distTiles * 4) + 1;
                for (let i = 0; i <= stepCount; i++) {
                    const t = i / stepCount;
                    const gx = Math.floor(p.points[0].x + (p.points[1].x - p.points[0].x) * t + 0.001);
                    const gy = Math.floor(p.points[0].y + (p.points[1].y - p.points[0].y) * t + 0.001);
                    const key = `${gx},${gy}`;
                    if (!this.pathGrid.has(key)) this.pathGrid.set(key, []);
                    if (!this.pathGrid.get(key)!.includes(p)) this.pathGrid.get(key)!.push(p);
                }
                // Ensure final endpoint
                const endKey = `${p.points[1].x},${p.points[1].y}`;
                if (!this.pathGrid.has(endKey)) this.pathGrid.set(endKey, []);
                if (!this.pathGrid.get(endKey)!.includes(p)) this.pathGrid.get(endKey)!.push(p);
                
                // Handle diagonal gaps (ensuring adjacency for 8-way movement)
                const dx = Math.abs(p.points[0].x - p.points[1].x);
                const dy = Math.abs(p.points[0].y - p.points[1].y);
                if (dx === 1 && dy === 1) {
                    const gap1 = `${p.points[0].x},${p.points[1].y}`;
                    const gap2 = `${p.points[1].x},${p.points[0].y}`;
                    if (!this.pathGrid.has(gap1)) this.pathGrid.set(gap1, []);
                    if (!this.pathGrid.get(gap1)!.includes(p)) this.pathGrid.get(gap1)!.push(p);
                    if (!this.pathGrid.has(gap2)) this.pathGrid.set(gap2, []);
                    if (!this.pathGrid.get(gap2)!.includes(p)) this.pathGrid.get(gap2)!.push(p);
                }
            }
        });

        // 2. Draw Ground Road OUTLINES
        this.paths.forEach(p => {
            if (!p.isMotorway) {
                const x1 = (p.points[0].x + 0.5) * size;
                const y1 = (p.points[0].y + 0.5) * size;
                const x2 = (p.points[1].x + 0.5) * size;
                const y2 = (p.points[1].y + 0.5) * size;
                rg.lineStyle(24, outlineColor, 1.0);
                rg.lineBetween(x1, y1, x2, y2);
            }
        });

        // 3. Draw Node Cap OUTLINES
        this.connectivityGraph.forEach((_neighbors, key) => {
            const [gx, gy] = key.split(",").map(Number);
            const groundPaths = this.paths.filter(p => !p.isMotorway && ((p.points[0].x === gx && p.points[0].y === gy) || (p.points[1].x === gx && p.points[1].y === gy)));
            if (groundPaths.length > 0) {
                rg.fillStyle(outlineColor, 1);
                rg.fillCircle((gx + 0.5) * size, (gy + 0.5) * size, 12);
            }
        });

        // 4. Draw Ground Road BODIES
        this.paths.forEach(p => {
            if (!p.isMotorway) {
                const x1 = (p.points[0].x + 0.5) * size;
                const y1 = (p.points[0].y + 0.5) * size;
                const x2 = (p.points[1].x + 0.5) * size;
                const y2 = (p.points[1].y + 0.5) * size;
                rg.lineStyle(18, pathColor, 1.0);
                rg.lineBetween(x1, y1, x2, y2);
            }
        });

        // 5. Draw Node Cap BODIES
        this.connectivityGraph.forEach((_neighbors, key) => {
            const [gx, gy] = key.split(",").map(Number);
            const groundPaths = this.paths.filter(p => !p.isMotorway && ((p.points[0].x === gx && p.points[0].y === gy) || (p.points[1].x === gx && p.points[1].y === gy)));
            if (groundPaths.length > 0) {
                rg.fillStyle(pathColor, 1);
                rg.fillCircle((gx + 0.5) * size, (gy + 0.5) * size, 9);
            }
        });

        // 6. Draw Direction Arrows
        this.paths.forEach(p => {
            if (!p.isMotorway && p.isOneWay) {
                const x1 = (p.points[0].x + 0.5) * size;
                const y1 = (p.points[0].y + 0.5) * size;
                const x2 = (p.points[1].x + 0.5) * size;
                const y2 = (p.points[1].y + 0.5) * size;
                const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2);
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
                const arrowSize = 7; // Slightly larger arrow

                // Subtle dark background for the arrow to make it pop on any road color
                rg.fillStyle(0x000000, 0.2);
                rg.fillCircle(midX, midY, 9);

                rg.fillStyle(outlineColor, 1.0);
                rg.beginPath();
                rg.moveTo(midX + Math.cos(angle) * arrowSize, midY + Math.sin(angle) * arrowSize);
                rg.lineTo(midX + Math.cos(angle + 2.5) * arrowSize, midY + Math.sin(angle + 2.5) * arrowSize);
                rg.lineTo(midX + Math.cos(angle - 2.5) * arrowSize, midY + Math.sin(angle - 2.5) * arrowSize);
                rg.closePath();
                rg.fillPath();
            }
        });
    }
}
