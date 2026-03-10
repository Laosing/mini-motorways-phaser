import { Scene, GameObjects } from "phaser";
import { Building } from "./Building";
import { House } from "./House";
import { Path } from "./Path";
import { Roundabout } from "./Roundabout";
import { GridUtils } from "./GridUtils";

export enum WorkerState {
    IDLE,
    GOING_TO_BUILDING,
    COLLECTING_DEMAND,
    RETURNING_TO_HOUSE,
    DROPPING_OFF,
}

export class Worker extends GameObjects.Container {
    // Spatial path cache
    private static pathCache: Map<number, { x: number; y: number }[]> =
        new Map();
    private static cacheVersion: number = -1;
    private circle: GameObjects.Image;
    private cargo: GameObjects.Image;
    private workerState: WorkerState = WorkerState.IDLE;
    private targetBuilding: Building | null = null;
    private homeHouse: House;
    private speed: number = 140;
    private currentPath: { x: number; y: number }[] = [];
    private lastPathTargetKey: number = -1;

    // The specific grid coordinates we are currently moving toward
    private activeTargetGridX: number = 0;
    private activeTargetGridY: number = 0;
    private pauseTimer: number = 0;
    public isDespawned: boolean = false;
    private appliedMultiplier: number = 0;
    private uniqueId: number = Math.random();
    private lastNetworkVersion: number = -1;
    private strandedTimer: number = 0;
    private waitTimer: number = 0;

    private headlights: GameObjects.Image;

    private static texturesGenerated: boolean = false;

    constructor(scene: Scene, house: House) {
        // Spawn at house center
        const centerX = house.x + house.width / 2;
        const centerY = house.y + house.height / 2;
        super(scene, centerX, centerY);

        this.homeHouse = house;

        // Ensure textures are generated once
        Worker.generateTextures(scene);

        // Headlights (Vision Cone)
        this.headlights = scene.add.image(0, 0, "worker-headlights");
        this.headlights.setOrigin(0, 0.5); // Pivot at worker center
        this.add(this.headlights);
        this.headlights.setScale(0.25); // 1/4 resolution

        // Create the white circle visual
        this.circle = scene.add.image(0, 0, "worker-body");
        this.add(this.circle);
        this.circle.setScale(0.25); // 1/4 resolution

        // Cargo visual (Matches house color)
        this.cargo = scene.add.image(0, 0, "worker-cargo");
        this.cargo.setTint(house.bodyColor);
        this.cargo.setVisible(false);
        this.add(this.cargo);
        this.cargo.setScale(0.25); // 1/4 resolution

        scene.add.existing(this as GameObjects.GameObject);
        this.setDepth(10);
    }

