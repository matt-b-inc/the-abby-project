# Prototype asset notes

This selection makes the first scene usable without drawing characters, modeling pets, or authoring movement animations. Keep original source assets under `Assets/ThirdParty`; presentation definitions and generated project materials belong elsewhere. Gameplay identities and saved progression should refer to the project's content IDs, never a Kenney filename.

## Shared meadow presentation

The first meadow slice uses the same temporary dragon expressions, memory-bloom icon, palette and Nunito font as React. Canonical sources are under `shared/storybook`; `scripts/storybook/sync_presentation.py` copies runtime exports into both clients. Temporary dragon and bloom SVGs are project-authored illustrations, with PNG exports, rather than licensed store previews or a substitute for the final purchased models.

Nunito comes from the official Google Fonts repository (`google/fonts`, `ofl/nunito`). The static runtime font is an instance of the variable font at weight 600, with the OFL license also embedded in its metadata. The original variable font and copyright/license text remain in `shared/storybook/fonts`.

The authored presentation and dragon definition live under `Assets/AbbyCamp/Presentation`, outside generated Kenney defaults. A model takes precedence over a portrait. Model controllers map speed and celebration intents; portrait definitions can provide idle, happy and blink sprites with camera-facing rendering and local reactions. Both preserve the gameplay root, collider, following behavior and content identity. Rebuilds validate these references and the canonical palette instead of replacing authored art.

Meshtint's Cute Series is the current ready-made candidate for companions, growth forms, scenery and matching web portraits. No paid Meshtint or 3DDisco assets are included in this slice. Purchased source models, textures and packages must stay out of the public source repository; importing one requires a separate local source folder and a retained applicable license. Do not assume humanoid accessories fit a dragon or that recolors supply evolved body forms.

Start with the [Spark / Fire / Inferno evolution pack](https://www.meshtint.com/products/dragon-fire-inferno-evolution-pack-cute-series) and its [matching portrait icons](https://www.meshtint.com/products/icons-for-monsters-ultimate-pack-02-cute-series). These provide three distinct dragon forms and web portraits without custom drawing. The Fire stage advertises flying locomotion, so each form needs its own animation mapping. No common skeleton, fitted dragon wardrobe, or further evolution forms are promised. Simple attached accessories can be fitted per stage; deforming clothing requires additional modeling/rigging work.

Later scenery can come from [Forest Ruins](https://www.meshtint.com/products/forest-ruins-pack-cute-series), and a player avatar from the [modular Female Archer](https://www.meshtint.com/products/female-archer-modular-pack-01-cute-series), within the same Cute Series. Meshtint's Toon and Polygonal lines have different styles. Check materials in this project's URP configuration and test the actual models on Android before expanding the library. The publisher's [direct-store license](https://www.meshtint.com/pages/terms-of-use-license) allows modifications and app/website use but restricts distributing the source assets. Use licensed embedded exports for the app; keep paid raw sources in private storage.

## Original harness models

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
