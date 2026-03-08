import { Scene, GameObjects } from "phaser";
import { Path } from "./Path";
import { Building } from "./Building";

export class Roundabout extends GameObjects.Container {
    public gridX: number;
    public gridY: number;
    public static readonly SIZE = 3; // Upgrade to 3x3

    constructor(scene: Scene, gridX: number, gridY: number) {
        const x = gridX * Building.GRID_SIZE;
        const y = gridY * Building.GRID_SIZE;
        const pixelSize = Roundabout.SIZE * Building.GRID_SIZE;

        super(scene, x, y);

        this.gridX = gridX;
        this.gridY = gridY;

        // Roundabout visuals are handled by Path.render()
        scene.add.existing(this);
        this.setDepth(1.5);

        this.setupConnectivity(scene);
    }

    public static draw(
        graphics: GameObjects.Graphics,
        pixelSize: number,
        alpha: number = 1.0,
    ) {
        // Roundabout visuals are now handled by the one-way paths and arrows
        // in Path.render(), maintaining a cleaner, more integrated look.
    }

    private setupConnectivity(scene: Scene) {
        const gx = this.gridX;
        const gy = this.gridY;

        // Clear existing non-fixture paths in the 3x3 area
        for (let ox = 0; ox < Roundabout.SIZE; ox++) {
            for (let oy = 0; oy < Roundabout.SIZE; oy++) {
                Path.removeAt(gx + ox, gy + oy);
            }
        }

        // ONE-WAY PERIMETER LOOP (Clockwise)
        // Perimeter nodes: (0,0), (1,0), (2,0), (2,1), (2,2), (1,2), (0,2), (0,1)

        // Top edge
        Path.add(scene, gx, gy, gx + 1, gy, true, true);
        Path.add(scene, gx + 1, gy, gx + 2, gy, true, true);

        // Right edge
        Path.add(scene, gx + 2, gy, gx + 2, gy + 1, true, true);
        Path.add(scene, gx + 2, gy + 1, gx + 2, gy + 2, true, true);

        // Bottom edge
        Path.add(scene, gx + 2, gy + 2, gx + 1, gy + 2, true, true);
        Path.add(scene, gx + 1, gy + 2, gx, gy + 2, true, true);

        // Left edge
        Path.add(scene, gx, gy + 2, gx, gy + 1, true, true);
        Path.add(scene, gx, gy + 1, gx, gy, true, true);
    }

    public removeRoundabout() {
        const gx = this.gridX;
        const gy = this.gridY;

        // Remove all fixtures in the loop
        Path.removeFixture(gx, gy, gx + 1, gy);
        Path.removeFixture(gx + 1, gy, gx + 2, gy);
        Path.removeFixture(gx + 2, gy, gx + 2, gy + 1);
        Path.removeFixture(gx + 2, gy + 1, gx + 2, gy + 2);
        Path.removeFixture(gx + 2, gy + 2, gx + 1, gy + 2);
        Path.removeFixture(gx + 1, gy + 2, gx, gy + 2);
        Path.removeFixture(gx, gy + 2, gx, gy + 1);
        Path.removeFixture(gx, gy + 1, gx, gy);

        this.destroy();
    }

    public static canPlaceAt(scene: any, gx: number, gy: number): boolean {
        // Prevent overlapping ANY existing structure (Building, House, or Roundabout)
        for (let ox = 0; ox < Roundabout.SIZE; ox++) {
            for (let oy = 0; oy < Roundabout.SIZE; oy++) {
                if (scene.structureGrid.has(`${gx + ox},${gy + oy}`)) {
                    return false;
                }
            }
        }
        return true;
    }
}