    private static generateTextures(scene: Scene) {
        if (this.texturesGenerated) return;

        const resolution = 4; // 4x Supersampling for crispness at zoom

        // Generate Worker Body
        const bodyG = scene.make.graphics({ x: 0, y: 0 }, false);
        bodyG.fillStyle(0xffffff, 1);
        bodyG.fillCircle(8 * resolution, 8 * resolution, 4 * resolution);
        bodyG.lineStyle(resolution, 0x000000, 1); // Scale stroke
        bodyG.strokeCircle(8 * resolution, 8 * resolution, 4 * resolution);
        bodyG.generateTexture("worker-body", 16 * resolution, 16 * resolution);
        bodyG.destroy();

        // Generate Cargo (White, will be tinted)
        const cargoG = scene.make.graphics({ x: 0, y: 0 }, false);
        cargoG.fillStyle(0xffffff, 1);
        cargoG.fillCircle(4 * resolution, 4 * resolution, 2 * resolution);
        cargoG.generateTexture("worker-cargo", 8 * resolution, 8 * resolution);
        cargoG.destroy();

        // Generate Headlights (soft white arc)
        const headG = scene.make.graphics({ x: 0, y: 0 }, false);
        const slowDistance = 50 * resolution;
        const coneAngle = Phaser.Math.DegToRad(35);
        headG.fillStyle(0xffffff, 0.15);
        headG.beginPath();
        headG.moveTo(0, slowDistance);
        headG.arc(0, slowDistance, slowDistance, -coneAngle / 2, coneAngle / 2);
        headG.closePath();
        headG.fillPath();

        headG.generateTexture(
            "worker-headlights",
            slowDistance,
            slowDistance * 2,
        );
        headG.destroy();

        this.texturesGenerated = true;
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
                        this.workerState = WorkerState.COLLECTING_DEMAND;
                        this.pauseTimer = 1.0;
                        this.setDepth(10);
                        this.setAlpha(1.0);

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

    public getTargetPinKey(): number | null {
        if (
            this.workerState === WorkerState.GOING_TO_BUILDING ||
            this.workerState === WorkerState.COLLECTING_DEMAND
        ) {
            return GridUtils.getKey(
                this.activeTargetGridX,
                this.activeTargetGridY,
            );
        }
        return null;
    }

    private prevGridX: number = -1;
    private prevGridY: number = -1;

    private followPath(
        tX: number,
        tY: number,
        targetContainer: GameObjects.Container,
        deltaSeconds: number,
    ) {
        const targetKey = GridUtils.getKey(tX, tY);
        const laneOffset = 6; // pixels to stay on the right

        const gx = Math.floor(this.x / Building.GRID_SIZE);
        const gy = Math.floor(this.y / Building.GRID_SIZE);

        if (this.prevGridX === -1) {
            this.prevGridX = gx;
            this.prevGridY = gy;
        }

        if (this.lastNetworkVersion !== Path.networkVersion) {
            this.lastPathTargetKey = -1;
            this.currentPath = [];
            this.lastNetworkVersion = Path.networkVersion;
        }

        if (
            this.lastPathTargetKey !== targetKey ||
            this.currentPath.length === 0
        ) {
            if (gx !== tX || gy !== tY) {
                this.currentPath = this.findPath(tX, tY, targetContainer);
                this.lastPathTargetKey = targetKey;

                if (this.currentPath.length === 0) {
                    this.strandedTimer += deltaSeconds;
                    this.appliedMultiplier = Math.max(
                        0,
                        this.appliedMultiplier - deltaSeconds * 2,
                    );
                    if (this.depth > 1.1) this.setDepth(1.1);
                    if (this.strandedTimer > 5.0) {
                        this.despawn();
                    }
                    return;
                }
                this.strandedTimer = 0;
            }
        }

        if (this.currentPath.length > 0) {
            const nextNode = this.currentPath[0];
            const nextX = (nextNode.x + 0.5) * Building.GRID_SIZE;
            const nextY = (nextNode.y + 0.5) * Building.GRID_SIZE;

            const neighborsAtPrev = Path.pathGrid.get(
                GridUtils.getKey(this.prevGridX, this.prevGridY),
            );
            const motorway = neighborsAtPrev?.find(
                (p) =>
                    p.isMotorway &&
                    ((p.points[0].x === nextNode.x &&
                        p.points[0].y === nextNode.y) ||
                        (p.points[1].x === nextNode.x &&
                            p.points[1].y === nextNode.y)),
            );

            if (motorway) {
                this.strandedTimer = 0;
                this.setDepth(0.2); // SUBTERRANEAN (below buildings/roads)
                this.setAlpha(0.5); // Ghostly underground look

                this.moveToPoint(nextX, nextY, deltaSeconds, 1.2);

                if (
                    Phaser.Math.Distance.Between(this.x, this.y, nextX, nextY) <
                    5
                ) {
                    this.prevGridX = nextNode.x;
                    this.prevGridY = nextNode.y;
                    this.currentPath.shift();
                }
                return;
            } else {
                this.setDepth(10); // surface
                this.setAlpha(1.0); // fully visible
            }

            const segmentAngle = Phaser.Math.Angle.Between(
                this.prevGridX,
                this.prevGridY,
                nextNode.x,
                nextNode.y,
            );

            let turnMultiplier = 1.0;
            if (this.currentPath.length >= 2) {
                const nextNode2 = this.currentPath[1];
                const nextAngle = Phaser.Math.Angle.Between(
                    nextNode.x,
                    nextNode.y,
                    nextNode2.x,
                    nextNode2.y,
                );
                const turnAngleDiff = Math.abs(
                    Phaser.Math.Angle.ShortestBetween(
                        Phaser.Math.RadToDeg(segmentAngle),
                        Phaser.Math.RadToDeg(nextAngle),
                    ),
                );
                if (turnAngleDiff > 45) {
                    const distToNode = Phaser.Math.Distance.Between(
                        this.x,
                        this.y,
                        nextX,
                        nextY,
                    );
                    if (distToNode < 32) {
                        turnMultiplier = Phaser.Math.Linear(
                            0.4,
                            1.0,
                            Math.min(1, distToNode / 32),
                        );
                    }
                }
            }

            const rightSideAngle = segmentAngle + Math.PI / 2;
            const offsetX = Math.cos(rightSideAngle) * laneOffset;
            const offsetY = Math.sin(rightSideAngle) * laneOffset;

            const offsetNextX = nextX + offsetX;
            const offsetNextY = nextY + offsetY;

            const dist = Phaser.Math.Distance.Between(
                this.x,
                this.y,
                offsetNextX,
                offsetNextY,
            );

            if (dist < 4) {
                this.prevGridX = nextNode.x;
                this.prevGridY = nextNode.y;
                this.currentPath.shift();
            } else {
                this.moveToPoint(
                    offsetNextX,
                    offsetNextY,
                    deltaSeconds,
                    turnMultiplier,
                );
            }
        } else {
            // Arrived at the final grid cell of the path
            this.setDepth(10); // Ensure we are on surface
            this.setAlpha(1.0);
            const targetX = (tX + 0.5) * Building.GRID_SIZE;
            const targetY = (tY + 0.5) * Building.GRID_SIZE;
            if (
                Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY) >
                2
            ) {
                this.moveToPoint(targetX, targetY, deltaSeconds);
            }
        }
    }

