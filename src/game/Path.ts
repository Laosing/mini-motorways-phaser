import { Scene, GameObjects } from "phaser";

export interface PathPoint {
    x: number;
    y: number;
}

export class Path {
    public static paths: Path[] = [];
    public static connectivityGraph: Map<string, Set<string>> = new Map();
    public static networkVersion: number = 0; 
    private static graphics: GameObjects.Graphics | null = null;

    public points: PathPoint[];
    public isFixture: boolean = false;
    public isOneWay: boolean = false;

    public static isAt(gridX: number, gridY: number): boolean {
        return this.paths.some(p => {
            // Standard node check
            if ((p.points[0].x === gridX && p.points[0].y === gridY) ||
                (p.points[1].x === gridX && p.points[1].y === gridY)) {
                return true;
            }
            // Diagonal clipping check: if the path is diagonal (e.g., (0,0) to (1,1)),
            // it visually and logically "occupies" the corners (0,1) and (1,0) for building.
            const x1 = p.points[0].x;
            const y1 = p.points[0].y;
            const x2 = p.points[1].x;
            const y2 = p.points[1].y;
            const dx = Math.abs(x1 - x2);
            const dy = Math.abs(y1 - y2);
            if (dx === 1 && dy === 1) {
                if ((gridX === x1 && gridY === y2) || (gridX === x2 && gridY === y1)) {
                    return true;
                }
            }
            return false;
        });
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
    ) {
        this.points = [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ];
        this.isFixture = isFixture;
        this.isOneWay = isOneWay;
    }

    public static init(scene: Scene) {
        console.log("Path.init called");
        this.paths = [];
        this.connectivityGraph = new Map();
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(1); // Higher depth to be above buildings
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
    ) {
        console.log(
            `Path.add: (${x1},${y1}) to (${x2},${y2}), isFixture: ${isFixture}, isOneWay: ${isOneWay}`,
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
            const path = new Path(x1, y1, x2, y2, isFixture, isOneWay);
            this.paths.push(path);
            this.updateConnectivity(x1, y1, x2, y2, true, isOneWay);
            this.networkVersion++;
            this.render();
        }
    }

    public static removeAt(gridX: number, gridY: number) {
        const toRemove = this.paths.filter(
            (p) => {
                if (p.isFixture) return false;
                
                // 1. Node check
                if ((p.points[0].x === gridX && p.points[0].y === gridY) ||
                    (p.points[1].x === gridX && p.points[1].y === gridY)) {
                    return true;
                }

                // 2. Diagonal clipping check (elbow removal)
                const x1 = p.points[0].x;
                const y1 = p.points[0].y;
                const x2 = p.points[1].x;
                const y2 = p.points[1].y;
                if (Math.abs(x1 - x2) === 1 && Math.abs(y1 - y2) === 1) {
                    if ((gridX === x1 && gridY === y2) || (gridX === x2 && gridY === y1)) {
                        return true;
                    }
                }
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
        if (!this.graphics) {
            console.warn("Path.render called but graphics is null");
            return;
        }
        const g = this.graphics;
        g.clear();
        if (this.paths.length === 0) {
            return;
        }

        const pathColor = 0xdca26f;
        const outlineColor = 0xffffff;
        const lineWidth = 18;
        const outlineWidth = 24;
        const size = 32;

        const drawPass = (w: number, color: number, isOutline: boolean) => {
            g.lineStyle(w, color, 1);
            this.paths.forEach((p) => {
                const x1 = (p.points[0].x + 0.5) * size;
                const y1 = (p.points[0].y + 0.5) * size;
                const x2 = (p.points[1].x + 0.5) * size;
                const y2 = (p.points[1].y + 0.5) * size;
                g.lineBetween(x1, y1, x2, y2);

                if (!isOutline && p.isOneWay) {
                    // Draw direction arrow
                    const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2);
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;
                    const arrowSize = 6;
                    
                    g.fillStyle(outlineColor, 0.8);
                    g.beginPath();
                    g.moveTo(midX + Math.cos(angle) * arrowSize, midY + Math.sin(angle) * arrowSize);
                    g.lineTo(midX + Math.cos(angle + 2.5) * arrowSize, midY + Math.sin(angle + 2.5) * arrowSize);
                    g.lineTo(midX + Math.cos(angle - 2.5) * arrowSize, midY + Math.sin(angle - 2.5) * arrowSize);
                    g.closePath();
                    g.fillPath();
                }
            });

            // Draw circles at all nodes to make corners look joined
            this.connectivityGraph.forEach((_neighbors, key) => {
                const [gx, gy] = key.split(",").map(Number);
                g.fillStyle(color, 1);
                g.fillCircle((gx + 0.5) * size, (gy + 0.5) * size, w / 2);
            });
        };

        drawPass(outlineWidth, outlineColor, true);
        drawPass(lineWidth, pathColor, false);
    }
}
