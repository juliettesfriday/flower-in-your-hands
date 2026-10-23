# 馥郁之诗：补齐闭合状态

原素材是已盛开的淡紫色褶皱花朵，没有闭合成花苞的片段；倒放原片也不能得到真实闭合。现有交互中明确标为“舒展”，不把它冒充成完整开合。

## 生成方案

使用 `public/media/fuyu/poster.webp` 的花型作为参考，在 Google Flow 中选择支持首帧参考的 Veo 视频模式，制作“盛开→闭合”的固定机位镜头；检查后倒序导出，即为“闭合→盛开”的手势序列。优先生成一条，不购买订阅或充值。

如 Veo 不能保持花型或花瓣拓扑，优先保留原片，并另行补拍/获取花苞至盛开的原始渲染。不能把生成质量当作保证。

## 可直接使用的提示词

Use the supplied reference as the exact flower identity. One single pale lavender, densely ruffled flower, centered in the frame, isolated on a uniform near-black background (#08090b). Preserve its distinctive ivory and lilac petals, realistic satin texture and soft side lighting. Locked-off camera, no camera rotation, no zoom, no lateral movement. Show the complete flower with generous empty space on every side and no cropped petals.

Starting with the fully open reference flower, the petals slowly and continuously fold inward, layer by layer, until they form a compact, fully closed natural flower bud. Each petal remains attached to the same flower throughout. Monotonic closure from open to closed, a single continuous 8-second shot. Keep the flower centered and its scale stable. The center of the bud remains in the same position. No wind, no floating petals, no hands, no text, no additional flowers, no environment, no cuts, no fade to black, no dissolves, no growing a second flower. Hold the completely closed bud still for the last half second. Silent video.

## 接入检查

- 必须真的闭合到花苞；不以画面缩小、透明度变化代替花瓣闭合。
- 花型、材质、色相应与原素材一致。
- 关闭后仍然是一朵完整花，不能消失。
- 头尾选帧后倒序，导出 96 张 640×640 透明 WebP，并保持相同的主体中心与全局比例。
- 换入 `public/media/fuyu/000.webp` 至 `095.webp`，更新 `manifest.json` 的能力说明，再跑浏览器检查。

## 当前接入状态

2026-10-22：已检查可用插件，没有直接提供 Veo 的已连接工具。打开官方 Google Flow 后，页面位于 `https://flow.google.com/unsupported-country`，并显示首次使用隐私说明。尚未接受首次使用条款、上传素材或发起生成。账号/地区可用性和额度仍待确认。

另已检查当前 Gemini 网页的工具菜单，没有显示视频生成工具。找到支持 Veo 3.1 的 Higgsfield 官方入口（https://higgsfield.ai/veo3.1），并提供了 Higgsfield 插件安装/连接入口；连接状态尚未确认。接通后需先查模型可用性和额度，再发起一条花朵闭合视频。没有购买订阅、充值或调用付费生成。
