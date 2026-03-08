import { Scene, GameObjects } from "phaser";
import { Building } from "./Building";
import { House } from "./House";
import { Path } from "./Path";

export enum WorkerState {
    IDLE,
    GOING_TO_BUILDING,
    COLLECTING_DEMAND,
    RETURNING_TO_HOUSE,
    DROPPING_OFF,
}

export class Worker extends GameObjects.Container {
    private circle: GameObjects.Arc;
    private cargo: GameObjects.Arc;
    private workerState: WorkerState = WorkerState.IDLE;
    private targetBuilding: Building | null = null;
    private homeHouse: House;
    private speed: number = 120; // pixels per second
    private currentPath: { x: number; y: number }[] = [];
    private lastPathTargetKey: string = "";

    // The specific grid coordinates we are currently moving toward
    private activeTargetGridX: number = 0;
    private activeTargetGridY: number = 0;
    private pauseTimer: number = 0;
    public isDespawned: boolean = false;

    constructor(scene: Scene, house: House) {
        // Spawn at house center
        const centerX = house.x + house.width / 2;
        const centerY = house.y + house.height / 2;
        super(scene, centerX, centerY);

        this.homeHouse = house;

        // Create the white circle visual
        this.circle = scene.add.circle(0, 0, 4, 0xffffff);
        this.circle.setStrokeStyle(1, 0x000000);
        this.add(this.circle);

        // Cargo visual (Matches house color)
        this.cargo = scene.add.circle(0, 0, 2, house.bodyColor);
        this.cargo.setVisible(false);
        this.add(this.cargo);

        scene.add.existing(this as GameObjects.GameObject);
        this.setDepth(10);
    }

    public setTargetBuilding(building: Building, gx: number, gy: number) {
        this.targetBuilding = building;
        this.activeTargetGridX = gx;
        this.activeTargetGridY = gy;
        this.workerState = WorkerState.GOING_TO_BUILDING;
    }

    public update(_time: number, delta: number) {
        const deltaSeconds = delta / 1000;

        switch (this.workerState) {
            case WorkerState.IDLE:
                break;

            case WorkerState.GOING_TO_BUILDING:
                if (this.targetBuilding) {
                    this.followPath(
                        this.activeTargetGridX,
                        this.activeTargetGridY,
                        this.targetBuilding,
                        deltaSeconds,
                    );
                    if (
                        this.isAtTargetCoordinates(
                            this.activeTargetGridX,
                            this.activeTargetGridY,
                        )
                    ) {
                        console.log(
                            "Worker reached specific building pin cell. Posing for 1s...",
                        );
                        this.workerState = WorkerState.COLLECTING_DEMAND;
                        this.pauseTimer = 1.0;

                        // Collect the specific pin at this location
                        this.targetBuilding.collectDemandAt(
                            this.activeTargetGridX,
                            this.activeTargetGridY,
                        );
                    }
                }
                break;

            case WorkerState.COLLECTING_DEMAND:
                this.pauseTimer -= deltaSeconds;
                if (this.pauseTimer <= 0) {
                    console.log("Collection done. Returning home...");
                    this.workerState = WorkerState.RETURNING_TO_HOUSE;
                    this.cargo.setVisible(true);
                    // Set house center as next target
                    this.activeTargetGridX = Math.floor(
                        (this.homeHouse.x + this.homeHouse.width / 2) /
                            Building.GRID_SIZE,
                    );
                    this.activeTargetGridY = Math.floor(
                        (this.homeHouse.y + this.homeHouse.height / 2) /
                            Building.GRID_SIZE,
                    );
                }
                break;

            case WorkerState.RETURNING_TO_HOUSE:
                this.followPath(
                    this.activeTargetGridX,
                    this.activeTargetGridY,
                    this.homeHouse,
                    deltaSeconds,
                );
                if (
                    this.isAtTargetCoordinates(
                        this.activeTargetGridX,
                        this.activeTargetGridY,
                    )
                ) {
                    console.log("Worker returned home. Dropping off for 1s...");
                    this.workerState = WorkerState.DROPPING_OFF;
                    this.pauseTimer = 1.0;
                }
                break;

            case WorkerState.DROPPING_OFF:
                this.pauseTimer -= deltaSeconds;
                if (this.pauseTimer <= 0) {
                    console.log("Drop off done. Despawning.");
                    this.despawn();
                }
                break;
        }
    }

    public despawn() {
        this.isDespawned = true;
        this.destroy();
    }

    public getHomeHouse(): House {
        return this.homeHouse;
    }

    public getTargetPinKey(): string | null {
        if (this.workerState === WorkerState.GOING_TO_BUILDING || this.workerState === WorkerState.COLLECTING_DEMAND) {
            return `${this.activeTargetGridX},${this.activeTargetGridY}`;
        }
        return null;
    }

