import './style.css';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import { createAutoDemoSequence, nextAutoDemoIndex } from './auto-demo.ts';
import type { AutoDemoScenario, AutoDemoStep } from './auto-demo.ts';
import { RailwayScene } from './scene.ts';
import type { ReconstructionMode, ReconstructionStats } from './reconstruction.ts';
import { activateScenario, advanceResponse, createSimulation, DEVICES, getTelemetry, LABEL_DEVICE_IDS, RESPONSE_LABELS, RESPONSE_PHASES, RESPONSE_PLANS, resolveCurrentAlert, SCENARIOS, SENSOR_TYPES, sensorReading } from './simulation.ts';
import type { AlertRecord, Device, ResponseSource, ScenarioId, SensorType } from './simulation.ts';
import { applyTranslations, attributes, getLanguage, getLocale, restoreLanguage, saveLanguage, setLanguage, t, text, translateMessage } from './i18n.ts';
import type { Language, LanguageStorage, MessageKey } from './i18n.ts';

let languageStorage: LanguageStorage | null = null;
try { languageStorage = window.localStorage; }
catch (error) { console.warn('Interface language storage is unavailable:', error); }
restoreLanguage(languageStorage);
document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
document.title = t('app.title');

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('应用挂载点不存在。');

const sensorTypes = Object.keys(SENSOR_TYPES) as SensorType[];
const scenarioIds = Object.keys(SCENARIOS) as ScenarioId[];
const autoDemoSteps = createAutoDemoSequence(scenarioIds.filter((id): id is AutoDemoScenario => id !== 'normal'));
const reconstructionModes: { id: ReconstructionMode; key: MessageKey; icon: IconName }[] = [
  { id: 'scene', key: 'mode.scene', icon: 'box' },
  { id: 'vision', key: 'mode.vision', icon: 'camera' },
  { id: 'radar', key: 'mode.radar', icon: 'radar' },
  { id: 'fusion', key: 'mode.fusion', icon: 'layers' },
];
const navButton = (name: IconName, key: MessageKey, panel: string, active = false): string =>
  `<button class="nav-button${active ? ' active' : ''}" data-panel="${panel}" ${attributes(key, 'title', 'aria-label')}${active ? ' aria-current="page"' : ''}>${icon(name, 22)}<span class="nav-tooltip" data-i18n="${key}">${t(key)}</span></button>`;
const toolButton = (name: IconName, key: MessageKey, id: string, active = false): string =>
  `<button class="icon-button${active ? ' is-active' : ''}" id="${id}" ${attributes(key, 'title', 'aria-label')}${active ? ' aria-pressed="true"' : ''}>${icon(name, 18)}</button>`;
const languageControl = (): string => `<div class="language-switch" role="group" ${attributes('language.label', 'aria-label')}><button type="button" data-language="zh" aria-pressed="${getLanguage() === 'zh'}" ${attributes('language.chinese', 'aria-label', 'title')}>中文</button><button type="button" data-language="en" aria-pressed="${getLanguage() === 'en'}" ${attributes('language.english', 'aria-label', 'title')}>EN</button></div>`;

