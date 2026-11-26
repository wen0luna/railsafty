# 路瞳 RailSafty

基于 **Three.js 0.187.0 + TypeScript + Vite** 的铁路沿线安全监测数字孪生演示，默认展示 **广西铁路 · 青山段**。山地、河流、高架双线铁路、接触网、运行列车及 24 台感知设备均使用程序化几何构建，无需下载模型或使用外部服务。

## 运行

需要 Node.js 22.18+，推荐 Node.js 24 或更高版本。

```powershell
npm install
npm run dev
```

打开终端显示的本地地址，默认 `http://127.0.0.1:5173`。

```powershell
npm run build
npm test
npm run preview
```

## 容器部署

支持 Docker Engine、Docker Desktop（**Linux 容器**模式）及 Podman。宿主机无需安装 Node.js。镜像通过 Node.js 24 执行 `npm ci` 和生产构建，运行阶段仅保留构建产物，由非 root Nginx 在容器内的 `8080` 端口提供服务，不使用 Vite 开发服务器。

### Podman

Windows/macOS 上需要先启动 Podman machine；首次使用且尚未创建 machine 时执行：

```powershell
podman machine init
podman machine start
```

已有 machine 时不要重复初始化，仅在其停止时执行 `podman machine start`；Linux 原生 Podman 不需要此步骤。若当前终端找不到 `podman`，安装后重新打开终端，或使用 Podman 安装目录内的可执行文件。

```powershell
podman build --format docker -t localhost/railsafty:local .
podman run -d --name railsafty --restart unless-stopped -p 8080:8080 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges:true localhost/railsafty:local
```

访问 **http://localhost:8080**。`--format docker` 用于保留 Dockerfile 中的 `HEALTHCHECK`，避免默认 OCI 格式忽略该指令；以上命令直接使用 Podman，无需安装 Compose provider。

查看健康状态与日志：

```powershell
podman healthcheck run railsafty
podman inspect --format '{{.State.Health.Status}}' railsafty
podman logs railsafty
```

修改代码后重新构建镜像，再停止并移除旧容器，使用上面的 `podman run` 命令创建新容器。停止并移除服务：

```powershell
podman stop railsafty
podman rm railsafty
```

### Docker Compose

需要 Docker Compose v2 或更高版本。

在项目根目录执行：

```powershell
docker compose up -d --build --wait
```

访问 **http://localhost:8080**。中英文界面、异常演练和视觉雷达融合重建均使用同一份部署产物。`/healthz` 返回 `ok`，镜像内置的健康检查会用于 `--wait` 就绪判断。

默认映射宿主机 `8080` 端口；如有冲突，可在项目根目录的 `.env` 中设置 `RAILSAFTY_PORT=9090`，或在 PowerShell 中执行：

```powershell
$env:RAILSAFTY_PORT = "9090"
docker compose up -d --build --wait
```

此时访问 `http://localhost:9090`。查看状态、日志及停止服务：

```powershell
docker compose ps
docker compose logs -f railsafty
docker compose down
```

修改代码后重新运行 `docker compose up -d --build --wait` 即可更新；如需同时拉取最新基础镜像，先运行 `docker compose build --pull`。Compose 使用只读根文件系统，仅为 `/tmp` 提供临时内存空间，并移除 Linux capabilities；无需挂载源码、`node_modules` 或持久化数据卷。

### 直接使用 Docker

```powershell
docker build --pull -t railsafty:local .
docker run -d --name railsafty --restart unless-stopped -p 8080:8080 --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges:true railsafty:local
```

同样访问 `http://localhost:8080`。停止并移除该容器：

```powershell
docker stop railsafty
docker rm railsafty
```

`.dockerignore` 仅允许构建所需文件进入上下文，排除本地依赖、已有构建产物、工具配置及 `.env` 文件。Nginx 对带哈希的 `/assets/` 资源启用长期缓存与 gzip，页面入口要求重新验证缓存，避免更新后继续使用旧入口；缺失的 `/assets/` 资源返回 `404`。

**部署边界**：Three.js 渲染仍在访问者的浏览器中进行，需要支持 WebGL 的现代浏览器；服务器不需要 GPU，也无需透传摄像头设备。容器不会增加真实设备接入或事件持久化，刷新页面仍会重置演练，语言偏好保存在浏览器中。本配置按站点根路径 `/` 提供 HTTP 服务；公网发布应使用提供 HTTPS 与访问控制的反向代理，并限制宿主机暴露的端口。

## 展示功能

