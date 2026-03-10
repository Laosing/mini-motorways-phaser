import { Scene, GameObjects } from "phaser";
import { Path } from "./Path";

export type Direction8 = "up" | "down" | "left" | "right" | "up-left" | "up-right" | "down-left" | "down-right";

export interface HouseConfig {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: number;
    gridX: number;
    gridY: number;
}

export class House extends GameObjects.Container {
    public gridX: number;
    public gridY: number;
    public lastSpawnTime: number = 0;
    public static readonly GRID_SIZE = 32;

    private currentDir: Direction8;
    private drivewayTarget: { x: number, y: number } | null = null;
    private borderGraphics: GameObjects.Graphics;
    private doorSprite: GameObjects.Rectangle;
    public bodyColor: number;

    constructor(
        scene: Scene,
        gridX: number,
        gridY: number,
        gridWidth: number = 1,
        gridHeight: number = 1,
        color: number = 0x4a90e2,
        entranceDir?: Direction8,
    ) {
        const x = gridX * House.GRID_SIZE;
        const y = gridY * House.GRID_SIZE;
        const width = gridWidth * House.GRID_SIZE;
        const height = gridHeight * House.GRID_SIZE;

        super(scene, x, y);

        this.gridX = gridX;
        this.gridY = gridY;
        this.bodyColor = color;

        // Long Shadow
        const shadowG = scene.add.graphics();
        shadowG.fillStyle(0x000000, 0.12);
        const L = 16; // Shadow length
        const points = [
            { x: width, y: 0 },         // Top Right
            { x: width + L, y: L },     // Projected Top Right
            { x: width + L, y: height + L }, // Projected Bottom Right
            { x: L, y: height + L },    // Projected Bottom Left
            { x: 0, y: height },        // Bottom Left
            { x: width, y: height }     // Bottom Right
        ];
        shadowG.fillPoints(points);
        this.add(shadowG);

        // Main building body
        const shape = scene.add.rectangle(0, 0, width, height, color);
        shape.setOrigin(0, 0);
        this.add(shape);

        // Determine initial entrance direction
        const directions: Direction8[] = ["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"];
        this.currentDir = entranceDir || directions[Math.floor(Math.random() * directions.length)];
        
        // Initialize graphics
        this.borderGraphics = scene.add.graphics();
        this.add(this.borderGraphics);
        this.doorSprite = scene.add.rectangle(0, 0, 0, 0, color);
        // Rotate door sprite to match diagonal if needed
        this.add(this.doorSprite);

        this.setSize(width, height);
        this.updateVisuals();

        scene.add.existing(this);
        this.setDepth(2);

        // Rotation is now handled by dragging in Game.ts
        this.setInteractive();

        // Add a shadow-like effect
        this.setAlpha(0);
        scene.tweens.add({
            targets: this,
            alpha: 1,
            duration: 500,
            ease: "Power2",
        });
    }

    public setDirection(dir: Direction8) {
        if (this.currentDir === dir) return;
        this.currentDir = dir;
        this.updateVisuals();
    }

    private updateVisuals() {
        const width = this.width;
        const height = this.height;
        const color = this.bodyColor;

        this.borderGraphics.clear();
        this.borderGraphics.lineStyle(3, 0x2c3e50);
        this.borderGraphics.beginPath();

        let doorX = 16, doorY = height, doorW = 16, doorH = 4, doorAngle = 0;
        let dTargetX = this.gridX, dTargetY = this.gridY + 1;

        if (this.currentDir === "down") {
            dTargetX = this.gridX; dTargetY = this.gridY + 1;
            doorX = 16; doorY = height; doorW = 16; doorH = 4;
            this.borderGraphics.moveTo(24, height);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(8, height);
        } else if (this.currentDir === "up") {
            dTargetX = this.gridX; dTargetY = this.gridY - 1;
            doorX = 16; doorY = 0; doorW = 16; doorH = 4;
            this.borderGraphics.moveTo(8, 0);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(24, 0);
        } else if (this.currentDir === "left") {
            dTargetX = this.gridX - 1; dTargetY = this.gridY;
            doorX = 0; doorY = 16; doorW = 4; doorH = 16;
            this.borderGraphics.moveTo(0, 24);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(0, 8);
        } else if (this.currentDir === "right") {
            dTargetX = this.gridX + 1; dTargetY = this.gridY;
            doorX = width; doorY = 16; doorW = 4; doorH = 16;
            this.borderGraphics.moveTo(width, 8);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(width, 24);
        } else if (this.currentDir === "down-right") {
            dTargetX = this.gridX + 1; dTargetY = this.gridY + 1;
            doorX = width - 4; doorY = height - 4; doorW = 12; doorH = 4; doorAngle = -45;
            this.borderGraphics.moveTo(width - 8, height);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(width, height - 8);
        } else if (this.currentDir === "down-left") {
            dTargetX = this.gridX - 1; dTargetY = this.gridY + 1;
            doorX = 4; doorY = height - 4; doorW = 12; doorH = 4; doorAngle = 45;
            this.borderGraphics.moveTo(8, height);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(0, height - 8);
        } else if (this.currentDir === "up-right") {
            dTargetX = this.gridX + 1; dTargetY = this.gridY - 1;
            doorX = width - 4; doorY = 4; doorW = 12; doorH = 4; doorAngle = 45;
            this.borderGraphics.moveTo(width - 8, 0);
            this.borderGraphics.lineTo(0, 0);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(width, 8);
        } else if (this.currentDir === "up-left") {
            dTargetX = this.gridX - 1; dTargetY = this.gridY - 1;
            doorX = 4; doorY = 4; doorW = 12; doorH = 4; doorAngle = -45;
            this.borderGraphics.moveTo(8, 0);
            this.borderGraphics.lineTo(width, 0);
            this.borderGraphics.lineTo(width, height);
            this.borderGraphics.lineTo(0, height);
            this.borderGraphics.lineTo(0, 8);
        }

        this.borderGraphics.strokePath();
        
        this.doorSprite.setPosition(doorX, doorY);
        this.doorSprite.setSize(doorW, doorH);
        this.doorSprite.setAngle(doorAngle);
        this.doorSprite.setFillStyle(color);

        // Remove old fixture if it exists
        if (this.drivewayTarget) {
            Path.removeFixture(this.gridX, this.gridY, this.drivewayTarget.x, this.drivewayTarget.y);
        }

        // Add new fixture
        this.drivewayTarget = { x: dTargetX, y: dTargetY };
        Path.add(this.scene, this.gridX, this.gridY, dTargetX, dTargetY, true);
    }

    public rotate() {
        const directions: Direction8[] = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];
        const currentIndex = directions.indexOf(this.currentDir);
        this.currentDir = directions[(currentIndex + 1) % 8];
        this.updateVisuals();
    }
}
