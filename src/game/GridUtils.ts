
export class GridUtils {
    /**
     * Converts grid coordinates into a numeric key.
     * Uses a 16-bit shift which supports coordinates up to 65535.
     */
    public static getKey(gx: number, gy: number): number {
        return (gx << 16) | gy;
    }

    /**
     * Extracts coordinates from a numeric key.
     */
    public static getCoords(key: number): { x: number; y: number } {
        return {
            x: key >> 16,
            y: key & 0xFFFF
        };
    }
}
