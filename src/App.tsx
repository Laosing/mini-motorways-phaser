import { useRef, useState } from "react";
import { IRefPhaserGame, PhaserGame } from "./PhaserGame";
import { MainMenu } from "./game/scenes/MainMenu";

function App() {
    // The sprite can only be moved in the MainMenu Scene
    const [isPaused, setIsPaused] = useState(false);
    const [canPause, setCanPause] = useState(false);

    //  References to the PhaserGame component (game and scene are exposed)
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    const changeScene = () => {
        if (phaserRef.current) {
            const scene = phaserRef.current.scene as MainMenu;

            if (scene) {
                scene.changeScene();
            }
        }
    };

    const toggleSpawning = () => {
        if (phaserRef.current) {
            const scene = phaserRef.current.scene as any;

            if (scene && scene.scene.key === "Game") {
                const paused = scene.toggleSpawning();
                setIsPaused(paused);
            }
        }
    };


    const [placementMode, setPlacementMode] = useState("ROAD");

    // Event emitted from the PhaserGame component
    const currentScene = (scene: Phaser.Scene) => {
        setCanPause(scene.scene.key === "Game");
        
        if (scene.scene.key === "Game") {
            // Handle mode changes from within Phaser (e.g. after placement)
            import("./game/EventBus").then(m => {
                m.EventBus.on("placement-mode-changed", (mode: string) => {
                    setPlacementMode(mode);
                });
            });
        }
    };

    const toggleRoundaboutMode = () => {
        if (phaserRef.current) {
            const scene = phaserRef.current.scene as any;
            if (scene && scene.scene.key === "Game") {
                const newMode = placementMode === "ROUNDABOUT" ? "ROAD" : "ROUNDABOUT";
                scene.setPlacementMode(newMode);
                setPlacementMode(newMode);
            }
        }
    };

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} currentActiveScene={currentScene} />
            <div className="ui-container">
                <div className="button-group">
                    <button className="button" onClick={changeScene}>
                        Change Scene
                    </button>
                    <button
                        disabled={!canPause}
                        className="button"
                        onClick={toggleSpawning}
                    >
                        {isPaused ? "Resume Spawning" : "Pause Spawning"}
                    </button>
                </div>

                <div className="button-group">
                    <button 
                        className={`button ${placementMode === "ROAD" ? "active" : ""}`}
                        onClick={() => toggleRoundaboutMode()}
                    >
                        {placementMode === "ROUNDABOUT" ? "Cancel Roundabout" : "Add Roundabout"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default App;