app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar" ${attributes('nav.label', 'aria-label')}>
      <a class="brand-mark" href="./" ${attributes('nav.homeLink', 'aria-label')}>${icon('rail', 28)}</a>
      <div class="nav-divider"></div>
      <nav class="main-nav">
        ${navButton('grid', 'nav.home', 'home', true)}
        ${navButton('box', 'nav.devices', 'devices')}
        ${navButton('chart', 'nav.analytics', 'analytics')}
        ${navButton('bell', 'nav.events', 'events')}
      </nav>
      <div class="sidebar-bottom">
        ${navButton('settings', 'nav.settings', 'settings')}
        ${navButton('help', 'nav.help', 'help')}
        <div class="nav-divider"></div>
        <div class="sidebar-avatar" ${attributes('user.name', 'title')}>R</div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="brand-wordmark"><span class="brand-cn">路瞳</span><span class="brand-en">RailSafty</span><span class="brand-separator"></span><span class="product-name" data-i18n="app.product">${t('app.product')}</span></div>
        <div class="topbar-actions">
          <span class="demo-badge"><i></i>${text('app.simulation')}</span>
          ${languageControl()}
          <span class="topbar-divider"></span>
          ${toolButton('expand', 'common.fullscreen', 'global-fullscreen')}
          <button class="icon-button notification-button" id="notifications" ${attributes('common.notifications', 'title', 'aria-label')}>${icon('bell', 19)}<i id="notification-dot" hidden></i></button>
          <span class="topbar-divider"></span>
          <div class="operator"><span class="operator-avatar" data-i18n="user.avatar">${t('user.avatar')}</span><span>${text('user.name')}<small data-i18n="user.role">${t('user.role')}</small></span></div>
        </div>
      </header>
      <main class="page-content">
        <section class="page-heading" aria-labelledby="page-title">
          <div><p class="eyebrow">SEE BEYOND. PROTECT EVERY MILE.</p><h1 id="page-title">${text('app.heading')}<span class="heading-dot"></span></h1><p class="page-subtitle" data-i18n="app.subtitle">${t('app.subtitle')}</p></div>
          <div class="heading-actions">
            <label class="line-select">${icon('pin', 17)}<select id="region-select" ${attributes('region.select', 'aria-label')}><option value="all" data-i18n="region.allOption">${t('region.allOption')}</option><option value="bridge" data-i18n="region.bridgeOption">${t('region.bridgeOption')}</option><option value="slope" data-i18n="region.slopeOption">${t('region.slopeOption')}</option><option value="forest" data-i18n="region.forestOption">${t('region.forestOption')}</option></select>${icon('chevron', 15)}</label>
            <div class="date-block"><strong id="clock">--:--:--</strong><span id="calendar">----</span></div>
          </div>
        </section>

        <section class="metrics-grid" ${attributes('metrics.label', 'aria-label')}>
          <article class="metric-card"><div class="metric-content"><span class="metric-label">${text('metrics.online')}${icon('wifi', 14)}</span><div class="metric-value">24<span class="metric-denominator">/ 24</span><span class="metric-unit" data-i18n="metrics.deviceUnit">${t('metrics.deviceUnit')}</span></div><p><span class="status-dot"></span>${text('common.allOnline')}<span class="metric-separator">|</span>${text('metrics.sensorTypes')}</p></div><div class="metric-right"><span class="metric-icon mint">${icon('box', 22)}</span><div class="mini-bars">${[10, 15, 13, 20, 17, 24, 21, 28, 25, 30].map((height) => `<i style="height:${height}px"></i>`).join('')}</div></div></article>
          <article class="metric-card"><div class="metric-content"><span class="metric-label">${text('metrics.alerts')}${icon('bell', 14)}</span><div class="metric-value" id="alert-metric"><span id="active-count">00</span><span class="metric-unit" data-i18n="metrics.alertUnit">${t('metrics.alertUnit')}</span><span class="metric-inline-badge" id="risk-badge">${t('metrics.safe')}</span></div><p>${text('metrics.session')} <b id="event-count">2</b> <span data-i18n="metrics.alertUnit">${t('metrics.alertUnit')}</span><span class="metric-separator">|</span>${text('metrics.handled')} <b id="resolved-count">2</b></p></div><span class="metric-icon sand">${icon('shield', 22)}</span></article>
          <article class="metric-card"><div class="metric-content"><span class="metric-label">${text('metrics.coverage')}${icon('pin', 14)}</span><div class="metric-value">4.0<span class="metric-unit">km</span></div><p>K128+000 <span class="route-text-line"></span> K132+000</p></div><div class="metric-right"><span class="metric-icon blue">${icon('rail', 22)}</span><span class="coverage-caption"><i></i>${text('metrics.fullCoverage')}</span></div></article>
          <article class="metric-card environment-metric"><div class="metric-content"><span class="metric-label">${text('metrics.environment')}${icon('sun', 14)}</span><div class="metric-value"><span id="temperature-value">22.6</span><span class="metric-unit">°C</span><span class="weather-word" id="weather-word">${t('weather.sun')}</span></div><p><span id="wind-summary">${t('weather.wind', { value: '2.3' })}</span><span class="metric-separator">|</span><span id="humidity-summary">${t('weather.humidity', { value: 64 })}</span></p></div><div class="weather-illustration" id="weather-art">${icon('sun', 45)}</div></article>
        </section>

        <section class="panel drill-dock" ${attributes('drill.title', 'aria-label')}>
          <div class="drill-dock-heading"><span>${icon('warning', 22)}</span><div><h2 data-i18n="drill.title">${t('drill.title')}</h2><p data-i18n="drill.subtitle">${t('drill.subtitle')}</p></div></div>
          <div class="scenario-grid" role="group" ${attributes('drill.select', 'aria-label')}>${scenarioIds.map((id) => `<button class="scenario-button${id === 'normal' ? ' active' : ''}" data-scenario="${id}" ${attributes(`scenario.${id}.name`, 'aria-label')} aria-pressed="${id === 'normal'}">${icon(SCENARIOS[id].icon, 19)}<span>${text(`scenario.${id}.name`)}<small data-i18n="${id === 'normal' ? 'drill.restore' : SCENARIOS[id].risk === 'critical' ? 'drill.critical' : 'drill.warning'}">${t(id === 'normal' ? 'drill.restore' : SCENARIOS[id].risk === 'critical' ? 'drill.critical' : 'drill.warning')}</small></span></button>`).join('')}</div>
          <span class="drill-safety-note">${text('drill.simulationOnly')}<br>${text('drill.noCommands')}</span>
          <div class="auto-demo-controls" id="auto-demo-controls" data-state="idle">
            <div class="auto-demo-summary" aria-live="polite"><i class="auto-demo-indicator" aria-hidden="true"></i><span><strong id="auto-demo-status">${t('demo.statusReady')}</strong><small id="auto-demo-stage" data-i18n="demo.description">${t('demo.description')}</small></span></div>
            <div class="auto-demo-progress-group"><div class="auto-demo-progress-track" id="auto-demo-progress" role="progressbar" ${attributes('demo.progressLabel', 'aria-label')} aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="auto-demo-progress-fill"></span></div><span class="auto-demo-progress-count" id="auto-demo-progress-count">${t('demo.progress', { current: 0, total: autoDemoSteps.length })}</span><span class="auto-demo-countdown" id="auto-demo-countdown" hidden></span></div>
            <div class="auto-demo-actions"><label class="auto-demo-loop" data-demo-control="loop"><input id="auto-demo-loop" type="checkbox">${text('demo.loop')}</label><button class="auto-demo-button" id="auto-demo-toggle" type="button" data-demo-control="button" data-demo-action="toggle">${icon('play', 15)}<span>${t('demo.start')}</span></button><button class="auto-demo-button secondary" id="auto-demo-stop" type="button" data-demo-control="button" data-demo-action="stop" hidden>${icon('close', 14)}<span>${text('demo.takeover')}</span></button></div>
          </div>
        </section>

        <section class="workspace" ${attributes('scene.workspace', 'aria-label')}>
          <div class="monitor-column">
            <section class="panel scene-panel" id="scene-panel" ${attributes('scene.title', 'aria-label')}>
              <header class="panel-header scene-panel-header"><div class="panel-heading"><span class="section-marker"></span><h2 data-i18n="scene.title">${t('scene.title')}</h2><span class="panel-en">DIGITAL TWIN</span></div><div class="scene-header-actions"><div class="scene-tabs" role="group" ${attributes('scene.views', 'aria-label')}><button class="active" data-scene-tab="overview" aria-pressed="true" data-i18n="scene.perspective">${t('scene.perspective')}</button><button data-scene-tab="top" aria-pressed="false" data-i18n="scene.top">${t('scene.top')}</button></div><span class="header-divider"></span>${toolButton('camera', 'scene.capture', 'capture-scene')}${toolButton('expand', 'scene.fullscreen', 'scene-fullscreen')}</div></header>
              <div class="reconstruction-toolbar"><span>${icon('scan', 15)}${text('fusion.vision')} <b>×</b> ${text('fusion.radar')}</span><div role="group" ${attributes('fusion.modes', 'aria-label')}>${reconstructionModes.map((mode) => `<button data-reconstruction="${mode.id}" class="${mode.id === 'scene' ? 'active' : ''}" aria-pressed="${mode.id === 'scene'}">${icon(mode.icon, 13)}${text(mode.key)}</button>`).join('')}</div><small data-i18n="fusion.simulation">${t('fusion.simulation')}</small></div>
              <div class="scene-host" id="scene-host">
                <section id="incident-banner" class="incident-banner" ${attributes('scene.currentIncident', 'aria-label')} aria-live="polite" hidden></section>
                <section class="fusion-hud" id="fusion-hud" ${attributes('fusion.data', 'aria-label')} hidden><header><span>${icon('layers', 14)}<b id="fusion-mode-name">${t('mode.fusion')}</b></span><button data-action="focus-track" ${attributes('fusion.focus', 'title', 'aria-label')}>${icon('scan', 14)}</button></header><div class="fusion-point-counts"><span>${text('fusion.visualPoints')}<b id="fusion-vision-count">—</b></span><span>${text('fusion.radarPoints')}<b id="fusion-radar-count">—</b></span></div><div class="fusion-legend"><span><i class="vision-dot"></i>${text('fusion.vision')}</span><span><i class="radar-dot"></i>${text('fusion.radar')}</span><span><i class="fused-dot"></i>${text('fusion.targetTrail')}</span></div><div class="fusion-track"><b id="fusion-track-id">${t('fusion.acquiring')}</b><span id="fusion-track-position">${t('fusion.coordinates')}</span></div><div class="fusion-error-values"><span>${text('fusion.visualError')}<b id="fusion-vision-error">—</b></span><span>${text('fusion.radarError')}<b id="fusion-radar-error">—</b></span><span>${text('fusion.fusedError')}<b id="fusion-position-error">—</b></span></div><footer data-i18n="fusion.disclaimer">${t('fusion.disclaimer')}</footer></section>
                <div class="scene-top-left"><span class="live-pill"><i></i>${text('scene.live')}<span class="live-indicator">LIVE</span></span><span class="scene-location">${icon('pin', 12)}<span id="scene-region">${t('region.all')}</span></span></div>
                <div class="scene-tools">${toolButton('layers', 'scene.coverage', 'toggle-coverage', true)}${toolButton('tag', 'scene.labels', 'toggle-labels', true)}<span></span>${toolButton('moon', 'scene.night', 'toggle-night')}</div>
                <div class="north-indicator" aria-hidden="true"><span>N</span><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="18"/><path d="m21 9 5 17-5-3-5 3 5-17Z"/><path d="m21 33-5-7 5-3 5 3-5 7Z"/></svg></div>
                <div class="route-map" ${attributes('scene.routeMap', 'aria-label')}><div><span class="status-dot"></span>${text('region.route')}<span>4.0 km</span></div><svg viewBox="0 0 175 51" aria-hidden="true"><path class="mini-map-terrain" d="m0 43 23-25 16 6L65 3l28 22 17-9 22 8 20-15 23 25v17H0Z"/><path class="mini-map-route-shadow" d="M7 39c28-4 36-22 70-18s45 19 90-7"/><path class="mini-map-route" d="M7 39c28-4 36-22 70-18s45 19 90-7"/><circle cx="40" cy="29" r="3"/><circle cx="96" cy="25" r="3"/><circle cx="143" cy="25" r="3"/><circle class="map-train" cx="77" cy="21" r="4"/></svg><div class="route-map-labels"><span>K128+000</span><span>K132+000</span></div></div>
                <div class="view-presets" role="group" ${attributes('scene.presets', 'aria-label')}><button data-view="overview" class="active" aria-pressed="true">${icon('compass', 14)}${text('scene.overview')}</button><button data-view="patrol" aria-pressed="false">${icon('play', 13)}${text('scene.patrol')}</button><button data-view="slope" aria-pressed="false">${icon('mountain', 15)}${text('scene.slope')}</button></div>
                <div class="zoom-tools">${toolButton('plus', 'scene.zoomIn', 'zoom-in')}${toolButton('minus', 'scene.zoomOut', 'zoom-out')}<span></span>${toolButton('home', 'scene.reset', 'reset-view')}</div>
                <div class="scene-loading" id="scene-loading"><span class="loading-orbit"></span><strong data-i18n="scene.loading">${t('scene.loading')}</strong><small data-i18n="scene.connecting">${t('scene.connecting')}</small></div>
                <div class="scene-error" id="scene-error" role="alert" hidden></div>
              </div>
              <div class="incident-actionbar" id="incident-actionbar" hidden></div>
              <footer class="scene-footer"><span><i class="status-dot"></i><span id="scene-status">${t('scene.statusSafe')}</span></span><span>${icon('compass', 12)}${text('scene.rotate')}<span class="footer-dot">·</span>${text('scene.scroll')}<span class="footer-dot">·</span>${text('scene.pick')}</span></footer>
            </section>
            <div class="live-grid" ${attributes('feed.previews', 'aria-label')}>
              <section class="panel feed-panel"><header class="feed-header"><h3>${icon('camera', 16)}${text('feed.hd')}<span class="feed-id" id="hd-feed-id">HD-003</span></h3><span class="feed-live"><i></i>LIVE</span><button class="icon-button" data-feed="hd" ${attributes('feed.expandHd', 'aria-label', 'title')}>${icon('expand', 14)}</button></header><button class="feed-view hd-feed" data-feed="hd" ${attributes('feed.viewHd', 'aria-label')}><canvas id="hd-preview" width="480" height="270"></canvas><span class="feed-camera-name" data-feed-location="hd">${t('feed.hdLocation')}</span><time class="feed-time"></time><span class="feed-resolution">4K <i>25 FPS</i></span><span class="feed-simulation" data-i18n="feed.simulated">${t('feed.simulated')}</span><span class="target-box" id="hd-target" hidden><span>PERSON 98.6%</span></span><i class="feed-corner top-left"></i><i class="feed-corner bottom-right"></i></button></section>
              <section class="panel feed-panel"><header class="feed-header"><h3>${icon('infrared', 16)}${text('feed.ir')}<span class="feed-id" id="ir-feed-id">IR-003</span></h3><span class="feed-live"><i></i>LIVE</span><button class="icon-button" data-feed="ir" ${attributes('feed.expandIr', 'aria-label', 'title')}>${icon('expand', 14)}</button></header><button class="feed-view ir-feed" data-feed="ir" ${attributes('feed.viewIr', 'aria-label')}><canvas id="ir-preview" width="480" height="270"></canvas><span class="feed-camera-name" data-feed-location="ir">${t('feed.irLocation')}</span><time class="feed-time"></time><span class="thermal-scale"><i></i><span>38°<br>18°</span></span><span class="feed-resolution">640 × 512 <i>THERMAL</i></span><span class="feed-simulation" data-i18n="feed.falseColor">${t('feed.falseColor')}</span><span class="target-box thermal-target" id="ir-target" hidden><span>36.5 °C</span></span><i class="feed-corner top-left"></i><i class="feed-corner bottom-right"></i></button></section>
            </div>
          </div>

          <aside class="insight-column" ${attributes('network.aside', 'aria-label')}>
            <section class="panel event-panel"><header class="panel-header"><div class="panel-heading"><span class="section-marker"></span><h2 data-i18n="response.command">${t('response.command')}</h2></div><span class="command-severity" id="command-severity">${t('response.guarding')}</span></header><div id="response-state" class="response-state"></div><div class="recent-header"><h3>${text('events.audit')}<span id="recent-count">2</span></h3><button id="all-events">${text('events.allRecords')} ${icon('arrow', 12)}</button></div><div class="recent-events" id="recent-events"></div></section>
            <section class="panel network-panel"><header class="panel-header"><div class="panel-heading"><span class="section-marker"></span><h2 data-i18n="network.title">${t('network.title')}</h2></div><span class="subtle-status"><i></i>${text('common.allOnline')}</span></header><div class="network-summary"><div class="online-ring"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="ring-track" cx="32" cy="32" r="27"/><circle class="ring-progress" cx="32" cy="32" r="27"/></svg><span>24<small>ONLINE</small></span></div><div><strong data-i18n="network.slogan">${t('network.slogan')}</strong><p data-i18n="network.subtitle">${t('network.subtitle')}</p><span class="network-health"><i></i><i></i><i></i><i></i><i></i>${text('network.health')}</span></div></div><div class="sensor-list">${sensorTypes.map((type) => { const sensor = SENSOR_TYPES[type]; return `<button class="sensor-row${type === 'camera' ? ' selected' : ''}" data-sensor="${type}" aria-label="${t('network.locate', { name: sensor.name })}" aria-pressed="${type === 'camera'}" style="--sensor-color:${sensor.color}"><span class="sensor-row-icon">${icon(sensor.icon, 18)}</span><span class="sensor-row-label">${text(`sensor.${type}.name`)}<small data-i18n="sensor.${type}.short">${sensor.shortName}</small></span><span class="sensor-count"><b>${sensor.count}</b><small> / ${sensor.count}</small></span><span class="sensor-online"><i></i>${t('common.online')}</span>${icon('chevron', 13)}</button>`; }).join('')}</div><footer class="selected-device-footer"><span>${icon('scan', 13)}<span id="selected-device-label">HD-003 · ${SENSOR_TYPES.camera.name}</span></span><button id="device-details">${text('common.details')} ${icon('arrow', 12)}</button></footer></section>
          </aside>
        </section>
        <footer class="page-footer"><span>${icon('shield', 12)}${text('app.brand')}<span class="footer-tagline" data-i18n="app.footerTagline">${t('app.footerTagline')}</span></span><span>${text('app.disclaimer')}<i></i>${text('app.healthy')}</span></footer>
      </main>
    </div>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <dialog class="app-dialog" id="app-dialog" aria-labelledby="dialog-title"><header class="dialog-header"><div><span class="eyebrow" id="dialog-eyebrow"></span><h2 id="dialog-title"></h2></div><div class="dialog-header-actions">${languageControl()}<button class="icon-button" id="close-dialog" ${attributes('common.close', 'aria-label')}>${icon('close', 22)}</button></div></header><div class="dialog-body" id="dialog-body"></div></dialog>
