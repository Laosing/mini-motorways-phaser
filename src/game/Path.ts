import { Scene, GameObjects } from "phaser";

export interface PathPoint {
    x: number;
    y: number;
}

export class Path {
    public static paths: Path[] = [];
    public static connectivityGraph: Map<string, Set<string>> = new Map();
    private static graphics: GameObjects.Graphics | null = null;

    public points: PathPoint[];
    public isFixture: boolean = false;

    public static isAt(gridX: number, gridY: number): boolean {
        return this.paths.some(p => 
            (p.points[0].x === gridX && p.points[0].y === gridY) ||
            (p.points[1].x === gridX && p.points[1].y === gridY)
        );
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
    ) {
        this.points = [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ];
        this.isFixture = isFixture;
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
    ) {
        console.log(
            `Path.add: (${x1},${y1}) to (${x2},${y2}), isFixture: ${isFixture}`,
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
            const path = new Path(x1, y1, x2, y2, isFixture);
            this.paths.push(path);
            this.updateConnectivity(x1, y1, x2, y2, true);
            this.render();
        }
    }

    public static removeAt(gridX: number, gridY: number) {
        const toRemove = this.paths.filter(
            (p) =>
                !p.isFixture &&
                ((p.points[0].x === gridX && p.points[0].y === gridY) ||
                    (p.points[1].x === gridX && p.points[1].y === gridY)),
        );

        if (toRemove.length === 0) return;

        toRemove.forEach((p) => {
            this.updateConnectivity(
                p.points[0].x,
                p.points[0].y,
                p.points[1].x,
                p.points[1].y,
                false,
            );
            const index = this.paths.indexOf(p);
            if (index > -1) this.paths.splice(index, 1);
        });
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
            this.updateConnectivity(p.points[0].x, p.points[0].y, p.points[1].x, p.points[1].y, false);
            this.paths.splice(index, 1);
            this.render();
        }
    }

    private static updateConnectivity(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        add: boolean,
    ) {
        const k1 = `${x1},${y1}`;
        const k2 = `${x2},${y2}`;

        if (add) {
            if (!this.connectivityGraph.has(k1))
                this.connectivityGraph.set(k1, new Set());
            if (!this.connectivityGraph.has(k2))
                this.connectivityGraph.set(k2, new Set());
            this.connectivityGraph.get(k1)!.add(k2);
            this.connectivityGraph.get(k2)!.add(k1);
        } else {
            const s1 = this.connectivityGraph.get(k1);
            const s2 = this.connectivityGraph.get(k2);
            s1?.delete(k2);
            s2?.delete(k1);
            if (s1 && s1.size === 0) this.connectivityGraph.delete(k1);
            if (s2 && s2.size === 0) this.connectivityGraph.delete(k2);
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
            console.log("Path.render called but paths array is empty");
            return;
        }
        console.log(`Path.render: drawing ${this.paths.length} paths`);

        const pathColor = 0xdca26f;
        const outlineColor = 0xffffff;
        const lineWidth = 18;
        const outlineWidth = 24;
        const size = 32;

        const segments: { x1: number; y1: number; x2: number; y2: number }[] =
            [];
        const curves: { curve: Phaser.Curves.QuadraticBezier }[] = [];

        const cornerNodes = new Map<
            string,
            { cx: number; cy: number; n1k: string; n2k: string }
        >();
        this.connectivityGraph.forEach((neighbors, key) => {
            if (neighbors.size === 2) {
                const [n1k, n2k] = Array.from(neighbors);
                const [gx, gy] = key.split(",").map(Number);
                cornerNodes.set(key, {
                    cx: (gx + 0.5) * size,
                    cy: (gy + 0.5) * size,
                    n1k,
                    n2k,
                });
            }
        });

        this.paths.forEach((p) => {
            const k1 = `${p.points[0].x},${p.points[0].y}`;
            const k2 = `${p.points[1].x},${p.points[1].y}`;
            const c1 = cornerNodes.get(k1);
            const c2 = cornerNodes.get(k2);

            let x1 = (p.points[0].x + 0.5) * size;
            let y1 = (p.points[0].y + 0.5) * size;
            let x2 = (p.points[1].x + 0.5) * size;
            let y2 = (p.points[1].y + 0.5) * size;

            if (c1) {
                x1 = (x1 + x2) / 2;
                y1 = (y1 + y2) / 2;
            }
            if (c2) {
                x2 = (x2 + x1) / 2;
                y2 = (y2 + y1) / 2;
            }
            segments.push({ x1, y1, x2, y2 });
        });

        cornerNodes.forEach((data) => {
            const [n1x, n1y] = data.n1k.split(",").map(Number);
            const [n2x, n2y] = data.n2k.split(",").map(Number);
            const m1x = (data.cx + (n1x + 0.5) * size) / 2;
            const m1y = (data.cy + (n1y + 0.5) * size) / 2;
            const m2x = (data.cx + (n2x + 0.5) * size) / 2;
            const m2y = (data.cy + (n2y + 0.5) * size) / 2;
            curves.push({
                curve: new Phaser.Curves.QuadraticBezier(
                    new Phaser.Math.Vector2(m1x, m1y),
                    new Phaser.Math.Vector2(data.cx, data.cy),
                    new Phaser.Math.Vector2(m2x, m2y),
                ),
            });
        });

        const drawPass = (w: number, color: number) => {
            g.lineStyle(w, color, 1);
            segments.forEach((s) => g.lineBetween(s.x1, s.y1, s.x2, s.y2));
            curves.forEach((c) => c.curve.draw(g, 16));
            this.connectivityGraph.forEach((neighbors, key) => {
                if (neighbors.size !== 2) {
                    const [gx, gy] = key.split(",").map(Number);
                    g.fillStyle(color, 1);
                    g.fillCircle((gx + 0.5) * size, (gy + 0.5) * size, w / 2);
                }
            });
        };

        drawPass(outlineWidth, outlineColor);
        drawPass(lineWidth, pathColor);
    }
}
