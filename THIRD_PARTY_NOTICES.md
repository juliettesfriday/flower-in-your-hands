# 第三方素材与依赖

## 花卉图像

`public/media/` 中花卉序列帧由用户提供的「致奇」数字花卉视频提取：

- 馥郁之诗：数字花卉 No.022 馥郁（原视频标识 6aae93d1000000002803977c）
- 春：HOUDINI 数字花卉 #12（69550238000000001e00409d）
- 富士山下：FLOWER_FLOWING 花绽时流（686e5762000000000d01b7f9）

素材未取得可核实的开源许可，不适用本仓库 MIT 许可；权利归原作者。重新分发、改编或商业使用须取得权利人许可。

## 演示视频

项目维护者提供的演示视频用于展示交互效果。演示视频、封面、人像、音乐及所含第三方画面不适用 MIT 许可。Release 中提供用户指定的原始视频；docs/demo.mp4 为便于网页播放的 H.264/AAC 版本。

## MediaPipe

`public/vendor/mediapipe/`：Google MediaPipe Tasks Vision 0.10.21，Apache-2.0。
项目：https://github.com/google-ai-edge/mediapipe
许可：https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

`public/models/hand_landmarker.task`：Google 官方 hand_landmarker float16/1 模型。
来源：https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
文档：https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