`;

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`界面元素不存在：${selector}`);
  return found;
}

const startTime = Date.now();
let state = createSimulation(startTime);
let telemetry = getTelemetry(state.scenario, 0);
let selectedDevice = DEVICES.find((device) => device.id === 'HD-003')!;
let scene: RailwayScene | null = null;
let reconstructionMode: ReconstructionMode = 'scene';
let completedAlert: AlertRecord | null = null;
type AutoDemoStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'complete' | 'error';
let autoDemoStatus: AutoDemoStatus = 'idle';
let autoDemoIndex = -1;
let autoDemoLoop = false;
let autoDemoDeadline = 0;
let autoDemoRemainingMs = 0;
let autoDemoTimer: ReturnType<typeof setTimeout> | null = null;
let labelsVisible = true;
let coverageVisible = true;
let nightMode = false;
let toastTimer: ReturnType<typeof setTimeout>;
let dialogKind = '';
let expandedFeed: 'hd' | 'ir' = 'hd';
let deviceFilter = 'all';
let eventFilter = 'all';
const dialog = element<HTMLDialogElement>('#app-dialog');
const dialogBody = element('#dialog-body');
const events = new AbortController();
const drillDockObserver = new ResizeObserver(() => {
  element('#scene-panel').style.scrollMarginTop = `${element('.drill-dock').getBoundingClientRect().height + 20}px`;
});
drillDockObserver.observe(element('.drill-dock'));
let timeFormatter = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
let dateFormatter = new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: getLanguage() === 'en' ? 'short' : '2-digit', day: '2-digit', weekday: 'short' });

function toast(message: string, error = false): void {
  clearTimeout(toastTimer);
  const target = element('#toast');
  target.innerHTML = `${icon(error ? 'warning' : 'check', 17)}<span></span>`;
  target.querySelector('span')!.textContent = message;
  target.className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => target.classList.remove('visible'), 3600);
}

function isAutoDemoActive(): boolean {
  return autoDemoStatus === 'running' || autoDemoStatus === 'paused';
}

function autoDemoStepTitle(step: AutoDemoStep): string {
  return 'scenario' in step ? t(step.title, { name: SCENARIOS[step.scenario].name }) : t(step.title);
}

function updateAutoDemoProgress(): void {
  const step = autoDemoIndex >= 0 ? autoDemoSteps[autoDemoIndex] : undefined;
  const remainingMs = autoDemoStatus === 'running' ? Math.max(0, autoDemoDeadline - Date.now()) : autoDemoRemainingMs;
  const progress = autoDemoStatus === 'complete'
    ? 100
    : step ? ((autoDemoIndex + 1 - remainingMs / step.durationMs) / autoDemoSteps.length) * 100 : 0;
  const percent = Math.round(Math.max(0, Math.min(100, progress)));
  element('#auto-demo-progress-fill').style.width = `${percent}%`;
  element('#auto-demo-progress').setAttribute('aria-valuenow', String(percent));
  const current = autoDemoStatus === 'complete' ? autoDemoSteps.length : Math.max(0, autoDemoIndex + 1);
  element('#auto-demo-progress-count').textContent = t('demo.progress', { current, total: autoDemoSteps.length });
  const countdown = element('#auto-demo-countdown');
  countdown.hidden = !isAutoDemoActive();
  countdown.textContent = t('demo.remaining', { seconds: Math.ceil(remainingMs / 1000) });
}

function updateAutoDemoControls(): void {
  const statusMessages: Record<AutoDemoStatus, MessageKey> = {
    idle: 'demo.statusReady',
    running: 'demo.statusRunning',
    paused: 'demo.statusPaused',
    stopped: 'demo.statusStopped',
    complete: 'demo.statusComplete',
    error: 'demo.statusFailed',
  };
  const step = autoDemoIndex >= 0 ? autoDemoSteps[autoDemoIndex] : undefined;
  element('#auto-demo-controls').dataset.state = autoDemoStatus;
  element('#auto-demo-status').textContent = t(statusMessages[autoDemoStatus]);
  element('#auto-demo-stage').textContent = autoDemoStatus === 'idle'
    ? t('demo.description')
    : autoDemoStatus === 'stopped'
      ? t('demo.manualHint')
      : autoDemoStatus === 'complete'
        ? t('demo.finishedHint')
        : autoDemoStatus === 'error'
          ? t('demo.failedHint')
          : step ? autoDemoStepTitle(step) : t('demo.description');

  const toggle = element<HTMLButtonElement>('#auto-demo-toggle');
  const labelKey: MessageKey = autoDemoStatus === 'running' ? 'demo.pause' : autoDemoStatus === 'paused' ? 'demo.resume' : 'demo.start';
  const renderKey = `${labelKey}:${getLanguage()}`;
  if (toggle.dataset.renderKey !== renderKey) {
    toggle.innerHTML = `${icon(autoDemoStatus === 'running' ? 'pause' : 'play', 15)}<span>${t(labelKey)}</span>`;
    toggle.dataset.renderKey = renderKey;
  }
  element<HTMLButtonElement>('#auto-demo-stop').hidden = !isAutoDemoActive();
  updateAutoDemoProgress();
}

function reportSceneError(message: string): void {
  element('#scene-loading').hidden = true;
  const target = element('#scene-error');
  target.hidden = false;
  target.innerHTML = `${icon('warning', 28)}<strong data-i18n="error.sceneUnavailable">${t('error.sceneUnavailable')}</strong><p></p><small data-i18n="error.sceneHint">${t('error.sceneHint')}</small>`;
  target.querySelector('p')!.textContent = message;
}

function selectDevice(device: Device, focus = true): void {
  selectedDevice = device;
  scene?.selectDevice(device.id, focus);
  element('#selected-device-label').textContent = `${device.id} · ${SENSOR_TYPES[device.type].name}`;
  if (device.type === 'camera') {
    element('#hd-feed-id').textContent = device.id;
    element('.hd-feed .feed-camera-name').textContent = t('feed.hdPatrol', { mileage: device.mileage });
  } else if (device.type === 'infrared') {
    element('#ir-feed-id').textContent = device.id;
    element('.ir-feed .feed-camera-name').textContent = t('feed.irPatrol', { mileage: device.mileage });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-sensor]').forEach((button) => {
    const active = button.dataset.sensor === device.type;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncView(view: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-scene-tab]').forEach((button) => {
    const active = button.dataset.sceneTab === (view === 'top' ? 'top' : 'overview');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderFusionStats(stats: ReconstructionStats | null): void {
  const host = element('#scene-host');
  host.dataset.visionPoints = String(stats?.visionPoints ?? 0);
  host.dataset.radarPoints = String(stats?.radarPoints ?? 0);
  host.dataset.reconstructionSurfaces = String(stats?.surfaces ?? 0);
  host.dataset.fusionTrack = stats?.targetId ?? '';
  element('#fusion-vision-count').textContent = stats ? stats.visionPoints.toLocaleString('en-US') : '—';
  element('#fusion-radar-count').textContent = stats ? stats.radarPoints.toLocaleString('en-US') : '—';
  element('#fusion-track-id').textContent = stats?.targetId ?? t('fusion.acquiring');
  element('#fusion-track-position').textContent = stats ? `X ${stats.position[0].toFixed(1)}  Y ${stats.position[1].toFixed(1)}  Z ${stats.position[2].toFixed(1)} · ${stats.speed.toFixed(1)} m/s` : t('fusion.coordinates');
  element('#fusion-vision-error').textContent = stats ? `${stats.visionError.toFixed(2)} m` : '—';
  element('#fusion-radar-error').textContent = stats ? `${stats.radarError.toFixed(2)} m` : '—';
  element('#fusion-position-error').textContent = stats ? `${stats.fusionError.toFixed(2)} m` : '—';
}

function setReconstructionMode(mode: ReconstructionMode): boolean {
  if (!scene) { toast(t('error.engineUnavailable'), true); return false; }
  try {
    scene.setReconstructionMode(mode);
  } catch (error) {
    console.error('三维重建显示失败', error);
    toast(t('error.reconstruction'), true);
    return false;
  }
  reconstructionMode = mode;
  element('#fusion-hud').hidden = mode === 'scene';
  element('#fusion-mode-name').textContent = t(reconstructionModes.find((item) => item.id === mode)!.key);
  document.querySelectorAll<HTMLButtonElement>('button[data-reconstruction]').forEach((button) => {
    const active = button.dataset.reconstruction === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  return true;
}

function advanceResponseState(expectedPhase: 'detected' | 'verified', source: ResponseSource = 'operator'): AlertRecord | null {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active || active.phase !== expectedPhase) return null;
  const next = advanceResponse(state, Date.now(), source);
  if (next === state) return null;
  state = next;
  const updated = state.alerts.find((alert) => alert.id === active.id)!;
  scene?.setResponsePhase(updated.phase);
  renderState();
  refreshTelemetry();
  if (dialog.open && dialogKind === 'resolve') openResolveDialog();
  return updated;
}

function advanceCurrentResponse(): void {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active) { toast(t('toast.noIncident'), true); return; }
  if (active.phase === 'responding') { openResolveDialog(); return; }
  if (active.phase === 'resolved') { toast(t('toast.followSteps'), true); return; }
  const updated = advanceResponseState(active.phase);
  if (!updated) { toast(t('toast.followSteps'), true); return; }
  toast(updated.phase === 'verified' ? t('toast.verified') : t('toast.dispatched', { action: RESPONSE_PLANS[active.scenario].action }));
}

function completeCurrentResponse(source: ResponseSource = 'operator'): boolean {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active || active.phase !== 'responding') return false;
  const next = resolveCurrentAlert(state, Date.now(), source);
  if (next === state) return false;
  state = next;
  completedAlert = state.alerts.find((alert) => alert.id === active.id)!;
  scene?.setScenario('normal');
  scene?.setView('overview');
  dialog.close();
  renderState();
  refreshTelemetry();
  return true;
}

function setScenario(id: ScenarioId, silent = false, source: ResponseSource = 'operator'): void {
  const next = activateScenario(state, id, Date.now(), source);
  if (next === state) {
    if (id !== 'normal') scene?.focusIncident();
    if (!silent) toast(t(id === 'normal' ? 'toast.alreadyNormal' : 'toast.alreadyActive'));
    return;
  }
  state = next;
  completedAlert = null;
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  scene?.setScenario(id, active?.id);
  if (id === 'normal') scene?.setView('overview');
  else scene?.focusIncident();
  refreshTelemetry();
  renderState();
  if (!silent && id !== 'normal') element('#scene-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  if (!silent) toast(id === 'normal' ? t('toast.restored') : t('toast.started', { name: SCENARIOS[id].name, count: SCENARIOS[id].sensors.length }));
}

function performAutoDemoStep(step: AutoDemoStep): boolean {
  if (!scene) return false;
  switch (step.kind) {
    case 'overview':
      completedAlert = null;
      element<HTMLSelectElement>('#region-select').value = 'all';
      element('#scene-region').textContent = t('region.all');
      renderState();
      if (!setReconstructionMode('scene')) return false;
      scene.setView('overview');
      return true;
    case 'patrol':
      scene.setView('patrol');
      return true;
    case 'scenario':
      if (!setReconstructionMode('scene')) return false;
      setScenario(step.scenario, true, 'auto-demo');
      return true;
    case 'fusion':
      if (!setReconstructionMode('fusion')) return false;
      scene.focusIncident();
      return true;
    case 'review':
      return advanceResponseState('detected', 'auto-demo')?.phase === 'verified';
    case 'dispatch':
      return advanceResponseState('verified', 'auto-demo')?.phase === 'responding';
    case 'recheck':
      return completeCurrentResponse('auto-demo');
    case 'complete':
      if (!setReconstructionMode('scene')) return false;
      scene.setView('overview');
      return true;
  }
}

function failAutoDemo(error: unknown): void {
  console.error('自动演示失败', error);
  if (autoDemoStatus === 'running') autoDemoRemainingMs = Math.max(0, autoDemoDeadline - Date.now());
  if (autoDemoTimer !== null) clearTimeout(autoDemoTimer);
  autoDemoTimer = null;
  autoDemoStatus = 'error';
  renderState();
  updateAutoDemoControls();
  toast(t('demo.failed'), true);
}

function runAutoDemoStep(index: number): void {
  const step = autoDemoSteps[index];
  if (!step) { failAutoDemo(new Error(`自动演示步骤不存在：${index}`)); return; }
  autoDemoIndex = index;
  autoDemoStatus = 'running';
  try {
    if (!performAutoDemoStep(step)) throw new Error(`自动演示步骤未能完成：${step.kind}`);
  } catch (error) {
    failAutoDemo(error);
    return;
  }
  autoDemoRemainingMs = step.durationMs;
  autoDemoDeadline = Date.now() + step.durationMs;
  autoDemoTimer = setTimeout(advanceAutoDemo, step.durationMs);
  updateAutoDemoControls();
}

function advanceAutoDemo(): void {
  autoDemoTimer = null;
  if (autoDemoStatus !== 'running') return;
  const nextIndex = nextAutoDemoIndex(autoDemoIndex, autoDemoSteps.length, autoDemoLoop);
  if (nextIndex === null) {
    autoDemoStatus = 'complete';
    autoDemoRemainingMs = 0;
    renderState();
    updateAutoDemoControls();
    return;
  }
  runAutoDemoStep(nextIndex);
}

function startAutoDemo(): void {
  if (!scene) { toast(t('error.engineUnavailable'), true); return; }
  if (state.alerts.some((alert) => alert.resolvedAt === null)) {
    toast(t('demo.requiresClear'), true);
    return;
  }
  if (autoDemoTimer !== null) clearTimeout(autoDemoTimer);
  autoDemoTimer = null;
  if (dialog.open) dialog.close();
  autoDemoLoop = element<HTMLInputElement>('#auto-demo-loop').checked;
  autoDemoIndex = -1;
  autoDemoRemainingMs = 0;
  autoDemoStatus = 'running';
  runAutoDemoStep(0);
}

function pauseAutoDemo(): void {
  if (autoDemoStatus !== 'running') return;
  autoDemoRemainingMs = Math.max(0, autoDemoDeadline - Date.now());
  if (autoDemoTimer !== null) clearTimeout(autoDemoTimer);
  autoDemoTimer = null;
  autoDemoStatus = 'paused';
  renderState();
  updateAutoDemoControls();
}

function resumeAutoDemo(): void {
  if (autoDemoStatus !== 'paused') return;
  autoDemoStatus = 'running';
  if (autoDemoRemainingMs <= 0) {
    advanceAutoDemo();
    return;
  }
  autoDemoDeadline = Date.now() + autoDemoRemainingMs;
  autoDemoTimer = setTimeout(advanceAutoDemo, autoDemoRemainingMs);
  renderState();
  updateAutoDemoControls();
}

function stopAutoDemo(): void {
  if (!isAutoDemoActive()) return;
  if (autoDemoStatus === 'running') autoDemoRemainingMs = Math.max(0, autoDemoDeadline - Date.now());
  if (autoDemoTimer !== null) clearTimeout(autoDemoTimer);
  autoDemoTimer = null;
  autoDemoStatus = 'stopped';
  renderState();
  updateAutoDemoControls();
}

function eventMarkup(alert: AlertRecord, compact = false): string {
  const definition = SCENARIOS[alert.scenario];
  const pending = alert.resolvedAt === null;
  const status = pending ? 'pending' : alert.outcome === 'cancelled' ? 'cancelled' : 'resolved';
  const label = t(pending ? alert.phase === 'responding' ? 'events.responding' : alert.phase === 'verified' ? 'events.awaitDispatch' : 'events.awaitReview' : alert.outcome === 'cancelled' ? 'events.cancelled' : 'events.handled');
  if (compact) return `<button class="recent-event" data-alert="${alert.id}"><span class="recent-event-icon ${pending ? 'pending' : ''}">${icon(definition.icon, 15)}</span><span class="recent-event-copy"><b>${t(pending ? 'events.alertName' : 'events.drillName', { name: definition.name })}</b><small>${timeFormatter.format(alert.createdAt)}<span>·</span>${definition.location.split(' · ')[0]}</small></span><span class="event-state ${status}">${label}</span>${icon('chevron', 12)}</button>`;
  return `<article class="event-record" data-status="${status}"><span class="event-record-icon ${pending ? 'pending' : ''}">${icon(definition.icon, 23)}</span><div class="event-record-content"><div><h3>${definition.title}</h3><span class="event-state ${status}">${label}</span></div><p>${definition.detail}</p><small>${alert.id}<span>·</span>${dateFormatter.format(alert.createdAt)} ${timeFormatter.format(alert.createdAt)}<span>·</span>${definition.location}</small><ol class="event-audit">${alert.timeline.map((step) => `<li><span>${timeFormatter.format(step.at)}</span><b>${RESPONSE_LABELS[step.phase]}</b><small>${translateMessage(step.note)}</small></li>`).join('')}</ol>${alert.resolution ? `<p class="event-resolution">${icon(alert.outcome === 'cancelled' ? 'close' : 'check', 13)}${translateMessage(alert.resolution)}</p>` : ''}</div><button class="text-button" data-alert-focus="${alert.id}">${t('common.locate')} ${icon('pin', 14)}</button></article>`;
}

function responseButtonLabel(alert: AlertRecord): string {
  return alert.phase === 'detected' ? t('response.verify') : alert.phase === 'verified' ? t('response.dispatch', { action: RESPONSE_PLANS[alert.scenario].action }) : t('response.finish');
}

function responseSteps(alert: AlertRecord): string {
  const current = RESPONSE_PHASES.indexOf(alert.phase);
  return RESPONSE_PHASES.map((phase, index) => {
    const step = alert.timeline.find((entry) => entry.phase === phase);
    return `<li class="${index <= current ? 'done' : index === current + 1 ? 'current' : 'pending'}" data-response-step="${phase}"><span>${index <= current ? icon('check', 12) : String(index + 1).padStart(2, '0')}</span><div><strong>${RESPONSE_LABELS[phase]}</strong><small>${step ? timeFormatter.format(step.at) : t(phase === 'verified' ? 'response.compare' : phase === 'responding' ? 'response.confirmDispatch' : 'response.recheck')}</small></div></li>`;
  }).join('');
}

function incidentMetrics(): { label: string; value: string; note: string }[] {
  if (state.scenario === 'rain') return [
    { label: t('incident.rainRate'), value: `${telemetry.rainRate.toFixed(1)} mm/h`, note: t('incident.rainThreshold') },
    { label: t('incident.dailyRain'), value: `${telemetry.dailyRain.toFixed(1)} mm`, note: t('incident.rainNote') },
  ];
  if (state.scenario === 'slope') return [
    { label: t('incident.displacement'), value: `${telemetry.displacement.toFixed(2)} mm`, note: t('incident.displacementThreshold') },
    { label: t('incident.simultaneousRain'), value: `${telemetry.rainRate.toFixed(1)} mm/h`, note: t('incident.deformationNote') },
  ];
  return [
    { label: t('incident.confidence'), value: `${telemetry.confidence.toFixed(1)} %`, note: t('incident.confidenceNote') },
    { label: t('incident.range'), value: `${telemetry.range.toFixed(1)} m`, note: t('incident.rangeNote') },
  ];
}

function elapsedText(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateIncidentReadings(): void {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active) return;
  incidentMetrics().forEach((metric, index) => document.querySelectorAll<HTMLElement>(`[data-incident-value="${index}"]`).forEach((target) => { target.textContent = metric.value; }));
  document.querySelectorAll<HTMLElement>('[data-incident-elapsed]').forEach((target) => { target.textContent = elapsedText(Date.now() - active.createdAt); });
}

function renderState(): void {
  const pendingCount = state.alerts.filter((alert) => alert.resolvedAt === null).length;
  const definition = SCENARIOS[state.scenario];
  element('#active-count').textContent = String(pendingCount).padStart(2, '0');
  element('#event-count').textContent = String(state.alerts.length);
  element('#resolved-count').textContent = String(state.alerts.filter((alert) => alert.outcome === 'handled').length);
  element('#recent-count').textContent = String(state.alerts.length);
  element('#notification-dot').hidden = pendingCount === 0;
  element('#risk-badge').textContent = t(pendingCount ? definition.risk === 'critical' ? 'metrics.critical' : 'metrics.warning' : 'metrics.safe');
  element('#risk-badge').classList.toggle('warning', pendingCount > 0);
  element('#alert-metric').classList.toggle('has-risk', pendingCount > 0);
  element('#scene-status').textContent = pendingCount ? t('scene.statusActive', { count: definition.sensors.length, name: definition.name }) : t('scene.statusSafe');
  document.querySelectorAll<HTMLButtonElement>('.scenario-button').forEach((button) => {
    const active = button.dataset.scenario === state.scenario;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLElement>('[data-sensor]').forEach((row) => {
    const linked = definition.sensors.includes(row.dataset.sensor as SensorType);
    row.classList.toggle('is-linking', linked);
    const status = row.querySelector<HTMLElement>('.sensor-online');
    if (status) status.innerHTML = `<i></i>${t(linked ? 'network.linked' : 'common.online')}`;
  });
  const response = element('#response-state');
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  const banner = element('#incident-banner');
  const actionbar = element('#incident-actionbar');
  element('#scene-panel').classList.toggle('has-incident', Boolean(active));
  element('.event-panel').dataset.phase = active?.phase ?? (completedAlert ? 'resolved' : 'normal');
  element('.event-panel').dataset.risk = definition.risk;
  banner.hidden = !active && !completedAlert;
  actionbar.hidden = !active;
  if (active) {
    const level = t(definition.risk === 'critical' ? 'response.priorityII' : 'response.priorityIII');
    const phaseName = isAutoDemoActive()
      ? t('demo.workflow')
      : t(active.phase === 'detected' ? 'response.reviewPending' : active.phase === 'verified' ? 'response.dispatchPending' : 'response.inProgress');
    element('#command-severity').textContent = level;
    response.className = 'response-state incident-response';
    const responseInstruction = isAutoDemoActive()
      ? t('demo.workflowInstruction')
      : active.phase === 'responding' ? RESPONSE_PLANS[active.scenario].instruction : t(active.phase === 'verified' ? 'response.dispatchInstruction' : 'response.reviewInstruction');
    response.innerHTML = `<div class="incident-response-title"><span>${icon(definition.icon, 24)}</span><div><strong>${definition.name} · ${phaseName}</strong><small>${definition.location}</small></div></div><div class="incident-readings">${incidentMetrics().map((metric, index) => `<article><span>${metric.label}</span><b data-incident-value="${index}">${metric.value}</b><small>${metric.note}</small></article>`).join('')}</div><div class="evidence-sensors">${definition.sensors.map((type) => `<span>${icon(SENSOR_TYPES[type].icon, 13)}${SENSOR_TYPES[type].shortName}</span>`).join('')}</div><ol class="response-timeline" aria-label="${t('response.flow')}">${responseSteps(active)}</ol><p class="response-instruction">${responseInstruction}</p><button class="primary-response-button" data-action="response-next">${icon(active.phase === 'responding' ? 'check' : 'arrow', 16)}${responseButtonLabel(active)}${icon('arrow', 15)}</button><div class="response-secondary"><button id="resolve-alert" data-action="review-evidence">${icon('eye', 13)}${t('response.evidence')}</button><button data-action="focus-incident">${icon('pin', 13)}${t('response.focus')}</button><button data-action="incident-fusion">${icon('layers', 13)}${t('mode.fusion')}</button></div><small class="response-safety-note">${t('response.safety')}</small>`;
    banner.className = `incident-banner is-active ${definition.risk}`;
    banner.innerHTML = `<span class="incident-banner-icon">${icon(definition.icon, 23)}</span><div class="incident-banner-copy"><span>${level}<b>SIMULATED INCIDENT</b></span><strong>${definition.title}</strong><small>${definition.location} · ${phaseName}</small></div><div class="incident-banner-clock" aria-live="off"><span>${t('response.elapsed')}</span><b data-incident-elapsed>${elapsedText(Date.now() - active.createdAt)}</b></div>`;
    actionbar.innerHTML = `<ol class="response-steps" aria-label="${t('response.progress')}">${responseSteps(active)}</ol><button class="primary-response-button" data-action="response-next">${responseButtonLabel(active)}${icon('arrow', 15)}</button>`;
  } else {
    element('#command-severity').textContent = t(completedAlert ? 'response.complete' : 'response.guarding');
    response.className = 'response-state response-standby';
    response.innerHTML = `<span class="standby-shield">${icon('shield', 34)}</span><strong>${t(completedAlert ? 'response.completedHeading' : 'response.standbyHeading')}</strong><p>${completedAlert ? `${t('response.completedDescription', { name: SCENARIOS[completedAlert.scenario].name })}<br>${t('response.completedDuration', { duration: elapsedText(completedAlert.resolvedAt! - completedAlert.createdAt) })}` : t('response.standbyDescription')}</p>${completedAlert ? `<ol class="response-steps completed-steps">${responseSteps(completedAlert)}</ol><button class="standby-start" data-action="history">${t('response.history')} ${icon('arrow', 14)}</button>` : `<button class="standby-start" data-scenario="person" aria-label="${t('response.startPerson')}">${icon('play', 14)}${t('response.startPersonButton')}</button>`}<small>${t('response.noCommands')}</small>`;
    if (completedAlert) {
      banner.className = 'incident-banner is-complete';
      banner.innerHTML = `<span class="incident-banner-icon">${icon('shield', 25)}</span><div class="incident-banner-copy"><span>${t('response.bannerComplete')}<b>RESPONSE COMPLETED</b></span><strong>${t('response.bannerTitle', { name: SCENARIOS[completedAlert.scenario].name })}</strong><small>${t('response.bannerAudit')}</small></div><button class="icon-button" data-action="dismiss-completion" aria-label="${t('response.dismiss')}">${icon('close', 17)}</button>`;
    }
  }
  element('#recent-events').innerHTML = state.alerts.slice(0, 2).map((alert) => eventMarkup(alert, true)).join('');
  const hasTarget = state.scenario === 'person' || state.scenario === 'animal' || state.scenario === 'rockfall';
  element('#hd-target').hidden = !hasTarget;
  element('#ir-target').hidden = state.scenario !== 'person' && state.scenario !== 'animal';
  element('#hd-target span').textContent = state.scenario === 'animal' ? 'ANIMAL 97.2%' : state.scenario === 'rockfall' ? 'ROCK 98.6%' : 'PERSON 98.6%';
}

function refreshTelemetry(): void {
  const seconds = (Date.now() - startTime) / 1000;
  telemetry = getTelemetry(state.scenario, seconds);
  element('#temperature-value').textContent = telemetry.temperature.toFixed(1);
  element('#weather-word').textContent = t(state.scenario === 'rain' ? 'weather.rain' : nightMode ? 'weather.night' : 'weather.sun');
  element('#wind-summary').textContent = t('weather.wind', { value: telemetry.wind.toFixed(1) });
  element('#humidity-summary').textContent = t('weather.humidity', { value: telemetry.humidity });
  element('#weather-art').innerHTML = icon(state.scenario === 'rain' ? 'rain' : nightMode ? 'moon' : 'sun', 45);
  scene?.updateReadings(telemetry);
  updateIncidentReadings();
  document.querySelectorAll<HTMLElement>('[data-live-reading]').forEach((target) => {
    target.textContent = sensorReading(target.dataset.liveReading as SensorType, telemetry, state.scenario);
  });
  if (dialogKind === 'analytics' && dialog.open) updateCharts();
  if (dialogKind === 'feed' && dialog.open) updateExpandedFeed();
}

function tick(): void {
  const now = new Date();
  const time = timeFormatter.format(now);
  element('#clock').textContent = time;
  element('#calendar').textContent = dateFormatter.format(now).replaceAll('/', '.');
  document.querySelectorAll<HTMLElement>('.feed-time').forEach((target) => { target.textContent = time; });
  refreshTelemetry();
  updateAutoDemoProgress();
}

function openDialog(kind: string, title: string, eyebrow: string, content: string): void {
  dialogKind = kind;
  element('#dialog-title').textContent = title;
  element('#dialog-eyebrow').textContent = eyebrow;
  dialogBody.innerHTML = content;
  dialog.dataset.kind = kind;
  if (!dialog.open) dialog.showModal();
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((button) => {
    button.classList.toggle('active', button.dataset.panel === kind);
    button.removeAttribute('aria-current');
  });
}

function openDevicesDialog(): void {
  deviceFilter = 'all';
  openDialog('devices', t('devices.title'), 'SENSOR NETWORK · 24 DEVICES ONLINE', `
    <div class="dialog-notice">${icon('wifi', 17)}${t('devices.allOnline')}<span>${t('devices.demoNotice')}</span></div>
    <div class="dialog-toolbar"><div class="filter-tabs" role="group" aria-label="${t('devices.filter')}"><button class="active" data-device-filter="all">${t('devices.all')} <span>24</span></button>${sensorTypes.map((type) => `<button data-device-filter="${type}">${SENSOR_TYPES[type].shortName}</button>`).join('')}</div><label class="search-input">${icon('search', 16)}<input id="device-search" placeholder="${t('devices.search')}" aria-label="${t('devices.search')}" /></label></div>
    <div class="device-table-wrap"><table class="device-table"><thead><tr><th>${t('devices.sensor')}</th><th>${t('devices.mileage')}</th><th>${t('devices.reading')}</th><th>${t('devices.status')}</th><th>${t('devices.actions')}</th></tr></thead><tbody>${DEVICES.map((device) => `<tr data-device-row="${device.type}" data-search="${device.id.toLowerCase()} ${device.mileage.toLowerCase()}"><td><span class="table-device-icon" style="color:${SENSOR_TYPES[device.type].color}">${icon(SENSOR_TYPES[device.type].icon, 17)}</span><span><b>${device.id}</b><small>${device.name}</small></span></td><td>${device.mileage}</td><td data-live-reading="${device.type}">${sensorReading(device.type, telemetry, state.scenario)}</td><td><span class="table-online"><i></i>${t('common.online')}</span></td><td><button class="text-button" data-locate="${device.id}">${icon('pin', 13)}${t('common.locate')}</button></td></tr>`).join('')}</tbody></table><div class="empty-state" id="device-empty" hidden>${icon('search', 25)}${t('devices.empty')}</div></div><footer class="dialog-footer-note"><span id="device-result-count">${t('devices.count', { count: 24 })}</span><span>${t('devices.locateHint')}</span></footer>`);
  element<HTMLInputElement>('#device-search').addEventListener('input', filterDevices, { signal: events.signal });
}

function filterDevices(): void {
  const query = element<HTMLInputElement>('#device-search').value.trim().toLowerCase();
  let count = 0;
  document.querySelectorAll<HTMLElement>('[data-device-row]').forEach((row) => {
    const visible = (deviceFilter === 'all' || row.dataset.deviceRow === deviceFilter) && (row.dataset.search?.includes(query) ?? false);
    row.hidden = !visible;
    if (visible) count++;
  });
  element('#device-empty').hidden = count > 0;
  element('#device-result-count').textContent = t('devices.count', { count });
}

function filterEvents(): void {
  let count = 0;
  document.querySelectorAll<HTMLElement>('.event-record').forEach((record) => {
    const visible = eventFilter === 'all' || record.dataset.status === eventFilter;
    record.hidden = !visible;
    if (visible) count++;
  });
  document.querySelectorAll<HTMLElement>('[data-event-filter]').forEach((tab) => tab.classList.toggle('active', tab.dataset.eventFilter === eventFilter));
  element('#event-empty').hidden = count > 0;
}

function openEventsDialog(): void {
  eventFilter = 'all';
  const pending = state.alerts.filter((alert) => alert.resolvedAt === null).length;
  const handled = state.alerts.filter((alert) => alert.outcome === 'handled').length;
  const cancelled = state.alerts.filter((alert) => alert.outcome === 'cancelled').length;
  openDialog('events', t('events.title'), 'EVENT CENTER · SIMULATED RECORDS', `
    <div class="dialog-toolbar"><div class="filter-tabs" role="group" aria-label="${t('events.filterLabel')}"><button class="active" data-event-filter="all">${t('common.all')} <span>${state.alerts.length}</span></button><button data-event-filter="pending">${t('events.pending')} <span>${pending}</span></button><button data-event-filter="resolved">${t('events.handled')} <span>${handled}</span></button><button data-event-filter="cancelled">${t('events.cancelled')} <span>${cancelled}</span></button></div><button class="secondary-button" data-action="export">${icon('download', 15)}${t('common.export')}</button></div><div class="event-record-list">${state.alerts.map((alert) => eventMarkup(alert)).join('')}</div><div class="empty-state" id="event-empty" hidden>${icon('shield', 27)}${t('events.empty')}</div><div class="dialog-disclaimer">${icon('help', 15)}${t('events.disclaimer')}</div>`);
}

function openDeviceDialog(): void {
  const definition = SENSOR_TYPES[selectedDevice.type];
  openDialog('device', `${selectedDevice.id} · ${definition.name}`, 'DEVICE INSIGHT · DIGITAL TWIN', `
    <div class="device-detail-heading"><span style="color:${definition.color}">${icon(definition.icon, 38)}</span><div><span class="table-online"><i></i>${t('devices.online')}</span><h3>${definition.description}</h3><p>${selectedDevice.mileage} · ${t('region.fullName')}</p></div></div>
    <div class="detail-grid"><article><span>${t('devices.measurement')}</span><strong data-live-reading="${selectedDevice.type}">${sensorReading(selectedDevice.type, telemetry, state.scenario)}</strong></article><article><span>${t('devices.network')}</span><strong>${t('devices.linkHealthy')}</strong></article><article><span>${t('devices.id')}</span><strong>${selectedDevice.id}</strong></article><article><span>${t('devices.coordination')}</span><strong>${t(SCENARIOS[state.scenario].sensors.includes(selectedDevice.type) ? 'devices.reviewing' : 'devices.patrolling')}</strong></article></div><div class="dialog-disclaimer">${icon('help', 15)}${t('devices.disclaimer')}</div><div class="dialog-actions"><button class="primary-button" data-locate="${selectedDevice.id}">${icon('pin', 15)}${t('devices.locateScene')}</button></div>`);
}

function chartMarkup(kind: 'rain' | 'displacement'): string {
  const isRain = kind === 'rain';
  const labels = isRain ? ['60', '45', '30', '15', '0'] : ['6.0', '4.5', '3.0', '1.5', '0'];
  return `<article class="trend-card"><header><div><span class="metric-icon ${isRain ? 'blue' : 'sand'}">${icon(isRain ? 'rain' : 'displacement', 21)}</span><h3>${t(isRain ? 'analytics.rainRate' : 'analytics.displacement')}<small>${t('analytics.trend')}</small></h3></div><strong id="${kind}-chart-value"></strong></header><svg class="trend-chart" data-chart="${kind}" viewBox="0 0 640 174" role="img" aria-label="${t(isRain ? 'analytics.rainChart' : 'analytics.displacementChart')}"><defs><linearGradient id="gradient-${kind}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${isRain ? '#5d9cba' : '#c09b5f'}" stop-opacity=".2"/><stop offset="100%" stop-color="${isRain ? '#5d9cba' : '#c09b5f'}" stop-opacity="0"/></linearGradient></defs>${labels.map((label, index) => `<text x="0" y="${18 + index * 30}">${label}</text><path class="chart-grid" d="M35 ${14 + index * 30}H626"/>`).join('')}<path class="chart-threshold" d="M35 74H626"/><text class="threshold-label" x="626" y="67" text-anchor="end">${t('common.threshold', { value: isRain ? '30 mm/h' : '3 mm' })}</text><path class="chart-area" fill="url(#gradient-${kind})"/><path class="chart-line" stroke="${isRain ? '#5d9cba' : '#c09b5f'}"/><text x="35" y="163">-120s</text><text x="318" y="163">-60s</text><text x="605" y="163">${t('common.now')}</text></svg></article>`;
}

function openAnalyticsDialog(): void {
  openDialog('analytics', t('analytics.title'), 'ENVIRONMENTAL TELEMETRY · SIMULATION', `<div class="dialog-notice">${icon('chart', 17)}${t('analytics.scenario', { name: SCENARIOS[state.scenario].name })}<span>${t('analytics.rules')}</span></div><div class="trends-grid">${chartMarkup('rain')}${chartMarkup('displacement')}</div><div class="environment-details"><span>${icon('thermometer', 17)}${t('analytics.temperature')} <b id="analysis-temperature"></b></span><span>${icon('wind', 17)}${t('analytics.wind')} <b id="analysis-wind"></b></span><span>${icon('rain', 17)}${t('analytics.daily')} <b id="analysis-daily"></b></span></div><div class="dialog-actions"><span class="muted">${t('analytics.disclaimer')}</span><button class="secondary-button" data-action="export">${icon('download', 15)}${t('common.exportData')}</button></div>`);
  updateCharts();
}

function updateCharts(): void {
  const seconds = (Date.now() - startTime) / 1000;
  for (const kind of ['rain', 'displacement'] as const) {
    const svg = document.querySelector<SVGElement>(`[data-chart="${kind}"]`);
    if (!svg) continue;
    const isRain = kind === 'rain';
    const maximum = isRain ? 60 : 6;
    const points = Array.from({ length: 25 }, (_, index) => {
      const sample = getTelemetry(state.scenario, seconds - (24 - index) * 5);
      const value = isRain ? sample.rainRate : sample.displacement;
      return `${35 + (index / 24) * 591},${134 - (Math.min(value, maximum) / maximum) * 120}`;
    });
    const path = `M${points.join(' L')}`;
    svg.querySelector('.chart-line')!.setAttribute('d', path);
    svg.querySelector('.chart-area')!.setAttribute('d', `${path} L626,134 L35,134 Z`);
    element(`#${kind}-chart-value`).textContent = `${(isRain ? telemetry.rainRate : telemetry.displacement).toFixed(isRain ? 1 : 2)} ${isRain ? 'mm/h' : 'mm'}`;
  }
  element('#analysis-temperature').textContent = `${telemetry.temperature.toFixed(1)} °C`;
  element('#analysis-wind').textContent = `${telemetry.wind.toFixed(1)} m/s`;
  element('#analysis-daily').textContent = `${telemetry.dailyRain.toFixed(1)} mm`;
}

