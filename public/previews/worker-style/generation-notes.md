# 普通工人 · 包工头画风预览

生成方式：内置 image_gen 工具。仅预览，不替换正式游戏人物。

## 输入

- 画风权威：`public/foreman.png`
- 身份、服装、姿势：`public/worker.png`

## 首次完整提示词

Use case: style-transfer.
Asset type: a single transparent full-body ordinary worker sprite for the isometric workshop game Plot Workers, to be compared in a separate preview only.

Input images: Image 1 (foreman.png) is the sole art-style authority. Image 2 (worker.png) is the identity, outfit, palette, and neutral standing-pose reference. Redraw Image 2 as a member of Image 1's exact visual family.

Primary request: Render one ordinary adult worker with simple dark short hair, a plain mustard-yellow short-sleeve shirt, blue-gray trousers, and dark charcoal work shoes. Both bare arms hang naturally at the sides, relaxed compact block hands, feet planted in a stable neutral stance. Keep the worker unadorned: no helmet, tools, belt accessories, radio, or held objects.

Style/medium: match Image 1's low-poly geometric 3D cut-paper-like facets exactly: angular polygonal silhouette, chunky limbs, large simple matte color planes, just a few darker planes for volume, simplified roughly 3.5-head-tall adult proportions. A solid peach face with absolutely no eyes, eyebrows, nose, or mouth. Hair is a small set of dark geometric masses, not individual strands. Simplified body and clothes with no tiny detail. No cartoon outlines, no photorealistic textures, no smooth clay rendering.
Composition/framing: front view with a slight 3/4 turn and slight elevated camera as in the foreman. One centered full-body figure, both shoes completely visible. Portrait canvas. The figure occupies approximately 90% of canvas height. Keep the silhouette readable when displayed at 64 by 104 pixels.
Scene/backdrop: genuinely transparent alpha background. Isolated sprite only.
Lighting/mood: restrained directional face shading like the foreman, friendly neutral warm light, without glow.
Constraints: preserve the ordinary worker's yellow-shirt / blue-gray-trouser identity and resting arms. Use the foreman's facial simplicity and geometric facet vocabulary. Clean precise cutout edges. No text or watermark. Do not copy the reference's halo or aura. No floor, no background color, no cast shadow, no vignette, no glow, no ambient haze. The game renders its own foot shadow.

## 一次定向去光晕修正提示词

Use case: background-extraction.
Edit the attached worker sprite with ONE narrowly scoped change: remove all soft glow, haze, halo, and shadow around the character. Preserve the character itself, its polygonal shape, face, pose, exact yellow shirt, blue-gray trousers, dark hair and shoes, scale, composition, and all internal colors and shading completely unchanged. Do not redesign anything.

Cut out the character exactly along the hard geometric silhouette, including the arm-to-body gaps and leg gap. Outside the crisp polygon boundary, alpha must be fully 0, including immediately next to the boundary. Inside the character, alpha must be fully opaque except for minimal one-pixel edge antialiasing. There must be NO semitransparent surrounding colored glow, NO feathered edge, NO shadow below the shoes, NO black or white background. This is a tiny in-game sprite, not a glowing illustration. Keep the full 1024x1536 portrait canvas framing with both feet complete. Output a real transparent PNG cutout.

## 文件记录

- 首次原图保留为 `worker-foreman-style-v1-source.png`。
- 修正结果保留为 `worker-foreman-style-v1.png`。
- 原始工具输出保留在 `/Users/lazymice/.codex/generated_images/01a13a48-e1e8-7af1-92d4-6b3947e2369b/`。
- 尺寸：1024 × 1536，RGBA。内置工具生成的边缘仍有软透明光晕；未用外部方式重绘或修改像素。