- **中英文界面**：右上角及弹窗标题栏提供 `中文 / EN` 切换，覆盖导航、三维设备标签、演练流程、历史留痕、重建数据、图表与数据导出。语言选择保存在本机浏览器；切换语言不会重启场景、重置视角或中断当前演练，并保留弹窗中的筛选、搜索与复查确认。
- **细节模型与自然动作**：人物采用成人比例，包含面部、手指、衣物、鞋和背包；通过 `AnimationMixer` 驱动髋部、膝盖、脚踝和手臂，并按移动速度调整步频。动物具有躯干、口鼻、耳朵、鹿角、蹄及四足关节动画，朝向随移动方向变化。
- **物体材质与光影**：列车采用流线型车头、反射玻璃、车门、转向架、轮对和受电弓；落石采用不规则细分几何并根据旋转后的实际顶点贴地。衣物、毛发、草地、道砟、岩石与混凝土纹理由本地程序生成，配合 PBR 材质、天空环境反射和接地阴影，无需外部模型或贴图服务。
- **三维巡检**：旋转、缩放、平移，全域总览、俯瞰视图、列车跟随巡航、边坡特写、区域定位及昼夜切换。
- **多源感知**：8 台高清摄像头、4 台红外摄像头、4 台毫米波雷达、4 台雨量计及 4 台位移计；点击模型或标签定位，支持设备类型筛选、编号及里程搜索。
- **突出异常演练**：顶部常驻场景选择，右侧优先显示事件指挥面板。人员入侵、动物入侵、强降雨、边坡位移和落石侵限均有自动特写、目标框、脉冲警戒圈、光柱、区域高亮与流动感知链路；人员、动物与落石具有动态效果。
- **自动演示**：自动串联全域总览、列车巡航、五类异常、视觉 × 雷达融合与仿真处置，支持暂停、循环和停止后手动接管。自动复核、派发及复查会在留痕中明确标为自动演示模拟操作；详见[自动演示流程说明](docs/auto-demo.md)。
- **视觉 × 雷达重建**：在主场景工具栏切换「三维实景 / 视觉点云 / 雷达点迹 / 融合重建」。视觉点云从实际场景模型的三角形表面采样，包含实例化树木的变换；雷达点迹由同一几何生成稀疏量化观测。融合视图叠加表面网格、扫描平面、目标框、观测关联线和连续轨迹，并显示实际点数、目标坐标及相对仿真真值的误差。高清视频和红外预览不随重建图层切换而改变。
- **视频预览**：从同一三维场景渲染高清视角和红外伪彩视角，可点击放大。红外画面是可视化效果，并非真实热成像测温。
- **分阶段处置**：发现异常 → 人工确认多源复核 → 派发对应场景的仿真处置 → 勾选现场复查确认 → 归档。处置按钮同时位于右侧指挥面板和主场景底部，全屏时也可操作。未完成前置阶段或未勾选复查确认时不能结束告警。
- **全过程留痕**：各阶段记录时间与操作。切换场景会中止并归档原演练，单独标记「已中止」，不计入「已处置」。支持状态筛选、含阶段记录与重建数据的 JSON 导出，以及当前重建模式的 PNG 截图。
- **监测分析**：雨强与位移动态趋势，展示雨强 `> 30 mm/h`、累计位移 `> 3 mm` 的演示预警阈值。

三维画布聚焦后支持 `←` / `→` 切换设备、`+` / `-` 缩放、`0` 复位；`Esc` 关闭弹窗。人员和动物演练会使用更近的特写，缩放支持近距离观察模型。支持桌面和平板/手机布局。

## Interface language

Select **EN** in the top-right corner or dialog header for the English interface; select **中文** to switch back. The browser remembers this choice. Language changes preserve the active incident, camera view, reconstruction mode and dialog inputs. With no saved preference, the interface defaults to Simplified Chinese.

Translations and interpolation live in `src\i18n.ts`. Incident records store language-independent message keys, so an existing audit trail can be rendered or exported in either language without rewriting its timestamps or response state.

## 重建演示的计算边界

`src\reconstruction.ts` 对每个坐标轴使用逆方差加权融合视觉与雷达位置观测；界面显示的误差由合成观测和模型真值计算，而非写死的“精度提升率”。切换观测模式保留场景坐标，切换异常目标会重置旧目标轨迹。

此效果不是从真实视频恢复深度，不包含真实毫米波原始信号处理、相机标定、SLAM、摄影测量或生产级多传感器数据关联。点云、传感器噪声、方差、目标类型及处置结果均为仿真。

## 数据边界

**这是本地交互式仿真，不是生产安全系统。** 所有设备、视频、识别置信度、红外温度、雷达目标及监测数据均为生成的演示内容；未接入摄像头、物联网网关、识别服务或行车控制系统。确认告警仅结束演练，不向真实设备或列车发送指令。事件和三维显示设置仅在当前页面会话内保留；界面语言偏好单独保存在本机浏览器。

若接入真实系统，应以经过认证的采集、识别与预警后端替换 `src\simulation.ts` 的演示状态，并在 `src\main.ts` 对接事件流；`src\scene.ts` 负责独立的三维可视化，`src\models.ts` 构建模型及关节动画，`src\appearance.ts` 生成材质与环境反射，`src\reconstruction.ts` 负责重建展示与演示融合计算。模型仍为程序化演示模型，并非扫描资产或真实视频。真实阈值、处置策略及行车联动必须经过业务与安全验证。

Three.js 官方文档：<https://threejs.org/docs/>。

动画与纹理参考：[AnimationAction](https://threejs.org/docs/AnimationAction.html)、[Texture](https://threejs.org/docs/Texture.html)。