function openResolveDialog(): void {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active) return;
  const definition = SCENARIOS[active.scenario];
  const reviewed = active.phase !== 'detected';
  const finalReview = active.phase === 'responding';
  openDialog('resolve', t(finalReview ? 'review.finalTitle' : 'review.title'), 'COORDINATED RESPONSE · SIMULATION ONLY', `<div class="resolve-alert-heading">${icon(definition.icon, 28)}<div><h3>${definition.title}</h3><p>${definition.location}</p></div><span class="event-state pending">${t(finalReview ? 'review.awaitFinal' : reviewed ? 'review.reviewed' : 'response.reviewPending')}</span></div><p class="resolve-description">${definition.detail}</p><div class="verification-list">${definition.sensors.map((type, index) => `<div><span>${String(index + 1).padStart(2, '0')}</span>${icon(SENSOR_TYPES[type].icon, 21)}<div><strong>${SENSOR_TYPES[type].name}</strong><small data-live-reading="${type}">${sensorReading(type, telemetry, state.scenario)}</small></div><span class="verified">${icon(reviewed ? 'check' : 'eye', 13)}${t(reviewed ? 'review.verified' : 'review.collected')}</span></div>`).join('')}</div><p class="dispatch-plan">${icon('link', 16)}${RESPONSE_PLANS[active.scenario].instruction}</p>${finalReview ? `<label class="clearance-confirm"><input type="checkbox" id="clearance-confirm" /><span>${t('review.clearance')}</span></label>` : ''}<div class="dialog-disclaimer">${icon('help', 16)}${t('review.disclaimer')}</div><div class="dialog-actions"><button class="secondary-button" data-action="close">${t('review.keepState')}</button>${finalReview ? `<button class="primary-button" data-action="resolve" disabled>${icon('check', 16)}${t('review.complete')}</button>` : `<button class="primary-button" data-action="response-next">${responseButtonLabel(active)}${icon('arrow', 15)}</button>`}</div>`);
}

