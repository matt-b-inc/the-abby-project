# Prototype asset notes

This selection makes the first scene usable without drawing characters, modeling pets, or authoring movement animations. Keep original source assets under `Assets/ThirdParty`; presentation definitions and generated project materials belong elsewhere. Gameplay identities and saved progression should refer to the project's content IDs, never a Kenney filename.

## Selected models

Paths below are relative to `Assets/ThirdParty/Kenney`.

| Role | Model | Appearance | Texture |
| --- | --- | --- | --- |
| Default player | `BlockyCharacters/Models/character-f.fbx` | Green shirt | `BlockyCharacters/Models/Textures/texture-f.png` |
| Alternate player | `BlockyCharacters/Models/character-a.fbx` | Orange outdoor jacket | `BlockyCharacters/Models/Textures/texture-a.png` |
| Default companion | `CubePets/Models/animal-dog.fbx` | Brown dog | `CubePets/Models/Textures/colormap.png` |
| Alternate companion | `CubePets/Models/animal-fox.fbx` | Orange fox | Same shared colormap |

`NatureKit/Models` includes two trees, a rock, a bush, a flower, a small open tent, campfire logs, a fallen log, and a wooden sign. These models use named flat-color materials embedded in the FBX; there are no external texture dependencies. Preserve each renderer's material slots when adjusting shaders so a tree retains separate bark and leaves.

The selected FBX source files import directly in Unity. No Blender installation, `.blend` import, GLTF plugin, or additional asset-store package is required. Original ZIPs also include GLB/OBJ versions, but those redundant formats are excluded from this project.

## Animation mapping

Exact case-sensitive source take names were inspected in the FBX files and checked against the companion GLB versions in the official archives. Use Generic rigs: these models animate a hierarchy of rigid mesh parts rather than a humanoid skinned skeleton.

| Gameplay intent | Blocky character take | Cube pet take |
| --- | --- | --- |
| Rest | `idle` | `idle` |
| Movement | `walk` | `walk` |
| Faster movement | `sprint` | `run` |
| Positive reaction | `emote-yes` | `gesture-positive` |
| Celebration | `emote-yes` | `dance` |
| Object interaction | `interact-right` or `interact-left` | `eat` |

All eight pet takes: `static`, `idle`, `walk`, `run`, `eat`, `dance`, `gesture-positive`, `gesture-negative`.

All 27 character takes: `static`, `idle`, `walk`, `sprint`, `sit`, `drive`, `die`, `pick-up`, `emote-yes`, `emote-no`, `holding-right`, `holding-left`, `holding-both`, `holding-right-shoot`, `holding-left-shoot`, `holding-both-shoot`, `attack-melee-right`, `attack-melee-left`, `attack-kick-right`, `attack-kick-left`, `interact-right`, `interact-left`, `wheelchair-sit`, `wheelchair-move-forward`, `wheelchair-move-back`, `wheelchair-move-left`, `wheelchair-move-right`.

Only the prototype's rest, movement, and positive-reaction clips need controller states. The original takes are retained unmodified; importing the FBX does not require exposing every take as a game action.

## Scale and orientation

All selected sources are Y-up with their resting geometry grounded at Y=0. Animated FBX files specify centimeters; their source translations are about 100 units. Unity's normal file-unit conversion should produce a character about 2.7 units tall. Source OBJ resting bounds are approximately 1.6 × 2.7 × 0.8 for either character, 1.26 × 1.58 × 1.50 for the dog, and 1.25 × 1.69 × 2.31 for the fox including its tail. Animation can extend these bounds.

Nature FBX files specify decimeters and use a different source scale. Normalize actual imported renderer bounds to the desired scene size rather than hard-coding one scale across all packs. Reasonable initial targets are a 1.75-unit player and 0.75-unit companion. Verify facing direction in the scene before adjusting the visual definition's local rotation. Keep collision and interaction dimensions on the gameplay object, separate from the model child.

## Replacing a visual later

1. Import a new model into its own source folder and retain its license.
2. Create or update its visual definition with the prefab, scale, offset, and orientation.
3. Map its animations to the existing gameplay intents. A new rig can have its own controller.
4. Assign that definition to the player or companion; preserve the gameplay identity and saved progression.
5. Check movement direction, grounding, interaction reach, reward reaction, and lighting in the scene.

The included dog/fox and green-shirt/orange-jacket choices provide a small, concrete appearance-swap check without changing gameplay code or save data. Future asset packs may require additional rig and material setup, but should not require rewriting the habit loop.

Pack provenance and license paths are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Kenney's official import reference is [Importing 3D models into game engines](https://kenney.nl/knowledge-base/game-assets-3d/importing-3d-models-into-game-engines).