    public getHeading(): number {
        return this.headlights.rotation;
    }

    private moveToPoint(
        targetX: number,
        targetY: number,
        deltaSeconds: number,
        baseMultiplier: number = 1.0,
    ) {
        const game = this.scene as any;
        const grid = game.workerGrid as Map<number, Worker[]>;

        const safeDistance = 24;
        const slowDistance = 50;
        const angleToTarget = Phaser.Math.Angle.Between(
            this.x,
            this.y,
            targetX,
            targetY,
        );

        this.headlights.setRotation(angleToTarget);

        let targetMultiplier = baseMultiplier;
        let isStopped = false;

        const isGhosting = this.waitTimer > 2.0;
        const isFrustrated = this.waitTimer > 1.0;

        if (!isGhosting && this.depth >= 5) {
            const gx = Math.floor(this.x / Building.GRID_SIZE);
            const gy = Math.floor(this.y / Building.GRID_SIZE);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const cellKey = GridUtils.getKey(gx + dx, gy + dy);
                    const neighbors = grid.get(cellKey);
                    if (!neighbors) continue;

                    for (const other of neighbors) {
                        if (other === this || other.isDespawned) continue;

                        // ONLY collide if on the same vertical level
                        const myLevel =
                            this.depth < 5 ? "subterranean" : "surface";
                        const otherLevel =
                            other.depth < 5 ? "subterranean" : "surface";
                        if (myLevel !== otherLevel) continue;

                        const otherGx = Math.floor(
                            other.x / Building.GRID_SIZE,
                        );
                        const otherGy = Math.floor(
                            other.y / Building.GRID_SIZE,
                        );

                        const dist = Phaser.Math.Distance.Between(
                            this.x,
                            this.y,
                            other.x,
                            other.y,
                        );
                        if (dist < slowDistance) {
                            const angleToOther = Phaser.Math.Angle.Between(
                                this.x,
                                this.y,
                                other.x,
                                other.y,
                            );
                            const diff = Phaser.Math.Angle.ShortestBetween(
                                Phaser.Math.RadToDeg(angleToTarget),
                                Phaser.Math.RadToDeg(angleToOther),
                            );

                            if (Math.abs(diff) < 25) {
                                const otherHeading = other.getHeading();
                                const headingDiff =
                                    Phaser.Math.Angle.ShortestBetween(
                                        Phaser.Math.RadToDeg(angleToTarget),
                                        Phaser.Math.RadToDeg(otherHeading),
                                    );

                                if (Math.abs(headingDiff) > 135) continue;

                                const otherAngleToUs =
                                    Phaser.Math.Angle.Between(
                                        other.x,
                                        other.y,
                                        this.x,
                                        this.y,
                                    );
                                const otherDiff =
                                    Phaser.Math.Angle.ShortestBetween(
                                        Phaser.Math.RadToDeg(otherHeading),
                                        Phaser.Math.RadToDeg(otherAngleToUs),
                                    );
                                const theyAreLookingAtUs =
                                    Math.abs(otherDiff) < 25;

                                if (theyAreLookingAtUs) {
                                    const IAmInRoundabout =
                                        game.structureGrid.get(
                                            GridUtils.getKey(gx, gy),
                                        ) instanceof Roundabout;
                                    const TheyAreInRoundabout =
                                        game.structureGrid.get(
                                            GridUtils.getKey(otherGx, otherGy),
                                        ) instanceof Roundabout;

                                    if (
                                        !IAmInRoundabout &&
                                        TheyAreInRoundabout
                                    ) {
                                        isStopped = true;
                                        targetMultiplier = 0;
                                        break;
                                    }

                                    if (
                                        this.uniqueId > (other as any).uniqueId
                                    ) {
                                        if (!isFrustrated) {
                                            isStopped = true;
                                            targetMultiplier = 0;
                                            break;
                                        } else {
                                            targetMultiplier = Math.min(
                                                targetMultiplier,
                                                0.4,
                                            );
                                            continue;
                                        }
                                    } else {
                                        targetMultiplier = Math.min(
                                            targetMultiplier,
                                            1.2,
                                        );
                                        continue;
                                    }
                                }

                                if (dist < safeDistance) {
                                    if (!isFrustrated) {
                                        isStopped = true;
                                        targetMultiplier = 0;
                                        break;
                                    } else {
                                        targetMultiplier = Math.min(
                                            targetMultiplier,
                                            0.3,
                                        );
                                    }
                                } else {
                                    const brakeFactor =
                                        (dist - safeDistance) /
                                        (slowDistance - safeDistance);
                                    targetMultiplier = Math.min(
                                        targetMultiplier,
                                        Math.max(0, brakeFactor),
                                    );
                                }
                            }
                        }
                    }
                    if (isStopped) break;
                }
                if (isStopped) break;
            }
        }

        if (targetMultiplier < 0.5) {
            this.waitTimer += deltaSeconds;
        } else {
            this.waitTimer = Math.max(0, this.waitTimer - deltaSeconds * 2);
        }

        if (isStopped) {
            this.appliedMultiplier = Math.max(
                0,
                this.appliedMultiplier - deltaSeconds * 3,
            );
        } else if (this.appliedMultiplier < targetMultiplier) {
            this.appliedMultiplier = Math.min(
                targetMultiplier,
                this.appliedMultiplier + deltaSeconds * 1.5,
            );
        } else if (this.appliedMultiplier > targetMultiplier) {
            this.appliedMultiplier = Math.max(
                targetMultiplier,
                this.appliedMultiplier - deltaSeconds * 3,
            );
        }

        const distance = Phaser.Math.Distance.Between(
            this.x,
            this.y,
            targetX,
            targetY,
        );
        const currentSpeed = this.speed * this.appliedMultiplier;
        const moveDistance = currentSpeed * deltaSeconds;

        if (distance < moveDistance) {
            this.x = targetX;
            this.y = targetY;
        } else {
            const angleToTargetMove = Phaser.Math.Angle.Between(
                this.x,
                this.y,
                targetX,
                targetY,
            );
            this.x += Math.cos(angleToTargetMove) * moveDistance;
            this.y += Math.sin(angleToTargetMove) * moveDistance;
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
        targetX: number,
        targetY: number,
        container: GameObjects.Container,
    ): boolean {
        const path = this.findPath(targetX, targetY, container);
        return path.length > 0;
    }

    private findPath(
        targetGridX: number,
        targetGridY: number,
        _targetContainer: GameObjects.Container,
    ): { x: number; y: number }[] {
        const game = this.scene as any;
        const graph = Path.connectivityGraph;

        const startGridX = Math.floor(this.x / Building.GRID_SIZE);
        const startGridY = Math.floor(this.y / Building.GRID_SIZE);

        if (startGridX === targetGridX && startGridY === targetGridY) return [];

        // 0. Path Cache Check
        if (Worker.cacheVersion !== Path.networkVersion) {
            Worker.pathCache.clear();
            Worker.cacheVersion = Path.networkVersion;
        }

        const startKey = GridUtils.getKey(startGridX, startGridY);
        const targetKey = GridUtils.getKey(targetGridX, targetGridY);

        const cacheKey = `${startKey}_${targetKey}_${this.depth < 5}`;
        if (Worker.pathCache.has(cacheKey as any)) {
            return [...Worker.pathCache.get(cacheKey as any)!];
        }

        const getStructureAt = (gx: number, gy: number) => {
            return game.structureGrid.get(GridUtils.getKey(gx, gy));
        };

        const isCurrentlySubterranean = this.depth < 5;

        // A* Pathfinding
        // queue stores { x, y, isSub, cost, priority }
        const queue: { x: number; y: number; isSub: boolean; priority: number }[] = [];
        const parents = new Map<number, number | null>();
        const costs = new Map<number, number>();

        const getVisitedKey = (gx: number, gy: number, sub: boolean) => {
            return ((gx & 0x3ff) << 11) | ((gy & 0x3ff) << 1) | (sub ? 1 : 0);
        };

        const addToQueue = (
            qx: number,
            qy: number,
            qSub: boolean,
            pKey: number | null,
            stepCost: number
        ) => {
            const vKey = getVisitedKey(qx, qy, qSub);
            const newCost = (pKey !== null ? (costs.get(pKey) || 0) : 0) + stepCost;

            if (!costs.has(vKey) || newCost < (costs.get(vKey) || 0)) {
                costs.set(vKey, newCost);
                parents.set(vKey, pKey);
                
                // Heuristic: Manhattan distance to target
                const h = Math.abs(qx - targetGridX) + Math.abs(qy - targetGridY);
                const priority = newCost + h;
                
                queue.push({ x: qx, y: qy, isSub: qSub, priority });
                // Keep queue sorted by priority (simplified A*)
                queue.sort((a, b) => a.priority - b.priority);
                return true;
            }
            return false;
        };

        // ROBUST START DISCOVERY
        let onValidNode = !!getStructureAt(startGridX, startGridY) || graph.has(startKey);
        if (onValidNode) {
            addToQueue(startGridX, startGridY, isCurrentlySubterranean, null, 0);
        } else {
            // Expanded Snap Logic (Search 5x5 area)
            let snapFound = false;
            for (let r = 0; r <= 2 && !snapFound; r++) {
                for (let dx = -r; dx <= r && !snapFound; dx++) {
                    for (let dy = -r; dy <= r && !snapFound; dy++) {
                        const nx = startGridX + dx;
                        const ny = startGridY + dy;
                        const paths = Path.pathGrid.get(GridUtils.getKey(nx, ny));
                        const matchingPath = paths?.find(p => p.isMotorway === isCurrentlySubterranean);
                        
                        if (matchingPath) {
                            // If we're on a path, we can reach its nodes
                            // Note: One-way roads are handled below during neighbor expansion
                            matchingPath.points.forEach(pt => {
                                if (graph.has(GridUtils.getKey(pt.x, pt.y))) {
                                    addToQueue(pt.x, pt.y, matchingPath.isMotorway, null, r);
                                }
                            });
                            snapFound = true;
                        }
                    }
                }
            }
        }

        let foundVKey = -1;
        while (queue.length > 0) {
            const { x, y, isSub } = queue.shift()!;
            const currentVKey = getVisitedKey(x, y, isSub);

            if (x === targetGridX && y === targetGridY) {
                foundVKey = currentVKey;
                break;
            }

            const currentKey = GridUtils.getKey(x, y);
            const neighbors = graph.get(currentKey);

            if (neighbors) {
                const pathsAtCurrent = Path.pathGrid.get(currentKey);
                neighbors.forEach(neighborKey => {
                    const { x: nx, y: ny } = GridUtils.getCoords(neighborKey);
                    const connectingPath = pathsAtCurrent?.find(p => 
                        (p.points[0].x === nx && p.points[0].y === ny) ||
                        (p.points[1].x === nx && p.points[1].y === ny)
                    );

                    if (connectingPath) {
                        // Check one-way directionality
                        if (connectingPath.isOneWay) {
                            const isTowardsEnd = connectingPath.points[1].x === nx && connectingPath.points[1].y === ny;
                            if (!isTowardsEnd) return; // Can't go backwards
                        }
                        
                        const dist = Math.sqrt(Math.pow(nx-x, 2) + Math.pow(ny-y, 2));
                        addToQueue(nx, ny, connectingPath.isMotorway, currentVKey, dist);
                    }
                });
            }

            // Structure permeability (moving within a building/house)
            const struct = getStructureAt(x, y);
            if (struct && !(struct instanceof Roundabout) && !isSub) {
                const adj = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}];
                for (const offset of adj) {
                    const nx = x + offset.x, ny = y + offset.y;
                    if (getStructureAt(nx, ny) === struct) {
                        addToQueue(nx, ny, false, currentVKey, 1);
                    }
                }
            }
        }

        if (foundVKey !== -1) {
            const path: { x: number; y: number }[] = [];
            let curr: number | null = foundVKey;
            while (curr !== null) {
                path.push({ x: (curr >> 11) & 0x3ff, y: (curr >> 1) & 0x3ff });
                curr = parents.get(curr) ?? null;
            }
            path.reverse();
            if (path.length > 0) path.shift(); // Skip start cell
            
            Worker.pathCache.set(cacheKey as any, path);
            return path;
        }

        return [];
    }
}