function openHelpDialog(): void {
  openDialog('help', t('help.title'), 'A CLEARER VIEW. A SAFER RAILWAY.', `<div class="help-intro"><span class="brand-mark">${icon('rail', 32)}</span><div><h3>${t('help.heading')}</h3><p>${t('help.intro')}</p></div></div><div class="help-grid"><article>${icon('compass', 24)}<h3>${t('help.exploreTitle')}</h3><p>${t('help.explore')}</p></article><article>${icon('layers', 24)}<h3>${t('help.fusionTitle')}</h3><p>${t('help.fusion')}</p></article><article>${icon('link', 24)}<h3>${t('help.responseTitle')}</h3><p>${t('help.response')}</p></article><article>${icon('chart', 24)}<h3>${t('help.exportTitle')}</h3><p>${t('help.export')}</p></article></div><div class="keyboard-hints"><span><kbd>←</kbd><kbd>→</kbd>${t('help.selectDevice')}</span><span><kbd>+</kbd><kbd>−</kbd>${t('help.zoom')}</span><span><kbd>0</kbd>${t('help.reset')}</span><span><kbd>Esc</kbd>${t('help.close')}</span></div><div class="dialog-disclaimer">${icon('help', 16)}${t('help.disclaimer')}</div>`);
}

function openSettingsDialog(): void {
  openDialog('settings', t('settings.title'), 'DISPLAY PREFERENCES', `<p class="settings-description">${t('settings.description')}</p><div class="settings-list"><label><span>${icon('layers', 21)}<span><b>${t('settings.coverage')}</b><small>${t('settings.coverageHint')}</small></span></span><input type="checkbox" role="switch" data-setting="coverage" ${coverageVisible ? 'checked' : ''}/></label><label><span>${icon('tag', 21)}<span><b>${t('settings.labels')}</b><small>${t('settings.labelsHint')}</small></span></span><input type="checkbox" role="switch" data-setting="labels" ${labelsVisible ? 'checked' : ''}/></label><label><span>${icon('moon', 21)}<span><b>${t('settings.night')}</b><small>${t('settings.nightHint')}</small></span></span><input type="checkbox" role="switch" data-setting="night" ${nightMode ? 'checked' : ''}/></label></div><div class="dialog-actions"><button class="secondary-button" data-action="reset-settings">${icon('refresh', 15)}${t('settings.reset')}</button></div>`);
}