    private followPath(
        tX: number,
        tY: number,
        targetContainer: GameObjects.Container,
        deltaSeconds: number,
    ) {
        const targetKey = `${tX},${tY}`;

        // Recalculate path if target changed or we don't have one
        if (
            this.lastPathTargetKey !== targetKey ||
            this.currentPath.length === 0
        ) {
            const gx = Math.floor(this.x / Building.GRID_SIZE);
            const gy = Math.floor(this.y / Building.GRID_SIZE);

            if (gx !== tX || gy !== tY) {
                this.currentPath = this.findBFSPath(tX, tY, targetContainer);
                this.lastPathTargetKey = targetKey;

                if (this.currentPath.length === 0) {
                    console.warn(`Worker stuck! No path to ${targetKey}.`);
                    this.workerState = WorkerState.IDLE;
                    return;
                }
            }
        }

        if (this.currentPath.length > 0) {
            const nextNode = this.currentPath[0];
            const nextX = (nextNode.x + 0.5) * Building.GRID_SIZE;
            const nextY = (nextNode.y + 0.5) * Building.GRID_SIZE;

            const dist = Phaser.Math.Distance.Between(
                this.x,
                this.y,
                nextX,
                nextY,
            );
            if (dist < 4) {
                this.currentPath.shift();
            } else {
                this.moveToPoint(nextX, nextY, deltaSeconds);
            }
        } else {
            // Move to the exact center of the target cell
            const targetX = (tX + 0.5) * Building.GRID_SIZE;
            const targetY = (tY + 0.5) * Building.GRID_SIZE;
            const dist = Phaser.Math.Distance.Between(
                this.x,
                this.y,
                targetX,
                targetY,
            );
            if (dist > 2) {
                this.moveToPoint(targetX, targetY, deltaSeconds);
            }
        }
    }

    private moveToPoint(
        targetX: number,
        targetY: number,
        deltaSeconds: number,
    ) {
        const angle = Phaser.Math.Angle.Between(
            this.x,
            this.y,
            targetX,
            targetY,
        );
        const distance = Phaser.Math.Distance.Between(
            this.x,
            this.y,
            targetX,
            targetY,
        );
        const moveDistance = this.speed * deltaSeconds;

        if (distance < moveDistance) {
            this.x = targetX;
            this.y = targetY;
        } else {
            this.x += Math.cos(angle) * moveDistance;
            this.y += Math.sin(angle) * moveDistance;
        }
    }

    private isAtTargetCoordinates(gx: number, gy: number): boolean {
        const tX = (gx + 0.5) * Building.GRID_SIZE;
        const tY = (gy + 0.5) * Building.GRID_SIZE;
        return Phaser.Math.Distance.Between(this.x, this.y, tX, tY) < 5;
    }

    public isIdle(): boolean {
        return this.workerState === WorkerState.IDLE;
    }

    public canReach(
        gx: number,
        gy: number,
        container: GameObjects.Container,
    ): boolean {
        const startGridX = Math.floor(this.x / Building.GRID_SIZE);
        const startGridY = Math.floor(this.y / Building.GRID_SIZE);

        if (startGridX === gx && startGridY === gy) {
            return true;
        }

        const path = this.findBFSPath(gx, gy, container);
        return path.length > 0;
    }

    private findBFSPath(
        targetGridX: number,
        targetGridY: number,
        _targetContainer: GameObjects.Container,
    ): { x: number; y: number }[] {
        const startGridX = Math.floor(this.x / Building.GRID_SIZE);
        const startGridY = Math.floor(this.y / Building.GRID_SIZE);

        if (startGridX === targetGridX && startGridY === targetGridY) return [];

        const game = this.scene as any;
        const graph = Path.connectivityGraph;
        const buildings = game.buildings as Building[];
        const houses = game.houses as House[];

        const queue: {
            x: number;
            y: number;
            path: { x: number; y: number }[];
        }[] = [{ x: startGridX, y: startGridY, path: [] }];
        const visited = new Set<string>();
        visited.add(`${startGridX},${startGridY}`);

        const getStructureAt = (gx: number, gy: number) => {
            for (const b of buildings) {
                const bw = Math.floor(b.width / 32);
                const bh = Math.floor(b.height / 32);
                if (gx >= b.gridX && gx < b.gridX + bw && gy >= b.gridY && gy < b.gridY + bh) return b;
            }
            for (const h of houses) {
                const hw = Math.floor(h.width / 32);
                const hh = Math.floor(h.height / 32);
                if (gx >= h.gridX && gx < h.gridX + hw && gy >= h.gridY && gy < h.gridY + hh) return h;
            }
            return null;
        };

        while (queue.length > 0) {
            const { x, y, path } = queue.shift()!;

            if (x === targetGridX && y === targetGridY) {
                return path;
            }

            const currentKey = `${x},${y}`;
            const neighborCoords: { x: number; y: number }[] = [];

            // 1. Add all graph neighbors (Road-to-Road, Road-to-Entrance)
            const neighborsSet = graph.get(currentKey);
            if (neighborsSet) {
                neighborsSet.forEach(key => {
                    const [nx, ny] = key.split(',').map(Number);
                    neighborCoords.push({ x: nx, y: ny });
                });
            }

            // 2. If inside a structure, handle movement within it
            const currentStruct = getStructureAt(x, y);
            if (currentStruct) {
                const adjacent = [
                    { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
                    { x: x + 1, y: y + 1 }, { x: x + 1, y: y - 1 }, { x: x - 1, y: y + 1 }, { x: x - 1, y: y - 1 }
                ];
                for (const adj of adjacent) {
                    if (getStructureAt(adj.x, adj.y) === currentStruct) {
                         if (!neighborCoords.some(n => n.x === adj.x && n.y === adj.y)) {
                            neighborCoords.push(adj);
                        }
                    }
                }
            }

            for (const n of neighborCoords) {
                const key = `${n.x},${n.y}`;
                if (visited.has(key)) continue;

                visited.add(key);
                const newPath = [...path, { x: n.x, y: n.y }];
                queue.push({ x: n.x, y: n.y, path: newPath });
            }
        }

        return [];
    }
}