function openFeedDialog(feed: 'hd' | 'ir'): void {
  expandedFeed = feed;
  openDialog('feed', t(feed === 'hd' ? 'feed.hdTitle' : 'feed.irTitle'), 'LIVE SIMULATED FEED · NOT A REAL CAMERA', `<div class="expanded-feed-wrapper"><canvas id="expanded-feed" width="960" height="540"></canvas><span class="expanded-feed-badge"><i></i>${t('feed.liveSimulated')}</span><span class="expanded-feed-caption">${t(feed === 'hd' ? 'feed.hdCaption' : 'feed.irCaption')}</span></div><div class="dialog-footer-note"><span>${t('common.currentScenario', { name: SCENARIOS[state.scenario].name })}</span><span>${t('feed.rendered')}</span></div>`);
  updateExpandedFeed();
}

function updateExpandedFeed(): void {
  const target = document.querySelector<HTMLCanvasElement>('#expanded-feed');
  const source = element<HTMLCanvasElement>(expandedFeed === 'hd' ? '#hd-preview' : '#ir-preview');
  target?.getContext('2d')?.drawImage(source, 0, 0, 960, 540);
}

function toggleDisplay(setting: string, checked?: boolean): void {
  if (setting === 'coverage') {
    coverageVisible = checked ?? !coverageVisible;
    scene?.setCoverage(coverageVisible);
    element('#toggle-coverage').classList.toggle('is-active', coverageVisible);
    element('#toggle-coverage').setAttribute('aria-pressed', String(coverageVisible));
  } else if (setting === 'labels') {
    labelsVisible = checked ?? !labelsVisible;
    scene?.setLabels(labelsVisible);
    element('#toggle-labels').classList.toggle('is-active', labelsVisible);
    element('#toggle-labels').setAttribute('aria-pressed', String(labelsVisible));
  } else if (setting === 'night') {
    nightMode = checked ?? !nightMode;
    scene?.setNight(nightMode);
    element('#toggle-night').classList.toggle('is-active', nightMode);
    element('#toggle-night').setAttribute('aria-pressed', String(nightMode));
    element('#toggle-night').innerHTML = icon(nightMode ? 'sun' : 'moon', 18);
    refreshTelemetry();
  }
}

async function fullscreen(target: HTMLElement): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await target.requestFullscreen();
  } catch (error) {
    console.error('全屏模式启动失败', error);
    toast(t('error.fullscreen'), true);
  }
}

function download(href: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function exportData(): void {
  const data = {
    platform: t('app.brand'),
    language: getLanguage(),
    notice: t('export.notice'),
    exportedAt: new Date().toISOString(),
    scenario: SCENARIOS[state.scenario].name,
    telemetry,
    reconstruction: { displayMode: reconstructionMode, data: scene?.getReconstructionStats() ?? null, notice: t('export.fusionNotice') },
    devices: DEVICES.map((device) => ({ ...device, status: 'simulated-online', reading: sensorReading(device.type, telemetry, state.scenario) })),
    alerts: state.alerts.map((alert) => ({
      ...alert, title: SCENARIOS[alert.scenario].title, location: SCENARIOS[alert.scenario].location,
      resolution: alert.resolution ? translateMessage(alert.resolution) : null,
      timeline: alert.timeline.map((step) => ({ ...step, note: translateMessage(step.note) })),
    })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
  download(url, `railsafty-simulation-${new Date().toISOString().slice(0, 10)}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('toast.exported'));
}

function refreshLocalizedInterface(): void {
  document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  timeFormatter = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  dateFormatter = new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: getLanguage() === 'en' ? 'short' : '2-digit', day: '2-digit', weekday: 'short' });
  applyTranslations(document);
  document.querySelectorAll<HTMLButtonElement>('[data-language]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.language === getLanguage()));
  });
  document.querySelectorAll<HTMLElement>('[data-sensor]').forEach((row) => {
    row.setAttribute('aria-label', t('network.locate', { name: SENSOR_TYPES[row.dataset.sensor as SensorType].name }));
  });
  element('#selected-device-label').textContent = `${selectedDevice.id} · ${SENSOR_TYPES[selectedDevice.type].name}`;
  for (const feed of ['hd', 'ir'] as const) {
    const id = element(`#${feed}-feed-id`).textContent;
    const device = DEVICES.find((candidate) => candidate.id === id);
    if (device) element(`[data-feed-location="${feed}"]`).textContent = t(feed === 'hd' ? 'feed.hdPatrol' : 'feed.irPatrol', { mileage: device.mileage });
  }
  const regionKeys: Record<string, MessageKey> = { all: 'region.all', bridge: 'region.bridge', slope: 'region.slope', forest: 'region.forest' };
  element('#scene-region').textContent = t(regionKeys[element<HTMLSelectElement>('#region-select').value]);
  element('#fusion-mode-name').textContent = t(reconstructionModes.find((mode) => mode.id === reconstructionMode)!.key);
  renderState();
  updateAutoDemoControls();
  scene?.updateLocale();
  renderFusionStats(scene?.getReconstructionStats() ?? null);
  tick();
}

function refreshOpenDialog(): void {
  if (!dialog.open) return;
  const kind = dialogKind;
  const scroll = dialogBody.scrollTop;
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const search = document.querySelector<HTMLInputElement>('#device-search')?.value ?? '';
  const savedDeviceFilter = deviceFilter;
  const savedEventFilter = eventFilter;
  const clearance = document.querySelector<HTMLInputElement>('#clearance-confirm')?.checked ?? false;
  switch (kind) {
    case 'devices':
      openDevicesDialog();
      deviceFilter = savedDeviceFilter;
      element<HTMLInputElement>('#device-search').value = search;
      document.querySelectorAll<HTMLElement>('[data-device-filter]').forEach((tab) => tab.classList.toggle('active', tab.dataset.deviceFilter === deviceFilter));
      filterDevices();
      break;
    case 'events': openEventsDialog(); eventFilter = savedEventFilter; filterEvents(); break;
    case 'device': openDeviceDialog(); break;
    case 'analytics': openAnalyticsDialog(); break;
    case 'resolve':
      openResolveDialog();
      if (clearance) {
        element<HTMLInputElement>('#clearance-confirm').checked = true;
        element<HTMLButtonElement>('[data-action="resolve"]').disabled = false;
      }
      break;
    case 'settings': openSettingsDialog(); break;
    case 'help': openHelpDialog(); break;
    case 'feed': openFeedDialog(expandedFeed); break;
  }
  dialogBody.scrollTop = scroll;
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
}

function changeInterfaceLanguage(next: Language): void {
  if (next === getLanguage()) return;
  setLanguage(next);
  const saved = saveLanguage(languageStorage);
  refreshLocalizedInterface();
  refreshOpenDialog();
  toast(t(saved ? 'language.changed' : 'language.notSaved'), !saved);
}

const panelActions: Record<string, () => void> = {
  home: () => { if (dialog.open) dialog.close(); scene?.setView('overview'); },
  devices: openDevicesDialog,
  events: openEventsDialog,
  analytics: openAnalyticsDialog,
  settings: openSettingsDialog,
  help: openHelpDialog,
};

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLElement>('button');
  if (!button) return;
  if (button.dataset.demoAction === 'toggle') {
    if (autoDemoStatus === 'running') pauseAutoDemo();
    else if (autoDemoStatus === 'paused') resumeAutoDemo();
    else startAutoDemo();
    return;
  }
  if (button.dataset.demoAction === 'stop') { stopAutoDemo(); return; }
  if (isAutoDemoActive()
    && !button.hasAttribute('data-demo-control')
    && !button.dataset.language
    && button.id !== 'global-fullscreen'
    && button.id !== 'scene-fullscreen') stopAutoDemo();
  const language = button.dataset.language;
  if (language === 'zh' || language === 'en') changeInterfaceLanguage(language);
  if (button.dataset.panel) panelActions[button.dataset.panel]?.();
  if (button.dataset.scenario) setScenario(button.dataset.scenario as ScenarioId);
  if (button.dataset.reconstruction) setReconstructionMode(button.dataset.reconstruction as ReconstructionMode);
  if (button.dataset.sensor) {
    const device = DEVICES.find((candidate) => candidate.type === button.dataset.sensor && LABEL_DEVICE_IDS.includes(candidate.id)) ?? DEVICES.find((candidate) => candidate.type === button.dataset.sensor);
    if (device) selectDevice(device);
  }
  if (button.dataset.view) scene?.setView(button.dataset.view as 'overview' | 'patrol' | 'slope');
  if (button.dataset.sceneTab) scene?.setView(button.dataset.sceneTab as 'overview' | 'top');
  if (button.dataset.feed) openFeedDialog(button.dataset.feed as 'hd' | 'ir');
  if (button.dataset.alert) {
    const alert = state.alerts.find((record) => record.id === button.dataset.alert);
    if (alert?.resolvedAt === null) openResolveDialog();
    else openEventsDialog();
  }
  if (button.dataset.locate) {
    const device = DEVICES.find((candidate) => candidate.id === button.dataset.locate);
    if (device) {
      dialog.close();
      selectDevice(device);
      toast(t('toast.located', { id: device.id, mileage: device.mileage }));
    }
  }
  if (button.dataset.alertFocus) {
    const alert = state.alerts.find((candidate) => candidate.id === button.dataset.alertFocus);
    if (alert) {
      dialog.close();
      scene?.focusLocation(...SCENARIOS[alert.scenario].position);
      toast(t(alert.resolvedAt ? 'toast.historicalLocation' : 'toast.currentLocation'));
    }
  }
  if (button.dataset.deviceFilter) {
    deviceFilter = button.dataset.deviceFilter;
    document.querySelectorAll<HTMLElement>('[data-device-filter]').forEach((tab) => tab.classList.toggle('active', tab === button));
    filterDevices();
  }
  if (button.dataset.eventFilter) {
    eventFilter = button.dataset.eventFilter;
    filterEvents();
  }
  if (button.dataset.action === 'close') dialog.close();
  if (button.dataset.action === 'export') exportData();
  if (button.dataset.action === 'response-next') advanceCurrentResponse();
  if (button.dataset.action === 'review-evidence') openResolveDialog();
  if (button.dataset.action === 'history') openEventsDialog();
  if (button.dataset.action === 'dismiss-completion') { completedAlert = null; renderState(); }
  if (button.dataset.action === 'focus-incident') {
    scene?.focusIncident();
    element('#scene-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (button.dataset.action === 'incident-fusion') { setReconstructionMode('fusion'); scene?.focusIncident(); }
  if (button.dataset.action === 'focus-track') scene?.focusReconstructionTarget();
  if (button.dataset.action === 'resolve') {
    const active = state.alerts.find((alert) => alert.resolvedAt === null);
    if (!active || active.phase !== 'responding') { toast(t('toast.prerequisites'), true); return; }
    if (!element<HTMLInputElement>('#clearance-confirm').checked) { toast(t('toast.confirmRecheck'), true); return; }
    if (!completeCurrentResponse()) { toast(t('toast.notReady'), true); return; }
    toast(t('toast.completed'));
  }
  if (button.dataset.action === 'reset-settings') {
    toggleDisplay('coverage', true);
    toggleDisplay('labels', true);
    toggleDisplay('night', false);
    openSettingsDialog();
    toast(t('toast.settingsReset'));
  }
}, { signal: events.signal });

document.addEventListener('pointerdown', (event) => {
  if (!isAutoDemoActive() || !(event.target instanceof Element)) return;
  if (event.target.closest('[data-demo-control], [data-language], #global-fullscreen, #scene-fullscreen')) return;
  if (event.target.closest('button, input, select, canvas, #scene-host')) stopAutoDemo();
}, { signal: events.signal });

document.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.id === 'auto-demo-loop') {
    autoDemoLoop = event.target.checked;
  }
}, { signal: events.signal });

dialogBody.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.dataset.setting) toggleDisplay(event.target.dataset.setting, event.target.checked);
  if (event.target instanceof HTMLInputElement && event.target.id === 'clearance-confirm') {
    element<HTMLButtonElement>('[data-action="resolve"]').disabled = !event.target.checked;
  }
}, { signal: events.signal });
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}, { signal: events.signal });
dialog.addEventListener('close', () => {
  dialogKind = '';
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((button) => {
    button.classList.toggle('active', button.dataset.panel === 'home');
    if (button.dataset.panel === 'home') button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}, { signal: events.signal });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dialog.open) {
    event.preventDefault();
    dialog.close();
  }
}, { signal: events.signal });

element('#close-dialog').addEventListener('click', () => dialog.close(), { signal: events.signal });
element('#device-details').addEventListener('click', openDeviceDialog, { signal: events.signal });
element('#notifications').addEventListener('click', openEventsDialog, { signal: events.signal });
element('#all-events').addEventListener('click', openEventsDialog, { signal: events.signal });
element('#toggle-coverage').addEventListener('click', () => toggleDisplay('coverage'), { signal: events.signal });
element('#toggle-labels').addEventListener('click', () => toggleDisplay('labels'), { signal: events.signal });
element('#toggle-night').addEventListener('click', () => toggleDisplay('night'), { signal: events.signal });
element('#zoom-in').addEventListener('click', () => scene?.zoom(0.83), { signal: events.signal });
element('#zoom-out').addEventListener('click', () => scene?.zoom(1.2), { signal: events.signal });
element('#reset-view').addEventListener('click', () => {
  scene?.setView('overview');
  element<HTMLSelectElement>('#region-select').value = 'all';
  element('#scene-region').textContent = t('region.all');
}, { signal: events.signal });
element('#global-fullscreen').addEventListener('click', () => { void fullscreen(document.documentElement); }, { signal: events.signal });
element('#scene-fullscreen').addEventListener('click', () => { void fullscreen(element('#scene-panel')); }, { signal: events.signal });
element('#capture-scene').addEventListener('click', () => {
  if (!scene) { toast(t('error.capture'), true); return; }
  download(scene.capture(), `railsafty-scene-${Date.now()}.png`);
  toast(t('toast.captured'));
}, { signal: events.signal });
element<HTMLSelectElement>('#region-select').addEventListener('change', (event) => {
  const value = (event.target as HTMLSelectElement).value;
  const locations: Record<string, { key: MessageKey; x: number; z: number }> = {
    bridge: { key: 'region.bridge', x: -33, z: 0 },
    slope: { key: 'region.slope', x: 29, z: -23 },
    forest: { key: 'region.forest', x: -62, z: 4 },
  };
  if (value === 'all') {
    scene?.setView('overview');
    element('#scene-region').textContent = t('region.all');
  } else {
    const location = locations[value];
    scene?.focusLocation(location.x, location.z);
    element('#scene-region').textContent = t(location.key);
  }
}, { signal: events.signal });

renderState();
tick();
try {
  scene = new RailwayScene({
    host: element('#scene-host'),
    hdCanvas: element<HTMLCanvasElement>('#hd-preview'),
    irCanvas: element<HTMLCanvasElement>('#ir-preview'),
    onSelect: (device) => selectDevice(device, false),
    onViewChange: syncView,
    onReconstructionUpdate: renderFusionStats,
    onError: reportSceneError,
  });
  scene.selectDevice(selectedDevice.id);
  scene.updateReadings(telemetry);
  element('#scene-loading').hidden = true;
} catch (error) {
  console.error('Three.js 场景初始化失败', error);
  reportSceneError(error instanceof Error ? error.message : t('error.initialization'));
}
refreshLocalizedInterface();
const timer = setInterval(tick, 1000);
const previewTimer = setInterval(() => { if (dialog.open && dialogKind === 'feed') updateExpandedFeed(); }, 250);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(timer);
    clearInterval(previewTimer);
    clearTimeout(toastTimer);
    if (autoDemoTimer !== null) clearTimeout(autoDemoTimer);
    drillDockObserver.disconnect();
    events.abort();
    dialog.close();
    scene?.dispose();
  });
}
